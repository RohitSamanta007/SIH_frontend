const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const { connectDB, disconnectDB } = require("./config/db");
const healthRoutes = require("./src/routes/health.routes");
const authRoutes = require("./src/routes/auth.routes");
const caseRoutes = require("./src/routes/case.routes");
const { seedDefaultInvestigator } = require("./src/services/authService");
const notFoundHandler = require("./src/middleware/notFoundHandler");
const errorHandler = require("./src/middleware/errorHandler");

const app = express();

// ==========================================
// Middleware Order: 1. CORS, 2. Body Parsing
// ==========================================
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ==========================================
// Routes
// ==========================================
// Root informational endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    name: "Case Intelligence & Investigator Graph Backend Gateway",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: "/health",
      auth: "/api/auth/login",
      cases: "/api/cases",
    },
  });
});

// Health check endpoint (T01)
app.use("/health", healthRoutes);

// Authentication routes (T02)
app.use("/api/auth", authRoutes);

// Case intake & management routes (T03 - T07)
app.use("/api/cases", caseRoutes);

// ==========================================
// 404 & Centralized Error Handling Middleware
// ==========================================
// 404 Route Not Found handler
app.use(notFoundHandler);

// Centralized error handler (Must be the final middleware)
app.use(errorHandler);

// ==========================================
// Server Initialization & Database Connection
// ==========================================
const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Initialize default investigator credentials if none exist
    await seedDefaultInvestigator();

    // 3. Start Express server
    const server = app.listen(env.PORT, () => {
      console.log(`[Server] Case Intelligence Gateway running in ${env.NODE_ENV} mode on port ${env.PORT}`);
      console.log(`[Server] Health check available at http://localhost:${env.PORT}/health`);
      console.log(`[Server] Auth endpoint available at http://localhost:${env.PORT}/api/auth/login`);
      console.log(`[Server] Case intake available at http://localhost:${env.PORT}/api/cases`);
    });

    // Graceful shutdown handling
    const shutdown = async (signal) => {
      console.log(`\n[Server] ${signal} signal received. Initiating graceful shutdown...`);
      server.close(async () => {
        console.log("[Server] HTTP server closed.");
        await disconnectDB();
        process.exit(0);
      });

      setTimeout(() => {
        console.error("[Server] Forced shutdown due to timeout.");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    return server;
  } catch (error) {
    console.error("[Server] Failed to initialize server:", error.message);
    process.exit(1);
  }
};

// Start application if executed directly
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };