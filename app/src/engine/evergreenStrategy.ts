import type { CompletedExposure } from './trainingHistory';
import type { TrainingIntentProfile, TrainingPriority } from './models';

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
    sourceId: string;
    population: string;
    outcome: string;
    confidence: 'high' | 'medium' | 'low';
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
const REVIEWED_ON = '2026-08-10';

const HEALTH_AEROBIC_PROVENANCE: EvidenceProvenance = {
    sourceId: 'WHO-2020-PHYSICAL-ACTIVITY-GUIDELINES',
    population: 'Adults without a sport-specific performance requirement',
    outcome: 'Health-promoting moderate-intensity aerobic activity volume',
    confidence: 'high',
    applicability: ['health', 'balanced_performance'],
    authority: 'guideline_target', policyVersion: POLICY_VERSION, reviewedOn: REVIEWED_ON,
};

const STRENGTH_PROVENANCE: EvidenceProvenance = {
    sourceId: 'WHO-2020-PHYSICAL-ACTIVITY-GUIDELINES',
    population: 'Adults without a sport-specific performance requirement',
    outcome: 'Muscle-strengthening activity frequency',
    confidence: 'high',
    applicability: ['health', 'balanced_performance', 'strength_muscle'],
    authority: 'guideline_target', policyVersion: POLICY_VERSION, reviewedOn: REVIEWED_ON,
};

const HIGH_INTENSITY_PROVENANCE: EvidenceProvenance = {
    sourceId: 'PRODUCT-CONDITIONAL-TRAINING-PRIOR',
    population: 'Athletes with sufficient, internally consistent recent training evidence',
    outcome: 'Optional performance-oriented high-intensity exposure',
    confidence: 'low',
    applicability: ['endurance', 'speed_power', 'sport_readiness'],
    authority: 'conditional_prior', policyVersion: POLICY_VERSION, reviewedOn: REVIEWED_ON,
};

function hasAny(text: string, terms: readonly string[]): boolean {
    const normalized = text.toLowerCase();
    return terms.some(term => normalized.includes(term));
}

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

function aerobicRequirement(priority: AdaptationDoseRequirement['priority']): AdaptationDoseRequirement {
    return {
        adaptation: 'aerobic_endurance', priority,
        floor: { dose: { unit: 'minutes', value: 150 }, semantics: 'guideline_recommended_minimum' },
        target: { unit: 'minutes', minimum: 150, target: 150, maximum: 300 },
        substitutionPolicy: { equivalentModalitiesAllowed: true, permittedModalities: ['Walking', 'Running', 'Cycling', 'Other'] },
        evidence: HEALTH_AEROBIC_PROVENANCE,
    };
}

function strengthRequirement(priority: AdaptationDoseRequirement['priority']): AdaptationDoseRequirement {
    return {
        adaptation: 'strength', priority,
        floor: { dose: { unit: 'sessions', value: 2 }, semantics: 'guideline_recommended_minimum' },
        target: { unit: 'sessions', minimum: 2, target: 2, maximum: 3 },
        substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] },
        evidence: STRENGTH_PROVENANCE,
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
    // WHO/CDC adult-health guidance recommends both aerobic volume and muscle-strengthening
    // frequency. If either adaptation is included by the health/balanced baseline, or is
    // explicitly selected by the athlete, keep its evidence-backed floor non-droppable.
    // Capacity may still produce an explicit shortfall; it must not silently erase a whole
    // guideline-backed adaptation by relegating it to opportunistic leftover sessions.
    if (healthOrBalanced || priorities.has('endurance')) requirements.push(aerobicRequirement('required'));
    if (healthOrBalanced || priorities.has('strength_muscle')) requirements.push(strengthRequirement('required'));

    const performancePriority = priorities.has('endurance') || priorities.has('speed_power') || priorities.has('sport_readiness');
    const canUseConditionalPrior = athleteState.inference.dataQuality === 'high' && athleteState.trainingAgeProxy === 'established';
    const warnings: PolicyWarning[] = [];
    if (performancePriority && canUseConditionalPrior) {
        requirements.push({
            adaptation: 'high_intensity', priority: 'optional', floor: null,
            target: { unit: 'sessions', minimum: 0, target: 1, maximum: 2 },
            substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Running', 'Cycling', 'Other'] },
            evidence: HIGH_INTENSITY_PROVENANCE,
        });
    } else if (performancePriority) {
        warnings.push({ code: 'conditional_prior_withheld', message: 'Performance-intensity work is withheld until sufficient, consistent recent training evidence is available.' });
    }
    return { requirements, ...(canUseConditionalPrior ? { hardSessionCap: 2 } : {}), warnings };
}
