const mongoose = require("mongoose");

/**
 * Entity Schema
 * Represents a resolved entity within an investigation case
 */
const entitySchema = new mongoose.Schema(
  {
    associatedCases: {
      type: [String],
      default: [],
      index: true,
    },
    canonicalId: {
      type: String,
      required: [true, "canonicalId is required"],
      trim: true,
      unique: true,
      index: true,
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

// Compound index for querying entities by type
entitySchema.index({ type: 1 });

const Entity = mongoose.model("Entity", entitySchema);

module.exports = Entity;
