import type { CompletedExposure } from './trainingHistory';
import type { DailyReadiness, TrainingIntentProfile, TrainingPriority } from './models';
import type { PhaseWeights } from './periodization';
import type { EvidenceCertainty, KnowledgeMaturity, KnowledgeStatus } from '../knowledge/sportsKnowledge';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';

/** The one in-memory default for an athlete who has not yet saved an intent profile.
 * It is deliberately not persisted by planning-mode resolution. */
export const DEFAULT_TRAINING_INTENT_PROFILE: Omit<TrainingIntentProfile, 'userId' | 'createdAt' | 'updatedAt'> = {
    planningMode: 'evergreen', priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
    organizationPreference: 'auto', schemaVersion: 1,
};

/** `neuromuscular_power` (#802) is deliberately distinct from metabolic `high_intensity`
 * and from `strength`: VO2/threshold work never satisfies it, and it is credited only by
 * exact authored power identities (`workouts/powerExposure.ts`). */
export type AdaptationKey = 'aerobic_endurance' | 'strength' | 'high_intensity' | 'neuromuscular_power';
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
    /** `embedded` requirements ride inside an occurrence packed for another adaptation and
     * never consume their own weekly session slot (ADR-0044 D5/D6). Absent = standalone. */
    delivery?: 'embedded';
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
    /** Current pain/injury, illness or red-flag symptoms reported for the planning day. */
    hasCurrentClinicalSymptoms?: boolean;
    phase?: PhaseWeights | null;
}

/** True when today's check-in reports a current clinical symptom (pain/injury, illness or
 * a red flag). Mirrors the clinical-source resolution used by `evaluateEnvelopes`. */
