const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT, 10) || 5000,
  MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI || "",
  FASTAPI_BASE_URL: process.env.FASTAPI_BASE_URL || "http://127.0.0.1:8000",
  FASTAPI_TIMEOUT_MS: parseInt(process.env.FASTAPI_TIMEOUT_MS, 10) || 30000,
  FASTAPI_INTERNAL_SECRET: process.env.FASTAPI_INTERNAL_SECRET || "",
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
  DEFAULT_INVESTIGATOR_USERNAME: process.env.DEFAULT_INVESTIGATOR_USERNAME || "investigator",
  DEFAULT_INVESTIGATOR_PASSWORD: process.env.DEFAULT_INVESTIGATOR_PASSWORD || "investigator123",
};

module.exports = env;
