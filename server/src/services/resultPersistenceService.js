const mongoose = require("mongoose");
const { Case, Entity, Edge, Pattern } = require("../models");
const { AppError } = require("../utils/AppError");

/**
 * Custom error class representing persistence validation or database failures
 */
class PersistenceError extends AppError {
  constructor(message, statusCode = 500, code = "PERSISTENCE_DATABASE_ERROR", details = null) {
    super(message, code, statusCode, details);
  }
}

/**
 * Deduplicate evidence item — serialize to a stable key for Set-based collision checking.
 * Field names MUST match EvidenceItem Pydantic model in reasoning-service AND Edge.js evidenceItemSchema.
 *   sourceReportId  ← FastAPI field (was incorrectly "sourceType")
 *   matchedField    ← FastAPI field (was incorrectly "field")
 *   record          ← unchanged
 */
const serializeEvidenceItem = (item) => {
  if (!item || typeof item !== "object") return "";
  return JSON.stringify({
    sourceReportId: item.sourceReportId || "",
    matchedField: item.matchedField || "",
    record: item.record !== undefined ? item.record : "",
  });
};

/**
 * Validate incoming FastAPI AI reasoning payload prior to database mutation
 *
 * @param {Object} fastApiResult - AI payload returned by FastAPI
 * @param {string} [expectedCaseId] - Expected Case ID from intake
 */
const validateFastApiResult = (fastApiResult, expectedCaseId = null) => {
  if (!fastApiResult || typeof fastApiResult !== "object") {
    throw new PersistenceError("Invalid AI response: Expected payload object", 422, "PERSISTENCE_CONTRACT_ERROR");
  }

  const caseId = fastApiResult.caseId?.trim();
  if (!caseId) {
    throw new PersistenceError("Missing required caseId in FastAPI result", 422, "PERSISTENCE_VALIDATION_ERROR");
  }

  if (expectedCaseId && caseId !== expectedCaseId) {
    throw new PersistenceError(
      `Mismatched Case ID: Payload contains '${caseId}', expected '${expectedCaseId}'`,
      400,
      "PERSISTENCE_VALIDATION_ERROR"
    );
  }

  // Pre-validate critical hard invariant: Every edge must contain non-empty evidence[]
  const relationships = fastApiResult.relationships || fastApiResult.edges || [];
  if (Array.isArray(relationships)) {
    for (let i = 0; i < relationships.length; i++) {
      const rel = relationships[i];
      if (!rel || typeof rel !== "object") {
        throw new PersistenceError(
          `Invalid relationship entry at index ${i}`,
          422,
          "PERSISTENCE_VALIDATION_ERROR"
        );
      }

      if (!Array.isArray(rel.evidence) || rel.evidence.length === 0) {
        throw new PersistenceError(
          `Relationship from '${rel.source || rel.sourceEntityId || "unknown"}' to '${
            rel.target || rel.targetEntityId || "unknown"
          }' violates hard invariant: evidence[] must be a non-empty array`,
          422,
          "INVALID_EVIDENCE_ERROR"
        );
      }
    }
  }
};

/**
 * Persist and accumulate AI reasoning results into MongoDB
 *
 * @param {Object} fastApiResult - Validated AI reasoning result
 * @param {Object} [intakeMetadata] - Ingestion source info (textReports, csvRecords, etc.)
 * @returns {Promise<Object>} Persistence summary and Case record
 */
