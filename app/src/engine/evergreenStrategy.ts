import type { CompletedExposure } from './trainingHistory';
import type { DailyReadiness, TrainingIntentProfile, TrainingPriority } from './models';
import {
    getActiveKnowledgeClaim,
    KNOWLEDGE_CLAIM_IDS,
    type EvidenceCertainty,
    type KnowledgeMaturity,
    type KnowledgeStatus,
} from '../knowledge/sportsKnowledge';

/** The one in-memory default for an athlete who has not yet saved an intent profile.
 * It is deliberately not persisted by planning-mode resolution. */
export const DEFAULT_TRAINING_INTENT_PROFILE: Omit<TrainingIntentProfile, 'userId' | 'createdAt' | 'updatedAt'> = {
    planningMode: 'evergreen', priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
    organizationPreference: 'auto', schemaVersion: 1,
};

export type AdaptationKey = 'aerobic_endurance' | 'strength' | 'high_intensity';
export type DoseUnit = 'minutes' | 'sessions';

export interface DoseTarget {
    unit: DoseUnit;
    value: number;
}

export interface DoseRange {
    unit: DoseUnit;
    minimum: number;
    target: number;
    maximum: number;
}

export interface EvidenceProvenance {
    knowledgeClaimId: string;
    knowledgeClaimVersion: number;
    sourceId: string;
    sourceIds: string[];
    population: string;
    outcome: string;
    confidence: 'high' | 'medium' | 'low';
    evidenceCertainty: EvidenceCertainty;
    maturity: KnowledgeMaturity;
    status: KnowledgeStatus;
    applicability: string[];
    authority: 'guideline_target' | 'outcome_supported_default' | 'conditional_prior' | 'product_heuristic';
    policyVersion: string;
    reviewedOn: string;
}

export interface SubstitutionPolicy {
    /** Whether a different modality may satisfy the adaptation requirement. */
    equivalentModalitiesAllowed: boolean;
    permittedModalities: string[];
}

export interface AdaptationDoseRequirement {
    adaptation: AdaptationKey;
    floor: {
        dose: DoseTarget;
        semantics: 'guideline_recommended_minimum' | 'goal_required_minimum' | 'evidence_supported_minimum';
    } | null;
    target: DoseRange;
    priority: 'required' | 'target' | 'optional';
    substitutionPolicy: SubstitutionPolicy;
    /** All scientific/product knowledge claims that justify this requirement. */
    knowledgeRefs: string[];
    /** Compatibility projection for existing consumers while policy migrates to claim references. */
    evidence: EvidenceProvenance;
}

export interface InferenceDiagnostic {
    code: 'insufficient_history' | 'limited_history' | 'conflicting_history';
    message: string;
}

export interface RecentTrainingExposure {
    sessionCount: number;
    totalMinutes: number;
    aerobicSessions: number;
    strengthSessions: number;
    highIntensitySessions: number;
}

export interface AthleteTrainingState {
    recentExposure: RecentTrainingExposure;
    trainingAgeProxy: 'unknown' | 'developing' | 'established';
    inference: {
        dataQuality: 'high' | 'limited' | 'insufficient' | 'conflicting';
        observedWindowDays: number;
        diagnostics: InferenceDiagnostic[];
    };
}

export interface GoalOrEventContext {
    priorities: readonly TrainingPriority[];
    isAdverseRecovery?: boolean;
}

export function isSevereAdverseRecoveryReadiness(
    readiness: DailyReadiness | null | undefined,
    mode?: 'train' | 'modify' | 'recover',
): boolean {
    if (!readiness) return false;
    const isRecoverMode = mode ? mode === 'recover' : true;
    const obj = readiness.objective ?? {};
    let adverseCount = 0;
    if (obj.hrv_delta !== null && obj.hrv_delta !== undefined && obj.hrv_delta <= -10) adverseCount++;
    if (obj.rhr_delta !== null && obj.rhr_delta !== undefined && obj.rhr_delta >= 5) adverseCount++;
    if (obj.body_battery_wake !== null && obj.body_battery_wake !== undefined && obj.body_battery_wake <= 35) adverseCount++;
    if (obj.sleep_score !== null && obj.sleep_score !== undefined && obj.sleep_score <= 55) adverseCount++;

    const subj = readiness.subjective ?? {};
    let distressCount = 0;
    if (subj.fatigue !== undefined && subj.fatigue !== null && subj.fatigue >= 7) distressCount++;
    if (subj.soreness !== undefined && subj.soreness !== null && subj.soreness >= 7) distressCount++;
    if (subj.stress !== undefined && subj.stress !== null && subj.stress >= 8) distressCount++;
    if (subj.readiness !== undefined && subj.readiness !== null && subj.readiness <= 4) distressCount++;

    return isRecoverMode && (
        adverseCount >= 2
        || distressCount >= 2
        || (adverseCount >= 1 && distressCount >= 1)
    );
}

