import { useMemo } from 'react';

/**
 * Builds a lookup map from an array of entities to easily resolve
 * raw canonical IDs (UUIDs) into human-readable aliases.
 *
 * @param {Array} entities - Array of entity objects containing canonicalId and aliases
 * @returns {Function} getEntityName(id) -> string
 */
export function useEntityLookup(entities) {
  const lookup = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(entities)) return map;

    for (const entity of entities) {
      if (entity?.canonicalId) {
        map.set(entity.canonicalId, entity);
      }
    }
    return map;
  }, [entities]);

  const getEntityName = (id) => {
    if (!id) return 'Unknown Entity';
    const entity = lookup.get(id);
    if (!entity) return 'Unknown Entity';
    if (Array.isArray(entity.aliases) && entity.aliases.length > 0 && entity.aliases[0]) {
      return entity.aliases[0];
    }
    return id; // fallback to ID if no aliases
  };

  const getEntity = (id) => lookup.get(id);

  return { getEntityName, getEntity };
}
