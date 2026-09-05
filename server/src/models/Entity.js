const mongoose = require("mongoose");

/**
 * Entity Schema
 * Represents a resolved entity within an investigation case.
 *
 * Normalized identifier arrays enable exact, deterministic cross-case lookups
 * without relying on fuzzy text matching.  All values are stored as STRINGS
 * so that leading zeros and full numeric precision are never lost.
 *
 * Normalization rules (applied by identifierNormalizationService before save):
 *   normalizedPhones    — digits only, country-code prefix (+91 / 0) stripped
 *   normalizedVehicles  — uppercase, spaces and hyphens removed
 *   normalizedEmails    — trimmed lowercase
 *   normalizedAccounts  — trimmed, internal whitespace removed, leading zeros kept
 *   normalizedAddresses — lowercase, whitespace collapsed, harmless punctuation removed
 *
 * IMPORTANT: normalized identifier arrays support exact identity lookup only.
 * Similar-looking values (e.g. two different phone numbers) must NEVER be used
 * to automatically merge entities.  Only identical normalized values may trigger
 * a deterministic history match.
 *
 * Backward-compatibility guarantee:
 *   All new array fields default to [] so existing documents load without errors.
 */
const entitySchema = new mongoose.Schema(
  {
    associatedCases: { type: [String], default: [], index: true },

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
    aliases: { type: [String], default: [] },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    confidence: {
      type: Number,
      min: [0, "Confidence must be at least 0"],
      max: [1, "Confidence cannot exceed 1"],
      default: 1.0,
    },

    // ── Normalized identifier arrays ──────────────────────────────────────
    // Stored as strings; indexed for O(1) exact cross-case lookup.

    /** Phone numbers — digits only, no country-code prefix */
    normalizedPhones: { type: [String], default: [] },

    /** Vehicle registration plates — uppercase, no spaces/hyphens */
    normalizedVehicles: { type: [String], default: [] },

    /** Email addresses — trimmed lowercase */
    normalizedEmails: { type: [String], default: [] },

    /**
     * Bank/UPI account numbers — trimmed, leading zeros preserved as string.
     * Never coerced to Number; that would silently drop leading zeros.
     */
    normalizedAccounts: { type: [String], default: [] },

    /** Physical addresses — lowercase, whitespace collapsed */
    normalizedAddresses: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: "entities",
  }
);

// ── Compound type index ──────────────────────────────────────────────────────
// Removed duplicate index as 'type' has index: true in schema definition

// ── Legacy attribute-level exact-match indexes (kept for backward compat) ────
entitySchema.index({ "attributes.phone": 1 }, { sparse: true });
entitySchema.index({ "attributes.vehicle_reg": 1 }, { sparse: true });
entitySchema.index({ "attributes.email": 1 }, { sparse: true });
entitySchema.index({ "attributes.account_number": 1 }, { sparse: true });

// ── Normalized identifier exact-match indexes ────────────────────────────────
entitySchema.index({ normalizedPhones: 1 }, { sparse: true, name: "entity_norm_phones" });
entitySchema.index({ normalizedVehicles: 1 }, { sparse: true, name: "entity_norm_vehicles" });
entitySchema.index({ normalizedEmails: 1 }, { sparse: true, name: "entity_norm_emails" });
entitySchema.index({ normalizedAccounts: 1 }, { sparse: true, name: "entity_norm_accounts" });
entitySchema.index({ normalizedAddresses: 1 }, { sparse: true, name: "entity_norm_addresses" });

// ── Text index for alias/name keyword search fallback ────────────────────────
entitySchema.index({ aliases: "text" }, { name: "entity_aliases_text" });

const Entity = mongoose.model("Entity", entitySchema);

module.exports = Entity;
