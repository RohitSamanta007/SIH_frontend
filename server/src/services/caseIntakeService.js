const { parse } = require("csv-parse/sync");
const { generateCaseId } = require("../utils/caseIdGenerator");
const { AppError } = require("../utils/AppError");

/**
 * Custom application error with HTTP status code and error code
 */
class IntakeError extends AppError {
  constructor(message, statusCode = 422, code = "VALIDATION_ERROR", details = null) {
    super(message, code, statusCode, details);
  }
}

/**
 * Normalize and validate incoming text report inputs
 * @param {string|string[]|any} rawText - Unstructured text or array of text reports
 * @returns {string[]} Array of non-empty text reports
 */
const normalizeTextReports = (rawText) => {
  if (!rawText) {
    return [];
  }

  let textArray = [];

  if (Array.isArray(rawText)) {
    textArray = rawText;
  } else if (typeof rawText === "string") {
    // Check if the string is a JSON array representation
    const trimmed = rawText.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          textArray = parsed;
        } else {
          textArray = [trimmed];
        }
      } catch {
        textArray = [trimmed];
      }
    } else {
      textArray = [trimmed];
    }
  } else {
    return [];
  }

  // Filter out non-string, empty, or whitespace-only reports
  const validReports = textArray
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => {
      const trimmed = item.trim();
      if (trimmed.length > 500000) {
        throw new IntakeError("Individual text report exceeds maximum permitted length of 500,000 characters", 422, "TEXT_TOO_LONG");
      }
      return trimmed;
    });

  return validReports;
};

/**
 * Parse and validate CSV data into plain JSON records
 * @param {Buffer|string} csvData - Raw CSV buffer or string
 * @returns {Array<Record<string, any>>} Array of parsed CSV record objects
 */
const parseCsvRecords = (csvData) => {
  if (!csvData) {
    return [];
  }

  const csvString = Buffer.isBuffer(csvData) ? csvData.toString("utf8") : String(csvData);
  const trimmedCsv = csvString.trim();

  if (!trimmedCsv) {
    return [];
  }

  try {
    const records = parse(trimmedCsv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    });

    if (!Array.isArray(records) || records.length === 0) {
      throw new IntakeError("Uploaded CSV contains no valid data rows", 422, "EMPTY_CSV_DATA");
    }

    // Verify header columns exist
    const sampleRecord = records[0];
    const headerKeys = Object.keys(sampleRecord);

    if (headerKeys.length === 0 || headerKeys.every((key) => !key || key.trim() === "")) {
      throw new IntakeError("Uploaded CSV is missing a valid header row", 422, "MISSING_CSV_HEADER");
    }

    return records;
  } catch (error) {
    if (error instanceof IntakeError) {
      throw error;
    }
    // Handle CSV parse syntax errors
    throw new IntakeError(`Malformed CSV data: ${error.message}`, 422, "MALFORMED_CSV");
  }
};

/**
 * Process and normalize case intake from text reports and/or CSV inputs
 * @param {Object} params
 * @param {string|string[]} [params.textInput] - Text reports
 * @param {Buffer} [params.csvBuffer] - Uploaded CSV buffer
 * @param {string} [params.csvString] - Uploaded or body CSV string
 * @param {string} [params.title] - Case Name
 * @param {string} [params.category] - Category
 * @returns {{ caseId: string, textReports: string[], csvRecords: Array<Record<string, any>>, title?: string, category?: string }}
 */
const processCaseIntake = ({ textInput, csvBuffer, csvString, title, category }) => {
  // 1. Normalize text reports
  const textReports = normalizeTextReports(textInput);

  // 2. Parse CSV records
  const csvRecords = parseCsvRecords(csvBuffer || csvString);

  // 3. Reject if no usable data is present
  if (textReports.length === 0 && csvRecords.length === 0) {
    throw new IntakeError("At least one usable text report or CSV record must be provided", 422, "NO_USABLE_INPUT");
  }

  // 4. Generate unique collision-resistant caseId
  const caseId = generateCaseId();

  // 5. Return normalized intake payload
  return {
    caseId,
    textReports,
    csvRecords,
    title,
    category,
  };
};

module.exports = {
  IntakeError,
  normalizeTextReports,
  parseCsvRecords,
  processCaseIntake,
};