export function hasCurrentClinicalSymptoms(readiness: DailyReadiness | null | undefined): boolean {
    if (!readiness) return false;
    const subj = readiness.subjective ?? {};
    return subj.painFlag === true
        || (subj.clinicalEnvelopeSources?.length ?? 0) > 0
        || (subj.redFlagFindings?.length ?? 0) > 0;
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

/** Fresh subjective recovery does not erase adverse wearable evidence, but it makes a
 * multi-day shutdown disproportionate when that evidence is discordant. */
export function isFreshSubjectiveWithAdverseWearables(readiness: DailyReadiness | null | undefined): boolean {
    if (!readiness) return false;
    const obj = readiness.objective ?? {};
    const adverseCount = [
        obj.hrv_delta !== null && obj.hrv_delta !== undefined && obj.hrv_delta <= -10,
        obj.rhr_delta !== null && obj.rhr_delta !== undefined && obj.rhr_delta >= 5,
        obj.body_battery_wake !== null && obj.body_battery_wake !== undefined && obj.body_battery_wake <= 35,
        obj.sleep_score !== null && obj.sleep_score !== undefined && obj.sleep_score <= 55,
    ].filter(Boolean).length;
    const subj = readiness.subjective ?? {};
    return adverseCount >= 2
        && subj.readiness !== null && subj.readiness !== undefined && subj.readiness >= 7
        && subj.fatigue !== null && subj.fatigue !== undefined && subj.fatigue <= 3
        && subj.soreness !== null && subj.soreness !== undefined && subj.soreness <= 3
        && subj.painFlag !== true
        && (subj.clinicalEnvelopeSources?.length ?? 0) === 0
        && (subj.redFlagFindings?.length ?? 0) === 0;
}

export interface PolicyWarning {
    code: 'conditional_prior_withheld' | 'power_exposure_withheld';
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

/** Build the WHO-backed adult aerobic dose requirement without applying capacity constraints.
 * This remains the full guideline target. Product-level credit for a separately packed
 * quality occurrence is applied transactionally by weeklyDosePacking.ts and never
 * pre-credited into the evidence-backed requirement itself. */
function aerobicRequirement(
    priority: AdaptationDoseRequirement['priority'],
): AdaptationDoseRequirement {
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
export function strengthRequirement(priority: AdaptationDoseRequirement['priority']): AdaptationDoseRequirement {
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

/** Build the #802 neuromuscular-power requirement. The one-exposure target and two-exposure
 * ceiling are product policy owned by `policy.evergreen.power_maintenance_exposure_v1`; the
 * low-frequency direction is supported, with low certainty, by
 * `performance.power.low_frequency_maintenance`. No floor: power is never a guideline
 * minimum, and it is embedded in strength rather than adding a session. */
function powerRequirement(priority: AdaptationDoseRequirement['priority']): AdaptationDoseRequirement {
    const primaryClaimId = KNOWLEDGE_CLAIM_IDS.powerMaintenanceExposurePolicy;
    return {
        adaptation: 'neuromuscular_power', priority, delivery: 'embedded', floor: null,
        target: { unit: 'sessions', minimum: 0, target: 1, maximum: 2 },
        substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] },
        knowledgeRefs: [primaryClaimId, KNOWLEDGE_CLAIM_IDS.lowFrequencyStrengthPowerMaintenance],
        evidence: evidenceProvenance(primaryClaimId, 'product_heuristic', 'low'),
    };
}

/** Why an otherwise-eligible power requirement is deliberately suspended, or null. */
function powerWithheldReason(
    goalOrEvent: GoalOrEventContext,
    athleteState: AthleteTrainingState,
): string | null {
    const phaseName = goalOrEvent.phase?.phaseName;
    if (goalOrEvent.isAdverseRecovery) return 'Power exposure is withheld during acute adverse recovery; it is not owed as catch-up work.';
    if (goalOrEvent.hasCurrentClinicalSymptoms) return 'Power exposure is withheld while pain, injury, illness or red-flag symptoms are reported.';
    if (phaseName === 'Peak/Taper') return 'Power exposure is deliberately suspended during peak/taper; freshness takes priority.';
    if (phaseName === 'Post-Event Recovery') return 'Power exposure is deliberately suspended during post-event recovery.';
    if (athleteState.inference.dataQuality !== 'high' || athleteState.trainingAgeProxy !== 'established') {
        return 'Power exposure is withheld until sufficient, consistent recent training evidence establishes the athlete as trained.';
    }
    return null;
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

    const performancePriority = priorities.has('endurance') || priorities.has('speed_power') || priorities.has('sport_readiness');
    const isRecoveryPhase = goalOrEvent.phase?.phaseName === 'Post-Event Recovery';
    const canUseConditionalPrior = athleteState.inference.dataQuality === 'high'
        && athleteState.trainingAgeProxy === 'established'
        && !goalOrEvent.isAdverseRecovery
        && !goalOrEvent.hasCurrentClinicalSymptoms
        && !isRecoveryPhase;

    // Event proximity is not the mesocycle authority. An athlete can be in the event-model
    // "Base" phase while an authored block deliberately develops VO2, so generic Base/
    // Build labels must not silently rewrite objective-owned block intent (ADR-0037).
    // Only the explicit post-event recovery state suppresses this generic prior here.
    const hardSessionCap = 2;
    const hasQualityPrior = performancePriority && canUseConditionalPrior;

    // WHO adult-health guidance recommends both aerobic volume and muscle-strengthening
    // frequency. If either adaptation is included by the health/balanced baseline, or is
    // explicitly selected by the athlete, keep its evidence-backed floor non-droppable.
    // Capacity may still produce an explicit shortfall; it must not silently erase a whole
    // guideline-backed adaptation by relegating it to opportunistic leftover sessions.
    if (healthOrBalanced || priorities.has('endurance')) {
        requirements.push(aerobicRequirement('required'));
    }
    if (healthOrBalanced || priorities.has('strength_muscle')) {
        requirements.push(strengthRequirement('required'));
    }

    const warnings: PolicyWarning[] = [];
    if (hasQualityPrior) {
        const primaryClaimId = KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior;
        requirements.push({
            adaptation: 'high_intensity', priority: 'optional', floor: null,
            target: { unit: 'sessions', minimum: 0, target: 1, maximum: hardSessionCap },
            substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Running', 'Cycling', 'Other'] },
            knowledgeRefs: [primaryClaimId],
            evidence: evidenceProvenance(primaryClaimId, 'conditional_prior', 'low'),
        });
    } else if (performancePriority) {
        warnings.push({
            code: 'conditional_prior_withheld',
            message: goalOrEvent.isAdverseRecovery
                ? 'Performance-intensity work is withheld during acute adverse recovery.'
                : goalOrEvent.hasCurrentClinicalSymptoms
                    ? 'Performance-intensity work is withheld while pain, injury, illness or red-flag symptoms are reported.'
                    : isRecoveryPhase
                        ? 'Performance-intensity work is withheld during post-event recovery.'
                        : 'Performance-intensity work is withheld until sufficient, consistent recent training evidence is available.',
        });
    }

    // Issue #802: a hybrid athlete who already carries a strength requirement and a
    // performance priority gets a separate embedded power requirement. It never rides on the
    // generic high-intensity prior above, so VO2/threshold work cannot satisfy it.
    const strengthPlanned = requirements.some(requirement => requirement.adaptation === 'strength');
    const powerCandidate = strengthPlanned && (performancePriority || priorities.has('balanced_performance'));
    if (powerCandidate) {
        const withheld = powerWithheldReason(goalOrEvent, athleteState);
        if (withheld) warnings.push({ code: 'power_exposure_withheld', message: withheld });
        else requirements.push(powerRequirement(priorities.has('speed_power') ? 'target' : 'optional'));
    }
    return { requirements, ...(canUseConditionalPrior ? { hardSessionCap } : {}), warnings };
}
