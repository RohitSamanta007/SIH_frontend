const mongoose = require("mongoose");
const http = require("http");
const MockFastApiServer = require("./mockFastApiServer");
const { connectDB, disconnectDB } = require("../config/db");
const { Case, Entity, Edge, Pattern } = require("../src/models");
const { persistCaseResults, PersistenceError } = require("../src/services/resultPersistenceService");
const { callFastAPI } = require("../src/services/fastApiClient");

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

function buildMultipart(fields = {}, files = []) {
  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
  const chunks = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }

  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
      )
    );
    chunks.push(Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer));
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    buffer: Buffer.concat(chunks),
  };
}

async function runT06Tests() {
  console.log("=== STARTING T06 RESULT PERSISTENCE TEST SUITE ===\n");

  await connectDB();

  // Clean any previous T06 test cases
  const db = mongoose.connection.db;
  await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-T06-" } });
  await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-T06-" } });
  await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-T06-" } });
  await db.collection("patterns").deleteMany({ caseId: { $regex: "^CASE-TEST-T06-" } });

  const mockServer = new MockFastApiServer();
  const mockPort = await mockServer.start(8000);
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  console.log(`Mock FastAPI server running on ${mockBaseUrl}`);

  try {
    // -------------------------------------------------------------
    // Test 1: Repeated Upload & Accumulation Test (CRITICAL)
    // -------------------------------------------------------------
    console.log("\n--- Test 1: Repeated Upload & Graph Accumulation Test ---");
    const accumCaseId = `CASE-TEST-T06-ACCUM-${Date.now()}`;

    // Upload 1
    const upload1Result = {
      caseId: accumCaseId,
      entities: [
        {
          canonicalId: "PERSON-001",
          type: "PERSON",
          aliases: ["Rahul Sharma"],
          attributes: { phone: "+919876543210" },
          confidence: 0.85,
        },
      ],
      relationships: [
        {
          source: "PERSON-001",
          target: "PHONE-001",
          edgeType: "CALL",
          confidence: 0.8,
          evidence: [
            {
              sourceType: "cdr_csv",
              record: { call_id: "CALL-101" },
              field: "caller",
              value: "9876543210",
              citation: "CDR Upload 1 line 5",
            },
          ],
        },
      ],
      patterns: [
        {
          patternType: "SUSPICIOUS_NETWORK",
          relatedEntityIds: ["PERSON-001"],
          confidence: 0.8,
          description: "Pattern A: High frequency call burst",
          severity: "medium",
        },
      ],
      guardrail: [],
    };

    const res1 = await persistCaseResults(upload1Result, {
      caseId: accumCaseId,
      textReports: ["Initial FIR report"],
    });
    console.log("Upload 1 persisted status:", res1.status, "| Summary:", res1.summary);

    // Upload 2 (same caseId, new alias, new evidence on same edge, new pattern)
    const upload2Result = {
      caseId: accumCaseId,
      entities: [
        {
          canonicalId: "PERSON-001",
          type: "PERSON",
          aliases: ["R. Sharma", "Rahul S."],
          attributes: { address: "Mumbai", phone: "+919876543210" },
          confidence: 0.95,
        },
      ],
      relationships: [
        {
          source: "PERSON-001",
          target: "PHONE-001",
          edgeType: "CALL",
          confidence: 0.9,
          evidence: [
            {
              sourceType: "cdr_csv",
              record: { call_id: "CALL-202" },
              field: "caller",
              value: "9876543210",
              citation: "CDR Upload 2 line 12",
            },
          ],
        },
      ],
      patterns: [
        {
          patternType: "SIM_SWAP_RISK",
          relatedEntityIds: ["PERSON-001"],
          confidence: 0.9,
          description: "Pattern B: Suspected SIM swap activity",
          severity: "high",
        },
      ],
      guardrail: [],
    };

    const res2 = await persistCaseResults(upload2Result, {
      caseId: accumCaseId,
      csvRecords: [{ row: 1 }, { row: 2 }],
    });
    console.log("Upload 2 persisted status:", res2.status, "| Summary:", res2.summary);

    // Assert Accumulation
    const entitiesInDb = await Entity.find({ caseId: accumCaseId });
    console.log("Total entities in DB for case:", entitiesInDb.length);
    if (entitiesInDb.length !== 1) {
      throw new Error(`FAIL: Expected 1 accumulated entity, found ${entitiesInDb.length}`);
    }

    const accumulatedEntity = entitiesInDb[0];
    console.log("Accumulated Aliases:", accumulatedEntity.aliases);
    console.log("Accumulated Attributes:", accumulatedEntity.attributes);
    console.log("Accumulated Confidence:", accumulatedEntity.confidence);

    const hasRahulSharma = accumulatedEntity.aliases.includes("Rahul Sharma");
    const hasRSharma = accumulatedEntity.aliases.includes("R. Sharma");
    const hasRahulS = accumulatedEntity.aliases.includes("Rahul S.");
    if (!hasRahulSharma || !hasRSharma || !hasRahulS) {
      throw new Error("FAIL: Aliases were not merged properly!");
    }
    if (accumulatedEntity.confidence !== 0.95) {
      throw new Error("FAIL: Expected confidence to be max(0.85, 0.95) = 0.95");
    }

    // Assert Edges & Evidence
    const edgesInDb = await Edge.find({ caseId: accumCaseId });
    console.log("Total edges in DB for case:", edgesInDb.length);
    if (edgesInDb.length !== 1) {
      throw new Error(`FAIL: Expected 1 accumulated edge, found ${edgesInDb.length}`);
    }
    const accumulatedEdge = edgesInDb[0];
    console.log("Accumulated Edge Evidence count:", accumulatedEdge.evidence.length);
    if (accumulatedEdge.evidence.length !== 2) {
      throw new Error(`FAIL: Expected 2 accumulated evidence items, found ${accumulatedEdge.evidence.length}`);
    }

    // Assert Patterns
    const patternsInDb = await Pattern.find({ caseId: accumCaseId });
    console.log("Total patterns in DB for case:", patternsInDb.length);
    if (patternsInDb.length !== 2) {
      throw new Error(`FAIL: Expected 2 patterns (Pattern A & Pattern B), found ${patternsInDb.length}`);
    }

    // Assert Case status and uploads
    const savedCase = await Case.findOne({ caseId: accumCaseId });
    console.log("Case status:", savedCase.status, "| Source uploads count:", savedCase.sourceUploads.length);
    if (savedCase.status !== "completed" || savedCase.sourceUploads.length !== 2) {
      throw new Error("FAIL: Case status or uploads count incorrect");
    }

    // -------------------------------------------------------------
    // Test 2: Invalid Evidence Test (Hard Invariant)
    // -------------------------------------------------------------
    console.log("\n--- Test 2: Invalid Evidence Rejection ---");
    const invalidCaseId = `CASE-TEST-T06-INVALID-${Date.now()}`;

    // Sub-test 2a: Empty evidence []
    let emptyEvidenceRejected = false;
    try {
      await persistCaseResults(
        {
          caseId: invalidCaseId,
          entities: [{ canonicalId: "P-1", type: "PERSON" }],
          relationships: [
            {
              source: "P-1",
              target: "P-2",
              edgeType: "CALL",
              evidence: [], // Empty!
            },
          ],
        },
        { caseId: invalidCaseId }
      );
    } catch (err) {
      emptyEvidenceRejected = true;
      console.log("Empty evidence rejected properly with error:", err.code, "|", err.message);
    }
    if (!emptyEvidenceRejected) {
      throw new Error("FAIL: Edge with empty evidence [] was not rejected!");
    }

    // Sub-test 2b: Missing evidence field
    let missingEvidenceRejected = false;
    try {
      await persistCaseResults(
        {
          caseId: invalidCaseId,
          entities: [{ canonicalId: "P-1", type: "PERSON" }],
          relationships: [
            {
              source: "P-1",
              target: "P-2",
              edgeType: "CALL",
              // No evidence property
            },
          ],
        },
        { caseId: invalidCaseId }
      );
    } catch (err) {
      missingEvidenceRejected = true;
      console.log("Missing evidence rejected properly with error:", err.code, "|", err.message);
    }
    if (!missingEvidenceRejected) {
      throw new Error("FAIL: Edge with missing evidence was not rejected!");
    }

    // -------------------------------------------------------------
    // Test 3: Cross-Case Isolation Test
    // -------------------------------------------------------------
    console.log("\n--- Test 3: Cross-Case Entity Isolation Test ---");
    const caseAId = `CASE-TEST-T06-CASEA-${Date.now()}`;
    const caseBId = `CASE-TEST-T06-CASEB-${Date.now()}`;

    await persistCaseResults({
      caseId: caseAId,
      entities: [{ canonicalId: "PERSON-SAME-ID", type: "PERSON", aliases: ["Case A Person"] }],
    });

    await persistCaseResults({
      caseId: caseBId,
      entities: [{ canonicalId: "PERSON-SAME-ID", type: "PERSON", aliases: ["Case B Person"] }],
    });

    const entityA = await Entity.findOne({ caseId: caseAId, canonicalId: "PERSON-SAME-ID" });
    const entityB = await Entity.findOne({ caseId: caseBId, canonicalId: "PERSON-SAME-ID" });

    console.log("Entity in Case A:", entityA.aliases);
    console.log("Entity in Case B:", entityB.aliases);
    if (entityA.aliases[0] !== "Case A Person" || entityB.aliases[0] !== "Case B Person") {
      throw new Error("FAIL: Entities with identical canonicalId merged across distinct cases!");
    }
    console.log("Cross-case isolation verified successfully.");

    // -------------------------------------------------------------
    // Test 4: End-to-End Express Gateway (POST /api/cases -> Persistence)
    // -------------------------------------------------------------
    console.log("\n--- Test 4: End-to-End POST /api/cases with Full MongoDB Persistence ---");
    mockServer.setMode("success");

    // Login for JWT
    const loginRes = await makeRequest({
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "investigator", password: "investigator123" }),
    });
    const token = loginRes.data?.data?.token;

    const multipart = buildMultipart(
      {
        textReports: "FIR #900: Suspect transferred Rs 100,000 to mule account.",
      },
      [
        {
          fieldname: "file",
          filename: "cdr.csv",
          contentType: "text/csv",
          buffer: "caller,receiver,timestamp\n+919876543210,+919123456789,2026-08-15T12:00:00Z",
        },
      ]
    );

    const gatewayRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: {
        "Content-Type": multipart.contentType,
        Authorization: `Bearer ${token}`,
      },
      body: multipart.buffer,
    });

    console.log("Gateway Response status:", gatewayRes.status);
    console.log("Gateway Response body:", JSON.stringify(gatewayRes.data, null, 2));

    if (gatewayRes.status !== 201 || !gatewayRes.data?.data?.caseId) {
      throw new Error("FAIL: End-to-end case intake and persistence failed");
    }

    const createdCaseId = gatewayRes.data.data.caseId;
    const dbCase = await Case.findOne({ caseId: createdCaseId });
    const dbEntities = await Entity.find({ caseId: createdCaseId });
    const dbEdges = await Edge.find({ caseId: createdCaseId });
    const dbPatterns = await Pattern.find({ caseId: createdCaseId });

    console.log("DB Case status:", dbCase.status);
    console.log("DB Entities saved:", dbEntities.length);
    console.log("DB Edges saved:", dbEdges.length);
    console.log("DB Patterns saved:", dbPatterns.length);

    if (dbCase.status !== "completed" || dbEntities.length === 0 || dbEdges.length === 0) {
      throw new Error("FAIL: End-to-end case data was not properly persisted in MongoDB");
    }

    // -------------------------------------------------------------
    // Test 5: Regression Tests (T01, T02, T03, T04, T05)
    // -------------------------------------------------------------
    console.log("\n--- Test 5: Regression Tests for T01 - T05 ---");
    // T01 Health
    const healthRes = await makeRequest({ path: "/health" });
    console.log("T01 GET /health:", healthRes.status, "| DB:", healthRes.data?.database?.status);

    // T02 Auth Verify
    const authVerifyRes = await makeRequest({
      path: "/api/auth/verify",
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("T02 GET /api/auth/verify:", authVerifyRes.status, "| User:", authVerifyRes.data?.data?.user?.username);

    // Clean up test data
    await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-T06-" } });
    await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-T06-" } });
    await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-T06-" } });
    await db.collection("patterns").deleteMany({ caseId: { $regex: "^CASE-TEST-T06-" } });
    // Also delete created case from end-to-end test
    await db.collection("cases").deleteOne({ caseId: createdCaseId });
    await db.collection("entities").deleteMany({ caseId: createdCaseId });
    await db.collection("edges").deleteMany({ caseId: createdCaseId });
    await db.collection("patterns").deleteMany({ caseId: createdCaseId });
    console.log("Test artifacts cleaned up cleanly.");

    console.log("\n=== ALL T06 TESTS COMPLETED SUCCESSFULLY ===");
  } finally {
    await mockServer.stop();
    await disconnectDB();
  }
}

runT06Tests().catch(console.error);
