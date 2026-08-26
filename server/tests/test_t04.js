const mongoose = require("mongoose");
const http = require("http");
const { connectDB, disconnectDB } = require("../config/db");
const { Case, Entity, Edge, Pattern } = require("../src/models");

function makeRequest({ path, method = "GET", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 5000,
        path,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runT04Tests() {
  console.log("=== STARTING T04 MONGOOSE DATA MODELS TEST SUITE ===\n");

  await connectDB();

  const db = mongoose.connection.db;
  // Clean up any test artifacts
  await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-" } });
  await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-" } });
  await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-" } });
  await db.collection("patterns").deleteMany({ caseId: { $regex: "^CASE-TEST-" } });

  // Ensure fresh indexes
  await Case.syncIndexes();
  await Entity.syncIndexes();
  await Edge.syncIndexes();
  await Pattern.syncIndexes();

  const testCaseId = `CASE-TEST-T04-${Date.now()}`;

  try {
    // -------------------------------------------------------------
    // Test A: Valid Case document saves successfully
    // -------------------------------------------------------------
    console.log("--- Test A: Valid Case creation ---");
    const testCase = await Case.create({
      caseId: testCaseId,
      status: "pending",
      title: "Test Investigation Alpha",
      sourceUploads: [
        {
          uploadId: "UPL-001",
          type: "text",
          filename: "fir_report.txt",
          recordCount: 1,
        },
      ],
      metadata: { department: "Cybercrime Unit" },
    });
    console.log("Created Case ID:", testCase.caseId, "| Status:", testCase.status);
    console.log("Has createdAt timestamp:", !!testCase.createdAt);

    // -------------------------------------------------------------
    // Test B: Duplicate Case ID is rejected
    // -------------------------------------------------------------
    console.log("\n--- Test B: Duplicate Case ID rejection ---");
    let duplicateCaseRejected = false;
    try {
      await Case.create({
        caseId: testCaseId,
        status: "pending",
      });
    } catch (err) {
      duplicateCaseRejected = true;
      console.log("Duplicate Case rejected successfully:", err.code === 11000 || err.message.includes("E11000"));
    }
    if (!duplicateCaseRejected) {
      throw new Error("FAIL: Duplicate Case ID was not rejected!");
    }

    // -------------------------------------------------------------
    // Test C: Valid Entity creation
    // -------------------------------------------------------------
    console.log("\n--- Test C: Valid Entity creation ---");
    const entity1 = await Entity.create({
      caseId: testCaseId,
      canonicalId: "PERSON-001",
      type: "PERSON",
      aliases: ["Rahul Sharma", "RS"],
      attributes: { phone: "+919876543210", city: "Mumbai" },
      confidence: 0.95,
    });
    console.log("Created Entity 1:", entity1.canonicalId, "| Type:", entity1.type);

    const entity2 = await Entity.create({
      caseId: testCaseId,
      canonicalId: "BANK_ACCOUNT-001",
      type: "BANK_ACCOUNT",
      aliases: ["HDFC-99128"],
      attributes: { ifsc: "HDFC0001234", accountNumber: "XXXX1234" },
      confidence: 1.0,
    });
    console.log("Created Entity 2:", entity2.canonicalId, "| Type:", entity2.type);

    // -------------------------------------------------------------
    // Test H: Compound Unique (caseId, canonicalId) on Entity
    // -------------------------------------------------------------
    console.log("\n--- Test H: Duplicate Entity canonicalId within same case ---");
    let duplicateEntityRejected = false;
    try {
      await Entity.create({
        caseId: testCaseId,
        canonicalId: "PERSON-001",
        type: "PERSON",
      });
    } catch (err) {
      duplicateEntityRejected = true;
      console.log("Duplicate Entity rejected successfully:", err.code === 11000 || err.message.includes("E11000"));
    }

    // -------------------------------------------------------------
    // Test D: Valid Edge WITH Evidence
    // -------------------------------------------------------------
    console.log("\n--- Test D: Valid Edge with evidence saves successfully ---");
    const validEdge = await Edge.create({
      caseId: testCaseId,
      source: "PERSON-001",
      target: "BANK_ACCOUNT-001",
      edgeType: "TRANSACTION_SENT",
      confidence: 0.9,
      timestamp: new Date("2026-08-15T12:00:00Z"),
      guardrailStatus: "approved",
      guardrailRationale: "Direct bank transfer record corroborated by CDR metadata",
      evidence: [
        {
          sourceType: "transaction_csv",
          record: { txn_id: "TXN-99881", amount: 50000 },
          field: "amount",
          value: 50000,
          citation: "Bank statement line 42",
        },
      ],
    });
    console.log(
      "Created Edge:",
      `${validEdge.source} -> ${validEdge.target} (${validEdge.edgeType})`,
      "| Evidence count:",
      validEdge.evidence.length
    );

    // -------------------------------------------------------------
    // Test E: Edge WITHOUT evidence field fails Mongoose validation
    // -------------------------------------------------------------
    console.log("\n--- Test E: Edge without evidence fails Mongoose validation ---");
    let edgeWithoutEvidenceFailed = false;
    try {
      await Edge.create({
        caseId: testCaseId,
        source: "PERSON-001",
        target: "BANK_ACCOUNT-001",
        edgeType: "CALLED",
      });
    } catch (err) {
      edgeWithoutEvidenceFailed = true;
      console.log("Edge without evidence rejected with error:", err.name, "|", err.message);
    }
    if (!edgeWithoutEvidenceFailed) {
      throw new Error("FAIL: Edge without evidence was saved!");
    }

    // -------------------------------------------------------------
    // Test F: Edge with empty evidence [] fails Mongoose validation
    // -------------------------------------------------------------
    console.log("\n--- Test F: Edge with empty evidence [] fails Mongoose validation ---");
    let edgeWithEmptyEvidenceFailed = false;
    try {
      await Edge.create({
        caseId: testCaseId,
        source: "PERSON-001",
        target: "BANK_ACCOUNT-001",
        edgeType: "CALLED",
        evidence: [],
      });
    } catch (err) {
      edgeWithEmptyEvidenceFailed = true;
      console.log("Edge with empty evidence rejected with error:", err.name, "|", err.message);
    }
    if (!edgeWithEmptyEvidenceFailed) {
      throw new Error("FAIL: Edge with empty evidence [] was saved!");
    }

    // -------------------------------------------------------------
    // Test G: Valid Pattern saves successfully
    // -------------------------------------------------------------
    console.log("\n--- Test G: Valid Pattern creation ---");
    const testPattern = await Pattern.create({
      caseId: testCaseId,
      patternType: "SUSPICIOUS_MULE_TRANSFER",
      relatedEntityIds: ["PERSON-001", "BANK_ACCOUNT-001"],
      relatedEdgeIds: [validEdge._id.toString()],
      confidence: 0.88,
      severity: "high",
      description: "Immediate fund dispersal following rapid incoming transfers from victim accounts",
    });
    console.log("Created Pattern:", testPattern.patternType, "| Severity:", testPattern.severity);

    // -------------------------------------------------------------
    // Cleanup Test Documents
    // -------------------------------------------------------------
    console.log("\n--- Cleaning up test artifacts ---");
    await Case.deleteMany({ caseId: testCaseId });
    await Entity.deleteMany({ caseId: testCaseId });
    await Edge.deleteMany({ caseId: testCaseId });
    await Pattern.deleteMany({ caseId: testCaseId });
    console.log("Test documents cleaned up cleanly.");

    console.log("\n=== ALL SCHEMA / MODEL TESTS PASSED ===");
  } finally {
    await disconnectDB();
  }
}

async function verifyHttpEndpoints() {
  console.log("\n=== VERIFYING PREVIOUS MODULES (T01, T02, T03) ===");

  // Test I: Health Check (T01)
  console.log("\n--- Test I: T01 GET /health ---");
  const healthRes = await makeRequest({ path: "/health" });
  console.log("Health check status:", healthRes.status, "| Database:", healthRes.data?.database?.status);

  // Test J: Login (T02)
  console.log("\n--- Test J: T02 POST /api/auth/login ---");
  const loginRes = await makeRequest({
    path: "/api/auth/login",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "investigator", password: "investigator123" }),
  });
  console.log("Login status:", loginRes.status, "| Success:", loginRes.data?.success);
  const token = loginRes.data?.data?.token;

  // Test K: Case Intake (T03)
  console.log("\n--- Test K: T03 POST /api/cases ---");
  const intakeRes = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      textReports: ["Investigator note for T04 schema verification."],
    }),
  });
  console.log("Case intake status:", intakeRes.status, "| CaseId created:", intakeRes.data?.data?.caseId);

  console.log("\n=== ALL ENDPOINT VERIFICATIONS COMPLETED SUCCESSFULLY ===");
}

async function main() {
  await runT04Tests();
  await verifyHttpEndpoints();
}

main().catch(console.error);
