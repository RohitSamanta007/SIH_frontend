const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const { app } = require("../server");
const { connectDB, disconnectDB } = require("../config/db");
const { Entity, Edge, Case } = require("../src/models");
const { runCrossCaseLinking } = require("../src/services/crossCaseLinkingService");

describe("Cross-Case Linking Implementation", () => {
  before(async () => {
    await connectDB();
  });

  after(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    await Entity.deleteMany({});
    await Edge.deleteMany({});
    await Case.deleteMany({});
  });

  test("should link entities with matching properties across cases and pull neighbors", async () => {
    // 1. Setup Case A (Existing)
    await Case.create({ caseId: "CASE-A", status: "completed" });
    
    await Entity.create({
      canonicalId: "ENT-A1",
      type: "person",
      aliases: ["Rahul Sharma"],
      attributes: { phone: "+919876543210" },
      associatedCases: ["CASE-A"]
    });

    await Entity.create({
      canonicalId: "ENT-A2",
      type: "phone",
      aliases: [],
      attributes: { number: "+919876543210" },
      associatedCases: ["CASE-A"]
    });

    await Edge.create({
      source: "ENT-A1",
      target: "ENT-A2",
      edgeType: "OWNS",
      associatedCases: ["CASE-A"],
      evidence: [{
        sourceReportId: "REP-1",
        matchedField: "phone",
        record: "+919876543210"
      }]
    });

    // 2. Setup Case B (New)
    await Case.create({ caseId: "CASE-B", status: "completed" });
    
    await Entity.create({
      canonicalId: "ENT-B1",
      type: "person",
      aliases: ["R. Sharma"],
      attributes: { phone: "+919876543210", email: "rahul@example.com" }, // Shared phone!
      associatedCases: ["CASE-B"]
    });

    // 3. Trigger Linking for Case B
    const result = await runCrossCaseLinking("CASE-B");

    // 4. Assertions
    assert.ok(result.linked > 0, "linked should be greater than 0");
    assert.strictEqual(result.edgesCreated, 2, "should create exactly 2 bridge edges (matched both person and phone due to shared string)");
    
    const updatedA1 = await Entity.findOne({ canonicalId: "ENT-A1" });
    assert.ok(updatedA1.associatedCases.includes("CASE-B"), "ENT-A1 should get CASE-B");

    const updatedB1 = await Entity.findOne({ canonicalId: "ENT-B1" });
    assert.ok(updatedB1.associatedCases.includes("CASE-A"), "ENT-B1 should get CASE-A");

    const bridgeEdge = await Edge.findOne({ edgeType: "CROSS_CASE_MATCH" });
    assert.ok(bridgeEdge, "Bridge edge should exist");
    assert.strictEqual(bridgeEdge.guardrailStatus, "cross_case");
    assert.ok(bridgeEdge.associatedCases.includes("CASE-A"));
    assert.ok(bridgeEdge.associatedCases.includes("CASE-B"));

    const updatedA2 = await Entity.findOne({ canonicalId: "ENT-A2" });
    assert.ok(updatedA2.associatedCases.includes("CASE-B"), "Neighbor ENT-A2 should get CASE-B");

    const pulledEdge = await Edge.findOne({ edgeType: "OWNS" });
    assert.ok(pulledEdge.associatedCases.includes("CASE-B"), "Neighbor edge should get CASE-B");
  });
});
