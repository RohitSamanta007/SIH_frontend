const http = require("http");
const MockFastApiServer = require("./mockFastApiServer");
const { callFastAPI, FastApiError } = require("../src/services/fastApiClient");
const { processCaseThroughFastApi } = require("../src/services/caseProcessingService");
const { Entity, Edge } = require("../src/models");
const { connectDB, disconnectDB } = require("../config/db");

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

async function runT05Tests() {
  console.log("=== STARTING T05 FASTAPI CLIENT & GATEWAY ORCHESTRATION TEST SUITE ===\n");

  const mockServer = new MockFastApiServer();
  const mockPort = await mockServer.start(8000);
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  console.log(`Mock FastAPI server running on ${mockBaseUrl}`);

  // Connect to DB for state assertions
  await connectDB();
  const initialEntityCount = await Entity.countDocuments();
  const initialEdgeCount = await Edge.countDocuments();

  try {
    // -------------------------------------------------------------
    // Test 1: Direct fastApiClient call (Unit Level)
    // -------------------------------------------------------------
    console.log("\n--- Test 1: Direct fastApiClient call with valid mock response ---");
    mockServer.setMode("success");
    const sampleIntake = {
      caseId: "CASE-T05-UNIT-001",
      textReports: ["FIR 99: Suspect transferred funds on 15 Aug"],
      csvRecords: [{ caller: "+919876543210", receiver: "+919123456789" }],
    };

    const fastApiResult = await callFastAPI(sampleIntake, { baseUrl: mockBaseUrl });
    console.log("FastAPI client returned caseId:", fastApiResult.caseId);
    console.log("Entities received:", fastApiResult.entities?.length);
    console.log("Relationships received:", fastApiResult.relationships?.length);
    console.log("Patterns received:", fastApiResult.patterns?.length);
    console.log("Guardrail received:", fastApiResult.guardrail?.length);

    // -------------------------------------------------------------
    // Test 2: Verify Exact Request Body Sent to Mock
    // -------------------------------------------------------------
    console.log("\n--- Test 2: Verify Request Body Sent to FastAPI ---");
    const captured = mockServer.lastRequest;
    console.log("Method:", captured.method, "| URL:", captured.url);
    console.log("Payload keys:", Object.keys(captured.body));
    console.log("Payload caseId matches:", captured.body.caseId === sampleIntake.caseId);
    console.log("No extraneous headers or secret tokens in body:", !captured.body.password && !captured.body.token);

    // -------------------------------------------------------------
    // Test 3: Verify Content-Type Header
    // -------------------------------------------------------------
    console.log("\n--- Test 3: Verify Content-Type Header ---");
    console.log("Content-Type:", captured.headers["content-type"]);
    if (!captured.headers["content-type"].includes("application/json")) {
      throw new Error("FAIL: Content-Type is not application/json");
    }

    // -------------------------------------------------------------
    // Test 4: Timeout Handling -> FASTAPI_TIMEOUT (HTTP 504)
    // -------------------------------------------------------------
    console.log("\n--- Test 4: Timeout handling ---");
    mockServer.setMode("timeout", 1000);
    let timeoutCaught = false;
    try {
      await callFastAPI(sampleIntake, { baseUrl: mockBaseUrl, timeoutMs: 200 });
    } catch (err) {
      timeoutCaught = true;
      console.log("Caught timeout error:", err.code, "| StatusCode:", err.statusCode, "| Message:", err.message);
      if (err.code !== "FASTAPI_TIMEOUT" || err.statusCode !== 504) {
        throw new Error(`FAIL: Unexpected error properties for timeout: ${err.code} / ${err.statusCode}`);
      }
    }
    if (!timeoutCaught) {
      throw new Error("FAIL: Timeout did not trigger error!");
    }

    // -------------------------------------------------------------
    // Test 5: Connection Refused / Unavailable -> FASTAPI_UNAVAILABLE (HTTP 502)
    // -------------------------------------------------------------
    console.log("\n--- Test 5: Service unavailable handling ---");
    let unavailCaught = false;
    try {
      await callFastAPI(sampleIntake, { baseUrl: "http://127.0.0.1:59999" });
    } catch (err) {
      unavailCaught = true;
      console.log("Caught unavailable error:", err.code, "| StatusCode:", err.statusCode);
      if (err.code !== "FASTAPI_UNAVAILABLE" || err.statusCode !== 502) {
        throw new Error(`FAIL: Unexpected error properties for unavailable: ${err.code} / ${err.statusCode}`);
      }
    }
    if (!unavailCaught) {
      throw new Error("FAIL: Unavailable service did not trigger error!");
    }

    // -------------------------------------------------------------
    // Test 6: Upstream 500 Error -> FASTAPI_UPSTREAM_ERROR (HTTP 502)
    // -------------------------------------------------------------
    console.log("\n--- Test 6: Upstream HTTP 500 error handling ---");
    mockServer.setMode("error_500");
    let err500Caught = false;
    try {
      await callFastAPI(sampleIntake, { baseUrl: mockBaseUrl });
    } catch (err) {
      err500Caught = true;
      console.log("Caught upstream 500 error:", err.code, "| StatusCode:", err.statusCode);
    }
    if (!err500Caught) {
      throw new Error("FAIL: Upstream 500 did not trigger error!");
    }

    // -------------------------------------------------------------
    // Test 7: Upstream 4xx Error -> FASTAPI_UPSTREAM_ERROR (HTTP 502)
    // -------------------------------------------------------------
    console.log("\n--- Test 7: Upstream HTTP 400 error handling ---");
    mockServer.setMode("error_400");
    let err400Caught = false;
    try {
      await callFastAPI(sampleIntake, { baseUrl: mockBaseUrl });
    } catch (err) {
      err400Caught = true;
      console.log("Caught upstream 400 error:", err.code, "| StatusCode:", err.statusCode);
    }
    if (!err400Caught) {
      throw new Error("FAIL: Upstream 400 did not trigger error!");
    }

    // -------------------------------------------------------------
    // Test 8: Invalid Non-JSON Response -> FASTAPI_INVALID_RESPONSE (HTTP 502)
    // -------------------------------------------------------------
    console.log("\n--- Test 8: Invalid non-JSON response handling ---");
    mockServer.setMode("invalid_json");
    let invalidJsonCaught = false;
    try {
      await callFastAPI(sampleIntake, { baseUrl: mockBaseUrl });
    } catch (err) {
      invalidJsonCaught = true;
      console.log("Caught invalid JSON error:", err.code, "| StatusCode:", err.statusCode);
    }
    if (!invalidJsonCaught) {
      throw new Error("FAIL: Invalid JSON did not trigger error!");
    }

    // -------------------------------------------------------------
    // Test 9: Missing FASTAPI_BASE_URL -> FASTAPI_CONFIG_ERROR (HTTP 500)
    // -------------------------------------------------------------
    console.log("\n--- Test 9: Missing FASTAPI_BASE_URL configuration ---");
    let configErrCaught = false;
    try {
      await callFastAPI(sampleIntake, { baseUrl: "" });
    } catch (err) {
      configErrCaught = true;
      console.log("Caught config error:", err.code, "| StatusCode:", err.statusCode);
    }
    if (!configErrCaught) {
      throw new Error("FAIL: Missing config did not trigger error!");
    }

    // -------------------------------------------------------------
    // Test 10: End-to-End Express Gateway Integration (POST /api/cases)
    // -------------------------------------------------------------
    console.log("\n--- Test 10: End-to-End Express Gateway Integration with Mock FastAPI ---");
    mockServer.setMode("success");

    // Login for JWT
    const loginRes = await makeRequest({
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "investigator", password: "investigator123" }),
    });
    const token = loginRes.data?.data?.token;

    // Full case intake with text + CSV forwarded to FastAPI
    const multipart = buildMultipart(
      {
        textReports: "FIR 442: Victim transfer of Rs 50,000 to suspect.",
      },
      [
        {
          fieldname: "file",
          filename: "transactions.csv",
          contentType: "text/csv",
          buffer: "transaction_id,sender,receiver,amount\nTXN1,acc1,acc2,50000",
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
    console.log("Gateway Response data:", JSON.stringify(gatewayRes.data, null, 2));

    // -------------------------------------------------------------
    // Test 11: Verify Gateway POST /api/cases persists AI results (T06 contract)
    // (Supersedes the T05-era "no persistence" rule; persistence through
    //  the gateway is now the required architecture per T06.)
    // -------------------------------------------------------------
    console.log("\n--- Test 11: Verify gateway persists AI results to MongoDB (T06 behavior) ---");
    const createdCaseId = gatewayRes.data?.data?.caseId;
    const persistedEntityCount = await Entity.countDocuments({ caseId: createdCaseId });
    const persistedEdgeCount = await Edge.countDocuments({ caseId: createdCaseId });
    console.log(`Entities before suite: ${initialEntityCount}, after: ${await Entity.countDocuments()}`);
    console.log(`Edges before suite: ${initialEdgeCount}, after: ${await Edge.countDocuments()}`);
    console.log(`Persisted entities for ${createdCaseId}: ${persistedEntityCount}`);
    console.log(`Persisted edges for ${createdCaseId}: ${persistedEdgeCount}`);
    if (!createdCaseId || persistedEntityCount === 0 || persistedEdgeCount === 0) {
      throw new Error("FAIL: Gateway did not persist AI results to MongoDB");
    }
    console.log("Gateway-to-MongoDB persistence verified cleanly.");

    // Clean up this run's artifacts so the shared database stays clean
    const mongoose = require("mongoose");
    const dbh = mongoose.connection.db;
    await dbh.collection("cases").deleteMany({ caseId: createdCaseId });
    await dbh.collection("entities").deleteMany({ caseId: createdCaseId });
    await dbh.collection("edges").deleteMany({ caseId: createdCaseId });
    await dbh.collection("patterns").deleteMany({ caseId: createdCaseId });
    console.log("Gateway test artifacts cleaned up.");

    // -------------------------------------------------------------
    // Test 12: Verify Previous Modules (T01 Health, T02 Auth, T03 Intake)
    // -------------------------------------------------------------
    console.log("\n--- Test 12: Verify Previous Modules ---");
    const healthRes = await makeRequest({ path: "/health" });
    console.log("Health check status:", healthRes.status, "| Database:", healthRes.data?.database?.status);

    const authVerifyRes = await makeRequest({
      path: "/api/auth/verify",
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("Auth verify status:", authVerifyRes.status, "| User:", authVerifyRes.data?.data?.user?.username);

    console.log("\n=== ALL T05 TESTS COMPLETED SUCCESSFULLY ===");
  } finally {
    await mockServer.stop();
    await disconnectDB();
  }
}

runT05Tests().catch(console.error);