export interface PolicyWarning {
    code: 'conditional_prior_withheld';
    message: string;
}

export interface EvidenceBackedStrategy {
    requirements: AdaptationDoseRequirement[];
    hardSessionCap?: number;
    warnings: PolicyWarning[];
}

const POLICY_VERSION = 'evergreen-dose-v1';

/** Project an active knowledge claim into the legacy provenance shape consumed by existing planner code. */
function evidenceProvenance(
    knowledgeClaimId: string,
    authority: EvidenceProvenance['authority'],
    legacyConfidence: EvidenceProvenance['confidence'],
): EvidenceProvenance {
    const claim = getActiveKnowledgeClaim(knowledgeClaimId);
    const primaryEvidence = claim.evidence[0];
    if (!primaryEvidence) throw new Error(`Knowledge claim ${claim.id} has no evidence/source link`);

    return {
        knowledgeClaimId: claim.id,
        knowledgeClaimVersion: claim.version,
        sourceId: primaryEvidence.sourceId,
        sourceIds: claim.evidence.map(link => link.sourceId),
        population: claim.applicability.populations.join('; '),
        outcome: claim.applicability.outcomes.join('; '),
        confidence: legacyConfidence,
        evidenceCertainty: claim.evidenceCertainty,
        maturity: claim.maturity,
        status: claim.status,
        applicability: [...claim.applicability.contexts],
        authority,
        policyVersion: POLICY_VERSION,
        reviewedOn: claim.reviewedOn,
    };
}

/** Return whether a normalized label contains any of the supplied classification terms. */
function hasAny(text: string, terms: readonly string[]): boolean {
    const normalized = text.toLowerCase();
    return terms.some(term => normalized.includes(term));
}

/** Detect contradictory structured modality and free-text session-type evidence in one exposure. */
function hasConflictingStructuralEvidence(exposure: CompletedExposure): boolean {
    if (!exposure.modality) return false;
    const label = exposure.trainingRecordLike.type;
    const strengthLabel = hasAny(label, ['strength', 'weight', 'lifting', 'resistance']);
    const enduranceLabel = hasAny(label, ['cycling', 'running', 'walking', 'aerobic', 'endurance', 'zone 2']);
    return (strengthLabel && ['Cycling', 'Running', 'Walking', 'Field'].includes(exposure.modality))
        || (enduranceLabel && exposure.modality === 'Strength');
}

/** Infer only recent observed training state. This deliberately never claims literal
 * training age: sparse or ambiguous history remains `unknown` and cannot unlock a
 * conditional high-intensity prior. */
export function inferAthleteTrainingState(
    exposures: readonly CompletedExposure[],
    observedWindowDays: number,
): AthleteTrainingState {
    const recentExposure: RecentTrainingExposure = exposures.reduce((total, exposure) => {
        const label = `${exposure.modality ?? ''} ${exposure.category ?? ''} ${exposure.trainingRecordLike.type}`;
        const duration = Number.isFinite(exposure.trainingRecordLike.duration_min)
            ? Math.max(0, exposure.trainingRecordLike.duration_min)
            : 0;
        const aerobic = hasAny(label, ['cycling', 'running', 'walking', 'aerobic', 'endurance', 'zone 2']);
        const strength = hasAny(label, ['strength', 'weight', 'lifting', 'resistance']);
        const highIntensity = hasAny(label, ['threshold', 'vo2', 'interval', 'surge', 'hiit']);
        return {
            sessionCount: total.sessionCount + 1,
            totalMinutes: total.totalMinutes + duration,
            aerobicSessions: total.aerobicSessions + Number(aerobic),
            strengthSessions: total.strengthSessions + Number(strength),
            highIntensitySessions: total.highIntensitySessions + Number(highIntensity),
        };
    }, { sessionCount: 0, totalMinutes: 0, aerobicSessions: 0, strengthSessions: 0, highIntensitySessions: 0 });

    if (exposures.some(hasConflictingStructuralEvidence)) {
        return {
            recentExposure, trainingAgeProxy: 'unknown',
            inference: {
                dataQuality: 'conflicting', observedWindowDays,
                diagnostics: [{ code: 'conflicting_history', message: 'Recent history contains incompatible recorded modality and session-type evidence; conditional training priors are withheld.' }],
            },
        };
    }

    if (observedWindowDays < 14) {
        return {
            recentExposure, trainingAgeProxy: 'unknown',
            inference: {
                dataQuality: 'insufficient', observedWindowDays,
                diagnostics: [{ code: 'insufficient_history', message: 'Fewer than 14 observed days; conditional training priors are withheld.' }],
            },
        };
    }
    if (observedWindowDays < 28) {
        return {
            recentExposure, trainingAgeProxy: 'unknown',
            inference: {
                dataQuality: 'limited', observedWindowDays,
                diagnostics: [{ code: 'limited_history', message: 'Fewer than 28 observed days; training state remains conservative.' }],
            },
        };
    }
    const established = recentExposure.sessionCount >= 12 && recentExposure.totalMinutes >= 720;
    return {
        recentExposure,
        trainingAgeProxy: established ? 'established' : 'developing',
        inference: { dataQuality: 'high', observedWindowDays, diagnostics: [] },
    };
}

