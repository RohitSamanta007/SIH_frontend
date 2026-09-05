"use strict";

const { callFastAPI, FastApiError } = require("./fastApiClient");
const { persistCaseResults, PersistenceError } = require("./resultPersistenceService");
const { Case } = require("../models");
const { runCrossCaseLinking } = require("./crossCaseLinkingService");
const { extractIdentifiersFromCase } = require("./identifierNormalizationService");
const { buildExactCaseHistory, buildRetrievalContext } = require("./historicalContextService");

/**
 * Case Processing Service (Orchestration Layer)
 *
 * Coordinates normalized case intake → historical context injection →
 * FastAPI reasoning call → MongoDB persistence.
 *
 * Pipeline:
 *  1. Create/upsert Case document with status "processing"
 *  2. Extract normalized identifiers from current FIR + CSV
 *  3. Build caseHistory from EXACT identifier matches in previous cases
 *  4. Build retrievalContext from up to 3 best MongoDB matches
 *  5. Call FastAPI reasoning service with complete enriched payload
 *  6. Persist AI results into MongoDB (entities, edges, patterns, guardrail)
 *  7. Trigger cross-case background linking (fire-and-forget)
 *
 * @param {Object} normalizedCase — from caseIntakeService.processCaseIntake()
 * @param {Object} [options]      — transport overrides used in tests
 * @returns {Promise<Object>}      Persistence summary and Case status
 */
const processCaseThroughFastApi = async (normalizedCase, options = {}) => {
  if (!normalizedCase || !normalizedCase.caseId) {
    throw new Error("Invalid case payload passed to caseProcessingService");
  }

  const caseId = normalizedCase.caseId;

  // ── 1. Create the Case document immediately so the dashboard can show "processing" ──
  try {
    const newMetadata = {};
    if (normalizedCase.category) newMetadata.category = normalizedCase.category;

    await Case.findOneAndUpdate(
      { caseId },
      {
        $setOnInsert: {
          caseId,
          status: "processing",
          title: normalizedCase.title,
          metadata: newMetadata,
        },
      },
      { upsert: true, new: false }
    );
  } catch (err) {
    console.warn("[caseProcessingService] Could not pre-create Case document:", err.message);
  }

  // ── 2. Extract normalized identifiers from the current FIR and CSV data ──
  //    This is used to build the exact-match caseHistory and retrievalContext.
  let normalizedIdentifiers = { phones: [], vehicles: [], emails: [], accounts: [], addresses: [] };
  try {
    normalizedIdentifiers = extractIdentifiersFromCase(
      normalizedCase.textReports || [],
      normalizedCase.csvRecords  || []
    );
    console.log(
      `[caseProcessingService] Extracted identifiers for ${caseId}:`,
      `phones=${normalizedIdentifiers.phones.length}`,
      `vehicles=${normalizedIdentifiers.vehicles.length}`,
      `emails=${normalizedIdentifiers.emails.length}`,
      `accounts=${normalizedIdentifiers.accounts.length}`,
      `addresses=${normalizedIdentifiers.addresses.length}`
    );
  } catch (err) {
    console.warn("[caseProcessingService] Identifier extraction failed:", err.message);
  }

  // Preserve submitted audit material and searchable identifiers before the
  // remote call. A FastAPI outage must not erase the intake record.
  await Case.updateOne(
    { caseId },
    {
      $set: {
        status: "processing",
        ...(normalizedCase.title ? { title: normalizedCase.title } : {}),
        ...(normalizedCase.category ? { "metadata.category": normalizedCase.category } : {}),
        "normalizedIdentifiers.phones": normalizedIdentifiers.phones,
        "normalizedIdentifiers.vehicles": normalizedIdentifiers.vehicles,
        "normalizedIdentifiers.emails": normalizedIdentifiers.emails,
        "normalizedIdentifiers.accounts": normalizedIdentifiers.accounts,
        "normalizedIdentifiers.addresses": normalizedIdentifiers.addresses,
      },
      $addToSet: {
        textReports: { $each: normalizedCase.textReports || [] },
        csvRecords: { $each: normalizedCase.csvRecords || [] },
      },
    }
  );

  // ── 3. Build caseHistory from exact identifier matches ───────────────────
  //    Non-fatal: if lookup fails, proceed with empty history so FastAPI still runs.
  let caseHistory = [];
  try {
    caseHistory = await buildExactCaseHistory(caseId, normalizedIdentifiers);
    console.log(`[caseProcessingService] caseHistory entries: ${caseHistory.length}`);
  } catch (err) {
    console.error("[caseProcessingService] buildExactCaseHistory failed — empty history:", err.message);
  }

  // ── 4. Build retrievalContext from up to 3 best historical matches ────────
  //    Non-fatal: if context building fails, send empty array.
  let retrievalContext = [];
  try {
    retrievalContext = await buildRetrievalContext(
      caseId,
      normalizedIdentifiers,
      normalizedCase.textReports || []
    );
    console.log(`[caseProcessingService] retrievalContext entries: ${retrievalContext.length}`);
  } catch (err) {
    console.error("[caseProcessingService] buildRetrievalContext failed — empty context:", err.message);
  }

  // ── 5. Build enriched payload and call FastAPI ───────────────────────────
  const enrichedCase = {
    ...normalizedCase,
    caseHistory,
    retrievalContext,
    // caseName and caseCategory are passed through for FastAPI context
    caseName:     normalizedCase.title    || "",
    caseCategory: normalizedCase.category || "",
  };

  let fastApiResult;
  try {
    fastApiResult = await callFastAPI(enrichedCase, options);
  } catch (err) {
    // Mark case as 'failed' — never leave it stuck on 'processing'
    try {
      await Case.updateOne(
        { caseId },
        {
          $set: {
            status: "failed",
            "metadata.failureReason": err.message || "FastAPI call failed",
            "metadata.failureCode":   err.code || "FASTAPI_ERROR",
            "metadata.failedAt":      new Date().toISOString(),
          },
        }
      );
    } catch (updateErr) {
      console.error("[caseProcessingService] Failed to mark case as failed:", updateErr.message);
    }
    throw err;
  }

  // ── 6. Persist AI reasoning results into MongoDB ─────────────────────────
  console.log(`[caseProcessingService] Calling persistCaseResults for ${caseId}...`);
  const persistenceResult = await persistCaseResults(fastApiResult, {
    ...normalizedCase,
    normalizedIdentifiers,
  });
  console.log(`[caseProcessingService] persistCaseResults finished for ${caseId}.`);

  // ── 7. Trigger cross-case background linking (fire-and-forget) ───────────
  runCrossCaseLinking(caseId).catch((err) => {
    console.error("[caseProcessingService] Background cross-case linking failed:", err.message);
  });

  return persistenceResult;
};

module.exports = {
  processCaseThroughFastApi,
  FastApiError,
  PersistenceError,
};
