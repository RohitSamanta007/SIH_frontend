"use strict";

const env = require("../../config/env");
const { AppError } = require("../utils/AppError");

/**
 * Custom error class for FastAPI transport & upstream communication failures.
 * Matches AppError constructor: (message, code, statusCode, details)
 */
class FastApiError extends AppError {
  constructor(message, code = "FASTAPI_UPSTREAM_ERROR", statusCode = 502, details = null) {
    super(message, code, statusCode, details);
  }
}

/**
 * Sends a normalized case intake payload to the FastAPI reasoning core.
 *
 * Request payload (CaseRequest Pydantic contract):
 *   caseId           — unique case identifier
 *   caseName         — human-readable case name (from intake title)
 *   caseCategory     — investigation category (e.g. "Fraud", "Terrorism")
 *   textReports      — full current FIR / report text array
 *   csvRecords       — parsed current CSV/CDR records
 *   caseHistory      — exact normalized-identifier matches from previous cases
 *   retrievalContext — up to 3 bounded historical case summaries + FIR excerpts
 *
 * Response fields mapped back:
 *   entities, relationships, patterns, guardrail — existing fields
 *   retrievalSummary                             — NEW: AI-generated summary
 *   similarCaseLeads                             — NEW: Chroma semantic leads
 *
 * @param {Object} normalizedCase
 * @param {Object} [options]  Optional overrides for testing (baseUrl, timeoutMs)
 * @returns {Promise<Object>}
 */
const callFastAPI = async (normalizedCase, options = {}) => {
  const baseUrl   = options.baseUrl !== undefined ? options.baseUrl : env.FASTAPI_BASE_URL;
  const timeoutMs = options.timeoutMs || env.FASTAPI_TIMEOUT_MS || 60000;

  if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new FastApiError(
      "FASTAPI_BASE_URL is not configured in environment variables",
      "FASTAPI_CONFIG_ERROR",
      500
    );
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/case`;

  // ── Build request payload ────────────────────────────────────────────────
  const requestPayload = {
    caseId:       normalizedCase.caseId,
    caseName:     typeof normalizedCase.caseName     === "string" ? normalizedCase.caseName     : "",
    caseCategory: typeof normalizedCase.caseCategory === "string" ? normalizedCase.caseCategory : "",
    textReports:  Array.isArray(normalizedCase.textReports)  ? normalizedCase.textReports  : [],
    csvRecords:   Array.isArray(normalizedCase.csvRecords)   ? normalizedCase.csvRecords   : [],
    caseHistory:  Array.isArray(normalizedCase.caseHistory)  ? normalizedCase.caseHistory  : [],
    retrievalContext: Array.isArray(normalizedCase.retrievalContext)
      ? normalizedCase.retrievalContext
      : [],
  };

  // ── Request headers ──────────────────────────────────────────────────────
  const headers = {
    "Content-Type": "application/json",
    Accept:         "application/json",
  };
  if (env.FASTAPI_INTERNAL_SECRET) {
    headers["X-Internal-Secret"] = env.FASTAPI_INTERNAL_SECRET;
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method:  "POST",
      headers,
      body:    JSON.stringify(requestPayload),
      signal:  controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === "AbortError" || err.name === "TimeoutError") {
      throw new FastApiError(
        `FastAPI request timed out after ${timeoutMs}ms`,
        "FASTAPI_TIMEOUT",
        504
      );
    }

    const isConnRefused =
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.cause?.code === "ECONNREFUSED" ||
      err.cause?.code === "ENOTFOUND" ||
      err.message?.toLowerCase().includes("fetch failed");

    if (isConnRefused) {
      throw new FastApiError(
        `FastAPI service is unavailable at ${endpoint}`,
        "FASTAPI_UNAVAILABLE",
        502,
        err.message
      );
    }

    throw new FastApiError(
      `Failed to communicate with FastAPI: ${err.message}`,
      "FASTAPI_TRANSPORT_ERROR",
      502,
      err.message
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // ── Upstream HTTP errors ─────────────────────────────────────────────────
  if (!response.ok) {
    let errorBody = "";
    try { errorBody = await response.text(); } catch { /* ignore */ }
    throw new FastApiError(
      `FastAPI upstream returned error HTTP ${response.status}`,
      "FASTAPI_UPSTREAM_ERROR",
      502,
      { status: response.status, body: errorBody }
    );
  }

  // ── Parse response JSON ──────────────────────────────────────────────────
  let responseData;
  try {
    const rawText = await response.text();
    if (!rawText || !rawText.trim()) {
      throw new Error("Empty response body received from FastAPI");
    }
    responseData = JSON.parse(rawText);
  } catch (err) {
    throw new FastApiError(
      `FastAPI returned invalid or non-JSON response: ${err.message}`,
      "FASTAPI_INVALID_RESPONSE",
      502
    );
  }

  if (typeof responseData !== "object" || responseData === null || Array.isArray(responseData)) {
    throw new FastApiError(
      "FastAPI returned malformed response payload (expected object)",
      "FASTAPI_INVALID_RESPONSE",
      502
    );
  }

  // ── Return normalized response ───────────────────────────────────────────
  return {
    caseId:           responseData.caseId || normalizedCase.caseId,
    entities:         Array.isArray(responseData.entities)      ? responseData.entities      : [],
    relationships:    Array.isArray(responseData.relationships) ? responseData.relationships : [],
    patterns:         Array.isArray(responseData.patterns)      ? responseData.patterns      : [],
    guardrail:        Array.isArray(responseData.guardrail)     ? responseData.guardrail     : [],
    // New FastAPI response fields
    retrievalSummary: typeof responseData.retrievalSummary === "string"
      ? responseData.retrievalSummary
      : null,
    similarCaseLeads: Array.isArray(responseData.similarCaseLeads)
      ? responseData.similarCaseLeads
      : [],
    // Forward all other fields for future extensibility
    ...responseData,
  };
};

module.exports = { callFastAPI, FastApiError };