/** Build the WHO-backed adult aerobic dose requirement without applying capacity constraints. */
function aerobicRequirement(priority: AdaptationDoseRequirement['priority']): AdaptationDoseRequirement {
    const primaryClaimId = KNOWLEDGE_CLAIM_IDS.adultAerobicHealthVolume;
    return {
        adaptation: 'aerobic_endurance', priority,
        floor: { dose: { unit: 'minutes', value: 150 }, semantics: 'guideline_recommended_minimum' },
        target: { unit: 'minutes', minimum: 150, target: 150, maximum: 300 },
        substitutionPolicy: { equivalentModalitiesAllowed: true, permittedModalities: ['Walking', 'Running', 'Cycling', 'Other'] },
        knowledgeRefs: [primaryClaimId],
        evidence: evidenceProvenance(primaryClaimId, 'guideline_target', 'high'),
    };
}

/** Build the adult strength requirement from the WHO floor plus the separate product upper-target claim. */
function strengthRequirement(priority: AdaptationDoseRequirement['priority']): AdaptationDoseRequirement {
    const primaryClaimId = KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency;
    return {
        adaptation: 'strength', priority,
        floor: { dose: { unit: 'sessions', value: 2 }, semantics: 'guideline_recommended_minimum' },
        target: { unit: 'sessions', minimum: 2, target: 2, maximum: 3 },
        substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] },
        knowledgeRefs: [primaryClaimId, KNOWLEDGE_CLAIM_IDS.adultStrengthDefaultUpperTarget],
        evidence: evidenceProvenance(primaryClaimId, 'guideline_target', 'high'),
    };
}

/** Resolves dose before capacity. The result makes no assumption about the athlete's
 * available minutes or declared session count; those constraints belong to
 * `trainingCapacity.ts`. */
export function resolveEvidenceBackedStrategy(
    goalOrEvent: GoalOrEventContext,
    athleteState: AthleteTrainingState,
): EvidenceBackedStrategy {
    const priorities = new Set(goalOrEvent.priorities.length > 0 ? goalOrEvent.priorities : ['balanced_performance']);
    const requirements: AdaptationDoseRequirement[] = [];
    const healthOrBalanced = priorities.has('health') || priorities.has('balanced_performance');
    // WHO adult-health guidance recommends both aerobic volume and muscle-strengthening
    // frequency. If either adaptation is included by the health/balanced baseline, or is
    // explicitly selected by the athlete, keep its evidence-backed floor non-droppable.
    // Capacity may still produce an explicit shortfall; it must not silently erase a whole
    // guideline-backed adaptation by relegating it to opportunistic leftover sessions.
    if (healthOrBalanced || priorities.has('endurance')) requirements.push(aerobicRequirement('required'));
    if (healthOrBalanced || priorities.has('strength_muscle')) requirements.push(strengthRequirement('required'));

    const performancePriority = priorities.has('endurance') || priorities.has('speed_power') || priorities.has('sport_readiness');
    const canUseConditionalPrior = athleteState.inference.dataQuality === 'high'
        && athleteState.trainingAgeProxy === 'established'
        && !goalOrEvent.isAdverseRecovery;
    const warnings: PolicyWarning[] = [];
    if (performancePriority && canUseConditionalPrior) {
        const primaryClaimId = KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior;
        requirements.push({
            adaptation: 'high_intensity', priority: 'optional', floor: null,
            target: { unit: 'sessions', minimum: 0, target: 1, maximum: 2 },
            substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Running', 'Cycling', 'Other'] },
            knowledgeRefs: [primaryClaimId],
            evidence: evidenceProvenance(primaryClaimId, 'conditional_prior', 'low'),
        });
    } else if (performancePriority) {
        warnings.push({
            code: 'conditional_prior_withheld',
            message: goalOrEvent.isAdverseRecovery
                ? 'Performance-intensity work is withheld during acute adverse recovery.'
                : 'Performance-intensity work is withheld until sufficient, consistent recent training evidence is available.',
        });
    }
    return { requirements, ...(canUseConditionalPrior ? { hardSessionCap: 2 } : {}), warnings };
}
