"use strict";

const { persistCaseResults } = require("../src/services/resultPersistenceService");
const { buildExactCaseHistory, buildRetrievalContext } = require("../src/services/historicalContextService");
const { Case, Entity, Edge, Pattern } = require("../src/models");
const mongoose = require("mongoose");

jest.mock("../src/models", () => ({
  Case: {
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    find: jest.fn(),
  },
  Entity: {
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    find: jest.fn(),
  },
  Edge: {
    findOne: jest.fn(),
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    find: jest.fn(),
  },
  Pattern: {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  }
}));

jest.mock("mongoose", () => ({
  startSession: jest.fn(() => ({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
  })),
  Schema: class {
    constructor() {}
    index() {}
  },
  model: jest.fn()
}));

describe("Backend Requirements Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Requirement 1 & 2: Should store timelineEvents on Case", async () => {
    const caseId = "CASE_123";
    const fastApiResult = {
      caseId,
      retrievalSummary: "Test summary",
      timelineEvents: [
        {
          eventDate: "2024-03-15",
          eventTime: "14:30:00",
          eventType: "theft_reported",
          relationReason: "Victim reported theft",
          edgeId: "edge_001",
          evidenceIds: ["ev_1"],
          dateConfidence: "explicit",
        }
      ],
      entities: [],
      edges: []
    };

    Case.findOne.mockResolvedValue(null);
    Case.create.mockResolvedValue([{ 
      caseId, 
      status: "completed", 
      timelineEvents: fastApiResult.timelineEvents 
    }]);

    const result = await persistCaseResults(fastApiResult, { title: "Test Case" });
    
    expect(Case.create).toHaveBeenCalled();
    const createArg = Case.create.mock.calls[0][0][0];
    expect(createArg.timelineEvents).toBeDefined();
    expect(createArg.timelineEvents.length).toBe(1);
    expect(createArg.timelineEvents[0].eventDate).toBe("2024-03-15");
  });

  it("Requirement 3: buildExactCaseHistory uses exact normalized identifier equality", async () => {
    const historicalCaseId = "CASE_HIST";
    
    const mockEntities = [{
      canonicalId: "ent_hist",
      type: "person",
      associatedCases: [historicalCaseId],
      normalizedPhones: ["9876543210"]
    }];

    Case.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{
      caseId: historicalCaseId,
      normalizedIdentifiers: { phones: ["9876543210"] }
    }]) });
    Entity.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(mockEntities) });

    const newCaseId = "CASE_NEW";
    const currentIdentifiers = {
      phones: ["9876543210"],
      vehicles: [],
      emails: [],
      accounts: []
    };

    const history = await buildExactCaseHistory(newCaseId, currentIdentifiers);
    expect(history.length).toBe(1);
    expect(history[0].canonicalId).toBe("phone:9876543210");
    expect(history[0].type).toBe("phone");
    expect(history[0].lastSeenCaseId).toBe(historicalCaseId);

    const findArg = Case.find.mock.calls[0][0];
    expect(findArg.$or).toBeDefined();
    expect(findArg.$or[0]["normalizedIdentifiers.phones"]).toBeDefined();
  });

  it("Requirement 3: buildRetrievalContext extracts retrievalSummary and bounded excerpts", async () => {
    const historicalCaseId = "CASE_HIST";
    
    const mockCases = [{
      caseId: historicalCaseId,
      title: "Historical Case",
      retrievalSummary: "Historical theft summary",
      textReports: ["Long FIR text"],
      normalizedIdentifiers: {
        phones: ["9876543210"]
      }
    }];

    Case.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(mockCases)
    });
    
    Entity.find.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });

    const newCaseId = "CASE_NEW";
    const currentIdentifiers = {
      phones: ["9876543210"],
      vehicles: [],
      emails: [],
      accounts: []
    };

    const context = await buildRetrievalContext(newCaseId, currentIdentifiers, ["Some new text"]);
    
    expect(context.length).toBe(1);
    expect(context[0].caseId).toBe(historicalCaseId);
    expect(context[0].caseSummary).toBe("Historical theft summary");
    expect(context[0].matchType).toBe("exact");
    
    const findArg = Case.find.mock.calls[0][0];
    expect(findArg.caseId.$ne).toBe(newCaseId);
  });
});
