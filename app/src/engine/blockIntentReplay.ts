/**
 * ADR-0037: Block Intent and Controlled Progression (H5a).
 *
 * D-REPLAY: Canonical semantic replay projection and deterministic SHA-256 hashing.
 * Exhaustively projects every behavior-affecting field, pins a canonical snapshot of
 * the TrainingIntentProfile (priorities and weeklyCommitment), and excludes display-only fields.
 */

import type { TrainingIntentProfile, TrainingPriority } from './models';
import type {
    BlockObjectiveDefinition,
    BlockProgressionContract,
    BlockSubstitutionRule,
    IntentBlock,
} from './blockIntent';

export const TREATMENT_INTENT_REPLAY_SCHEMA_VERSION = 'treatment_intent_replay_v1' as const;

export interface PinnedTrainingIntentProfileSnapshot {
    priorities: readonly TrainingPriority[];
    weeklyCommitment: {
        minSessions: number;
        targetSessions: number;
        maxSessions: number;
    };
    schemaVersion?: number;
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
    knowledgeLineage?: readonly string[];
    protectedRoles?: readonly string[];
    allowedSubstitutions?: readonly {
        targetCoverageKey: string;
        allowedCoverageKeys: readonly string[];
        minDoseFraction?: number;
        rationale?: string;
    }[];
    successCriteria?: {
        evaluationRef?: {
            id: string;
            revision: number;
            metricId: string;
        };
        minCompletedExposures?: number;
        targetTrend?: 'stable' | 'improving';
        acceptableDeclineTolerancePct?: number;
    };
    entryPrerequisites?: {
        requiredPriorExposures?: number;
        minBaselineDays?: number;
        prohibitedTissueSeverities?: readonly string[];
    };
    exitCriteria?: {
        maxWeeksInBlock?: number;
        stagnationReviewAfterWeeks?: number;
    };
}

export interface CanonicalReplayProgressionContract {
    targetBinding: {
        objectiveId: string;
        sessionId?: string;
        stepId?: string;
    };
    variable: string;
    unit: string;
    currentValue: number;
    permittedRange: {
        min: number;
        max: number;
    };
    increment: number;
    knowledgeLineage?: readonly string[];
    observationWindowDays: number;
    minCompletedExposures: number;
    requiredFollowUpCoveragePct: number;
    reviewCadenceDays: number;
    reductionAlternative?: {
        decrement: number;
        trigger: 'adverse_response' | 'stagnation';
    };
}

export interface TreatmentIntentReplayPayloadV1 {
    schemaVersion: typeof TREATMENT_INTENT_REPLAY_SCHEMA_VERSION;
    sourcePlanIdentity: SourcePlanIdentity;
    trainingIntentProfile: PinnedTrainingIntentProfileSnapshot;
    block: {
        id: string;
        revision: number;
        dateRange: {
            startDate: string;
            endDate: string;
        };
        objectives: readonly CanonicalReplayObjective[];
        reviewSchedule: {
            reviewCadenceDays: number;
            nextReviewDate: string;
        };
        progressionContract?: CanonicalReplayProgressionContract;
    };
}

/**
 * Sorts and canonicalizes substitutions by targetCoverageKey.
 */
function canonicalizeSubstitutions(
    substitutions?: readonly BlockSubstitutionRule[],
): CanonicalReplayObjective['allowedSubstitutions'] {
    if (!substitutions || substitutions.length === 0) return undefined;
    return [...substitutions]
        .sort((a, b) => a.targetCoverageKey.localeCompare(b.targetCoverageKey))
        .map(sub => ({
            targetCoverageKey: sub.targetCoverageKey,
            allowedCoverageKeys: [...sub.allowedCoverageKeys].sort(),
            minDoseFraction: sub.minDoseFraction,
            rationale: sub.rationale,
        }));
}

/**
 * Transforms an objective into its canonical replay shape.
 */
