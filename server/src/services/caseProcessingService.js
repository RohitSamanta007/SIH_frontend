const { callFastAPI, FastApiError } = require("./fastApiClient");
const { persistCaseResults, PersistenceError } = require("./resultPersistenceService");
const { Entity, Case } = require("../models");

/**
 * Builds a caseHistory payload from all previously resolved canonical entities stored in MongoDB.
 *
 * The reasoning service (FastAPI) is deliberately stateless — it never queries MongoDB.
 * The gateway is responsible for injecting historical entity context per-request so the
 * reasoning core can perform cross-case recurrence detection (Pattern Rule 1).
 *
 * Shape returned matches the CaseHistoryItem Pydantic model exactly:
 *   { canonicalId: string, type: string, lastSeenCaseId: string }
 *
 * @param {string} currentCaseId - Exclude entities belonging to the current (new) case
 * @returns {Promise<Array<{ canonicalId: string, type: string, lastSeenCaseId: string }>>}
 */
const buildCaseHistory = async (currentCaseId) => {
  try {
    // Fetch one representative entity document per (canonicalId, type) pair from previous cases.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    const historicEntities = await Entity.aggregate([
      // Exclude any entity that belongs to the current new case, and enforce 90-day rolling window
      { $match: { 
          caseId: { $ne: currentCaseId },
          createdAt: { $gte: ninetyDaysAgo } 
        } 
      },
      // Sort so the most recently created document wins in the $first accumulator below
      { $sort: { createdAt: -1 } },
      // Deduplicate by canonicalId — one CaseHistoryItem per unique canonical entity
      {
        $group: {
          _id: "$canonicalId",
          type: { $first: "$type" },
          lastSeenCaseId: { $first: "$caseId" },
        },
      },
      // Cap to a reasonable limit to avoid oversized payloads on large deployments
      { $limit: 500 },
    ]);

    // FastAPI CaseHistoryItem.type is a strict Literal enum (lowercase only).
    // MongoDB may hold legacy data with UPPERCASE types or non-enum values (e.g. BANK_ACCOUNT).
    // Normalize to lowercase and filter out any types that aren't in the allowed set.
    const ALLOWED_TYPES = new Set(["person", "phone", "location", "vehicle", "org"]);

    return historicEntities
      .map((doc) => ({
        canonicalId: doc._id,
        type: typeof doc.type === "string" ? doc.type.toLowerCase() : "",
        lastSeenCaseId: doc.lastSeenCaseId,
      }))
      .filter((item) => ALLOWED_TYPES.has(item.type));
  } catch (err) {
    // Non-fatal: if history fetch fails, the reasoning service degrades gracefully
    // (caseHistory defaults to [] — cross-case patterns simply won't fire for this run)
    console.error("[caseProcessingService] Failed to build caseHistory — proceeding with empty history:", err.message);
    return [];
  }
};

/**
 * Case Processing Service (Orchestration Layer)
 * Coordinates normalized case intake with FastAPI AI reasoning, followed by MongoDB persistence.
 *
 * Pipeline:
 *   1. Build caseHistory from MongoDB (existing canonical entities from past cases)
 *   2. Call FastAPI reasoning service with full CaseRequest payload
 *   3. Persist AI results (entities, edges, patterns, guardrail) into MongoDB
 *
 * @param {Object} normalizedCase - Case intake payload from Module 1
 * @param {string} normalizedCase.caseId - Case ID
 * @param {string[]} normalizedCase.textReports - Array of text reports
 * @param {Array<Record<string, any>>} normalizedCase.csvRecords - Parsed CSV records
 * @param {Object} [options] - Optional transport overrides (timeout, baseUrl) — used in tests
 * @returns {Promise<Object>} Persistence summary and Case status
 */
const processCaseThroughFastApi = async (normalizedCase, options = {}) => {
  if (!normalizedCase || !normalizedCase.caseId) {
    throw new Error("Invalid case payload passed to caseProcessingService");
  }

  const caseId = normalizedCase.caseId;

  // 1. Create the Case document in MongoDB immediately with status 'processing'
  //    so the dashboard can show an in-flight indicator while the LLM pipeline runs.
  //    Uses upsert in case of a duplicate submission race.
  try {
    await Case.findOneAndUpdate(
      { caseId },
      { $setOnInsert: { caseId, status: "processing", metadata: {} } },
      { upsert: true, new: false }
    );
  } catch (err) {
    // Non-fatal: persistence will create the document again during the write phase
    console.warn("[caseProcessingService] Could not pre-create Case document:", err.message);
  }

  // 2. Fetch cross-case entity history from MongoDB and inject into the payload.
  //    This is the bridge that keeps reasoning-service stateless while enabling
  //    Pattern Rule 1 (cross_case_recurrence).
  const caseHistory = await buildCaseHistory(caseId);

  const enrichedCase = {
    ...normalizedCase,
    caseHistory,
  };

  // 3. Call the isolated FastAPI HTTP client (Module 2 Gateway)
  let fastApiResult;
  try {
    fastApiResult = await callFastAPI(enrichedCase, options);
  } catch (err) {
    // Mark case as 'failed' in MongoDB — never leave it stuck on 'processing'
    try {
      await Case.updateOne(
        { caseId },
        {
          $set: {
            status: "failed",
            "metadata.failureReason": err.message || "FastAPI call failed",
            "metadata.failureCode": err.code || "FASTAPI_ERROR",
            "metadata.failedAt": new Date().toISOString(),
          },
        }
      );
    } catch (updateErr) {
      console.error("[caseProcessingService] Failed to mark case as failed:", updateErr.message);
    }
    throw err; // Re-throw original FastApiError — errorHandler formats it correctly
  }

  // 4. Persist AI reasoning results into MongoDB (Module 4 Store / T06)
  const persistenceResult = await persistCaseResults(fastApiResult, normalizedCase);

  return persistenceResult;
};

module.exports = {
  processCaseThroughFastApi,
  FastApiError,
  PersistenceError,
};
