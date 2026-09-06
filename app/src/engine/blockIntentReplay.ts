/**
 * ADR-0037: Block Intent and Controlled Progression (H5a).
 *
 * D-REPLAY: canonical semantic replay projection and deterministic SHA-256 hashing.
 * Every behavior-affecting authored field in the Phase-1 contract is projected explicitly;
 * proven presentation-only fields are deliberately excluded and regression-tested.
 */

import type { TrainingIntentProfile, TrainingPriority } from './models';
import type {
    BlockObjectiveDefinition,
    BlockProgressionContract,
    BlockProtectedRole,
    BlockSubstitutionRule,
    IntentBlock,
} from './blockIntent';

export const TREATMENT_INTENT_REPLAY_SCHEMA_VERSION = 'treatment_intent_replay_v1' as const;

export interface PinnedTrainingIntentProfileSnapshot {
    priorities: readonly TrainingPriority[];
    weeklyCommitment: { minSessions: number; targetSessions: number; maxSessions: number };
    schemaVersion?: number;
}

function compareCodeUnits(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export interface SourcePlanIdentity {
    planId: string;
    schemaVersion: string;
    revision: number;
    sourceRef?: string;
}

export interface CanonicalReplayObjective {
    id: string;
    sport: string;
    adaptationScope: string;
    coverageKey: string;
    intent: 'develop' | 'maintain';
    priority: string;
    doseEnvelope: {
        min: number;
        target: number;
        max: number;
        unit: string;
        floorSemantics: 'hard_floor' | 'soft_floor';
    };
    knowledgeLineage: readonly string[];
    protectedRoles?: readonly (
        | { kind: 'coverage_role'; coverageKey: string }
        | { kind: 'session'; sessionId: string }
    )[];
    allowedSubstitutions?: readonly {
        targetCoverageKey: string;
        allowedCoverageKeys: readonly string[];
        minDoseFraction?: number;
    }[];
    successCriteria: {
        evaluationRef?: { id: string; revision: number; metricId: string };
        minCompletedExposures?: number;
        targetTrend?: 'stable' | 'improving';
        acceptableDeclineTolerancePct?: number;
    };
    entryPrerequisites?: {
        requiredPriorExposures?: number;
        minBaselineDays?: number;
        prohibitedTissueSeverities?: readonly string[];
    };
    exitCriteria?: { maxWeeksInBlock?: number; stagnationReviewAfterWeeks?: number };
}

export interface CanonicalReplayProgressionContract {
    targetBinding: { objectiveId: string; sessionId?: string; stepId?: string };
    variable: string;
    unit: string;
    currentValue: number;
    permittedRange: { min: number; max: number };
    increment: number;
    knowledgeLineage: readonly string[];
    observationWindowDays: number;
    minCompletedExposures: number;
    requiredFollowUpCoveragePct: number;
    reviewCadenceDays: number;
    reductionAlternative?: { decrement: number; trigger: string };
    redirectCriteria?: { triggers: readonly string[] };
}

export interface TreatmentIntentReplayPayloadV1 {
    schemaVersion: typeof TREATMENT_INTENT_REPLAY_SCHEMA_VERSION;
    sourcePlanIdentity: SourcePlanIdentity;
    trainingIntentProfile: PinnedTrainingIntentProfileSnapshot;
    block: {
        id: string;
        revision: number;
        dateRange: { startDate: string; endDate: string };
        objectives: readonly CanonicalReplayObjective[];
        reviewSchedule: { reviewCadenceDays: number; nextReviewDate: string };
        progressionContract?: CanonicalReplayProgressionContract;
    };
}

function canonicalizeStringSet(values?: readonly string[]): readonly string[] | undefined {
    if (!values || values.length === 0) return undefined;
    return [...values].sort(compareCodeUnits);
}

function canonicalizeProtectedRoles(roles?: readonly BlockProtectedRole[]): CanonicalReplayObjective['protectedRoles'] {
    if (!roles || roles.length === 0) return undefined;
    return [...roles]
        .map(role => role.kind === 'coverage_role'
            ? { kind: 'coverage_role' as const, coverageKey: role.coverageKey }
            : { kind: 'session' as const, sessionId: role.sessionId })
        .sort((a, b) => {
            const aKey = a.kind === 'coverage_role' ? `${a.kind}:${a.coverageKey}` : `${a.kind}:${a.sessionId}`;
            const bKey = b.kind === 'coverage_role' ? `${b.kind}:${b.coverageKey}` : `${b.kind}:${b.sessionId}`;
            return compareCodeUnits(aKey, bKey);
        });
}

/** Human-facing substitution rationale is intentionally excluded from semantic identity. */
function canonicalizeSubstitutions(substitutions?: readonly BlockSubstitutionRule[]): CanonicalReplayObjective['allowedSubstitutions'] {
    if (!substitutions || substitutions.length === 0) return undefined;
    return [...substitutions]
        .map(sub => ({
            targetCoverageKey: sub.targetCoverageKey,
            allowedCoverageKeys: [...sub.allowedCoverageKeys].sort(compareCodeUnits),
            minDoseFraction: sub.minDoseFraction,
        }))
        .sort((a, b) => {
            const targetOrder = compareCodeUnits(a.targetCoverageKey, b.targetCoverageKey);
            if (targetOrder !== 0) return targetOrder;
            return compareCodeUnits(a.allowedCoverageKeys.join('\u0000'), b.allowedCoverageKeys.join('\u0000'));
        });
}

function canonicalizeSuccessCriteria(objective: BlockObjectiveDefinition): CanonicalReplayObjective['successCriteria'] {
    const criteria = objective.successCriteria;
    return {
        evaluationRef: criteria.evaluationRef ? {
            id: criteria.evaluationRef.id,
            revision: criteria.evaluationRef.revision,
            metricId: criteria.evaluationRef.metricId,
        } : undefined,
        minCompletedExposures: criteria.minCompletedExposures,
        targetTrend: criteria.targetTrend,
        acceptableDeclineTolerancePct: criteria.acceptableDeclineTolerancePct,
    };
}

function canonicalizeObjective(obj: BlockObjectiveDefinition): CanonicalReplayObjective {
    const entryPrerequisites = obj.entryPrerequisites ? {
        requiredPriorExposures: obj.entryPrerequisites.requiredPriorExposures,
        minBaselineDays: obj.entryPrerequisites.minBaselineDays,
        prohibitedTissueSeverities: canonicalizeStringSet(obj.entryPrerequisites.prohibitedTissueSeverities),
    } : undefined;
    const exitCriteria = obj.exitCriteria ? {
        maxWeeksInBlock: obj.exitCriteria.maxWeeksInBlock,
        stagnationReviewAfterWeeks: obj.exitCriteria.stagnationReviewAfterWeeks,
    } : undefined;

    return {
        id: obj.id,
        sport: obj.sport,
        adaptationScope: obj.adaptationScope,
        coverageKey: obj.coverageKey,
        intent: obj.intent,
        priority: obj.priority,
        doseEnvelope: {
            min: obj.doseEnvelope.min,
            target: obj.doseEnvelope.target,
            max: obj.doseEnvelope.max,
            unit: obj.doseEnvelope.unit,
            floorSemantics: obj.doseEnvelope.floorSemantics,
        },
        knowledgeLineage: [...obj.knowledgeLineage].sort(compareCodeUnits),
        protectedRoles: canonicalizeProtectedRoles(obj.protectedRoles),
        allowedSubstitutions: canonicalizeSubstitutions(obj.allowedSubstitutions),
        successCriteria: canonicalizeSuccessCriteria(obj),
        entryPrerequisites: entryPrerequisites && Object.values(entryPrerequisites).some(value => value !== undefined) ? entryPrerequisites : undefined,
        exitCriteria: exitCriteria && Object.values(exitCriteria).some(value => value !== undefined) ? exitCriteria : undefined,
    };
}

function canonicalizeProgressionContract(contract?: BlockProgressionContract): CanonicalReplayProgressionContract | undefined {
    if (!contract) return undefined;
    return {
        targetBinding: {
            objectiveId: contract.targetBinding.objectiveId,
            sessionId: contract.targetBinding.sessionId,
            stepId: contract.targetBinding.stepId,
        },
        variable: contract.variable,
        unit: contract.unit,
        currentValue: contract.currentValue,
        permittedRange: { min: contract.permittedRange.min, max: contract.permittedRange.max },
        increment: contract.increment,
        knowledgeLineage: [...contract.knowledgeLineage].sort(compareCodeUnits),
        observationWindowDays: contract.observationWindowDays,
        minCompletedExposures: contract.minCompletedExposures,
        requiredFollowUpCoveragePct: contract.requiredFollowUpCoveragePct,
        reviewCadenceDays: contract.reviewCadenceDays,
        reductionAlternative: contract.reductionAlternative ? {
            decrement: contract.reductionAlternative.decrement,
            trigger: contract.reductionAlternative.trigger,
        } : undefined,
        redirectCriteria: contract.redirectCriteria ? {
            triggers: canonicalizeStringSet(contract.redirectCriteria.triggers) ?? [],
        } : undefined,
    };
}

/**
 * Builds the versioned semantic projection. `title`, `notes`, and substitution `rationale`
 * are display-only and therefore excluded. Objective/set ordering is canonicalized where
 * order has no behavior, while `TrainingIntentProfile.priorities` order is preserved because
 * profile priority order may be authored preference precedence in allocation.
 */
export function buildTreatmentIntentReplayPayloadV1(
    block: IntentBlock,
    profile: Pick<TrainingIntentProfile, 'priorities' | 'weeklyCommitment'> & { schemaVersion?: number },
    sourceSchemaVersion: string,
    sourceRef?: string,
): TreatmentIntentReplayPayloadV1 {
    const sortedObjectives = [...block.objectives].sort((a, b) => compareCodeUnits(a.id, b.id)).map(canonicalizeObjective);
    return {
        schemaVersion: TREATMENT_INTENT_REPLAY_SCHEMA_VERSION,
        sourcePlanIdentity: {
            planId: block.sourcePlanId,
            schemaVersion: sourceSchemaVersion,
            revision: block.sourcePlanRevision,
            sourceRef,
        },
        trainingIntentProfile: {
            priorities: [...profile.priorities],
            weeklyCommitment: {
                minSessions: profile.weeklyCommitment.minSessions,
                targetSessions: profile.weeklyCommitment.targetSessions,
                maxSessions: profile.weeklyCommitment.maxSessions,
            },
            schemaVersion: profile.schemaVersion,
        },
        block: {
            id: block.id,
            revision: block.revision,
            dateRange: { startDate: block.dateRange.startDate, endDate: block.dateRange.endDate },
            objectives: sortedObjectives,
            reviewSchedule: {
                reviewCadenceDays: block.reviewSchedule.reviewCadenceDays,
                nextReviewDate: block.reviewSchedule.nextReviewDate,
            },
            progressionContract: canonicalizeProgressionContract(block.progressionContract),
        },
    };
}

/**
 * Deterministically sorts object keys recursively and omits undefined object members.
 * Non-finite numbers are rejected rather than silently serialized as `null`, which would
 * create an ambiguous cryptographic identity for invalid semantic inputs.
 */
export function canonicalizeReplayJson(value: unknown): unknown {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Replay payload contains a non-finite number');
    if (Array.isArray(value)) {
        if (value.some(item => item === undefined)) throw new Error('Replay payload arrays cannot contain undefined members');
        return value.map(canonicalizeReplayJson);
    }
    if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(obj).sort(compareCodeUnits).filter(key => obj[key] !== undefined).map(key => [key, canonicalizeReplayJson(obj[key])]));
    }
    return value;
}

export function canonicalizeTreatmentIntentJson(payload: TreatmentIntentReplayPayloadV1): string {
    return JSON.stringify(canonicalizeReplayJson(payload));
}

export async function hashTreatmentIntentReplayPayload(payload: TreatmentIntentReplayPayloadV1): Promise<string> {
    const canonicalJson = canonicalizeTreatmentIntentJson(payload);
    const bytes = new TextEncoder().encode(canonicalJson);
    const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digestBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyTreatmentIntentReplayDigest(payload: TreatmentIntentReplayPayloadV1, expectedDigest: string): Promise<boolean> {
    return (await hashTreatmentIntentReplayPayload(payload)) === expectedDigest;
}
