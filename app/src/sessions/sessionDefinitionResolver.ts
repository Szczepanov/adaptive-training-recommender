import type { SessionSourceRef, SessionDefinition } from './models';
import type { DataState } from '../engine/dataState';
import { sessionDefinitionService } from '../services/sessionDefinitionService';
import { externalPlanService } from '../services/externalPlanService';
import { computeContentHash } from '../engine/externalPlanHash';
import { WORKOUTS } from '../workouts/catalog';
import type { WorkoutDefinition } from '../workouts/models';
import { adaptExternalPlanSessionToSessionDefinition } from './externalSessionAdapter';
import { hashSessionDefinition } from './sessionDefinitionHash';

// Fixture imports
import fixture01 from './fixtures/01-full-body-maintenance.json';
import fixture02 from './fixtures/02-lower-olympic-variants.json';
import fixture03 from './fixtures/03-upper-body-absorption-and-spin.json';
import fixture04 from './fixtures/04-friday-field-drills.json';
import fixture05 from './fixtures/05-timed-trunk-and-tissue.json';
import fixture06 from './fixtures/06-protocol-locked-sprint-jump-test.json';
import fixture08 from './fixtures/08-recovery-spin-companion.json';

const FIXTURES_BY_ID = new Map<string, SessionDefinition>([
    [fixture01.id, fixture01 as unknown as SessionDefinition],
    [fixture02.id, fixture02 as unknown as SessionDefinition],
    [fixture03.id, fixture03 as unknown as SessionDefinition],
    [fixture04.id, fixture04 as unknown as SessionDefinition],
    [fixture05.id, fixture05 as unknown as SessionDefinition],
    [fixture06.id, fixture06 as unknown as SessionDefinition],
    [fixture08.id, fixture08 as unknown as SessionDefinition],
]);

function adaptWorkoutDefinitionToSessionDefinition(workout: WorkoutDefinition): SessionDefinition {
    return {
        schemaVersion: 1,
        id: workout.id,
        revision: 1,
        title: workout.name,
        summary: workout.description,
        intent: workout.modality === 'recovery' || workout.modality === 'mobility' ? 'recovery' : 'training',
        dominantModality: workout.modality,
        duration: {
            min: workout.duration.minimumMin,
            max: workout.duration.maximumMin,
        },
        blocks: workout.blocks.map(b => ({
            id: b.id,
            title: b.name,
            role: b.role === 'warmup' ? 'warmup' : b.role === 'cooldown' ? 'cooldown' : b.role === 'accessory' ? 'accessory' : 'main',
            executionMode: 'sequential',
            steps: b.steps.map(s => ({
                id: s.id,
                kind: 'exercise',
                title: s.name,
                exerciseRef: { kind: 'catalog', exerciseId: s.exerciseId ?? s.id },
                notes: s.notes && s.notes.length > 0 ? s.notes.join('; ') : undefined,
            })),
        })),
    };
}

export async function resolveSessionDefinition(
    userId: string,
    source: SessionSourceRef,
): Promise<DataState<SessionDefinition>> {
    if (source.kind === 'unplanned_fixture') {
        const fixture = FIXTURES_BY_ID.get(source.fixtureId);
        if (!fixture) {
            return {
                status: 'INVALID',
                issues: [{ code: 'fixture-not-found', documentPath: `fixtures/${source.fixtureId}` }],
            };
        }
        return {
            status: 'AVAILABLE',
            data: fixture,
            revision: null,
        };
    }

    if (source.kind === 'manual') {
        const definition = await sessionDefinitionService.getDefinitionRevision(userId, source.definitionId, source.revision);
        if (definition.status !== 'AVAILABLE') return definition;
        const contentHash = await hashSessionDefinition(definition.data);
        if (contentHash !== source.contentHash) {
            return {
                status: 'INVALID',
                issues: [{
                    code: 'definition-hash-mismatch',
                    field: 'contentHash',
                    documentPath: `users/${userId}/session_definitions/${source.definitionId}/revisions/${source.revision}`,
                }],
            };
        }
        return definition;
    }

    if (source.kind === 'catalog') {
        const workout = WORKOUTS.find(w => w.id === source.workoutId);
        if (workout) {
            return {
                status: 'AVAILABLE',
                data: adaptWorkoutDefinitionToSessionDefinition(workout),
                revision: null,
            };
        }
        return {
            status: 'INVALID',
            issues: [{ code: 'catalog-workout-not-found', documentPath: `workouts/${source.workoutId}` }],
        };
    }

    const revision = await externalPlanService.getRevisionState(userId, source.planId, source.revision);
    if (revision.status === 'MISSING') return { status: 'MISSING' };
    if (revision.status === 'INVALID') return { status: 'INVALID', issues: revision.issues };
    if (revision.status === 'UNAVAILABLE') {
        return {
            status: 'UNAVAILABLE', operation: revision.operation, retryable: revision.retryable,
            ...(revision.message ? { message: revision.message } : {}),
        };
    }
    const contentHash = await computeContentHash(revision.data);
    const documentPath = `users/${userId}/external_plans/${source.planId}/revisions/${source.revision}`;
    if (contentHash !== source.contentHash) {
        return {
            status: 'INVALID',
            issues: [{ code: 'external-plan-hash-mismatch', field: 'contentHash', documentPath }],
        };
    }
    const session = revision.data.sessions.find(item => item.id === source.sessionId);
    if (!session) {
        return {
            status: 'INVALID',
            issues: [{ code: 'external-session-not-found', field: 'sessionId', documentPath }],
        };
    }
    return {
        status: 'AVAILABLE',
        data: adaptExternalPlanSessionToSessionDefinition(session, source.revision),
        revision: source.contentHash,
    };
}
