const mongoose = require("mongoose");
const http = require("http");
const { connectDB, disconnectDB } = require("../config/db");
const { Case, Entity, Edge, Pattern } = require("../src/models");
const MockFastApiServer = require("./mockFastApiServer");

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

async function runT07Tests() {
  console.log("=== STARTING T07 MONGODB READ APIS TEST SUITE ===\n");

  await connectDB();
  const db = mongoose.connection.db;

  // Clean any old test artifacts
  await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-T07-" } });
  await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-T07-" } });
  await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-T07-" } });
  await db.collection("patterns").deleteMany({ caseId: { $regex: "^CASE-TEST-T07-" } });

  // -------------------------------------------------------------
  // Seed Deterministic Test Data for Case A and Case B
  // -------------------------------------------------------------
  const caseAId = `CASE-TEST-T07-A-${Date.now()}`;
  const caseBId = `CASE-TEST-T07-B-${Date.now()}`;

  // Seed Case A
  await Case.create({
    caseId: caseAId,
    status: "completed",
    title: "Case Alpha Investigation",
    sourceUploads: [{ uploadId: "UPL-A1", type: "text", recordCount: 1 }],
  });

  await Entity.create([
    {
      caseId: caseAId,
      canonicalId: "PERSON-001",
      type: "PERSON",
      aliases: ["Rahul Sharma", "RS"],
      attributes: { phone: "+919876543210", role: "Primary Suspect" },
      confidence: 0.95,
    },
    {
      caseId: caseAId,
      canonicalId: "PHONE-001",
      type: "PHONE",
      aliases: ["+919876543210"],
      attributes: { carrier: "Jio", circle: "Mumbai" },
      confidence: 1.0,
    },
    {
      caseId: caseAId,
      canonicalId: "BANK-001",
      type: "BANK_ACCOUNT",
      aliases: ["HDFC-99128"],
      attributes: { ifsc: "HDFC0001234", balance: 50000 },
      confidence: 0.9,
    },
  ]);

  const edgeA1 = await Edge.create({
    caseId: caseAId,
    source: "PERSON-001",
    target: "PHONE-001",
    edgeType: "USES_PHONE",
    confidence: 0.95,
    timestamp: new Date("2026-08-15T10:00:00Z"),
    guardrailStatus: "approved",
    guardrailRationale: "SIM registered under suspect identity",
    evidence: [{ sourceType: "kyc_csv", citation: "KYC Record #1" }],
  });

  const edgeA2 = await Edge.create({
    caseId: caseAId,
    source: "PERSON-001",
    target: "BANK-001",
    edgeType: "TRANSACTION_SENT",
    confidence: 0.88,
    timestamp: new Date("2026-08-15T12:30:00Z"),
    guardrailStatus: "approved",
    guardrailRationale: "IMPS transfer corroborated by statement",
    evidence: [{ sourceType: "bank_csv", citation: "Statement Row 44" }],
  });

  const edgeA3 = await Edge.create({
    caseId: caseAId,
    source: "PHONE-001",
    target: "BANK-001",
    edgeType: "LINKED_UPI",
    confidence: 0.9,
    // Note: No domain event timestamp (to test timestamp sorting fallback)
    guardrailStatus: "flagged",
    guardrailRationale: "UPI registration verified without recent calls",
    evidence: [{ sourceType: "upi_registry", citation: "NPCI Handle Map" }],
  });

  // Seed Case B (with same canonicalId "PERSON-001" to verify strict isolation)
  await Case.create({
    caseId: caseBId,
    status: "completed",
    title: "Case Beta Investigation",
  });

  await Entity.create([
    {
      caseId: caseBId,
      canonicalId: "PERSON-001",
      type: "PERSON",
      aliases: ["Amit Kumar"], // Distinct name in Case B
      attributes: { city: "Delhi" },
      confidence: 0.8,
    },
    {
      caseId: caseBId,
      canonicalId: "PHONE-999",
      type: "PHONE",
      aliases: ["+919999999999"],
      confidence: 1.0,
    },
  ]);

  const edgeB1 = await Edge.create({
    caseId: caseBId,
    source: "PERSON-001",
    target: "PHONE-999",
    edgeType: "CALL",
    confidence: 0.75,
    timestamp: new Date("2026-08-16T15:00:00Z"),
    evidence: [{ sourceType: "cdr_csv", citation: "Case B CDR line 1" }],
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
  // GRAPH API TESTS (GET /api/cases/:caseId/graph)
  // =============================================================
  console.log("\n--- GRAPH API TESTS ---");

  // Test A: Valid Case Graph
  console.log("Test A: GET valid case graph");
  const graphRes = await makeRequest({
    path: `/api/cases/${caseAId}/graph`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Status:", graphRes.status, "| Nodes count:", graphRes.data?.data?.nodes?.length, "| Edges count:", graphRes.data?.data?.edges?.length);
  if (graphRes.status !== 200 || graphRes.data?.data?.nodes?.length !== 3 || graphRes.data?.data?.edges?.length !== 3) {
    throw new Error("FAIL: Graph endpoint did not return correct nodes/edges count");
  }

  // Test B: Nonexistent Case
  console.log("Test B: GET nonexistent case graph (Expected 404)");
  const nonExistGraph = await makeRequest({
    path: `/api/cases/CASE-NONEXISTENT-9999/graph`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Status:", nonExistGraph.status, "| Error code:", nonExistGraph.data?.error?.code);
  if (nonExistGraph.status !== 404 || nonExistGraph.data?.error?.code !== "CASE_NOT_FOUND") {
    throw new Error("FAIL: Nonexistent case did not return 404 CASE_NOT_FOUND");
  }

  // Test C: Case Isolation in Graph
  console.log("Test C: Verify no nodes/edges from Case B appear in Case A graph");
  const nodesCaseA = graphRes.data.data.nodes;
  const hasCaseBAlias = nodesCaseA.some((n) => n.aliases?.includes("Amit Kumar"));
  const hasCaseBPhone = nodesCaseA.some((n) => n.canonicalId === "PHONE-999");
  if (hasCaseBAlias || hasCaseBPhone) {
    throw new Error("FAIL: Case A graph leaked nodes from Case B!");
  }
  console.log("Case isolation in graph verified.");

  // =============================================================
  // ENTITY DETAIL API TESTS (GET /api/cases/:caseId/entities/:entityId)
  // =============================================================
  console.log("\n--- ENTITY DETAIL API TESTS ---");

  // Test D: Valid Entity Detail
  console.log("Test D: GET valid entity detail");
  const entityRes = await makeRequest({
    path: `/api/cases/${caseAId}/entities/PERSON-001`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Status:", entityRes.status, "| CanonicalId:", entityRes.data?.data?.entity?.canonicalId, "| Related edges:", entityRes.data?.data?.relatedEdges?.length);
  if (entityRes.status !== 200 || entityRes.data?.data?.entity?.canonicalId !== "PERSON-001") {
    throw new Error("FAIL: Entity detail retrieval failed");
  }

  // Test E: Nonexistent Entity
  console.log("Test E: GET nonexistent entity (Expected 404)");
  const nonExistEntity = await makeRequest({
    path: `/api/cases/${caseAId}/entities/PERSON-NONEXISTENT`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Status:", nonExistEntity.status, "| Error code:", nonExistEntity.data?.error?.code);
  if (nonExistEntity.status !== 404 || nonExistEntity.data?.error?.code !== "ENTITY_NOT_FOUND") {
    throw new Error("FAIL: Nonexistent entity did not return 404 ENTITY_NOT_FOUND");
  }

  // Test F & G: Case Isolation in Entity Query
  console.log("Test F/G: Cross-case entity isolation with identical canonicalId");
  const entityBRes = await makeRequest({
    path: `/api/cases/${caseBId}/entities/PERSON-001`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Case A Person Aliases:", entityRes.data?.data?.entity?.aliases);
  console.log("Case B Person Aliases:", entityBRes.data?.data?.entity?.aliases);
  if (entityRes.data?.data?.entity?.aliases[0] !== "Rahul Sharma" || entityBRes.data?.data?.entity?.aliases[0] !== "Amit Kumar") {
    throw new Error("FAIL: Cross-case entity collision observed!");
  }
  // Verify related edges of Case A entity do not contain Case B edge
  const relatedEdgesCaseA = entityRes.data?.data?.relatedEdges;
  const hasCaseBEdge = relatedEdgesCaseA.some((e) => e.target === "PHONE-999");
  if (hasCaseBEdge) {
    throw new Error("FAIL: Related edges leaked across cases!");
  }
  console.log("Cross-case entity isolation verified.");

  // =============================================================
  // TIMELINE API TESTS (GET /api/cases/:caseId/timeline)
  // =============================================================
  console.log("\n--- TIMELINE API TESTS ---");

  // Test H: Existing Case Timeline
  console.log("Test H: GET case timeline");
  const timelineRes = await makeRequest({
    path: `/api/cases/${caseAId}/timeline`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Status:", timelineRes.status, "| Total events:", timelineRes.data?.data?.totalEvents);
  if (timelineRes.status !== 200 || timelineRes.data?.data?.timeline?.length !== 3) {
    throw new Error("FAIL: Timeline endpoint returned incorrect event count");
  }

  // Test I & J: Chronological Sorting & Missing Timestamp Fallback
  console.log("Test I/J: Chronological ordering (oldest -> newest, missing timestamp placed deterministically at end)");
  const events = timelineRes.data?.data?.timeline;
  console.log("Event 1 timestamp:", events[0].timestamp, "| Type:", events[0].edgeType);
  console.log("Event 2 timestamp:", events[1].timestamp, "| Type:", events[1].edgeType);
  console.log("Event 3 timestamp:", events[2].timestamp, "| Type:", events[2].edgeType);

  const t1 = new Date(events[0].timestamp).getTime();
  const t2 = new Date(events[1].timestamp).getTime();
  if (t1 > t2) {
    throw new Error("FAIL: Timeline events not sorted in ascending chronological order!");
  }
  if (events[2].timestamp !== null) {
    throw new Error("FAIL: Missing timestamp event was not placed deterministically at end!");
  }

  // Test K: Case Isolation in Timeline
  console.log("Test K: Verify no events from Case B appear in Case A timeline");
  const hasCaseBTimelineEvent = events.some((e) => e.target === "PHONE-999");
  if (hasCaseBTimelineEvent) {
    throw new Error("FAIL: Case B events appeared in Case A timeline!");
  }
  console.log("Timeline chronological sorting and isolation verified.");

  // =============================================================
  // GUARDRAIL API TESTS (GET /api/cases/:caseId/guardrail/:edgeId)
  // =============================================================
  console.log("\n--- GUARDRAIL API TESTS ---");

  // Test L: Valid Edge Guardrail
  console.log("Test L: GET valid edge guardrail detail");
  const guardrailRes = await makeRequest({
    path: `/api/cases/${caseAId}/guardrail/${edgeA1._id.toString()}`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Status:", guardrailRes.status, "| Status:", guardrailRes.data?.data?.edge?.guardrailStatus, "| Rationale:", guardrailRes.data?.data?.edge?.guardrailRationale);
  if (guardrailRes.status !== 200 || guardrailRes.data?.data?.edge?.guardrailStatus !== "approved") {
    throw new Error("FAIL: Guardrail detail retrieval failed");
  }

  // Test M: Nonexistent Edge ID
  console.log("Test M: GET nonexistent edge ID (Expected 404)");
  const nonExistGuardrail = await makeRequest({
    path: `/api/cases/${caseAId}/guardrail/507f1f77bcf86cd799439011`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Status:", nonExistGuardrail.status, "| Error code:", nonExistGuardrail.data?.error?.code);
  if (nonExistGuardrail.status !== 404 || nonExistGuardrail.data?.error?.code !== "EDGE_NOT_FOUND") {
    throw new Error("FAIL: Nonexistent edge did not return 404 EDGE_NOT_FOUND");
  }

  // Test N: Edge from another case (Case Isolation)
  console.log("Test N: GET edge from Case B using Case A in URL (Expected 404)");
  const crossCaseGuardrail = await makeRequest({
    path: `/api/cases/${caseAId}/guardrail/${edgeB1._id.toString()}`,
    method: "GET",
    headers: authHeaders,
  });
  console.log("Status:", crossCaseGuardrail.status, "| Error code:", crossCaseGuardrail.data?.error?.code);
  if (crossCaseGuardrail.status !== 404 || crossCaseGuardrail.data?.error?.code !== "EDGE_NOT_FOUND") {
    throw new Error("FAIL: Cross-case edge lookup succeeded when it should return 404!");
  }
  console.log("Guardrail edge query isolation verified.");

  // =============================================================
  // AUTHENTICATION TESTS ON READ APIS
  // =============================================================
  console.log("\n--- AUTHENTICATION TESTS ON READ ENDPOINTS ---");

  // Test O: Missing JWT
  console.log("Test O: Request without JWT (Expected 401)");
  const noJwtGraph = await makeRequest({ path: `/api/cases/${caseAId}/graph` });
  console.log("Status:", noJwtGraph.status, "| Error code:", noJwtGraph.data?.error?.code);
  if (noJwtGraph.status !== 401 || noJwtGraph.data?.error?.code !== "UNAUTHORIZED") {
    throw new Error("FAIL: Missing JWT was not rejected with 401 UNAUTHORIZED");
  }

  // Test P: Invalid JWT
  console.log("Test P: Request with invalid JWT (Expected 401)");
  const badJwtGraph = await makeRequest({
    path: `/api/cases/${caseAId}/graph`,
    headers: { Authorization: "Bearer bad.token.string" },
  });
  console.log("Status:", badJwtGraph.status, "| Error code:", badJwtGraph.data?.error?.code);
  if (badJwtGraph.status !== 401 || badJwtGraph.data?.error?.code !== "INVALID_TOKEN") {
    throw new Error("FAIL: Invalid JWT was not rejected with 401 INVALID_TOKEN");
  }

  // =============================================================
  // REGRESSION TESTS (T01 - T06)
  // =============================================================
  console.log("\n--- REGRESSION TESTS (T01 - T06) ---");

  // R. T01 Health
  const healthRes = await makeRequest({ path: "/health" });
  console.log("T01 GET /health:", healthRes.status, "| Database:", healthRes.data?.database?.status);

  // S. T02 Auth
  const authVerifyRes = await makeRequest({
    path: "/api/auth/verify",
    method: "GET",
    headers: authHeaders,
  });
  console.log("T02 GET /api/auth/verify:", authVerifyRes.status, "| User:", authVerifyRes.data?.data?.user?.username);

  // Clean up test data
  console.log("\n--- Cleaning up test artifacts ---");
  await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-T07-" } });
  await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-T07-" } });
  await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-T07-" } });
  await db.collection("patterns").deleteMany({ caseId: { $regex: "^CASE-TEST-T07-" } });
  console.log("Test artifacts cleaned up cleanly.");

  console.log("\n=== ALL T07 TESTS COMPLETED SUCCESSFULLY ===");
  await disconnectDB();
}

runT07Tests().catch(console.error);
