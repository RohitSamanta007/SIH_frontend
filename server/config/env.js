const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT, 10) || 5000,
  MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI || "",
  // Accept REASONING_SERVICE_URL as a deployment-friendly alias for FASTAPI_BASE_URL
  FASTAPI_BASE_URL:
    process.env.FASTAPI_BASE_URL ||
    process.env.REASONING_SERVICE_URL ||
    "http://127.0.0.1:8000",
  // Default to 60 s — Groq LLM inference can take 30-50 s for large inputs
  FASTAPI_TIMEOUT_MS: parseInt(process.env.FASTAPI_TIMEOUT_MS, 10) || 60000,
  FASTAPI_INTERNAL_SECRET: process.env.FASTAPI_INTERNAL_SECRET || "",
  JWT_SECRET: process.env.JWT_SECRET || "case_intelligence_jwt_dev_secret_2026",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
  DEFAULT_INVESTIGATOR_USERNAME: process.env.DEFAULT_INVESTIGATOR_USERNAME || "investigator",
  DEFAULT_INVESTIGATOR_PASSWORD: process.env.DEFAULT_INVESTIGATOR_PASSWORD || "investigator123",
};

module.exports = env;
