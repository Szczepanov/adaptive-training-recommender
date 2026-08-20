import type { SessionSourceRef, SessionDefinition } from './models';
import type { DataState } from '../engine/dataState';
import { sessionDefinitionService } from '../services/sessionDefinitionService';
import { externalPlanService } from '../services/externalPlanService';
import { executionPrescriptionService } from '../services/executionPrescriptionService';
import { computeContentHash } from '../engine/externalPlanHash';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import type { WorkoutDefinition } from '../workouts/models';
import { adaptExternalPlanSessionToSessionDefinition } from './externalSessionAdapter';
import { isV2Session } from './externalPlanV2';
import { canonicalizeSessionData, hashSessionDefinition } from './sessionDefinitionHash';

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

async function applyStoredPrescription(
    userId: string,
    definition: SessionDefinition,
    prescriptionHash: string | undefined,
    expectedSource: SessionSourceRef,
    expectedDefinitionHash: string | null,
    documentPath: string,
    fallbackRevision: string | null,
): Promise<DataState<SessionDefinition>> {
    if (!prescriptionHash) {
        return { status: 'AVAILABLE', data: definition, revision: fallbackRevision };
    }
    const prescriptionState = await executionPrescriptionService.getPrescription(userId, prescriptionHash);
    if (prescriptionState.status !== 'AVAILABLE') return prescriptionState;
    if (JSON.stringify(canonicalizeSessionData(prescriptionState.data.sessionSource)) !== JSON.stringify(canonicalizeSessionData(expectedSource))) {
        return {
            status: 'INVALID',
            issues: [{ code: 'prescription-source-mismatch', field: 'sessionSource', documentPath }],
        };
    }
    if (expectedDefinitionHash !== null && prescriptionState.data.definitionHash !== expectedDefinitionHash) {
        return {
            status: 'INVALID',
            issues: [{ code: 'prescription-definition-hash-mismatch', field: 'definitionHash', documentPath }],
        };
    }
    return {
        status: 'AVAILABLE',
        data: { ...definition, blocks: prescriptionState.data.blocks },
        revision: prescriptionHash,
    };
}

export async function resolveSessionDefinition(
    userId: string,
    source: SessionSourceRef,
    /** M3.1: required to resolve a `catalog` source. The stored, evaluated
     * `ExecutionPrescription` -- not the live catalog template -- is the only source of
     * truth for what was actually prescribed; unlike `manual`/`external_plan`, a `catalog`
     * source ref alone (`workoutId`/`catalogVersion`) carries no dose/variant identity of
     * its own. When supplied for any other source kind, `applyStoredPrescription` still
     * validates and applies it (see the `unplanned_fixture`, `manual` and `external_plan`
     * branches below). */
    prescriptionHash?: string,
): Promise<DataState<SessionDefinition>> {
    if (source.kind === 'unplanned_fixture') {
        const fixture = FIXTURES_BY_ID.get(source.fixtureId);
        if (!fixture) {
            return {
                status: 'INVALID',
                issues: [{ code: 'fixture-not-found', documentPath: `fixtures/${source.fixtureId}` }],
            };
        }
        return applyStoredPrescription(
            userId, fixture, prescriptionHash, source, await hashSessionDefinition(fixture),
            `fixtures/${source.fixtureId}`, null,
        );
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
        return applyStoredPrescription(
            userId, definition.data, prescriptionHash, source, contentHash,
            `users/${userId}/session_definitions/${source.definitionId}/revisions/${source.revision}`,
            definition.revision,
        );
    }

    if (source.kind === 'catalog') {
        const workout = WORKOUTS_BY_ID.get(source.workoutId);
        if (!workout) {
            return {
                status: 'INVALID',
                issues: [{ code: 'catalog-workout-not-found', documentPath: `workouts/${source.workoutId}` }],
            };
        }
        if (!prescriptionHash) {
            // Fail closed rather than fall back to re-deriving from the live catalog: the
            // live template can have been edited since this decision was made, and a
            // silent re-derivation would resolve to different content than was executed.
            return {
                status: 'INVALID',
                issues: [{ code: 'catalog-prescription-hash-required', documentPath: `workouts/${source.workoutId}` }],
            };
        }
        const documentPath = `workouts/${source.workoutId}`;
        const prescriptionState = await executionPrescriptionService.getPrescription(userId, prescriptionHash);
        if (prescriptionState.status !== 'AVAILABLE') return prescriptionState;
        if (JSON.stringify(canonicalizeSessionData(prescriptionState.data.sessionSource)) !== JSON.stringify(canonicalizeSessionData(source))) {
            return {
                status: 'INVALID',
                issues: [{ code: 'prescription-source-mismatch', field: 'sessionSource', documentPath }],
            };
        }
        const liveDefinition = adaptWorkoutDefinitionToSessionDefinition(workout);
        const meta = prescriptionState.data.displayMetadata;
        if (!meta) {
            // Written before M3.2 added displayMetadata: no historical snapshot to verify
            // against. Fall back to the live-catalog version check -- this is the only
            // remaining signal that the live template hasn't drifted out from under this
            // prescription's evaluated blocks -- and fail closed on drift rather than
            // silently mixing a stale block set with a since-edited live template.
            if (String(workout.version) !== source.catalogVersion) {
                return {
                    status: 'INVALID',
                    issues: [{
                        code: 'catalog-version-mismatch',
                        field: 'catalogVersion',
                        documentPath,
                    }],
                };
            }
            return {
                status: 'AVAILABLE',
                data: { ...liveDefinition, blocks: prescriptionState.data.blocks },
                revision: prescriptionHash,
            };
        }
        // The historical definition is reconstructed entirely from the stored prescription
        // -- never merged with the live catalog -- so an edit to this workout's live entry
        // (title, duration, ...) after the day it was prescribed cannot silently rewrite
        // what this recommendation actually displayed. This makes the definition
        // self-verifying (via the hash check below), so it does not need the live catalog's
        // `version` to still match this prescription's historical `catalogVersion` -- unlike
        // the no-`meta` fallback above, replaying this snapshot never depends on the live
        // catalog being unedited since the day it was prescribed.
        const reconstructed: SessionDefinition = {
            ...liveDefinition,
            title: meta.title,
            summary: meta.summary,
            intent: meta.intent,
            dominantModality: meta.dominantModality,
            duration: meta.duration,
            blocks: prescriptionState.data.blocks,
        };
        if (await hashSessionDefinition(reconstructed) !== prescriptionState.data.definitionHash) {
            return {
                status: 'INVALID',
                issues: [{ code: 'prescription-definition-hash-mismatch', field: 'definitionHash', documentPath }],
            };
        }
        return { status: 'AVAILABLE', data: reconstructed, revision: prescriptionHash };
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
    // M3.6: a v2 session's content is already the canonical SessionDefinition -- no lossy
    // adapter needed, unlike v1's flat/free-text prescription. Identity (id/revision) is
    // still normalized to the wrapping session/plan, matching the v1 adapter's convention;
    // hashSessionDefinition doesn't cover either field, so this has no hash consequence.
    const definition = isV2Session(session)
        ? { ...session.definition, id: session.id, revision: source.revision }
        : adaptExternalPlanSessionToSessionDefinition(session, source.revision);
    return applyStoredPrescription(
        userId, definition, prescriptionHash, source, await hashSessionDefinition(definition),
        documentPath, source.contentHash,
    );
}
