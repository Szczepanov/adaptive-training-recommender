import { isExternalPlanOccurrence, type SessionDefinition, type ExecutionPrescription, type SessionReferenceBinding, type OccurrenceWindowBinding } from '../sessions/models';
import type { PreparedSessionLaunch } from '../sessions/sessionLaunch';
import type { WorkoutPrescription } from '../workouts/models';
import type { ExternalPlanSessionV2 } from '../sessions/externalPlanV2';
import type { ExternalPlanSessionV4 } from '../sessions/externalPlanV4';
import type { ExternalPlanSessionV6 } from '../sessions/externalPlanV6';
import { validateSessionDefinition } from '../sessions/validation';
import { adaptCatalogPrescriptionToSessionDefinition, createExecutionPrescriptionFromCatalog } from '../sessions/catalogSessionAdapter';
import { executionPrescriptionService } from './executionPrescriptionService';
import { sessionOccurrenceService } from './sessionOccurrenceService';
import { hashExecutionPrescription, hashSessionDefinition } from '../sessions/sessionDefinitionHash';
import { getLocalDateString } from '../utils/localDate';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { exportWorkoutPrescriptionToJson } from '../utils/workoutJsonExport';
import { computeWorkoutTemplateFingerprint } from '../training-occurrence/fitWorkoutIdentity';

function displayMetadataFor(definition: SessionDefinition): NonNullable<ExecutionPrescription['displayMetadata']> {
    return {
        title: definition.title,
        ...(definition.summary !== undefined ? { summary: definition.summary } : {}),
        intent: definition.intent,
        ...(definition.dominantModality !== undefined ? { dominantModality: definition.dominantModality } : {}),
        ...(definition.duration !== undefined ? { duration: definition.duration } : {}),
    };
}

function maxNumericRange(value: number | { min: number; max: number }): number {
    return typeof value === 'number' ? value : value.max;
}

function explicitDurationSeconds(definition: SessionDefinition): number {
    return definition.blocks.reduce((total, block) => total + block.steps.reduce((blockTotal, step) => {
        const sets = step.dose && 'sets' in step.dose ? step.dose.sets ?? 1 : 1;
        const sideMultiplier = step.laterality === 'per_side' ? 2 : 1;
        const doseSeconds = step.dose?.kind === 'duration' ? maxNumericRange(step.dose.seconds) * sets * sideMultiplier : 0;
        const restSeconds = step.rest === undefined ? 0 : maxNumericRange(step.rest) * sets * sideMultiplier;
        const alternativeSeconds = (step.alternatives ?? []).reduce((sum, alternative) => {
            const alternativeSets = alternative.dose && 'sets' in alternative.dose ? alternative.dose.sets ?? 1 : 1;
            return sum + (alternative.dose?.kind === 'duration'
                ? maxNumericRange(alternative.dose.seconds) * alternativeSets * sideMultiplier
                : 0);
        }, 0);
        return blockTotal + doseSeconds + restSeconds + alternativeSeconds;
    }, 0) * (block.rounds === undefined ? 1 : maxNumericRange(block.rounds)), 0);
}

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
        displayMetadata: displayMetadataFor(definition),
        createdAt: now,
    };
    const prescriptionHash = await hashExecutionPrescription(unsignedPrescription);
    await executionPrescriptionService.savePrescription(userId, {
        ...unsignedPrescription,
        prescriptionHash,
    });

    const occurrenceId = `occ-${Date.now()}-${crypto.randomUUID()}`;
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

