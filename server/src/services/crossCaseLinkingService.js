"use strict";

const { Entity, Edge } = require("../models");

/**
 * Cross-Case Entity Linking Service
 *
 * Background job that runs after a new case is persisted.
 * For every entity in the newly completed case, it queries MongoDB for entities
 * from OTHER cases that share EXACT NORMALIZED IDENTIFIERS.
 *
 * It creates a bounded recurrence edge only. It does not import unrelated
 * neighbours or merge case membership onto historical nodes.
 */

/**
 * Run the full cross-case linking job for a given case.
 * Safe to call multiple times — all writes are idempotent.
 *
 * @param {string} caseId
 * @returns {Promise<{ linked: number, edgesCreated: number, neighborsLinked: number }>}
 */
const runCrossCaseLinking = async (caseId) => {
  if (!caseId || typeof caseId !== "string") {
    throw new Error("[crossCaseLinking] Invalid caseId provided");
  }

  const tag = `[crossCaseLinking][${caseId}]`;
  console.log(`${tag} Starting cross-case linking job...`);

  let linked = 0;
  let edgesCreated = 0;
  let neighborsLinked = 0;

  try {
    const newCaseEntities = await Entity.find({ associatedCases: caseId }).lean();

    if (!newCaseEntities.length) {
      console.log(`${tag} No entities found for case — skipping.`);
      return { linked: 0, edgesCreated: 0, neighborsLinked: 0 };
    }

    console.log(`${tag} Processing ${newCaseEntities.length} entities...`);

    for (const newEntity of newCaseEntities) {
      // Build exactly matchable conditions from normalized identifier arrays
      const orConditions = [];

      if (Array.isArray(newEntity.normalizedPhones) && newEntity.normalizedPhones.length > 0) {
        orConditions.push({ normalizedPhones: { $in: newEntity.normalizedPhones } });
      }
      if (Array.isArray(newEntity.normalizedVehicles) && newEntity.normalizedVehicles.length > 0) {
        orConditions.push({ normalizedVehicles: { $in: newEntity.normalizedVehicles } });
      }
      if (Array.isArray(newEntity.normalizedEmails) && newEntity.normalizedEmails.length > 0) {
        orConditions.push({ normalizedEmails: { $in: newEntity.normalizedEmails } });
      }
      if (Array.isArray(newEntity.normalizedAccounts) && newEntity.normalizedAccounts.length > 0) {
        orConditions.push({ normalizedAccounts: { $in: newEntity.normalizedAccounts } });
      }
      if (Array.isArray(newEntity.normalizedAddresses) && newEntity.normalizedAddresses.length > 0) {
        orConditions.push({ normalizedAddresses: { $in: newEntity.normalizedAddresses } });
      }

      if (orConditions.length === 0) continue;

      const matchedEntities = await Entity.find({
        associatedCases: { $nin: [caseId] },
        canonicalId: { $ne: newEntity.canonicalId },
        $or: orConditions,
      }).lean();

      if (!matchedEntities.length) continue;

      for (const matchedEntity of matchedEntities) {
        const matchedCaseIds = matchedEntity.associatedCases || [];

        const distinctHistoricalCases = [...new Set(matchedCaseIds.filter((id) => id && id !== caseId))];
        if (distinctHistoricalCases.length === 0) continue;
        linked++;

        // Current + one distinct historical case satisfies the two-case threshold.
        const [src, tgt] = [newEntity.canonicalId, matchedEntity.canonicalId].sort();
        const overlaps = [];
        for (const [label, field] of [["phone", "normalizedPhones"], ["vehicle", "normalizedVehicles"], ["email", "normalizedEmails"], ["account", "normalizedAccounts"], ["address", "normalizedAddresses"]]) {
          const oldValues = new Set(matchedEntity[field] || []);
          for (const value of newEntity[field] || []) if (oldValues.has(value)) overlaps.push(`${label}:${value}`);
        }
        const bridgeEdge = await Edge.findOneAndUpdate(
          {
            source: src,
            target: tgt,
            edgeType: "cross_case_recurrence",
          },
          {
            $addToSet: { associatedCases: { $each: [caseId, ...distinctHistoricalCases] } },
            $setOnInsert: {
              edgeId: `cross-case:${src}:${tgt}`,
              source: src,
              target: tgt,
              edgeType: "cross_case_recurrence",
              systemStatus: "cross_connection",
              guardrailStatus: "cross_connection",
              guardrailRationale: `Deterministic exact identifier recurrence across ${[caseId, ...distinctHistoricalCases].join(", ")}`,
              relationReason: "Deterministic exact identifier match",
              confidence: 1.0,
              evidence: [
                {
                  sourceReportId: "system_generated",
                  matchedField: "exact_identifier_overlap",
                  record: {
                    newCase: caseId,
                    matchedCases: distinctHistoricalCases,
                    newEntityId: newEntity.canonicalId,
                    matchedEntityId: matchedEntity.canonicalId,
                    matchedFields: overlaps,
                  },
                },
              ],
            },
          },
          { upsert: true, new: true }
        );

        if (bridgeEdge) edgesCreated++;

        console.log(
          `${tag} Linked "${newEntity.canonicalId}" ↔ "${matchedEntity.canonicalId}" from ${distinctHistoricalCases.join(", ")}`
        );
      }
    }

    console.log(
      `${tag} Done — ${linked} entity matches, ${edgesCreated} bridge edges, ${neighborsLinked} neighbors linked.`
    );

    return { linked, edgesCreated, neighborsLinked };
  } catch (err) {
    console.error(`${tag} Job failed:`, err.message);
    throw err;
  }
};

module.exports = { runCrossCaseLinking };
