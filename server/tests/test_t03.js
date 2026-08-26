const http = require("http");

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

async function run() {
  console.log("=== STARTING T03 CASE INTAKE TEST SUITE ===\n");

  // 1. Get JWT from T02
  console.log("1. Obtaining valid JWT from T02 /api/auth/login...");
  const loginRes = await makeRequest({
    path: "/api/auth/login",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "investigator", password: "investigator123" }),
  });
  const token = loginRes.data?.data?.token;
  console.log("Auth login status:", loginRes.status, "| Token acquired:", !!token);

  // Test I: Missing/Invalid JWT on /api/cases
  console.log("\n--- Test I: Missing/Invalid JWT ---");
  const noAuthRes = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ textReports: ["Test report"] }),
  });
  console.log("Missing JWT status:", noAuthRes.status, "| Error code:", noAuthRes.data?.error?.code);

  const badAuthRes = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer invalid.token",
    },
    body: JSON.stringify({ textReports: ["Test report"] }),
  });
  console.log("Invalid JWT status:", badAuthRes.status, "| Error code:", badAuthRes.data?.error?.code);

  // Test A: Text Only
  console.log("\n--- Test A: Text Only Intake ---");
  const resA = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      textReports: [
        "FIR #104/2026: Rahul called Amit regarding suspected phishing transfer on 15 August.",
        "Supplementary note: Witness reported unusual crypto cashout.",
      ],
    }),
  });
  console.log("Text only status:", resA.status);
  console.log("Response:", JSON.stringify(resA.data, null, 2));

  // Test B: CSV Only
  console.log("\n--- Test B: CSV Only Intake (Multipart) ---");
  const sampleCsv =
    "caller,receiver,timestamp,duration,call_type\n+919876543210,+919123456789,2026-08-15T10:30:00Z,184,VOICE\n+919123456789,+918888888888,2026-08-15T11:15:00Z,45,VOICE";
  const multipartB = buildMultipart(
    {},
    [
      {
        fieldname: "csvFile",
        filename: "cdr_records.csv",
        contentType: "text/csv",
        buffer: sampleCsv,
      },
    ]
  );
  const resB = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": multipartB.contentType,
      Authorization: `Bearer ${token}`,
    },
    body: multipartB.buffer,
  });
  console.log("CSV only status:", resB.status);
  console.log("Response:", JSON.stringify(resB.data, null, 2));

  // Test C: Text + CSV
  console.log("\n--- Test C: Text + CSV Combined Intake ---");
  const multipartC = buildMultipart(
    {
      textReports: "Victim reported transfer of Rs 50,000 to unverified UPI ID.",
    },
    [
      {
        fieldname: "file",
        filename: "transactions.csv",
        contentType: "text/csv",
        buffer: "transaction_id,source_upi,target_upi,amount,timestamp\nTXN1001,victim@oksbi,mule@okhdfc,50000,2026-08-15T12:00:00Z",
      },
    ]
  );
  const resC = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": multipartC.contentType,
      Authorization: `Bearer ${token}`,
    },
    body: multipartC.buffer,
  });
  console.log("Text + CSV status:", resC.status);
  console.log("Response:", JSON.stringify(resC.data, null, 2));

  // Test D: Empty request
  console.log("\n--- Test D: Empty Request ---");
  const resD = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  console.log("Empty request status:", resD.status);
  console.log("Response:", JSON.stringify(resD.data, null, 2));

  // Test E: Empty / whitespace-only text
  console.log("\n--- Test E: Whitespace-only Text ---");
  const resE = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ textReports: ["   ", "\n\t  "] }),
  });
  console.log("Whitespace text status:", resE.status);
  console.log("Response:", JSON.stringify(resE.data, null, 2));

  // Test F: Malformed CSV
  console.log("\n--- Test F: Malformed CSV ---");
  const malformedCsv = 'caller,receiver,timestamp\n"unclosed quote,123,456';
  const multipartF = buildMultipart(
    {},
    [
      {
        fieldname: "file",
        filename: "bad.csv",
        contentType: "text/csv",
        buffer: malformedCsv,
      },
    ]
  );
  const resF = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": multipartF.contentType,
      Authorization: `Bearer ${token}`,
    },
    body: multipartF.buffer,
  });
  console.log("Malformed CSV status:", resF.status);
  console.log("Response:", JSON.stringify(resF.data, null, 2));

  // Test G: Unsupported file type
  console.log("\n--- Test G: Unsupported File Type (.pdf) ---");
  const multipartG = buildMultipart(
    {},
    [
      {
        fieldname: "file",
        filename: "report.pdf",
        contentType: "application/pdf",
        buffer: "%PDF-1.4 dummy pdf binary data",
      },
    ]
  );
  const resG = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": multipartG.contentType,
      Authorization: `Bearer ${token}`,
    },
    body: multipartG.buffer,
  });
  console.log("Unsupported file type status:", resG.status);
  console.log("Response:", JSON.stringify(resG.data, null, 2));

  // Test H: Oversized file (> 5MB)
  console.log("\n--- Test H: Oversized File (> 5MB) ---");
  const largeBuffer = Buffer.alloc(6 * 1024 * 1024, "a,b,c\n1,2,3\n");
  const multipartH = buildMultipart(
    {},
    [
      {
        fieldname: "file",
        filename: "huge.csv",
        contentType: "text/csv",
        buffer: largeBuffer,
      },
    ]
  );
  const resH = await makeRequest({
    path: "/api/cases",
    method: "POST",
    headers: {
      "Content-Type": multipartH.contentType,
      Authorization: `Bearer ${token}`,
    },
    body: multipartH.buffer,
  });
  console.log("Oversized file status:", resH.status);
  console.log("Response:", JSON.stringify(resH.data, null, 2));

  // Test K: Verify T01 Health
  console.log("\n--- Test K: Verify T01 Health Endpoint ---");
  const resK = await makeRequest({ path: "/health" });
  console.log("Health status:", resK.status, "| Database status:", resK.data?.database?.status);

  // Test L: Verify T02 Login
  console.log("\n--- Test L: Verify T02 Login Endpoint ---");
  const resL = await makeRequest({
    path: "/api/auth/login",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "investigator", password: "investigator123" }),
  });
  console.log("Auth login status:", resL.status, "| Success:", resL.data?.success);

  console.log("\n=== ALL T03 TESTS COMPLETED ===");
}

run().catch(console.error);
