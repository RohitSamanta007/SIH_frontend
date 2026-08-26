const mongoose = require("mongoose");

/**
 * Sub-schema for recording upload history and ingested evidence sources
 */
const sourceUploadSchema = new mongoose.Schema(
  {
    uploadId: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ["text", "csv", "json", "other"],
      default: "text",
    },
    filename: {
      type: String,
      trim: true,
    },
    recordCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

/**
 * Case Schema
 * Represents an investigation instance
 */
const caseSchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: [true, "caseId is required"],
      unique: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    title: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    sourceUploads: {
      type: [sourceUploadSchema],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "cases",
  }
);

const Case = mongoose.model("Case", caseSchema);

module.exports = Case;
