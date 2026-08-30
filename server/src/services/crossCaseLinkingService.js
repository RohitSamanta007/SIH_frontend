const { Entity, Edge } = require('../models');

/**
 * Cross-Case Entity Linking Service
 *
 * Background job that runs after a new case is persisted.
 * For every entity in the newly completed case, it:
 *   1. Builds a property fingerprint (aliases + attribute string values)
 *   2. Queries MongoDB for entities from OTHER cases that share any fingerprint value
 *   3. Merges associatedCases arrays on matched entities (both directions)
 *   4. Creates a CROSS_CASE_MATCH edge between the matched pair (upserted)
 *   5. Pulls 1-hop neighbors of the matched entity into the new case
 *      (adds the new caseId to those neighboring edges & entity docs)
 */

/**
 * Extract a flat set of matchable string values from an entity document.
 * Includes all aliases and all string/number leaf values from attributes{}.
 *
 * @param {Object} entity - Mongoose Entity document
 * @returns {string[]} Array of normalised fingerprint values
 */
const buildFingerprint = (entity) => {
  const values = new Set();

  // Aliases
  if (Array.isArray(entity.aliases)) {
    entity.aliases.forEach((a) => {
      if (typeof a === 'string' && a.trim()) values.add(a.trim().toLowerCase());
    });
  }

  // Attribute leaf values (phone, email, IP, account number, etc.)
  if (entity.attributes && typeof entity.attributes === 'object') {
    const extractLeaves = (obj) => {
      Object.values(obj).forEach((val) => {
        if (typeof val === 'string' && val.trim()) {
          values.add(val.trim().toLowerCase());
        } else if (typeof val === 'number') {
          values.add(String(val));
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
          extractLeaves(val);
        } else if (Array.isArray(val)) {
          val.forEach((v) => {
            if (typeof v === 'string' && v.trim()) values.add(v.trim().toLowerCase());
          });
        }
      });
    };
    extractLeaves(entity.attributes);
  }

  return [...values].filter((v) => v.length > 2); // Skip trivially short values
};

/**
 * Run the full cross-case linking job for a given case.
 * Safe to call multiple times — all writes are idempotent ($addToSet + upsert).
 *
 * @param {string} caseId - The newly completed case ID
 * @returns {Promise<{ linked: number, edgesCreated: number, neighborsLinked: number }>}
 */
const runCrossCaseLinking = async (caseId) => {
  if (!caseId || typeof caseId !== 'string') {
    throw new Error('[crossCaseLinking] Invalid caseId provided');
  }

  const tag = `[crossCaseLinking][${caseId}]`;
  console.log(`${tag} Starting cross-case linking job...`);

  let linked = 0;
  let edgesCreated = 0;
  let neighborsLinked = 0;

  try {
    // Fetch all entities that belong to the new case
    const newCaseEntities = await Entity.find({
      associatedCases: caseId,
    }).lean();

    if (!newCaseEntities.length) {
      console.log(`${tag} No entities found for case — skipping.`);
      return { linked: 0, edgesCreated: 0, neighborsLinked: 0 };
    }

    console.log(`${tag} Processing ${newCaseEntities.length} entities...`);

    for (const newEntity of newCaseEntities) {
      const fingerprint = buildFingerprint(newEntity);
      if (!fingerprint.length) continue;

      // ── Step 1: Find matching entities from OTHER cases ────────────────
      // Since MongoDB Atlas free tier disables $where, we'll build $or conditions
      // for the most common attribute paths, plus aliases.
      
      const attributeOrs = fingerprint.map(fp => {
        // We look for exact (or case-insensitive) matches in typical fields
        return [
          { 'attributes.phone': fp },
          { 'attributes.email': fp },
          { 'attributes.number': fp },
          { 'attributes.ip': fp },
          { 'attributes.account_number': fp },
          { 'attributes.mac_address': fp },
          { 'attributes.upi_id': fp }
        ];
      }).flat();

      const matchedEntities = await Entity.find({
        associatedCases: { $nin: [caseId] }, // Not already in this case
        canonicalId: { $ne: newEntity.canonicalId }, // Not the same entity
        $or: [
          // Match alias
          { aliases: { $elemMatch: { $regex: fingerprint.map((f) => `^${escapeRegex(f)}$`).join('|'), $options: 'i' } } },
          // Match standard attributes
          ...attributeOrs
        ],
      }).lean();

      if (!matchedEntities.length) continue;

      for (const matchedEntity of matchedEntities) {
        const matchedCaseIds = matchedEntity.associatedCases || [];

        // ── Step 2: Merge associatedCases (both directions) ────────────
        await Entity.updateOne(
          { canonicalId: matchedEntity.canonicalId },
          { $addToSet: { associatedCases: caseId } }
        );
        await Entity.updateOne(
          { canonicalId: newEntity.canonicalId },
          { $addToSet: { associatedCases: { $each: matchedCaseIds } } }
        );
        linked++;

        // ── Step 3: Upsert CROSS_CASE_MATCH bridge edge ────────────────
        const [src, tgt] = [newEntity.canonicalId, matchedEntity.canonicalId].sort();
        const bridgeEdge = await Edge.findOneAndUpdate(
          {
            source: src,
            target: tgt,
            edgeType: 'CROSS_CASE_MATCH',
          },
          {
            $addToSet: { associatedCases: { $each: [caseId, ...matchedCaseIds] } },
            $setOnInsert: {
              source: src,
              target: tgt,
              edgeType: 'CROSS_CASE_MATCH',
              guardrailStatus: 'cross_case',
              guardrailRationale: `Entity "${newEntity.canonicalId}" from case ${caseId} shares properties with "${matchedEntity.canonicalId}" from ${matchedCaseIds.join(', ')}`,
              confidence: 1.0,
              evidence: [
                {
                  matchedField: 'property_overlap',
                  record: {
                    newCase: caseId,
                    matchedCase: matchedCaseIds[0],
                    newEntityId: newEntity.canonicalId,
                    matchedEntityId: matchedEntity.canonicalId,
                    sharedProperties: fingerprint.slice(0, 5), // Log first 5 for brevity
                  },
                },
              ],
            },
          },
          { upsert: true, new: true }
        );

        if (bridgeEdge) edgesCreated++;

        // ── Step 4: Pull 1-hop neighbors from matched entity's cases ───
        // Find all edges where matched entity is source OR target
        const neighborEdges = await Edge.find({
          associatedCases: { $in: matchedCaseIds },
          $or: [
            { source: matchedEntity.canonicalId },
            { target: matchedEntity.canonicalId },
          ],
          edgeType: { $ne: 'CROSS_CASE_MATCH' }, // Don't recurse on bridge edges
        }).lean();

        for (const neighborEdge of neighborEdges) {
          // Add new caseId to these neighboring edges so they appear in new case graph
          await Edge.updateOne(
            { _id: neighborEdge._id },
            { $addToSet: { associatedCases: caseId } }
          );

          // Also pull in the neighboring entity node
          const neighborEntityId =
            neighborEdge.source === matchedEntity.canonicalId
              ? neighborEdge.target
              : neighborEdge.source;

          await Entity.updateOne(
            { canonicalId: neighborEntityId },
            { $addToSet: { associatedCases: caseId } }
          );

          neighborsLinked++;
        }

        console.log(
          `${tag} Linked "${newEntity.canonicalId}" ↔ "${matchedEntity.canonicalId}" (from ${matchedCaseIds[0]}), pulled ${neighborEdges.length} neighbors`
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

/**
 * Escape special regex characters in a string value.
 * @param {string} str
 * @returns {string}
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { runCrossCaseLinking };
