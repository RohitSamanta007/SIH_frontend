const fs = require('fs');
let c = fs.readFileSync('src/services/caseGraphService.js', 'utf8');
const start = c.indexOf('const getCaseTimeline =');
const end = c.indexOf('const getGuardrailDetail =');
const newFunc = `const getCaseTimeline = async (caseId) => {
  if (!caseId || typeof caseId !== "string" || !caseId.trim()) {
    throw new ValidationError("A valid caseId parameter is required", "INVALID_CASE_ID");
  }

  const normalizedCaseId = caseId.trim();

  // Verify Case exists
  const caseDoc = await Case.findOne({ caseId: normalizedCaseId }).lean();
  if (!caseDoc) {
    throw new NotFoundError(\`Case '\${normalizedCaseId}' not found\`, "CASE_NOT_FOUND");
  }

  const timelineEvents = Array.isArray(caseDoc.timelineEvents) ? caseDoc.timelineEvents : [];
  
  // Sort timelineEvents chronologically
  const sortedTimeline = timelineEvents.sort((a, b) => {
    if (!a.eventDate) return 1;
    if (!b.eventDate) return -1;
    const ta = new Date(a.eventDate).getTime();
    const tb = new Date(b.eventDate).getTime();
    if (ta !== tb) return ta - tb;
    if (a.eventTime && b.eventTime) return a.eventTime.localeCompare(b.eventTime);
    return 0;
  });

  return {
    caseId: normalizedCaseId,
    totalEvents: sortedTimeline.length,
    timeline: sortedTimeline
  };
};

/**
 * Retrieve guardrail and evidence metadata for a specific edge in a case
 *
 * @param {string} caseId - Case identifier
 * @param {string} edgeId - Edge MongoDB _id
 * @returns {Promise<{ caseId: string, edgeId: string, edge: Object }>}
 */
`;
c = c.substring(0, start) + newFunc + c.substring(end);
fs.writeFileSync('src/services/caseGraphService.js', c);
