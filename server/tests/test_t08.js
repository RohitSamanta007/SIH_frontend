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

async function runT08Tests() {
  console.log("=== STARTING T08 CENTRALIZED ERROR HANDLING TEST SUITE ===\n");

  await connectDB();
  const db = mongoose.connection.db;

  // Clean test artifacts
  await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-T08-" } });
  await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-T08-" } });
  await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-T08-" } });
  await db.collection("patterns").deleteMany({ caseId: { $regex: "^CASE-TEST-T08-" } });

  const mockServer = new MockFastApiServer();
  const mockPort = await mockServer.start(8000);
  console.log(`Mock FastAPI server running on http://127.0.0.1:${mockPort}`);

  try {
    // -------------------------------------------------------------
    // Test A: 404 Nonexistent Route
    // -------------------------------------------------------------
    console.log("Test A: Nonexistent route 404 handling");
    const notFoundRes = await makeRequest({ path: "/api/nonexistent-route-xyz" });
    console.log("Status:", notFoundRes.status, "| Envelope:", notFoundRes.data);
    if (
      notFoundRes.status !== 404 ||
      notFoundRes.data.success !== false ||
      notFoundRes.data.error?.code !== "ROUTE_NOT_FOUND"
    ) {
      throw new Error("FAIL: 404 route handling does not follow standard error envelope");
    }

    // -------------------------------------------------------------
    // Test B: Missing JWT
    // -------------------------------------------------------------
    console.log("\nTest B: Missing JWT authentication");
    const noJwtRes = await makeRequest({ path: "/api/cases", method: "POST" });
    console.log("Status:", noJwtRes.status, "| Envelope:", noJwtRes.data);
    if (noJwtRes.status !== 401 || noJwtRes.data.success !== false || noJwtRes.data.error?.code !== "UNAUTHORIZED") {
      throw new Error("FAIL: Missing JWT error does not follow standard error envelope");
    }

    // -------------------------------------------------------------
    // Test C: Invalid JWT
    // -------------------------------------------------------------
    console.log("\nTest C: Invalid JWT authentication");
    const badJwtRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: { Authorization: "Bearer malformed.invalid.token" },
    });
    console.log("Status:", badJwtRes.status, "| Envelope:", badJwtRes.data);
    if (badJwtRes.status !== 401 || badJwtRes.data.success !== false || badJwtRes.data.error?.code !== "INVALID_TOKEN") {
      throw new Error("FAIL: Invalid JWT error does not follow standard error envelope");
    }

    // Obtain valid token for authenticated tests
    const loginRes = await makeRequest({
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "investigator", password: "investigator123" }),
    });
    const token = loginRes.data?.data?.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // -------------------------------------------------------------
    // Test D: Validation Error (Empty Intake)
    // -------------------------------------------------------------
    console.log("\nTest D: Semantic validation error (Empty intake request)");
    const emptyIntakeRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({}),
    });
    console.log("Status:", emptyIntakeRes.status, "| Envelope:", emptyIntakeRes.data);
    if (
      emptyIntakeRes.status !== 422 ||
      emptyIntakeRes.data.success !== false ||
      emptyIntakeRes.data.error?.code !== "NO_USABLE_INPUT"
    ) {
      throw new Error("FAIL: Validation error response incorrect");
    }

    // -------------------------------------------------------------
    // Test E: Unsupported CSV File (e.g. .pdf)
    // -------------------------------------------------------------
    console.log("\nTest E: Unsupported file upload type (415)");
    const pdfMultipart = buildMultipart({}, [
      {
        fieldname: "file",
        filename: "test.pdf",
        contentType: "application/pdf",
        buffer: "%PDF-1.4 test content",
      },
    ]);
    const unsupportedFileRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: {
        "Content-Type": pdfMultipart.contentType,
        ...authHeaders,
      },
      body: pdfMultipart.buffer,
    });
    console.log("Status:", unsupportedFileRes.status, "| Envelope:", unsupportedFileRes.data);
    if (
      unsupportedFileRes.status !== 415 ||
      unsupportedFileRes.data.success !== false ||
      unsupportedFileRes.data.error?.code !== "UNSUPPORTED_FILE_TYPE"
    ) {
      throw new Error("FAIL: Unsupported file type was not mapped to 415 UNSUPPORTED_FILE_TYPE");
    }

    // -------------------------------------------------------------
    // Test F: Malformed CSV File
    // -------------------------------------------------------------
    console.log("\nTest F: Malformed CSV parsing failure (422)");
    const malformedCsvMultipart = buildMultipart({}, [
      {
        fieldname: "file",
        filename: "bad.csv",
        contentType: "text/csv",
        buffer: 'col1,col2\n"unclosed quote,value2',
      },
    ]);
    const malformedCsvRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: {
        "Content-Type": malformedCsvMultipart.contentType,
        ...authHeaders,
      },
      body: malformedCsvMultipart.buffer,
    });
    console.log("Status:", malformedCsvRes.status, "| Envelope:", malformedCsvRes.data);
    if (
      malformedCsvRes.status !== 422 ||
      malformedCsvRes.data.success !== false ||
      malformedCsvRes.data.error?.code !== "MALFORMED_CSV"
    ) {
      throw new Error("FAIL: Malformed CSV was not mapped to 422 MALFORMED_CSV");
    }

    // -------------------------------------------------------------
    // Test G: Missing/Unavailable FastAPI Service (502)
    // -------------------------------------------------------------
    console.log("\nTest G: Upstream FastAPI unavailable handling (502)");
    await mockServer.stop(); // Stop mock server
    const unavailableRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ textReports: ["FIR 100: Suspect report"] }),
    });
    console.log("Status:", unavailableRes.status, "| Envelope:", unavailableRes.data);
    if (
      unavailableRes.status !== 502 ||
      unavailableRes.data.success !== false ||
      unavailableRes.data.error?.code !== "FASTAPI_UNAVAILABLE"
    ) {
      throw new Error("FAIL: Service unavailable was not mapped to 502 FASTAPI_UNAVAILABLE");
    }

    // Restart mock server for subsequent tests
    await mockServer.start(8000);

    // -------------------------------------------------------------
    // Test H: FastAPI Timeout Handling (504)
    // -------------------------------------------------------------
    console.log("\nTest H: Upstream FastAPI timeout handling (504)");
    mockServer.setMode("timeout");
    const timeoutRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ textReports: ["FIR 200: Timeout test"] }),
    });
    console.log("Status:", timeoutRes.status, "| Envelope:", timeoutRes.data);
    if (
      timeoutRes.status !== 504 ||
      timeoutRes.data.success !== false ||
      timeoutRes.data.error?.code !== "FASTAPI_TIMEOUT"
    ) {
      throw new Error("FAIL: FastAPI timeout was not mapped to 504 FASTAPI_TIMEOUT");
    }

    // -------------------------------------------------------------
    // Test I: Invalid FastAPI Non-JSON Response (502)
    // -------------------------------------------------------------
    console.log("\nTest I: Upstream FastAPI invalid response handling (502)");
    mockServer.setMode("invalid_json");
    const invalidJsonRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ textReports: ["FIR 300: Invalid JSON test"] }),
    });
    console.log("Status:", invalidJsonRes.status, "| Envelope:", invalidJsonRes.data);
    if (
      invalidJsonRes.status !== 502 ||
      invalidJsonRes.data.success !== false ||
      invalidJsonRes.data.error?.code !== "FASTAPI_INVALID_RESPONSE"
    ) {
      throw new Error("FAIL: Invalid JSON response was not mapped to 502 FASTAPI_INVALID_RESPONSE");
    }

    // Reset mock to normal success mode
    mockServer.setMode("success");

    // -------------------------------------------------------------
    // Seed Data for Read API Error Tests
    // -------------------------------------------------------------
    const caseId = `CASE-TEST-T08-ALPHA-${Date.now()}`;
    await Case.create({
      caseId,
      status: "completed",
      title: "T08 Test Case",
    });

    const entityDoc = await Entity.create({
      caseId,
      canonicalId: "PERSON-001",
      type: "PERSON",
      aliases: ["Rahul Sharma"],
      attributes: { phone: "+919876543210" },
      confidence: 0.95,
    });

    const edgeDoc = await Edge.create({
      caseId,
      source: "PERSON-001",
      target: "PHONE-001",
      edgeType: "USES_PHONE",
      confidence: 0.9,
      timestamp: new Date("2026-08-15T12:00:00Z"),
      guardrailStatus: "approved",
      guardrailRationale: "Verified",
      evidence: [{ sourceType: "cdr_csv", citation: "Line 1" }],
    });

    // -------------------------------------------------------------
    // Test K: Nonexistent Case (404)
    // -------------------------------------------------------------
    console.log("\nTest K: Nonexistent case lookup (404)");
    const nonExistCaseRes = await makeRequest({
      path: "/api/cases/CASE-NONEXISTENT-XYZ/graph",
      headers: authHeaders,
    });
    console.log("Status:", nonExistCaseRes.status, "| Envelope:", nonExistCaseRes.data);
    if (
      nonExistCaseRes.status !== 404 ||
      nonExistCaseRes.data.success !== false ||
      nonExistCaseRes.data.error?.code !== "CASE_NOT_FOUND"
    ) {
      throw new Error("FAIL: Nonexistent case did not return 404 CASE_NOT_FOUND");
    }

    // -------------------------------------------------------------
    // Test L: Nonexistent Entity (404)
    // -------------------------------------------------------------
    console.log("\nTest L: Nonexistent entity lookup (404)");
    const nonExistEntityRes = await makeRequest({
      path: `/api/cases/${caseId}/entities/PERSON-NONEXISTENT`,
      headers: authHeaders,
    });
    console.log("Status:", nonExistEntityRes.status, "| Envelope:", nonExistEntityRes.data);
    if (
      nonExistEntityRes.status !== 404 ||
      nonExistEntityRes.data.success !== false ||
      nonExistEntityRes.data.error?.code !== "ENTITY_NOT_FOUND"
    ) {
      throw new Error("FAIL: Nonexistent entity did not return 404 ENTITY_NOT_FOUND");
    }

    // -------------------------------------------------------------
    // Test M: Nonexistent Edge (404)
    // -------------------------------------------------------------
    console.log("\nTest M: Nonexistent edge lookup (404)");
    const nonExistEdgeRes = await makeRequest({
      path: `/api/cases/${caseId}/guardrail/507f1f77bcf86cd799439011`,
      headers: authHeaders,
    });
    console.log("Status:", nonExistEdgeRes.status, "| Envelope:", nonExistEdgeRes.data);
    if (
      nonExistEdgeRes.status !== 404 ||
      nonExistEdgeRes.data.success !== false ||
      nonExistEdgeRes.data.error?.code !== "EDGE_NOT_FOUND"
    ) {
      throw new Error("FAIL: Nonexistent edge did not return 404 EDGE_NOT_FOUND");
    }

    // -------------------------------------------------------------
    // Test N: Valid Graph Request (200 + success envelope)
    // -------------------------------------------------------------
    console.log("\nTest N: Valid Graph request success envelope (200)");
    const validGraphRes = await makeRequest({
      path: `/api/cases/${caseId}/graph`,
      headers: authHeaders,
    });
    console.log("Status:", validGraphRes.status, "| Success:", validGraphRes.data.success, "| Error:", validGraphRes.data.error);
    if (
      validGraphRes.status !== 200 ||
      validGraphRes.data.success !== true ||
      validGraphRes.data.error !== null ||
      !validGraphRes.data.data?.nodes
    ) {
      throw new Error("FAIL: Valid graph response did not match success envelope");
    }

    // -------------------------------------------------------------
    // Test O: Valid Timeline Request (200 + success envelope)
    // -------------------------------------------------------------
    console.log("\nTest O: Valid Timeline request success envelope (200)");
    const validTimelineRes = await makeRequest({
      path: `/api/cases/${caseId}/timeline`,
      headers: authHeaders,
    });
    console.log("Status:", validTimelineRes.status, "| Success:", validTimelineRes.data.success);
    if (
      validTimelineRes.status !== 200 ||
      validTimelineRes.data.success !== true ||
      validTimelineRes.data.error !== null ||
      !validTimelineRes.data.data?.timeline
    ) {
      throw new Error("FAIL: Valid timeline response did not match success envelope");
    }

    // -------------------------------------------------------------
    // Test P: Valid Guardrail Request (200 + success envelope)
    // -------------------------------------------------------------
    console.log("\nTest P: Valid Guardrail request success envelope (200)");
    const validGuardrailRes = await makeRequest({
      path: `/api/cases/${caseId}/guardrail/${edgeDoc._id.toString()}`,
      headers: authHeaders,
    });
    console.log("Status:", validGuardrailRes.status, "| Success:", validGuardrailRes.data.success);
    if (
      validGuardrailRes.status !== 200 ||
      validGuardrailRes.data.success !== true ||
      validGuardrailRes.data.error !== null ||
      !validGuardrailRes.data.data?.edge
    ) {
      throw new Error("FAIL: Valid guardrail response did not match success envelope");
    }

    // -------------------------------------------------------------
    // Test Q: Valid Case Processing Flow (201 + success envelope)
    // -------------------------------------------------------------
    console.log("\nTest Q: Valid End-to-End Case Intake & Persistence (201)");
    const validCaseIntakeRes = await makeRequest({
      path: "/api/cases",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ textReports: ["FIR 999: Valid Case Flow Test"] }),
    });
    console.log("Status:", validCaseIntakeRes.status, "| Success:", validCaseIntakeRes.data.success, "| Data:", validCaseIntakeRes.data.data);
    if (
      validCaseIntakeRes.status !== 201 ||
      validCaseIntakeRes.data.success !== true ||
      validCaseIntakeRes.data.error !== null ||
      !validCaseIntakeRes.data.data?.caseId
    ) {
      throw new Error("FAIL: Valid case intake response did not match success envelope");
    }

    // -------------------------------------------------------------
    // Regressions: T01 Health & T02 Auth
    // -------------------------------------------------------------
    console.log("\n--- REGRESSION TESTS (T01 - T02) ---");
    const healthRes = await makeRequest({ path: "/health" });
    console.log("T01 GET /health:", healthRes.status, "| Database:", healthRes.data?.database?.status);

    const authVerifyRes = await makeRequest({
      path: "/api/auth/verify",
      headers: authHeaders,
    });
    console.log("T02 GET /api/auth/verify:", authVerifyRes.status, "| User:", authVerifyRes.data?.data?.user?.username);

    // Clean up test data
    await db.collection("cases").deleteMany({ caseId: { $regex: "^CASE-TEST-T08-" } });
    await db.collection("entities").deleteMany({ caseId: { $regex: "^CASE-TEST-T08-" } });
    await db.collection("edges").deleteMany({ caseId: { $regex: "^CASE-TEST-T08-" } });
    await db.collection("patterns").deleteMany({ caseId: { $regex: "^CASE-TEST-T08-" } });
    if (validCaseIntakeRes.data?.data?.caseId) {
      await db.collection("cases").deleteOne({ caseId: validCaseIntakeRes.data.data.caseId });
      await db.collection("entities").deleteMany({ caseId: validCaseIntakeRes.data.data.caseId });
      await db.collection("edges").deleteMany({ caseId: validCaseIntakeRes.data.data.caseId });
      await db.collection("patterns").deleteMany({ caseId: validCaseIntakeRes.data.data.caseId });
    }
    console.log("Test artifacts cleaned up cleanly.");

    console.log("\n=== ALL T08 TESTS COMPLETED SUCCESSFULLY ===");
  } finally {
    await mockServer.stop();
    await disconnectDB();
  }
}

runT08Tests().catch(console.error);
