import type { SessionDefinition, ExecutionPrescription, SessionReferenceBinding } from '../sessions/models';
import type { PreparedSessionLaunch } from '../sessions/sessionLaunch';
import type { WorkoutPrescription } from '../workouts/models';
import { validateSessionDefinition } from '../sessions/validation';
import { adaptCatalogPrescriptionToSessionDefinition, createExecutionPrescriptionFromCatalog } from '../sessions/catalogSessionAdapter';
import { executionPrescriptionService } from './executionPrescriptionService';
import { sessionOccurrenceService } from './sessionOccurrenceService';
import { hashExecutionPrescription, hashSessionDefinition } from '../sessions/sessionDefinitionHash';
import { getLocalDateString } from '../utils/localDate';

/**
 * Creates the evidence records required before a manually-owned definition may execute.
 * It deliberately grants only `unplanned_log` authority; schedule/replacement/addition
 * require the M3 recommendation/replay work and cannot be approximated here.
 */
export async function prepareUnplannedSessionLaunch(
    userId: string,
    definition: SessionDefinition,
    now = new Date().toISOString(),
): Promise<PreparedSessionLaunch> {
    const validation = validateSessionDefinition(definition);
    if (!validation.ok) {
        throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    }

    const contentHash = await hashSessionDefinition(definition);
    const unsignedPrescription: ExecutionPrescription = {
        schemaVersion: 1,
        prescriptionHash: '',
        definitionHash: contentHash,
        blocks: definition.blocks,
        createdAt: now,
    };
    const prescriptionHash = await hashExecutionPrescription(unsignedPrescription);
    await executionPrescriptionService.savePrescription(userId, {
        ...unsignedPrescription,
        prescriptionHash,
    });

    const occurrenceId = `occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await sessionOccurrenceService.saveOccurrence({
        userId,
        occurrenceId,
        date: getLocalDateString(),
        authority: 'unplanned_log',
        state: 'active',
        definitionRef: {
            definitionId: definition.id,
            revision: definition.revision,
            contentHash,
        },
        createdAt: now,
        updatedAt: now,
    });

    return {
        definition,
        binding: {
            sessionSource: {
                kind: 'manual',
                definitionId: definition.id,
                revision: definition.revision,
                contentHash,
            },
            occurrenceId,
            prescriptionHash,
        },
    };
}

/**
 * Evidence for a catalog-sourced session (M3.1/M3.4). Starting today's already-recommended
 * catalog session carries no new selection authority (D-MAUTH): the recommendation already
 * made that decision, so this creates no `session_occurrences` record -- only the write-once
 * execution-prescription snapshot the runner and replay resolve against.
 *
 * Idempotent and safe to call every time a catalog recommendation is composed:
 * `executionPrescriptionService.savePrescription` no-ops when the same content-addressed
 * hash is already stored.
 */
export async function prepareCatalogSessionLaunch(
    userId: string,
    prescription: WorkoutPrescription,
): Promise<PreparedSessionLaunch> {
    const definition = adaptCatalogPrescriptionToSessionDefinition(prescription);
    const definitionHash = await hashSessionDefinition(definition);
    const executionPrescription = await createExecutionPrescriptionFromCatalog(prescription, definitionHash);
    await executionPrescriptionService.savePrescription(userId, executionPrescription);

    return {
        definition,
        binding: {
            sessionSource: {
                kind: 'catalog',
                workoutId: prescription.workoutId,
                catalogVersion: String(prescription.workoutVersion),
            },
            prescriptionHash: executionPrescription.prescriptionHash,
        },
    };
}

/**
 * Freezes the exact accepted form of an authority-bearing manual occurrence. The source
 * definition hash and the prescription hash intentionally differ: a readiness-scaled
 * prescription must be a new content-addressed snapshot while still naming the immutable
 * authored definition revision it came from (ADR-0023 D-MSNAP).
 */
export async function prepareAuthoredOccurrenceLaunch(
    userId: string,
    source: Extract<SessionReferenceBinding['sessionSource'], { kind: 'manual' }>,
    occurrenceId: string,
    acceptedDefinition: SessionDefinition,
    now = new Date().toISOString(),
): Promise<PreparedSessionLaunch> {
    const validation = validateSessionDefinition(acceptedDefinition);
    if (!validation.ok) {
        throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    }

    const unsignedPrescription: ExecutionPrescription = {
        schemaVersion: 1,
        prescriptionHash: '',
        definitionHash: source.contentHash,
        blocks: acceptedDefinition.blocks,
        createdAt: now,
    };
    const prescriptionHash = await hashExecutionPrescription(unsignedPrescription);
    await executionPrescriptionService.savePrescription(userId, {
        ...unsignedPrescription,
        prescriptionHash,
    });

    return {
        definition: acceptedDefinition,
        binding: {
            sessionSource: source,
            occurrenceId,
            prescriptionHash,
        },
    };
}
