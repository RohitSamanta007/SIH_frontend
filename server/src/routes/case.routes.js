const express = require("express");
const caseController = require("../controllers/caseController");
const authMiddleware = require("../middleware/authMiddleware");
const { handleUpload } = require("../middleware/uploadMiddleware");
const { runCrossCaseLinking } = require("../services/crossCaseLinkingService");

const router = express.Router();

// ==========================================
// Case Intake & Processing (Module 1, 2, 4)
// ==========================================
/**
 * @route   POST /api/cases
 * @desc    Case intake endpoint — accepts FIR/report text and/or CDR/transaction CSV
 * @access  Private (Requires valid Investigator Bearer JWT)
 */
router.post("/", authMiddleware, handleUpload, caseController.createCaseIntake);

/**
 * @route   POST /api/cases/:caseId/relink
 * @desc    Manually trigger cross-case entity linking for a specific case
 * @access  Private
 */
router.post("/:caseId/relink", authMiddleware, (req, res) => {
  const { caseId } = req.params;
  // Fire-and-forget
  runCrossCaseLinking(caseId).catch((err) => {
    console.error(`[crossCaseLinking] Manual run failed for ${caseId}:`, err.message);
  });
  return res.status(202).json({
    success: true,
    message: `Cross-case linking job queued for case ${caseId}`,
  });
});

/**
 * @route   GET /api/cases
 * @desc    List all investigation cases (newest first) with summary counts for the dashboard
 * @access  Private (Requires valid Investigator Bearer JWT)
 */
router.get("/", authMiddleware, caseController.listCases);

// ==========================================
// MongoDB Read APIs for Dashboard (T07)
// ==========================================
/**
 * @route   GET /api/cases/:caseId/graph
 * @desc    Get full investigation graph (nodes + edges) for the specified case
 * @access  Private (Requires valid Investigator Bearer JWT)
 */
router.get("/:caseId/graph", authMiddleware, caseController.fetchCaseGraph);

/**
 * @route   GET /api/cases/:caseId/entities/:entityId
 * @desc    Get entity profile detail and related edges within the specified case
 * @access  Private (Requires valid Investigator Bearer JWT)
 */
router.get("/:caseId/entities/:entityId", authMiddleware, caseController.fetchEntityDetail);

/**
 * @route   GET /api/cases/:caseId/timeline
 * @desc    Get chronological interaction timeline for the specified case
 * @access  Private (Requires valid Investigator Bearer JWT)
 */
router.get("/:caseId/timeline", authMiddleware, caseController.fetchCaseTimeline);

/**
 * @route   GET /api/cases/:caseId/guardrail/:edgeId
 * @desc    Get guardrail verification and evidence metadata for a specific edge
 * @access  Private (Requires valid Investigator Bearer JWT)
 */
router.get("/:caseId/guardrail/:edgeId", authMiddleware, caseController.fetchGuardrailDetail);

/**
 * @route   PATCH /api/cases/:caseId/status
 * @desc    Toggle case status
 * @access  Private
 */
router.patch("/:caseId/status", authMiddleware, caseController.updateCaseStatus);

module.exports = router;
