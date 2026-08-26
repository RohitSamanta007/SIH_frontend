const mongoose = require("mongoose");
const http = require("http");
const { connectDB, disconnectDB } = require("../config/db");
const { Case, Entity, Edge } = require("../src/models");

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

async function runT09Tests() {
  console.log("=== STARTING T09 CASE LIST API TEST SUITE ===\n");
  console.log("NOTE: The Express server must already be running on port 5000 (npm run dev).\n");

  await connectDB();
  const db = mongoose.connection.db;

  // Clean any old test artifacts
  await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-T09-" } });
  await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-T09-" } });
  await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-T09-" } });

  // -------------------------------------------------------------
  // Seed Deterministic Test Data:
  // - Case OLD created first (older updatedAt)
  // - Case NEW created after a delay (newer updatedAt), with entities/edges/uploads
  // -------------------------------------------------------------
  const caseOldId = `CASE-TEST-T09-OLD-${Date.now()}`;
  const caseNewId = `CASE-TEST-T09-NEW-${Date.now()}`;

  console.log("Seeding test data...");
  await Case.create({
    caseId: caseOldId,
    status: "completed",
    title: "T09 Older Case (no graph data)",
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  await Case.create({
    caseId: caseNewId,
    status: "completed",
    title: "T09 Newer Case",
    sourceUploads: [
      { uploadId: "UPL-T09-1", type: "text", recordCount: 2, uploadedAt: new Date() },
      { uploadId: "UPL-T09-2", type: "csv", recordCount: 1, uploadedAt: new Date(Date.now() + 10) },
    ],
  });

  await Entity.create([
    {
      caseId: caseNewId,
      canonicalId: "PERSON-T09-A",
      type: "PERSON",
      aliases: ["Alpha Person"],
      confidence: 0.9,
    },
    {
      caseId: caseNewId,
      canonicalId: "PHONE-T09-B",
      type: "PHONE",
      aliases: ["+919000000000"],
      confidence: 1.0,
    },
  ]);

  await Edge.create({
    caseId: caseNewId,
    source: "PERSON-T09-A",
    target: "PHONE-T09-B",
    edgeType: "USES_PHONE",
    confidence: 0.9,
    evidence: [{ sourceType: "test_csv", citation: "T09 row 1" }],
  });

  // Obtain JWT Token
  console.log("1. Authenticating to obtain JWT token...");
  const loginRes = await makeRequest({
    path: "/api/auth/login",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "investigator", password: "investigator123" }),
  });
  const token = loginRes.data?.data?.token;
  console.log("Token acquired successfully:", !!token);

  const authHeaders = { Authorization: `Bearer ${token}` };

  // =============================================================
  // CASE LIST API TESTS (GET /api/cases)
  // =============================================================
  console.log("\n--- CASE LIST API TESTS ---");

  // Test A: Valid list request
  console.log("Test A: GET /api/cases returns success envelope");
  const listRes = await makeRequest({ path: "/api/cases", headers: authHeaders });
  console.log("Status:", listRes.status, "| Success:", listRes.data?.success, "| Error:", listRes.data?.error);
  if (
    listRes.status !== 200 ||
    listRes.data?.success !== true ||
    listRes.data?.error !== null ||
    !Array.isArray(listRes.data?.data?.cases)
  ) {
    throw new Error("FAIL: GET /api/cases did not return the standard success envelope");
  }

  // Test B: Newest-first ordering
  console.log("Test B: Cases sorted newest first by updatedAt");
  const cases = listRes.data.data.cases;
  const newIdx = cases.findIndex((c) => c.caseId === caseNewId);
  const oldIdx = cases.findIndex((c) => c.caseId === caseOldId);
  console.log("New case index:", newIdx, "| Old case index:", oldIdx, "| Total:", listRes.data.data.total);
  if (newIdx === -1 || oldIdx === -1) {
    throw new Error("FAIL: Seeded cases missing from list response");
  }
  if (listRes.data.data.total !== cases.length) {
    throw new Error("FAIL: total does not match cases array length");
  }
  if (newIdx > oldIdx) {
    throw new Error("FAIL: List is not sorted newest first by updatedAt");
  }

  // Test C: Summary counts and derived fields
  console.log("Test C: Per-case counts and source-upload derivations");
  const newCase = cases[newIdx];
  const oldCase = cases[oldIdx];
  console.log("New case counts:", {
    entitiesCount: newCase.entitiesCount,
    edgesCount: newCase.edgesCount,
    uploadsCount: newCase.uploadsCount,
    recordCount: newCase.recordCount,
  });
  if (newCase.entitiesCount !== 2 || newCase.edgesCount !== 1) {
    throw new Error("FAIL: Entity/edge aggregation counts are incorrect for seeded case");
  }
  if (newCase.uploadsCount !== 2 || newCase.recordCount !== 3) {
    throw new Error("FAIL: uploadsCount/recordCount derivation is incorrect");
  }
  if (!newCase.lastUploadAt) {
    throw new Error("FAIL: lastUploadAt missing for case with uploads");
  }
  if (oldCase.entitiesCount !== 0 || oldCase.edgesCount !== 0 || oldCase.uploadsCount !== 0) {
    throw new Error("FAIL: Missing counts must default to 0");
  }
  if (typeof oldCase.title !== "string") {
    throw new Error("FAIL: title field missing from list item");
  }
  console.log("Counts, defaults, and derivations verified.");

  // Test D: Field shape of each list item
  console.log("Test D: Response item field shape");
  const requiredFields = [
    "caseId",
    "status",
    "title",
    "recordCount",
    "uploadsCount",
    "lastUploadAt",
    "entitiesCount",
    "edgesCount",
    "createdAt",
    "updatedAt",
  ];
  const missingField = requiredFields.find((field) => !(field in newCase));
  if (missingField) {
    throw new Error(`FAIL: List item is missing required field '${missingField}'`);
  }
  console.log("All required fields present on list items.");

  // =============================================================
  // AUTHENTICATION TESTS ON LIST ENDPOINT
  // =============================================================
  console.log("\n--- AUTHENTICATION TESTS ---");

  // Test E: Missing JWT
  console.log("Test E: Request without JWT (Expected 401)");
  const noJwtRes = await makeRequest({ path: "/api/cases" });
  console.log("Status:", noJwtRes.status, "| Error code:", noJwtRes.data?.error?.code);
  if (noJwtRes.status !== 401 || noJwtRes.data?.error?.code !== "UNAUTHORIZED") {
    throw new Error("FAIL: Missing JWT was not rejected with 401 UNAUTHORIZED");
  }

  // Test F: Invalid JWT
  console.log("Test F: Request with invalid JWT (Expected 401)");
  const badJwtRes = await makeRequest({
    path: "/api/cases",
    headers: { Authorization: "Bearer bad.token.string" },
  });
  console.log("Status:", badJwtRes.status, "| Error code:", badJwtRes.data?.error?.code);
  if (badJwtRes.status !== 401 || badJwtRes.data?.error?.code !== "INVALID_TOKEN") {
    throw new Error("FAIL: Invalid JWT was not rejected with 401 INVALID_TOKEN");
  }

  // =============================================================
  // REGRESSION: Existing read routes still behave as before
  // =============================================================
  console.log("\n--- REGRESSION TEST ---");

  console.log("Regression: GET /api/cases/:caseId/graph still works");
  const graphRes = await makeRequest({
    path: `/api/cases/${caseNewId}/graph`,
    headers: authHeaders,
  });
  console.log(
    "Status:",
    graphRes.status,
    "| Nodes:",
    graphRes.data?.data?.nodes?.length,
    "| Edges:",
    graphRes.data?.data?.edges?.length
  );
  if (
    graphRes.status !== 200 ||
    graphRes.data?.data?.nodes?.length !== 2 ||
    graphRes.data?.data?.edges?.length !== 1
  ) {
    throw new Error("FAIL: Graph endpoint regression detected");
  }

  // Clean up test data
  console.log("\n--- Cleaning up test artifacts ---");
  await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-T09-" } });
  await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-T09-" } });
  await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-T09-" } });
  console.log("Test artifacts cleaned up cleanly.");

  console.log("\n=== ALL T09 TESTS COMPLETED SUCCESSFULLY ===");
  await disconnectDB();
}

runT09Tests().catch(console.error);