const persistCaseResults = async (fastApiResult, intakeMetadata = {}) => {
  // 1. Validate payload and verify hard evidence invariant
  const expectedCaseId = intakeMetadata.caseId;
  validateFastApiResult(fastApiResult, expectedCaseId);

  const caseId = fastApiResult.caseId.trim();

  // Build a per-edge guardrail lookup from the guardrail array BEFORE the persistence loop.
  // FastAPI returns guardrail[] as GuardrailItem[] with { edgeId, status, rationale }.
  // Each RelationshipModel carries its own edgeId — we must match them 1:1.
  // The previous implementation used guardrail[0] as a global fallback for ALL edges,
  // which incorrectly applied a single guardrail decision to every relationship.
  const guardrailMap = new Map(
    Array.isArray(fastApiResult.guardrail)
      ? fastApiResult.guardrail
          .filter((g) => g && typeof g.edgeId === "string" && g.edgeId.trim())
          .map((g) => [g.edgeId.trim(), g])
      : []
  );

  // Try to use a MongoDB transaction session if supported by deployment
  let session = null;
  let useTransaction = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();
    useTransaction = true;
  } catch {
    // Standalone or non-replica deployments proceed with careful sequential persistence
    session = null;
    useTransaction = false;
  }

  try {
    const sessionOption = session ? { session } : {};


    // -------------------------------------------------------------
    // 2. Persist / Update Case Document
    // -------------------------------------------------------------
    let caseDoc = await Case.findOne({ caseId }, null, sessionOption);

    const newUploadRecord = {
      uploadId: `UPL-${Date.now()}`,
      type: intakeMetadata.csvRecords?.length ? "csv" : "text",
      recordCount: (intakeMetadata.textReports?.length || 0) + (intakeMetadata.csvRecords?.length || 0),
      uploadedAt: new Date(),
      metadata: {
        sourceCount: {
          text: intakeMetadata.textReports?.length || 0,
          csv: intakeMetadata.csvRecords?.length || 0,
        },
      },
    };

    if (!caseDoc) {
      const createdCases = await Case.create(
        [
          {
            caseId,
            status: "completed",
            sourceUploads: [newUploadRecord],
            metadata: {},
          },
        ],
        sessionOption
      );
      caseDoc = createdCases[0];
    } else {
      caseDoc.status = "completed";
      caseDoc.sourceUploads.push(newUploadRecord);
      await caseDoc.save(sessionOption);
    }

    // -------------------------------------------------------------
    // 3. Persist / Merge Entities (Identity: caseId, canonicalId)
    // -------------------------------------------------------------
    const entities = Array.isArray(fastApiResult.entities) ? fastApiResult.entities : [];
    const savedEntities = [];

    for (const rawEntity of entities) {
      const canonicalId = rawEntity.canonicalId?.trim();
      const type = rawEntity.type?.trim();

      if (!canonicalId || !type) {
        continue;
      }

      const newAliases = Array.isArray(rawEntity.aliases)
        ? rawEntity.aliases.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim())
        : [];
      const newAttributes =
        rawEntity.attributes && typeof rawEntity.attributes === "object" ? rawEntity.attributes : {};
      const newConfidence = typeof rawEntity.confidence === "number" ? rawEntity.confidence : 1.0;

      let existingEntity = await Entity.findOne({ canonicalId }, null, sessionOption);

      if (!existingEntity) {
        const created = await Entity.create(
          [
            {
              associatedCases: [caseId],
              canonicalId,
              type,
              aliases: newAliases,
              attributes: newAttributes,
              confidence: newConfidence,
            },
          ],
          sessionOption
        );
        savedEntities.push(created[0]);
      } else {
        // Deterministic Merge:
        existingEntity.associatedCases = Array.from(new Set([...(existingEntity.associatedCases || []), caseId]));
        
        // 1. Aliases: Merge array, remove duplicates, preserve existing
        const mergedAliases = Array.from(new Set([...existingEntity.aliases, ...newAliases]));
        existingEntity.aliases = mergedAliases;

        // 2. Attributes: Shallow/nested merge, preserve existing keys
        existingEntity.attributes = Object.assign({}, existingEntity.attributes || {}, newAttributes);
        existingEntity.markModified("attributes");

        // 3. Confidence: Deterministic rule -> Preserve maximum/strongest confidence
        existingEntity.confidence = Math.max(existingEntity.confidence || 0, newConfidence);

        await existingEntity.save(sessionOption);
        savedEntities.push(existingEntity);
      }
    }

    // -------------------------------------------------------------
    // 4. Persist / Accumulate Edges with Mandatory Evidence
    // -------------------------------------------------------------
    const rawRelationships = fastApiResult.relationships || fastApiResult.edges || [];
    const savedEdges = [];

    for (const rel of rawRelationships) {
      const source = (rel.source || rel.sourceEntityId)?.trim();
      const target = (rel.target || rel.targetEntityId)?.trim();
      const edgeType = rel.edgeType?.trim();

      if (!source || !target || !edgeType) {
        continue;
      }

      const confidence = typeof rel.confidence === "number" ? rel.confidence : 1.0;
      const timestamp = rel.timestamp ? new Date(rel.timestamp) : undefined;

      // Look up guardrail decision for THIS specific edge by its edgeId.
      // RelationshipModel.edgeId from FastAPI is the key that joins to GuardrailItem.edgeId.
      // NEVER use guardrail[0] as a global fallback — that incorrectly applies one guardrail
      // decision to all edges regardless of which edge it was computed for.
      const edgeGuardrail = rel.edgeId ? guardrailMap.get(rel.edgeId.trim()) : undefined;
      const guardrailStatus = edgeGuardrail?.status || undefined;
      const guardrailRationale = edgeGuardrail?.rationale || undefined;

      const incomingEvidence = Array.isArray(rel.evidence) ? rel.evidence : [];

      // Edge identity lookup query for deduplication globally
      const edgeQuery = { source, target, edgeType };
      let existingEdge = await Edge.findOne(edgeQuery, null, sessionOption);

      if (!existingEdge) {
        const created = await Edge.create(
          [
            {
              associatedCases: [caseId],
              source,
              target,
              edgeType,
              confidence,
              timestamp,
              guardrailStatus,
              guardrailRationale,
              evidence: incomingEvidence,
              attributes: rel.attributes || {},
            },
          ],
          sessionOption
        );
        savedEdges.push(created[0]);
      } else {
        existingEdge.associatedCases = Array.from(new Set([...(existingEdge.associatedCases || []), caseId]));
        
        // Deduplicate and accumulate new evidence items
        const existingEvidenceKeys = new Set(existingEdge.evidence.map(serializeEvidenceItem));

        const nonDuplicateIncoming = incomingEvidence.filter((item) => {
          const key = serializeEvidenceItem(item);
          return key && !existingEvidenceKeys.has(key);
        });

        if (nonDuplicateIncoming.length > 0) {
          existingEdge.evidence.push(...nonDuplicateIncoming);
        }

        // Update confidence to highest observed
        existingEdge.confidence = Math.max(existingEdge.confidence || 0, confidence);

        // Update guardrail info if present
        if (guardrailStatus) existingEdge.guardrailStatus = guardrailStatus;
        if (guardrailRationale) existingEdge.guardrailRationale = guardrailRationale;
        if (timestamp && !existingEdge.timestamp) existingEdge.timestamp = timestamp;

        await existingEdge.save(sessionOption);
        savedEdges.push(existingEdge);
      }
    }

    // -------------------------------------------------------------
    // 5. Persist / Deduplicate Patterns
    // -------------------------------------------------------------
    const rawPatterns = Array.isArray(fastApiResult.patterns) ? fastApiResult.patterns : [];
    const savedPatterns = [];

    for (const pat of rawPatterns) {
      const patternType = pat.patternType?.trim();
      if (!patternType) continue;

      const relatedEntityIds = Array.isArray(pat.relatedEntityIds) ? pat.relatedEntityIds : [];
      const relatedEdgeIds = Array.isArray(pat.relatedEdgeIds) ? pat.relatedEdgeIds : [];
      const confidence = typeof pat.confidence === "number" ? pat.confidence : 1.0;
      const description = pat.description?.trim() || "";
      const severity = pat.severity || "medium";
      const metadata = pat.metadata || {};

      let existingPattern = await Pattern.findOne({ caseId, patternType, description }, null, sessionOption);

      if (!existingPattern) {
        const created = await Pattern.create(
          [
            {
              caseId,
              patternType,
              relatedEntityIds,
              relatedEdgeIds,
              confidence,
              description,
              severity,
              metadata,
            },
          ],
          sessionOption
        );
        savedPatterns.push(created[0]);
      } else {
        existingPattern.relatedEntityIds = Array.from(
          new Set([...existingPattern.relatedEntityIds, ...relatedEntityIds])
        );
        existingPattern.relatedEdgeIds = Array.from(
          new Set([...existingPattern.relatedEdgeIds, ...relatedEdgeIds])
        );
        existingPattern.confidence = Math.max(existingPattern.confidence || 0, confidence);
        await existingPattern.save(sessionOption);
        savedPatterns.push(existingPattern);
      }
    }

    // Commit transaction if active
    if (useTransaction && session) {
      await session.commitTransaction();
    }

    return {
      caseId,
      status: caseDoc.status,
      summary: {
        entitiesCount: savedEntities.length,
        edgesCount: savedEdges.length,
        patternsCount: savedPatterns.length,
      },
      createdAt: caseDoc.createdAt,
      updatedAt: caseDoc.updatedAt,
    };
  } catch (error) {
    if (useTransaction && session) {
      try {
        await session.abortTransaction();
      } catch {
        // Ignore abort errors
      }
    }

    // Ensure Case status is marked 'failed' on persistence error
    try {
      await Case.updateOne({ caseId }, { $set: { status: "failed" } });
    } catch {
      // Ignore secondary update error
    }

    if (error instanceof PersistenceError) {
      throw error;
    }

    throw new PersistenceError(
      `Database persistence failed: ${error.message}`,
      500,
      "PERSISTENCE_DATABASE_ERROR",
      error.message
    );
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch {
        // Ignore session end error
      }
    }
  }
};

module.exports = {
  PersistenceError,
  persistCaseResults,
  validateFastApiResult,
};
