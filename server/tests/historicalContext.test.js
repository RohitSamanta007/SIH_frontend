"use strict";

jest.mock("../src/models", () => ({
  Case: { find: jest.fn() }, Entity: { find: jest.fn() }, Edge: { find: jest.fn() },
}));

const { Case, Entity, Edge } = require("../src/models");
const { buildExactCaseHistory, buildRetrievalContext } = require("../src/services/historicalContextService");

const leanQuery = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const limitedQuery = (value) => ({ limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) });

describe("historical exact evidence", () => {
  beforeEach(() => jest.clearAllMocks());

  test("deduplicates by type, normalized value, and logical case ID", async () => {
    Case.find.mockReturnValue(leanQuery([
      { caseId: "OLD-1", normalizedIdentifiers: { phones: ["9012345678", "9012345678"] } },
      { caseId: "OLD-2", normalizedIdentifiers: { phones: ["9012345678"] } },
    ]));
    Entity.find.mockReturnValue(leanQuery([
      { associatedCases: ["OLD-1"], normalizedPhones: ["9012345678", "9012345678"] },
    ]));
    const history = await buildExactCaseHistory("NEW-1", { phones: ["9012345678"], vehicles: [], emails: [], accounts: [], addresses: [] });
    expect(history).toEqual([
      { canonicalId: "phone:9012345678", type: "phone", lastSeenCaseId: "OLD-1" },
      { canonicalId: "phone:9012345678", type: "phone", lastSeenCaseId: "OLD-2" },
    ]);
  });

  test("builds bounded exact packets and never sends an unrelated full FIR", async () => {
    const fullFir = `Unrelated opening. Exact phone +91 90123 45678 appeared in a call.${" private narrative".repeat(200)}`;
    Case.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ caseId: "OLD-1", retrievalSummary: "Bounded summary", textReports: [fullFir], normalizedIdentifiers: { phones: ["9012345678"] } }]),
    });
    Entity.find.mockReturnValue(limitedQuery([{ canonicalId: "PHONE-1", type: "phone", aliases: ["+91 90123 45678"] }]));
    Edge.find.mockReturnValue(limitedQuery([{
      source: "PERSON-1", target: "PHONE-1", edgeType: "telecom_link", relationReason: "CDR call",
      eventDate: "2025-01-02", eventTime: "10:30", eventType: "call", dateConfidence: "explicit", confidence: 0.98,
      evidence: [{ record: { excerpt: "9012345678 called the suspect" } }],
    }]));
    const packets = await buildRetrievalContext("NEW-1", { phones: ["9012345678"] });
    expect(packets).toHaveLength(1);
    expect(packets[0].matchType).toBe("exact");
    expect(packets[0].matchedFields).toEqual(["phone:9012345678"]);
    expect(packets[0].caseSummary).toContain("CDR call");
    expect(packets[0].caseSummary).toContain("2025-01-02 10:30 call explicit");
    expect(packets[0].reportExcerpt).toContain("90123 45678");
    expect(packets[0].reportExcerpt.length).toBeLessThanOrEqual(500);
    expect(packets[0].caseSummary.length).toBeLessThanOrEqual(1200);
    expect(packets[0].reportExcerpt).not.toBe(fullFir);
  });
});
