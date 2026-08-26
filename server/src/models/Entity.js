const mongoose = require("mongoose");

/**
 * Entity Schema
 * Represents a resolved entity within an investigation case
 */
const entitySchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: [true, "caseId is required"],
      trim: true,
      index: true,
    },
    canonicalId: {
      type: String,
      required: [true, "canonicalId is required"],
      trim: true,
    },
    type: {
      type: String,
      required: [true, "type is required"],
      trim: true,
      index: true,
    },
    aliases: {
      type: [String],
      default: [],
    },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    confidence: {
      type: Number,
      min: [0, "Confidence must be at least 0"],
      max: [1, "Confidence cannot exceed 1"],
      default: 1.0,
    },
  },
  {
    timestamps: true,
    collection: "entities",
  }
);

// Compound unique index ensuring canonicalId is unique within the case scope
entitySchema.index({ caseId: 1, canonicalId: 1 }, { unique: true });

// Compound index for querying entities by type within a case
entitySchema.index({ caseId: 1, type: 1 });

const Entity = mongoose.model("Entity", entitySchema);

module.exports = Entity;