async function computeCatalogFitIdentity(prescription: WorkoutPrescription) {
    const workout = WORKOUTS_BY_ID.get(prescription.workoutId);
    if (!workout) return null;

    try {
        // This is intentionally the same canonical payload shape that WorkoutExportMenu
        // queues for Garmin. Never derive a hard-match fingerprint later from the
        // SessionDefinition: catalogSessionAdapter is an execution adapter and may omit
        // display-only targets such as cycling power/FTP guidance.
        const canonicalExport = exportWorkoutPrescriptionToJson(prescription, workout.modality);
        return await computeWorkoutTemplateFingerprint(canonicalExport);
    } catch {
        // Identity is optional evidence. If the exact Garmin canonicalization context is
        // unavailable (for example unresolved %FTP), omit it rather than manufacture a
        // semantic fingerprint that could become a hard false-negative.
        return null;
    }
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
    const fitIdentity = await computeCatalogFitIdentity(prescription);

    return {
        definition,
        binding: {
            sessionSource: {
                kind: 'catalog',
                workoutId: prescription.workoutId,
                catalogVersion: String(prescription.workoutVersion),
            },
            prescriptionHash: executionPrescription.prescriptionHash,
            ...(fitIdentity
                ? {
                    fitWorkoutFingerprint: fitIdentity.fingerprint,
                    fitWorkoutFingerprintKind: fitIdentity.kind,
                }
                : {}),
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
        displayMetadata: displayMetadataFor(acceptedDefinition),
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

/**
 * Provenance for a scaled launch's duration ceiling (PR-B, #893 WP3.2): the approved gate
 * duration is always the session's own `gating.durationMin` scaled by the adjudicated
 * execution-volume fraction. The execution boundary owns this derivation so callers cannot
 * inflate a precomputed minute ceiling.
 */
export function resolveScaledLaunchCeilingMinutes(gatingDurationMin: number, doseVolume: number): number {
    if (!Number.isFinite(gatingDurationMin) || gatingDurationMin <= 0) {
        throw new Error('A scaled external-plan launch requires a positive finite gating duration.');
    }
    if (!Number.isFinite(doseVolume) || doseVolume <= 0 || doseVolume > 1) {
        throw new Error('A scaled external-plan launch requires an approved execution volume in (0, 1].');
    }
    return gatingDurationMin * doseVolume;
}

export interface PrepareExternalPlanSessionLaunchOptions {
    summaryOverride?: string;
    now?: string;
    date?: string;
    occurrenceId?: string;
    placementOrder?: number;
    /** H4 (#434) PR 3: the D-PLACEMENT-resolved window this member sits in. Only meaningful
     * alongside `date` (occurrence creation); ignored when `occurrenceId` is supplied
     * directly, since an existing occurrence's `windowBinding` is already immutable. */
    windowBinding?: OccurrenceWindowBinding;
    /** Scale only from the exact reducedDefinition carried by v6. */
    useReducedDefinition?: boolean;
    /** Adjudicated execution-volume fraction for today's exact scale verdict. */
    scaleVolume?: number;
}

/**
 * Freezes the execution-prescription snapshot for a structured external-plan session (ADR-0036
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
        session: ExternalPlanSessionV2 | ExternalPlanSessionV4 | ExternalPlanSessionV6;
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

    const reducedDefinition = externalPlan.session.scaling && 'reducedDefinition' in externalPlan.session.scaling
        ? externalPlan.session.scaling.reducedDefinition
        : undefined;
    if (options.useReducedDefinition && !reducedDefinition) {
        throw new Error('A scaled external-plan session requires an exact structured reducedDefinition.');
    }
    // Execution-boundary mirror of `externalPlanV6.ts`'s import contract (PR-B, #893 WP3.2):
    // a scaled launch is only ever the coach's own reduced form. Import validation already
    // rejects a `reducedDefinition` without `reducible: true` and one that renames the
    // authored identity, but the authoring layer accepts hand-built sessions, so it
    // re-enforces both rules here -- before any dose check -- and fails closed.
    if (options.useReducedDefinition && externalPlan.session.scaling?.reducible !== true) {
        throw new Error('A scaled external-plan launch requires reducible: true with an exact structured reducedDefinition.');
    }
    if (options.useReducedDefinition && reducedDefinition) {
        const fullDefinition = externalPlan.session.definition;
        if (reducedDefinition.id !== fullDefinition.id) {
            throw new Error('Reduced definition must retain the authored session definition id.');
        }
        if (reducedDefinition.intent !== fullDefinition.intent) {
            throw new Error('Reduced definition must retain the authored session intent.');
        }
        if (reducedDefinition.dominantModality !== fullDefinition.dominantModality) {
            throw new Error('Reduced definition must retain the authored dominant modality.');
        }
    }
    const maxDurationMinutes = options.useReducedDefinition
        ? resolveScaledLaunchCeilingMinutes(externalPlan.session.gating.durationMin, options.scaleVolume ?? Number.NaN)
        : undefined;
    const definition = options.useReducedDefinition ? reducedDefinition! : externalPlan.session.definition;
    if (options.useReducedDefinition && maxDurationMinutes !== undefined
        && (!definition.duration
            || definition.duration.max > maxDurationMinutes
            || explicitDurationSeconds(definition) > maxDurationMinutes * 60)) {
        throw new Error('The exact reduced definition exceeds today\'s approved duration ceiling.');
    }
    // Defense in depth: revalidate the exact executable definition, including v6's scaled form.
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
            {
                placementOrder: options.placementOrder,
                windowBinding: options.windowBinding,
                now,
            },
        );
        if (occurrence.state !== 'scheduled') {
            throw new Error(`External-plan occurrence ${occurrence.occurrenceId} does not match the launch source.`);
        }
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
