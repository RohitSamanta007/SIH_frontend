const { callFastAPI, FastApiError } = require("./fastApiClient");
const { persistCaseResults, PersistenceError } = require("./resultPersistenceService");

/**
 * Case Processing Service (Orchestration Layer)
 * Coordinates normalized case intake with FastAPI AI reasoning, followed by MongoDB persistence
 *
 * @param {Object} normalizedCase - Case intake payload from Module 1
 * @param {string} normalizedCase.caseId - Case ID
 * @param {string[]} normalizedCase.textReports - Array of text reports
 * @param {Array<Record<string, any>>} normalizedCase.csvRecords - Parsed CSV records
 * @param {Object} [options] - Optional transport overrides (timeout, baseUrl)
 * @returns {Promise<Object>} Persistence summary and Case status
 */
const processCaseThroughFastApi = async (normalizedCase, options = {}) => {
  if (!normalizedCase || !normalizedCase.caseId) {
    throw new Error("Invalid case payload passed to caseProcessingService");
  }

  // 1. Call the isolated FastAPI HTTP client (Module 2 Gateway)
  const fastApiResult = await callFastAPI(normalizedCase, options);

  // 2. Persist AI reasoning results into MongoDB (Module 4 Store / T06)
  const persistenceResult = await persistCaseResults(fastApiResult, normalizedCase);

  return persistenceResult;
};

module.exports = {
  processCaseThroughFastApi,
  FastApiError,
  PersistenceError,
};