function canonicalizeObjective(obj: BlockObjectiveDefinition): CanonicalReplayObjective {
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
        knowledgeLineage: obj.knowledgeLineage ? [...obj.knowledgeLineage].sort() : undefined,
        protectedRoles: obj.protectedRoles ? [...obj.protectedRoles].sort() : undefined,
        allowedSubstitutions: canonicalizeSubstitutions(obj.allowedSubstitutions),
        successCriteria: obj.successCriteria ? {
            evaluationRef: obj.successCriteria.evaluationRef ? {
                id: obj.successCriteria.evaluationRef.id,
                revision: obj.successCriteria.evaluationRef.revision,
                metricId: obj.successCriteria.evaluationRef.metricId,
            } : undefined,
            minCompletedExposures: obj.successCriteria.minCompletedExposures,
            targetTrend: obj.successCriteria.targetTrend,
            acceptableDeclineTolerancePct: obj.successCriteria.acceptableDeclineTolerancePct,
        } : undefined,
        entryPrerequisites: obj.entryPrerequisites ? {
            requiredPriorExposures: obj.entryPrerequisites.requiredPriorExposures,
            minBaselineDays: obj.entryPrerequisites.minBaselineDays,
            prohibitedTissueSeverities: obj.entryPrerequisites.prohibitedTissueSeverities
                ? [...obj.entryPrerequisites.prohibitedTissueSeverities].sort()
                : undefined,
        } : undefined,
        exitCriteria: obj.exitCriteria ? {
            maxWeeksInBlock: obj.exitCriteria.maxWeeksInBlock,
            stagnationReviewAfterWeeks: obj.exitCriteria.stagnationReviewAfterWeeks,
        } : undefined,
    };
}

/**
 * Canonicalizes the progression contract.
 */
function canonicalizeProgressionContract(
    contract?: BlockProgressionContract,
): CanonicalReplayProgressionContract | undefined {
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
        permittedRange: {
            min: contract.permittedRange.min,
            max: contract.permittedRange.max,
        },
        increment: contract.increment,
        knowledgeLineage: contract.knowledgeLineage ? [...contract.knowledgeLineage].sort() : undefined,
        observationWindowDays: contract.observationWindowDays,
        minCompletedExposures: contract.minCompletedExposures,
        requiredFollowUpCoveragePct: contract.requiredFollowUpCoveragePct,
        reviewCadenceDays: contract.reviewCadenceDays,
        reductionAlternative: contract.reductionAlternative ? {
            decrement: contract.reductionAlternative.decrement,
            trigger: contract.reductionAlternative.trigger,
        } : undefined,
    };
}

/**
 * Builds the canonical replay projection. Pins TrainingIntentProfile priorities
 * and weeklyCommitment, canonicalizes all semantic fields, and omits display-only fields (title, notes).
 */
export function buildTreatmentIntentReplayPayloadV1(
    block: IntentBlock,
    profile: Pick<TrainingIntentProfile, 'priorities' | 'weeklyCommitment'> & { schemaVersion?: number },
    sourceSchemaVersion: string,
    sourceRef?: string,
): TreatmentIntentReplayPayloadV1 {
    const sortedObjectives = [...block.objectives]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(canonicalizeObjective);

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
            dateRange: {
                startDate: block.dateRange.startDate,
                endDate: block.dateRange.endDate,
            },
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
 * Deterministically sorts all object keys recursively and omits undefined values.
 */
export function canonicalizeReplayJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalizeReplayJson);
    }
    if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return Object.fromEntries(
            Object.keys(obj)
                .sort()
                .filter(k => obj[k] !== undefined)
                .map(key => [key, canonicalizeReplayJson(obj[key])]),
        );
    }
    return value;
}

/**
 * Serializes the canonical replay payload to a deterministic JSON string.
 */
export function canonicalizeTreatmentIntentJson(payload: TreatmentIntentReplayPayloadV1): string {
    return JSON.stringify(canonicalizeReplayJson(payload));
}

/**
 * Computes the SHA-256 hex digest of the canonical replay payload.
 */
export async function hashTreatmentIntentReplayPayload(
    payload: TreatmentIntentReplayPayloadV1,
): Promise<string> {
    const canonicalJson = canonicalizeTreatmentIntentJson(payload);
    const bytes = new TextEncoder().encode(canonicalJson);
    const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digestBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Verifies that the digest of a replay payload matches an expected SHA-256 digest.
 */
export async function verifyTreatmentIntentReplayDigest(
    payload: TreatmentIntentReplayPayloadV1,
    expectedDigest: string,
): Promise<boolean> {
    const actualDigest = await hashTreatmentIntentReplayPayload(payload);
    return actualDigest === expectedDigest;
}
