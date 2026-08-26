const mongoose = require("mongoose");

/**
 * Flexible sub-schema for Edge Evidence
 * Isolates provisional FastAPI contract requirements while keeping structure validated
 */
const evidenceItemSchema = new mongoose.Schema(
  {
    sourceType: {
      type: String,
      trim: true,
    },
    // Supports either full record object OR record reference/ID
    record: {
      type: mongoose.Schema.Types.Mixed,
    },
    field: {
      type: String,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
    },
    citation: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

/**
 * Edge Schema
 * Represents a relationship/interaction between two entities with mandatory evidence
 */
const edgeSchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: [true, "caseId is required"],
      trim: true,
      index: true,
    },
    source: {
      type: String,
      required: [true, "source is required"],
      trim: true,
      alias: "sourceEntityId",
    },
    target: {
      type: String,
      required: [true, "target is required"],
      trim: true,
      alias: "targetEntityId",
    },
    edgeType: {
      type: String,
      required: [true, "edgeType is required"],
      trim: true,
      index: true,
    },
    confidence: {
      type: Number,
      min: [0, "Confidence must be at least 0"],
      max: [1, "Confidence cannot exceed 1"],
      default: 1.0,
    },
    // Domain / event timestamp from source evidence (distinct from createdAt / updatedAt)
    timestamp: {
      type: Date,
    },
    // Reserved for Argha's guardrail decision output
    guardrailStatus: {
      type: String,
      trim: true,
    },
    guardrailRationale: {
      type: String,
      trim: true,
    },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // HARD REQUIREMENT: Every persisted edge MUST contain non-empty evidence[]
    evidence: {
      type: [evidenceItemSchema],
      required: [true, "Edge evidence is required and must not be empty"],
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length > 0;
        },
        message: "Edge evidence must contain at least one item",
      },
    },
  },
  {
    timestamps: true,
    collection: "edges",
  }
);

// Indexes for relationship traversals and temporal analysis
edgeSchema.index({ caseId: 1, source: 1, target: 1 });
edgeSchema.index({ caseId: 1, edgeType: 1 });
edgeSchema.index({ caseId: 1, timestamp: 1 });

const Edge = mongoose.model("Edge", edgeSchema);

module.exports = Edge;
