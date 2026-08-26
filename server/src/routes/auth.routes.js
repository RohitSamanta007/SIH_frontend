const express = require("express");
const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate investigator & obtain JWT token
 * @access  Public
 */
router.post("/login", authController.login);

/**
 * @route   GET /api/auth/verify
 * @desc    Verify JWT token & return authenticated investigator payload
 * @access  Private (Requires Bearer token)
 */
router.get("/verify", authMiddleware, authController.verifyToken);

module.exports = router;
