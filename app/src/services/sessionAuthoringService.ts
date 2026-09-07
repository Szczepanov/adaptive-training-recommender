import { isExternalPlanOccurrence, type SessionDefinition, type ExecutionPrescription, type SessionReferenceBinding } from '../sessions/models';
import type { PreparedSessionLaunch } from '../sessions/sessionLaunch';
import type { WorkoutPrescription } from '../workouts/models';
import type { ExternalPlanSessionV4 } from '../sessions/externalPlanV4';
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
        sessionSource: {
            kind: 'manual',
            definitionId: definition.id,
            revision: definition.revision,
            contentHash,
        },
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
        sessionSource: source,
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

export interface PrepareExternalPlanSessionLaunchOptions {
    summaryOverride?: string;
    now?: string;
    date?: string;
    occurrenceId?: string;
    placementOrder?: number;
}

/**
 * Freezes the execution-prescription snapshot for a v4 external-plan session (ADR-0036
 * H4). A supplied date creates/resolves an external-plan occurrence idempotently. A
 * supplied occurrenceId is read back and verified against the exact external source (and
 * date when supplied) before it can be attached to the launch binding. Target-event
 * sessions are deliberately rejected: rules.ts treats them as fixed-activity/advisory
 * inputs rather than executable primary recommendations.
 *
 * Idempotent and safe to call every time an executable external-plan recommendation is
 * composed: `executionPrescriptionService.savePrescription` no-ops when the same
 * content-addressed hash is already stored.
 */
export async function prepareExternalPlanSessionLaunch(
    userId: string,
    externalPlan: {
        planId: string;
        revision: number;
        contentHash: string;
        session: ExternalPlanSessionV4;
    },
    summaryOverrideOrOptions?: string | PrepareExternalPlanSessionLaunchOptions,
    nowFallback = new Date().toISOString(),
): Promise<PreparedSessionLaunch> {
    if (externalPlan.session.isEvent) {
        throw new Error('External-plan target events are advisory fixed-activity inputs and cannot be launched as primary sessions.');
    }

    const options: PrepareExternalPlanSessionLaunchOptions =
        typeof summaryOverrideOrOptions === 'object' && summaryOverrideOrOptions !== null
            ? summaryOverrideOrOptions
            : {
                summaryOverride: summaryOverrideOrOptions,
                now: nowFallback,
            };

    const now = options.now ?? nowFallback;

    const definition = externalPlan.session.definition;
    // Defense in depth: already validated at import time (validateExternalSessionV2,
    // reused unchanged by v4), but every other launch path re-validates too.
    const validation = validateSessionDefinition(definition);
    if (!validation.ok) {
        throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    }

    const definitionHash = await hashSessionDefinition(definition);
    const sessionSource: Extract<SessionReferenceBinding['sessionSource'], { kind: 'external_plan' }> = {
        kind: 'external_plan',
        planId: externalPlan.planId,
        revision: externalPlan.revision,
        sessionId: externalPlan.session.id,
        contentHash: externalPlan.contentHash,
    };

    let effectiveOccurrenceId = options.occurrenceId;
    if (effectiveOccurrenceId) {
        const occurrence = await sessionOccurrenceService.getOccurrence(userId, effectiveOccurrenceId);
        if (occurrence.status !== 'AVAILABLE') {
            throw new Error(`External-plan occurrence ${effectiveOccurrenceId} is not available (${occurrence.status}).`);
        }
        const occurrenceData = occurrence.data;
        if (
            !isExternalPlanOccurrence(occurrenceData)
            || occurrenceData.state !== 'scheduled'
            || occurrenceData.userId !== userId
            || occurrenceData.externalPlanRef.planId !== sessionSource.planId
            || occurrenceData.externalPlanRef.revision !== sessionSource.revision
            || occurrenceData.externalPlanRef.sessionId !== sessionSource.sessionId
            || occurrenceData.externalPlanRef.contentHash !== sessionSource.contentHash
        ) {
            throw new Error(`External-plan occurrence ${effectiveOccurrenceId} does not match the launch source.`);
        }
        if (options.date !== undefined && occurrenceData.date !== options.date) {
            throw new Error(
                `External-plan occurrence ${effectiveOccurrenceId} is for ${occurrenceData.date}, expected ${options.date}.`,
            );
        }
    } else if (options.date) {
        const occurrence = await sessionOccurrenceService.getOrCreateExternalPlanOccurrence(
            userId,
            options.date,
            {
                planId: externalPlan.planId,
                revision: externalPlan.revision,
                sessionId: externalPlan.session.id,
                contentHash: externalPlan.contentHash,
            },
            options.placementOrder,
            now,
        );
        effectiveOccurrenceId = occurrence.occurrenceId;
    }

    const effectiveSummary = options.summaryOverride ?? definition.summary;
    const unsignedPrescription: ExecutionPrescription = {
        schemaVersion: 1,
        prescriptionHash: '',
        sessionSource,
        definitionHash,
        blocks: definition.blocks,
        displayMetadata: {
            title: definition.title,
            ...(effectiveSummary !== undefined ? { summary: effectiveSummary } : {}),
            intent: definition.intent,
            ...(definition.dominantModality !== undefined ? { dominantModality: definition.dominantModality } : {}),
            ...(definition.duration !== undefined ? { duration: definition.duration } : {}),
        },
        createdAt: now,
    };

    // Note: hashExecutionPrescription delegates to canonicalExecutionPrescriptionJson,
    // which explicitly omits createdAt (ADR-0023 D-MSNAP) so that identical sessions produce
    // identical content-addressed hashes regardless of invocation timestamp.
    const prescriptionHash = await hashExecutionPrescription(unsignedPrescription);
    await executionPrescriptionService.savePrescription(userId, {
        ...unsignedPrescription,
        prescriptionHash,
    });

    return {
        definition,
        binding: {
            sessionSource,
            ...(effectiveOccurrenceId ? { occurrenceId: effectiveOccurrenceId } : {}),
            prescriptionHash,
        },
    };
}
