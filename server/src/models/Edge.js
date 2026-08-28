const mongoose = require("mongoose");

/**
 * Evidence sub-schema — field names MUST stay in sync with FastAPI EvidenceItem Pydantic model:
 *
 *   class EvidenceItem(BaseModel):
 *       sourceReportId: str       ← was incorrectly stored as "sourceType"
 *       matchedField:   str       ← was incorrectly stored as "field"
 *       record:         Dict      ← unchanged
 *
 * Schema drift between these two definitions silently discards all evidence provenance data.
 * Any change here must also be reflected in resultPersistenceService.serializeEvidenceItem().
 */
const evidenceItemSchema = new mongoose.Schema(
  {
    // Identifier of the source text report or CSV row that generated this evidence
    sourceReportId: {
      type: String,
      trim: true,
    },
    // The field/column name within the source record that matched
    matchedField: {
      type: String,
      trim: true,
    },
    // Full raw record object (or ≤200-char excerpt for large records) — never a reference/ID
    record: {
      type: mongoose.Schema.Types.Mixed,
    },
    // Catch-all for any additional evidence metadata the reasoning service may add in future
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
    associatedCases: {
      type: [String],
      default: [],
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
    timestamp: {
      type: Date,
    },
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

// Global compound unique index ensuring a single edge tracks multiple cases
edgeSchema.index({ source: 1, target: 1, edgeType: 1 }, { unique: true });
edgeSchema.index({ timestamp: 1 });

const Edge = mongoose.model("Edge", edgeSchema);

module.exports = Edge;
