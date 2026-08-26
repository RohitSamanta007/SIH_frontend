const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

/**
 * @route   GET /health
 * @desc    Health check endpoint to verify backend service and database status
 * @access  Public
 */
router.get("/", (req, res) => {
  const dbStateMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  const dbState = dbStateMap[mongoose.connection.readyState] || "unknown";

  res.status(200).json({
    status: "ok",
    service: "case-intelligence-backend",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: {
      status: dbState,
      readyState: mongoose.connection.readyState,
    },
  });
});

module.exports = router;
