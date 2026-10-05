import type { SessionDefinition, SessionDefinitionSnapshot, SessionSourceRef } from './models';

/**
 * Freezes exactly the executable SessionDefinition fields covered by definitionHash.
 * Identity/placement live in SessionSourceRef and are deliberately reconstructed from
 * that immutable source when the snapshot is replayed.
 */
export function snapshotSessionDefinition(definition: SessionDefinition): SessionDefinitionSnapshot {
    return {
        schemaVersion: definition.schemaVersion,
        title: definition.title,
        ...(definition.summary !== undefined ? { summary: definition.summary } : {}),
        intent: definition.intent,
        ...(definition.modalities !== undefined ? { modalities: definition.modalities } : {}),
        ...(definition.dominantModality !== undefined ? { dominantModality: definition.dominantModality } : {}),
        ...(definition.duration !== undefined ? { duration: definition.duration } : {}),
        ...(definition.sessionTargets !== undefined ? { sessionTargets: definition.sessionTargets } : {}),
        ...(definition.prohibitedAdditions !== undefined ? { prohibitedAdditions: definition.prohibitedAdditions } : {}),
        ...(definition.importWarnings !== undefined ? { importWarnings: definition.importWarnings } : {}),
        ...(definition.movementComposition !== undefined ? { movementComposition: definition.movementComposition } : {}),
        blocks: definition.blocks,
    };
}

function identityFor(source: SessionSourceRef): Pick<SessionDefinition, 'id' | 'revision'> {
    switch (source.kind) {
        case 'manual':
            return { id: source.definitionId, revision: source.revision };
        case 'external_plan':
            return { id: source.sessionId, revision: source.revision };
        case 'catalog':
            return { id: source.workoutId, revision: 1 };
        case 'unplanned_fixture':
            return { id: source.fixtureId, revision: 1 };
    }
}

/** Reconstructs executable bytes without consulting a mutable/live source. */
export function definitionFromSnapshot(
    snapshot: SessionDefinitionSnapshot,
    source: SessionSourceRef,
): SessionDefinition {
    return {
        ...identityFor(source),
        schemaVersion: snapshot.schemaVersion,
        title: snapshot.title,
        ...(snapshot.summary !== undefined ? { summary: snapshot.summary } : {}),
        intent: snapshot.intent,
        ...(snapshot.modalities !== undefined ? { modalities: snapshot.modalities } : {}),
        ...(snapshot.dominantModality !== undefined ? { dominantModality: snapshot.dominantModality } : {}),
        ...(snapshot.duration !== undefined ? { duration: snapshot.duration } : {}),
        ...(snapshot.sessionTargets !== undefined ? { sessionTargets: snapshot.sessionTargets } : {}),
        ...(snapshot.prohibitedAdditions !== undefined ? { prohibitedAdditions: snapshot.prohibitedAdditions } : {}),
        ...(snapshot.importWarnings !== undefined ? { importWarnings: snapshot.importWarnings } : {}),
        ...(snapshot.movementComposition !== undefined ? { movementComposition: snapshot.movementComposition } : {}),
        blocks: snapshot.blocks,
    };
}
