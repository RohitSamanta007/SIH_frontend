const env = require("../../config/env");
const { AppError } = require("../utils/AppError");

/**
 * Custom error class representing FastAPI transport & upstream communication failures
 */
class FastApiError extends AppError {
  constructor(message, statusCode = 502, code = "FASTAPI_UPSTREAM_ERROR", details = null) {
    super(message, code, statusCode, details);
  }
}

/**
 * Sends a normalized case intake payload to Argha's FastAPI reasoning core
 *
 * @param {Object} normalizedCase - Case intake payload
 * @param {string} normalizedCase.caseId - Case identifier
 * @param {string[]} normalizedCase.textReports - Array of text reports
 * @param {Array<Record<string, any>>} normalizedCase.csvRecords - Array of parsed CSV objects
 * @param {Object} [options] - Optional overrides (e.g. for testing)
 * @param {string} [options.baseUrl] - Custom base URL
 * @param {number} [options.timeoutMs] - Custom timeout in milliseconds
 * @returns {Promise<{ caseId: string, entities: any[], relationships: any[], patterns: any[], guardrail: any[] }>}
 */
const callFastAPI = async (normalizedCase, options = {}) => {
  const baseUrl = options.baseUrl !== undefined ? options.baseUrl : env.FASTAPI_BASE_URL;
  const timeoutMs = options.timeoutMs || env.FASTAPI_TIMEOUT_MS || 30000;

  if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new FastApiError(
      "FASTAPI_BASE_URL is not configured in environment variables",
      500,
      "FASTAPI_CONFIG_ERROR"
    );
  }

  // Construct target endpoint
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/case`;

  // Construct exact clean request payload (no secrets, no internal tokens, no unnecessary metadata)
  const requestPayload = {
    caseId: normalizedCase.caseId,
    textReports: Array.isArray(normalizedCase.textReports) ? normalizedCase.textReports : [],
    csvRecords: Array.isArray(normalizedCase.csvRecords) ? normalizedCase.csvRecords : [],
  };

  // Build request headers
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Optional internal shared secret header (only if configured in environment)
  if (env.FASTAPI_INTERNAL_SECRET) {
    headers["X-Internal-Secret"] = env.FASTAPI_INTERNAL_SECRET;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);

    // Timeout detection
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      throw new FastApiError(
        `FastAPI request timed out after ${timeoutMs}ms`,
        504,
        "FASTAPI_TIMEOUT"
      );
    }

    // Network / connection refusal / DNS errors
    const isConnRefused =
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.cause?.code === "ECONNREFUSED" ||
      err.cause?.code === "ENOTFOUND" ||
      err.message?.toLowerCase().includes("fetch failed");

    if (isConnRefused) {
      throw new FastApiError(
        `FastAPI service is unavailable at ${endpoint}`,
        502,
        "FASTAPI_UNAVAILABLE",
        err.message
      );
    }

    throw new FastApiError(
      `Failed to communicate with FastAPI: ${err.message}`,
      502,
      "FASTAPI_TRANSPORT_ERROR",
      err.message
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle upstream HTTP error responses (4xx, 5xx)
  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // Ignore reading error body
    }

    throw new FastApiError(
      `FastAPI upstream returned error HTTP ${response.status}`,
      502,
      "FASTAPI_UPSTREAM_ERROR",
      { status: response.status, body: errorBody }
    );
  }

  // Parse and validate response JSON
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
      502,
      "FASTAPI_INVALID_RESPONSE"
    );
  }

  if (typeof responseData !== "object" || responseData === null || Array.isArray(responseData)) {
    throw new FastApiError(
      "FastAPI returned malformed response payload (expected object)",
      502,
      "FASTAPI_INVALID_RESPONSE"
    );
  }

  // Return draft logical structure preserving all returned AI fields
  return {
    caseId: responseData.caseId || normalizedCase.caseId,
    entities: Array.isArray(responseData.entities) ? responseData.entities : [],
    relationships: Array.isArray(responseData.relationships) ? responseData.relationships : [],
    patterns: Array.isArray(responseData.patterns) ? responseData.patterns : [],
    guardrail: Array.isArray(responseData.guardrail) ? responseData.guardrail : [],
    ...responseData,
  };
};

module.exports = {
  callFastAPI,
  FastApiError,
};
