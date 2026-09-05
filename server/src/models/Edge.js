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
    sourceReportId: { type: String, trim: true },
    // The field/column name within the source record that matched
    matchedField: { type: String, trim: true },
    // Full raw record object (or ≤200-char excerpt for large records) — never a reference/ID
    record: { type: mongoose.Schema.Types.Mixed },
    // Catch-all for any additional evidence metadata the reasoning service may add in future
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

/**
 * Audit entry written each time an investigator changes the review status of an edge.
 * The array is append-only — never delete entries so the full review history is preserved.
 */
const reviewAuditEntrySchema = new mongoose.Schema(
  {
    reviewedBy:     { type: String, trim: true },   // Investigator username / userId
    reviewedAt:     { type: Date, default: Date.now },
    previousStatus: { type: String, trim: true },
    newStatus:      { type: String, trim: true },
    note:           { type: String, trim: true },   // Optional free-text note
  },
  { _id: false }
);

/**
 * Edge Schema
 * Represents a relationship / interaction between two entities with mandatory evidence.
 *
 * Backward-compatibility guarantee:
 *   All new fields carry safe defaults (undefined / []) so documents created
 *   before this migration load without validation errors.
 *
 * Field separation — CRITICAL RULE:
 *   systemStatus  — immutable copy of FastAPI's guardrailStatus for this edge.
 *                   Never overwritten after initial save (even on case reprocessing).
 *   reviewStatus  — investigator-chosen classification. Persisted via the
 *                   PATCH /api/cases/:caseId/relationships/:edgeId/status route.
 *                   Allowed values: "verified" | "possible_connection" |
 *                                   "cross_connection" | "unverified" | "unknown"
 *
 *   guardrailStatus / guardrailRationale — kept for backward-compat with old code
 *   paths that read these fields; new code should prefer systemStatus.
 */
const edgeSchema = new mongoose.Schema(
  {
    associatedCases: { type: [String], default: [], index: true },
    edgeId: { type: String, trim: true, sparse: true, index: true },

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

    // Legacy timestamp field (kept for backward compat; timeline now uses eventDate)
    timestamp: { type: Date },

    // ── FastAPI guardrail / system fields ─────────────────────────────────

    /**
     * Immutable FastAPI guardrail result for this specific edge.
     * Copied from guardrailStatus on initial save; never overwritten on
     * reprocessing so the AI baseline is always preserved.
     */
    systemStatus: { type: String, trim: true },

    // Kept for backward compatibility with existing query paths
    guardrailStatus:   { type: String, trim: true },
    guardrailRationale: { type: String, trim: true },

    // ── Timeline event fields (returned by FastAPI on each relationship) ──

    /**
     * ISO-8601 date string of the real-world event (e.g. "2024-03-15").
     * Used for timeline ordering and slider filtering.
     * NULL means the date is unknown; do NOT substitute createdAt.
     */
    eventDate: { type: String, trim: true },

    /**
     * Time component of the event (e.g. "14:30:00").
     * Combined with eventDate for precise ordering when available.
     */
    eventTime: { type: String, trim: true },

    /**
     * Machine-readable event category returned by FastAPI
     * (e.g. "theft_reported", "call_recorded", "vehicle_recovered").
     * Displayed to investigators as a readable label.
     */
    eventType: { type: String, trim: true },

    /**
     * Human-readable explanation of why this relationship exists,
     * as determined by the FastAPI reasoning core.
     */
    relationReason: { type: String, trim: true },

    /**
     * Array of evidence item IDs referenced by FastAPI for this relationship.
     */
    evidenceIds: { type: [String], default: [] },

    /**
     * Confidence in the event date assignment:
     *   "explicit"  — date is directly stated in the source
     *   "inferred"  — date is derived from context (shown with "Inferred" badge)
     *   "none"      — no date available
     */
    dateConfidence: {
      type: String,
      enum: ["explicit", "inferred", "none"],
      default: "none",
    },

    // ── Investigator review ───────────────────────────────────────────────

    /**
     * Investigator-chosen relationship classification.
     * Independently settable via PATCH /api/cases/:caseId/edges/:edgeId/review.
     * Does NOT overwrite systemStatus.
     *
     * Recommended initial mapping from FastAPI result:
     *   guardrailStatus "verified"            → "approved"
     *   guardrailStatus "possible_connection" → "possible_connection"
     *   anything else / missing               → "unverified"
     */
    reviewStatus: {
      type: String,
      enum: ["verified", "possible_connection", "cross_connection", "unverified", "unknown"],
    },
    reviewReason: { type: String, trim: true },
    reviewUpdatedBy: { type: String, trim: true },
    reviewUpdatedAt: { type: Date },

    /**
     * Append-only audit log of every investigator status change.
     * Contains: reviewedBy, reviewedAt, previousStatus, newStatus, note.
     */
    reviewAudit: { type: [reviewAuditEntrySchema], default: [] },

    // General-purpose attribute bag
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },

    evidence: {
      type: [evidenceItemSchema],
      required: [true, "Edge evidence is required and must not be empty"],
      validate: {
        validator: (val) => Array.isArray(val) && val.length > 0,
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

// Timeline and review filtering indexes
edgeSchema.index({ timestamp: 1 });
edgeSchema.index({ eventDate: 1 }, { sparse: true });
edgeSchema.index({ reviewStatus: 1 }, { sparse: true });

const Edge = mongoose.model("Edge", edgeSchema);

module.exports = Edge;
