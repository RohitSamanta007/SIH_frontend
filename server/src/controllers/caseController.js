const { processCaseIntake } = require("../services/caseIntakeService");
const { processCaseThroughFastApi } = require("../services/caseProcessingService");
const {
  getCaseGraph,
  getEntityDetail,
  getCaseTimeline,
  getGuardrailDetail,
  getCasesList,
} = require("../services/caseGraphService");

/**
 * Handle case intake, orchestrate FastAPI reasoning, and persist results to MongoDB (T01 - T06)
 *
 * @route POST /api/cases
 * @access Private (Investigator JWT required)
 */
const createCaseIntake = async (req, res, next) => {
  try {
    const body = req.body || {};

    // 1. Gather text inputs
    let textInput = body.textReports || body.text || body.report || body.reports;

    // 2. Gather CSV inputs from multipart files or body string
    let csvBuffer = null;
    let csvString = null;

    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      csvBuffer = Buffer.concat(req.files.map((f) => f.buffer));
    } else if (req.file) {
      csvBuffer = req.file.buffer;
    } else if (body.csvData || body.csv) {
      csvString = body.csvData || body.csv;
    }

    // 3. Process and normalize via intake service (Module 1)
    const normalizedData = processCaseIntake({
      textInput,
      csvBuffer,
      csvString,
    });

    // 4. Orchestrate call to FastAPI reasoning service & persist into MongoDB (Modules 2 & 4)
    const persistenceResult = await processCaseThroughFastApi(normalizedData);

    // 5. Return HTTP 201 Created with standard persistence success envelope
    return res.status(201).json({
      success: true,
      data: {
        caseId: persistenceResult.caseId,
        status: persistenceResult.status,
        summary: persistenceResult.summary,
        createdAt: persistenceResult.createdAt,
        updatedAt: persistenceResult.updatedAt,
      },
      error: null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve full graph (nodes + edges) for a given case
 *
 * @route GET /api/cases/:caseId/graph
 * @access Private (Investigator JWT required)
 */
const fetchCaseGraph = async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const graphData = await getCaseGraph(caseId);
    return res.status(200).json({
      success: true,
      data: graphData,
      error: null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve entity detail and related edges
 *
 * @route GET /api/cases/:caseId/entities/:entityId
 * @access Private (Investigator JWT required)
 */
const fetchEntityDetail = async (req, res, next) => {
  try {
    const { caseId, entityId } = req.params;
    const entityData = await getEntityDetail(caseId, entityId);
    return res.status(200).json({
      success: true,
      data: entityData,
      error: null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve chronologically ordered interaction timeline
 *
 * @route GET /api/cases/:caseId/timeline
 * @access Private (Investigator JWT required)
 */
const fetchCaseTimeline = async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const timelineData = await getCaseTimeline(caseId);
    return res.status(200).json({
      success: true,
      data: timelineData,
      error: null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve guardrail details and evidence for a specific edge
 *
 * @route GET /api/cases/:caseId/guardrail/:edgeId
 * @access Private (Investigator JWT required)
 */
const fetchGuardrailDetail = async (req, res, next) => {
  try {
    const { caseId, edgeId } = req.params;
    const guardrailData = await getGuardrailDetail(caseId, edgeId);
    return res.status(200).json({
      success: true,
      data: guardrailData,
      error: null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all investigation cases (newest first) with summary counts for the dashboard
 *
 * @route GET /api/cases
 * @access Private (Investigator JWT required)
 */
const listCases = async (req, res, next) => {
  try {
    const listData = await getCasesList();
    return res.status(200).json({
      success: true,
      data: listData,
      error: null,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCaseIntake,
  listCases,
  fetchCaseGraph,
  fetchEntityDetail,
  fetchCaseTimeline,
  fetchGuardrailDetail,
};
