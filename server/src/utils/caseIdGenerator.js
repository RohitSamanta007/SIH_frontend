const crypto = require("crypto");

/**
 * Generate a unique, collision-resistant Case ID.
 * Format: CASE-<timestamp>-<randomHex>
 * Example: CASE-1787679000000-A3F8B1
 *
 * @returns {string} Unique Case ID
 */
const generateCaseId = () => {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `CASE-${timestamp}-${randomSuffix}`;
};

module.exports = {
  generateCaseId,
};
