const mongoose = require("mongoose");

/**
 * Pattern Schema
 * Stores detected suspicious patterns / subgraph motifs from Argha's reasoning core
 */
const patternSchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: [true, "caseId is required"],
      trim: true,
      index: true,
    },
    patternType: {
      type: String,
      required: [true, "patternType is required"],
      trim: true,
      index: true,
    },
    relatedEntityIds: {
      type: [String],
      default: [],
    },
    relatedEdgeIds: {
      type: [String],
      default: [],
    },
    confidence: {
      type: Number,
      min: [0, "Confidence must be at least 0"],
      max: [1, "Confidence cannot exceed 1"],
      default: 1.0,
    },
    description: {
      type: String,
      trim: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "patterns",
  }
);

// Compound index for querying patterns by type within a case
patternSchema.index({ caseId: 1, patternType: 1 });

const Pattern = mongoose.model("Pattern", patternSchema);

module.exports = Pattern;
