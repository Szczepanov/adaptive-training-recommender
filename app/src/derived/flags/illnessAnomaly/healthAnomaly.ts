import {
    HEALTH_ANOMALY_POLICIES,
    type ContextExplanation,
    type CoreSignalDataQuality,
    type CoreSignalEvidence,
    type EarlyResponseProtocol,
    type HealthAnomalyCalibrationStage,
    type HealthAnomalyEvidenceQuality,
    type HealthAnomalyInput,
    type HealthAnomalyPolicy,
    type HealthAnomalyRationaleFact,
    type HealthAnomalySeverity,
    type HealthAnomalyThresholdPolicy,
    type HealthCoreSignal,
    type HealthCoreSignalFeatures,
    type HealthSignalFeatureCandidate,
    type PhysiologicalAnomalyAssessment,
    type PhysiologicalAnomalyState,
    type SupportingSignalEvidence,
} from './healthAnomalyModels';
import { evaluateRespirationElevation } from './respirationElevation';

export const HEALTH_ANOMALY_POLICY_VERSION = 'health-anomaly/ha9-respiration-shadow-v1';

/** Candidate values for shadow replay only; HA7 evidence, not architecture preference, decides cutover. */
export const SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS: HealthAnomalyThresholdPolicy = {
    policyVersion: 'health-anomaly-thresholds/shadow-candidate-v1',
    moderateDeviation: 1.5,
    strongDeviation: 2.5,
    minimumCoreSignalsForMultiSignal: 2,
    persistenceDaysForEscalation: 2,
    minimumHistoryCount: 14,
    minimumRecentDayCoverage: 4 / 7,
    maxBaselineAgeDays: 3,
    estimatorBySignal: {
        rhr: 'mean-stdev-28d',
        respiration: 'median-mad-28d',
        hrv: 'log-mean-stdev-28d',
    },
};

/** Calibrated thresholds for visible non-diagnostic early warnings and replay comparison. */
export const VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS: HealthAnomalyThresholdPolicy = {
    policyVersion: 'health-anomaly-thresholds/visible-early-warning-v1',
    moderateDeviation: 1.5,
    strongDeviation: 2.5,
    minimumCoreSignalsForMultiSignal: 2,
    persistenceDaysForEscalation: 2,
    minimumHistoryCount: 14,
    minimumRecentDayCoverage: 4 / 7,
    maxBaselineAgeDays: 3,
    estimatorBySignal: {
        rhr: 'mean-stdev-28d',
        respiration: 'median-mad-28d',
        hrv: 'log-mean-stdev-28d',
    },
    emergingHistoryCount: 7,
    allowFirstNightMultiDomainEscalation: true,
    downgradeResolvingRespiration: true,
};

const CORE_SIGNALS: readonly HealthCoreSignal[] = ['rhr', 'respiration', 'hrv'];
const STRENGTH_RANK = { weak: 1, moderate: 2, strong: 3 } as const;
const DAY_MS = 86_400_000;

/**
 * Fail-closed parser for runtime configuration. Only the four exact policy strings are
 * accepted. Missing, malformed, differently-cased, or otherwise unrecognized values are off.
 */
export function resolveHealthAnomalyPolicy(value: unknown): HealthAnomalyPolicy {
    return typeof value === 'string'
        && (HEALTH_ANOMALY_POLICIES as readonly string[]).includes(value)
        ? value as HealthAnomalyPolicy
        : 'off';
}

/**
 * Reads policy configuration through a boundary that may fail (remote config, feature flag,
 * environment adapter). A read failure must never implicitly opt the athlete into health
 * anomaly collection or visibility.
 */
export function readHealthAnomalyPolicy(readConfiguredValue: () => unknown): HealthAnomalyPolicy {
    try {
        return resolveHealthAnomalyPolicy(readConfiguredValue());
    } catch {
        return 'off';
    }
}

export function isHealthAnomalyThresholdPolicy(value: unknown): value is HealthAnomalyThresholdPolicy {
    if (!value || typeof value !== 'object') return false;
    const policy = value as Partial<HealthAnomalyThresholdPolicy>;
    const estimators = policy.estimatorBySignal;
    const emergingValid = policy.emergingHistoryCount === undefined || (
        Number.isInteger(policy.emergingHistoryCount)
        && policy.emergingHistoryCount >= 1
        && policy.emergingHistoryCount <= (policy.minimumHistoryCount ?? 0)
    );
    const firstNightValid = policy.allowFirstNightMultiDomainEscalation === undefined
        || typeof policy.allowFirstNightMultiDomainEscalation === 'boolean';
    const resolvingValid = policy.downgradeResolvingRespiration === undefined
        || typeof policy.downgradeResolvingRespiration === 'boolean';
    return typeof policy.policyVersion === 'string'
        && policy.policyVersion.length > 0
        && typeof policy.moderateDeviation === 'number'
        && Number.isFinite(policy.moderateDeviation)
        && policy.moderateDeviation > 0
        && typeof policy.strongDeviation === 'number'
        && Number.isFinite(policy.strongDeviation)
        && policy.strongDeviation > policy.moderateDeviation
        && Number.isInteger(policy.minimumCoreSignalsForMultiSignal)
        && (policy.minimumCoreSignalsForMultiSignal ?? 0) >= 2
        && (policy.minimumCoreSignalsForMultiSignal ?? 0) <= 3
        && Number.isInteger(policy.persistenceDaysForEscalation)
        && (policy.persistenceDaysForEscalation ?? 0) >= 1
        && Number.isInteger(policy.minimumHistoryCount)
        && (policy.minimumHistoryCount ?? 0) >= 1
        && typeof policy.minimumRecentDayCoverage === 'number'
        && Number.isFinite(policy.minimumRecentDayCoverage)
        && policy.minimumRecentDayCoverage >= 0
        && policy.minimumRecentDayCoverage <= 1
        && Number.isInteger(policy.maxBaselineAgeDays)
        && (policy.maxBaselineAgeDays ?? -1) >= 0
        && emergingValid
        && firstNightValid
        && resolvingValid
        && !!estimators
        && typeof estimators === 'object'
        && ['mean-stdev-28d', 'median-mad-28d', 'log-mean-stdev-28d'].includes(estimators.rhr)
        && ['mean-stdev-28d', 'median-mad-28d', 'log-mean-stdev-28d'].includes(estimators.respiration)
        && ['mean-stdev-28d', 'median-mad-28d', 'log-mean-stdev-28d'].includes(estimators.hrv);
}

function unavailableEvidence(signal: HealthCoreSignal): CoreSignalEvidence {
    return {
        signal,
        status: 'unavailable',
        direction: null,
        currentValue: null,
        baselineValue: null,
        scaleValue: null,
        standardizedDeviation: null,
        estimator: null,
        baselineVersion: null,
    };
}

function featuresForSignal(input: HealthAnomalyInput, signal: HealthCoreSignal): HealthCoreSignalFeatures | null {
    return input.features?.coreSignals.find(item => item.signal === signal) ?? null;
}

function qualityForSignal(
    input: HealthAnomalyInput,
    signal: HealthCoreSignal,
    feature: HealthCoreSignalFeatures | null,
): CoreSignalDataQuality | null {
    return feature?.dataQuality ?? input.dataQuality.find(item => item.signal === signal) ?? null;
}

function isUsableCandidate(candidate: HealthSignalFeatureCandidate | undefined): candidate is HealthSignalFeatureCandidate {
    return !!candidate
        && candidate.status === 'available'
        && candidate.standardizedDeviation !== null
        && Number.isFinite(candidate.standardizedDeviation);
}

function selectSignalCandidate(
    feature: HealthCoreSignalFeatures,
    preferredEstimator: HealthAnomalyThresholdPolicy['estimatorBySignal'][HealthCoreSignal],
    emergingBaseline: boolean,
): HealthSignalFeatureCandidate | undefined {
    const preferred = feature.candidates.find(item => item.estimator === preferredEstimator);
    if (!emergingBaseline || isUsableCandidate(preferred)) {
        return preferred;
    }
    return feature.candidates.find(
        item => (item.estimator === 'mean-stdev-28d' || item.estimator === 'median-mad-28d')
            && isUsableCandidate(item),
    ) ?? preferred;
}

function categorizeSignal(
    input: HealthAnomalyInput,
    signal: HealthCoreSignal,
    thresholds: HealthAnomalyThresholdPolicy,
): { evidence: CoreSignalEvidence; usedEmergingBaseline: boolean } {
    const feature = featuresForSignal(input, signal);
    if (!feature) {
        const evidence = input.coreSignals.find(item => item.signal === signal) ?? unavailableEvidence(signal);
        const quality = qualityForSignal(input, signal, null);
        const usedEmergingBaseline = evidence.status !== 'unavailable'
            && quality !== null
            && thresholds.emergingHistoryCount !== undefined
            && quality.historyCount >= thresholds.emergingHistoryCount
            && quality.historyCount < thresholds.minimumHistoryCount;
        return { evidence, usedEmergingBaseline };
    }

    const quality = qualityForSignal(input, signal, feature);
    const isEmerging = quality !== null
        && thresholds.emergingHistoryCount !== undefined
        && quality.historyCount >= thresholds.emergingHistoryCount
        && quality.historyCount < thresholds.minimumHistoryCount;
    const candidate = selectSignalCandidate(feature, thresholds.estimatorBySignal[signal], isEmerging);
    const hasEnoughHistory = quality !== null
        && (quality.historyCount >= thresholds.minimumHistoryCount || isEmerging);
    if (
        !isUsableCandidate(candidate)
        || !quality
        || quality.currentValueMissing
        || !hasEnoughHistory
        || quality.recentDayCoverage < thresholds.minimumRecentDayCoverage
        || quality.baselineAgeDays === null
        || quality.baselineAgeDays > thresholds.maxBaselineAgeDays
    ) {
        return {
            evidence: {
                ...unavailableEvidence(signal),
                currentValue: candidate?.currentValue ?? null,
                baselineValue: candidate?.baselineValue ?? null,
                scaleValue: candidate?.scaleValue ?? null,
                estimator: candidate?.estimator ?? null,
                baselineVersion: candidate?.baselineVersion ?? null,
            },
            usedEmergingBaseline: false,
        };
    }

    const cutoffOffset = isEmerging ? 0.5 : 0;
    const moderateDeviation = thresholds.moderateDeviation + cutoffOffset;
    const strongDeviation = thresholds.strongDeviation + cutoffOffset;
    const deviation = candidate.standardizedDeviation!;
    let status: CoreSignalEvidence['status'] = 'normal';
    let direction: CoreSignalEvidence['direction'] = null;

    if (signal === 'rhr' || signal === 'respiration') {
        if (deviation >= strongDeviation) {
            status = 'strong_anomaly';
            direction = 'high';
        } else if (deviation >= moderateDeviation) {
            status = 'moderate_anomaly';
            direction = 'high';
        }
    } else if (deviation <= -strongDeviation) {
        status = 'strong_anomaly';
        direction = 'low';
    } else if (deviation <= -moderateDeviation) {
        status = 'moderate_anomaly';
        direction = 'low';
    } else if (deviation >= strongDeviation) {
        // Retain unusually-high HRV as out-of-range telemetry without treating it as an
        // adverse illness vote. isAdverseCoreSignalEvidence deliberately excludes two_sided HRV.
        status = 'strong_anomaly';
        direction = 'two_sided';
    } else if (deviation >= moderateDeviation) {
        status = 'moderate_anomaly';
        direction = 'two_sided';
    }

    return {
        evidence: {
            signal,
            status,
            direction,
            currentValue: candidate.currentValue,
            baselineValue: candidate.baselineValue,
            scaleValue: candidate.scaleValue,
            standardizedDeviation: deviation,
            estimator: candidate.estimator,
            baselineVersion: candidate.baselineVersion,
        },
        usedEmergingBaseline: isEmerging,
    };
}

function isAnomaly(evidence: CoreSignalEvidence): boolean {
    return evidence.status === 'moderate_anomaly' || evidence.status === 'strong_anomaly';
}

/** Canonical adverse-core classifier shared by evaluation and persistence composition. */
export function isAdverseCoreSignalEvidence(evidence: CoreSignalEvidence): boolean {
    if (!isAnomaly(evidence)) return false;
    if (evidence.signal === 'hrv') return evidence.direction === 'low';
    return evidence.direction === 'high';
}

/** Yesterday's high-intensity stimulus session (issue #809: "hard" = stimulus only). */
function hasPriorHardStimulus(snapshot: HealthAnomalyInput['recoverySnapshot']): boolean {
    const yesterday = snapshot?.raw.yesterdayTraining;
    return !!yesterday && (
        (yesterday.hardActivityCount ?? 0) > 0
        || yesterday.primaryActivity?.intensityTag === 'hard'
    );
}

/** Issue #809: a long aerobic session with high/very_high session cost is prior hard
 * *training* for explaining next-day RHR/HRV strain, reported under its own evidence code. */
function hasPriorHighCostSession(snapshot: HealthAnomalyInput['recoverySnapshot']): boolean {
    const yesterday = snapshot?.raw.yesterdayTraining;
    const primaryCost = yesterday?.primaryActivity?.sessionCost;
    return !!yesterday && (
        (yesterday.highCostActivityCount ?? 0) > 0
        || primaryCost === 'high'
        || primaryCost === 'very_high'
    );
}

/** Evidence codes for prior hard training: stimulus and dose stay distinguishable. */
export function hasPriorHardTraining(snapshot: HealthAnomalyInput['recoverySnapshot']): string[] {
    return [
        ...(hasPriorHardStimulus(snapshot) ? ['YESTERDAY_HARD_SESSION'] : []),
        ...(hasPriorHighCostSession(snapshot) ? ['YESTERDAY_HIGH_COST_SESSION'] : []),
    ];
}

function addExplanation(
    explanations: ContextExplanation[],
    kind: ContextExplanation['kind'],
    strength: ContextExplanation['strength'],
    explainsSignals: HealthCoreSignal[],
    evidence: string[],
): void {
    explanations.push({ kind, strength, explainsSignals, evidence });
}

function resolveExplanations(
    input: HealthAnomalyInput,
    priorAdverseDays = 0,
): ContextExplanation[] {
    const explanations: ContextExplanation[] = [];
    const snapshot = input.recoverySnapshot;
    const checkin = input.subjectiveCheckin;
    const health = checkin?.healthContext;
    const priorHardEvidence = hasPriorHardTraining(snapshot);

    // Morning RHR/HRV/respiration precede any activity performed later today. `todayTraining`
    // is therefore never explanatory. The backend defines last3DaysHardSessionsCount (and
    // last3DaysHighCostSessionsCount) as D-1 through D-3 only, so those aggregates are
    // causally safe for a weaker prior-load context.
    const windowEvidence = [
        ...(input.last3DaysHardSessionsCount > 0 ? ['HARD_SESSION_WITHIN_3D'] : []),
        ...((input.last3DaysHighCostSessionsCount ?? 0) > 0 ? ['HIGH_COST_SESSION_WITHIN_3D'] : []),
    ];
    if (priorHardEvidence.length > 0) {
        addExplanation(explanations, 'hard_training', 'strong', ['rhr', 'hrv'], priorHardEvidence);
        addExplanation(explanations, 'hard_training', 'weak', ['respiration'], priorHardEvidence);
    } else if (windowEvidence.length > 0) {
        addExplanation(explanations, 'hard_training', 'moderate', ['rhr', 'hrv'], windowEvidence);
    }

    const objectivePoorSleep = (snapshot?.raw.sleepScore ?? 100) < 60
        || (snapshot?.raw.sleepDurationSec ?? Number.POSITIVE_INFINITY) < 6 * 60 * 60;
    const subjectivePoorSleep = checkin?.sleepQuality != null && checkin.sleepQuality <= 4;
    if (objectivePoorSleep && subjectivePoorSleep) {
        addExplanation(explanations, 'short_or_poor_sleep', 'strong', ['rhr', 'hrv'], ['OBJECTIVE_AND_SUBJECTIVE_POOR_SLEEP']);
        addExplanation(explanations, 'short_or_poor_sleep', 'weak', ['respiration'], ['OBJECTIVE_AND_SUBJECTIVE_POOR_SLEEP']);
    } else if (objectivePoorSleep || subjectivePoorSleep) {
        addExplanation(explanations, 'short_or_poor_sleep', 'moderate', ['rhr', 'hrv'], [objectivePoorSleep ? 'OBJECTIVE_POOR_SLEEP' : 'SUBJECTIVE_POOR_SLEEP']);
    }

    const subjectiveHighStress = checkin?.mentalStress != null && checkin.mentalStress >= 7;
    const objectiveHighStress = (snapshot?.raw.stress?.avg ?? 0) >= 50;
    if (subjectiveHighStress && objectiveHighStress) {
        addExplanation(explanations, 'psychological_stress', 'strong', ['rhr', 'hrv'], ['OBJECTIVE_AND_SUBJECTIVE_HIGH_STRESS']);
    } else if (subjectiveHighStress || objectiveHighStress) {
        addExplanation(explanations, 'psychological_stress', 'moderate', ['rhr', 'hrv'], [subjectiveHighStress ? 'SUBJECTIVE_HIGH_STRESS' : 'GARMIN_HIGH_STRESS']);
    }

    const drinks = health?.alcoholDrinksLast24h;
    if (drinks != null && drinks > 0) {
        const strength: ContextExplanation['strength'] = drinks >= 3 ? 'strong' : drinks === 2 ? 'moderate' : 'weak';
        addExplanation(explanations, 'alcohol', strength, ['rhr', 'hrv'], [`ALCOHOL_${drinks >= 3 ? '3_PLUS' : drinks}`]);
        addExplanation(explanations, 'alcohol', 'weak', ['respiration'], ['ALCOHOL_RECENT']);
    }

    const manualTravel = health?.travelDisruption;
    const authoredTravel = input.structuredContext?.authoredTravelActive === true;
    const disruptiveTravel = manualTravel === 'timezone_shift' || manualTravel === 'late_arrival_or_disrupted_sleep';
    if (disruptiveTravel && objectivePoorSleep) {
        addExplanation(explanations, 'travel_or_jetlag', 'strong', ['rhr', 'hrv'], ['TRAVEL_AND_SLEEP_DISRUPTION']);
        addExplanation(explanations, 'travel_or_jetlag', 'weak', ['respiration'], ['TRAVEL_AND_SLEEP_DISRUPTION']);
    } else if (disruptiveTravel || manualTravel === 'local_or_no_timezone' || authoredTravel) {
        addExplanation(explanations, 'travel_or_jetlag', 'moderate', ['rhr', 'hrv'], [disruptiveTravel ? 'DISRUPTIVE_TRAVEL' : authoredTravel ? 'AUTHORED_TRAVEL' : 'LOCAL_TRAVEL']);
    }

    if (health?.unusualHeatOrSauna === true) {
        addExplanation(explanations, 'heat_or_sauna', 'moderate', ['rhr', 'hrv'], ['UNUSUAL_HEAT_OR_SAUNA']);
    }
    if (health?.dehydrationOrFluidLoss === true) {
        addExplanation(explanations, 'dehydration', 'moderate', ['rhr', 'hrv'], ['DEHYDRATION_OR_FLUID_LOSS']);
    }
    if (health?.unusualHeatOrSauna === true && health.dehydrationOrFluidLoss === true) {
        addExplanation(explanations, 'dehydration', 'strong', ['rhr', 'hrv'], ['HEAT_WITH_FLUID_LOSS']);
    }
    const multiDayConfounderStrength: ContextExplanation['strength'] = priorAdverseDays >= 2
        ? 'moderate'
        : 'strong';
    if (health?.recentVaccination === true) {
        addExplanation(explanations, 'vaccination', multiDayConfounderStrength, ['rhr', 'respiration', 'hrv'], ['RECENT_VACCINATION']);
    }
    if (health?.medicationChange === true) {
        addExplanation(explanations, 'medication_change', multiDayConfounderStrength, ['rhr', 'respiration', 'hrv'], ['MEDICATION_CHANGE']);
    }
    if (health?.otherDisruption && health.otherDisruption.trim().length > 0) {
        // Presence only: free text remains opaque and is never parsed as evaluator evidence.
        addExplanation(explanations, 'other', 'weak', ['rhr', 'hrv'], ['OTHER_DISRUPTION_REPORTED']);
    }

    return explanations;
}

function deriveSupportingSignals(input: HealthAnomalyInput): SupportingSignalEvidence[] {
    const snapshot = input.recoverySnapshot;
    const checkin = input.subjectiveCheckin;
    const health = checkin?.healthContext;
    const derived: SupportingSignalEvidence[] = [
        {
            code: 'GARMIN_SLEEP_SCORE',
            status: snapshot?.raw.sleepScore == null ? 'unavailable' : snapshot.raw.sleepScore < 60 ? 'adverse' : 'normal',
            value: snapshot?.raw.sleepScore ?? null,
        },
        {
            code: 'GARMIN_BODY_BATTERY_WAKE',
            status: snapshot?.raw.bodyBatteryWake == null ? 'unavailable' : snapshot.raw.bodyBatteryWake < 30 ? 'adverse' : 'normal',
            value: snapshot?.raw.bodyBatteryWake ?? null,
        },
        {
            code: 'GARMIN_STRESS_AVG',
            status: snapshot?.raw.stress?.avg == null ? 'unavailable' : snapshot.raw.stress.avg >= 50 ? 'adverse' : 'normal',
            value: snapshot?.raw.stress?.avg ?? null,
        },
        {
            code: 'GARMIN_TRAINING_READINESS',
            status: snapshot?.raw.trainingReadiness?.score == null ? 'unavailable' : snapshot.raw.trainingReadiness.score < 30 ? 'adverse' : 'normal',
            value: snapshot?.raw.trainingReadiness?.score ?? null,
        },
        {
            code: 'CLOSE_SICK_CONTACT',
            status: health?.closeSickContact === true ? 'supportive' : health?.closeSickContact === false ? 'normal' : 'unavailable',
            value: health?.closeSickContact ?? null,
        },
    ];
    const byCode = new Map<string, SupportingSignalEvidence>();
    for (const signal of derived) byCode.set(signal.code, signal);
    for (const signal of input.supportingSignals) byCode.set(signal.code, signal);
    return [...byCode.values()];
}

function strongestCoverage(
    signal: HealthCoreSignal,
    explanations: readonly ContextExplanation[],
): ContextExplanation['strength'] | null {
    let best: ContextExplanation['strength'] | null = null;
    for (const explanation of explanations) {
        if (!explanation.explainsSignals.includes(signal)) continue;
        if (best === null || STRENGTH_RANK[explanation.strength] > STRENGTH_RANK[best]) {
            best = explanation.strength;
        }
    }
    return best;
}

function evidenceLevel(coreSignals: readonly CoreSignalEvidence[]): PhysiologicalAnomalyAssessment['evidenceLevel'] {
    const adverse = coreSignals.filter(isAdverseCoreSignalEvidence);
    if (adverse.length === 0) return 'none';
    const strongCount = adverse.filter(item => item.status === 'strong_anomaly').length;
    if (adverse.length >= 2 && strongCount >= 1) return 'high';
    if (adverse.length >= 2 || strongCount === 1) return 'moderate';
    return 'low';
}

function parseDateDay(date: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return null;
    const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const parsed = new Date(millis);
    if (parsed.toISOString().slice(0, 10) !== date) return null;
    return Math.floor(millis / DAY_MS);
}

function isAdjacentDate(previous: string | null | undefined, current: string): boolean {
    if (!previous) return false;
    const previousDay = parseDateDay(previous);
    const currentDay = parseDateDay(current);
    return previousDay !== null && currentDay !== null && currentDay - previousDay === 1;
}

function episodeMetadata(
    input: HealthAnomalyInput,
    state: PhysiologicalAnomalyAssessment['state'],
): { episodeId: string | null; episodeDay: number | null } {
    if (state === 'normal' || state === 'insufficient_evidence') {
        return { episodeId: null, episodeDay: null };
    }
    const canContinue = input.persistence.previousState !== null
        && input.persistence.previousState !== 'normal'
        && input.persistence.previousState !== 'insufficient_evidence'
        && input.persistence.previousEpisodeId !== null
        && isAdjacentDate(input.persistence.previousAssessmentDate, input.date);
    if (canContinue) {
        return {
            episodeId: input.persistence.previousEpisodeId,
            episodeDay: Math.max(1, input.persistence.previousEpisodeDay ?? 0) + 1,
        };
    }
    return { episodeId: `health-anomaly:${input.date}`, episodeDay: 1 };
}

function resolveCalibrationStage(
    allCoreUnavailable: boolean,
    emergingOnly: boolean,
    personalCalibration: HealthAnomalyInput['personalCalibration'],
): HealthAnomalyCalibrationStage {
    if (allCoreUnavailable) return 'insufficient_evidence';
    if (emergingOnly) return 'emerging_baseline';
    if (personalCalibration?.calibrationEligible === true) return 'outcome_calibrated';
    return 'reliable_baseline';
}

function resolveAnomalySeverity(
    state: PhysiologicalAnomalyState,
    adverseAnomalies: readonly CoreSignalEvidence[],
    symptomsReported: boolean,
    symptomsSeverity: 'mild' | 'moderate' | 'severe' | null,
): HealthAnomalySeverity {
    if (state === 'normal' || state === 'insufficient_evidence') return 'none';
    const strongAdverseCount = adverseAnomalies.filter(item => item.status === 'strong_anomaly').length;
    if (
        state === 'possible_illness_or_systemic_stress'
        || strongAdverseCount >= 2
        || (symptomsReported && symptomsSeverity === 'severe')
    ) {
        return 'strong';
    }
    if (
        strongAdverseCount === 1
        || adverseAnomalies.length >= 2
        || (symptomsReported && symptomsSeverity === 'moderate')
    ) {
        return 'moderate';
    }
    return 'mild';
}

function hasMultiDomainCoverage(signals: readonly CoreSignalEvidence[]): boolean {
    const hasResp = signals.some(item => item.signal === 'respiration');
    const hasAutonomic = signals.some(item => item.signal === 'rhr' || item.signal === 'hrv');
    return hasResp && hasAutonomic;
}

function resolveEvidenceQuality(
    allCoreUnavailable: boolean,
    calibrationStage: HealthAnomalyCalibrationStage,
    coreSignals: readonly CoreSignalEvidence[],
    adverseAnomalies: readonly CoreSignalEvidence[],
    unexplained: readonly CoreSignalEvidence[],
): HealthAnomalyEvidenceQuality {
    if (allCoreUnavailable) return 'insufficient';
    if (calibrationStage === 'emerging_baseline') return 'emerging';

    const target = unexplained.length > 0
        ? unexplained
        : adverseAnomalies.length > 0
            ? adverseAnomalies
            : coreSignals.filter(item => item.status !== 'unavailable');
    if (hasMultiDomainCoverage(target)) return 'multi_domain_corroborated';
    if (target.length >= 2) return 'correlated_autonomic_only';
    return 'single_channel';
}

const NON_DIAGNOSTIC_NOTICE =
    'Wearable recovery indicators reflect personal baseline comparisons for training planning only and are not a medical determination or clinical evaluation; seek healthcare guidance if you feel unwell.';

const IOC_RED_FLAG_WARNINGS: readonly string[] = [
    'Stop exercise and seek medical evaluation promptly if you notice fever, chills, chest pain or tightness, shortness of breath at rest or minimal effort, racing resting pulse, dizziness, or rapidly worsening symptoms.',
    'Do not train through below-the-neck warning signs such as persistent cough, wheezing, chest discomfort, or marked fatigue with routine daily tasks.',
];

const THREE_STAGE_RETURN_TO_SPORT_GUIDANCE: readonly string[] = [
    'Stage 1 (Symptom rest): Pause structured workouts while systemic symptoms remain active; prioritize sleep, fluids, and gentle daily movement only if comfortable.',
    'Stage 2 (Easy re-entry): Once systemic symptoms have resolved and resting markers settle for 24-48 hours, test a brief easy aerobic session and verify next-morning recovery.',
    'Stage 3 (Progressive build): Rebuild normal aerobic volume before reintroducing high-intensity intervals only after consecutive stable recovery mornings.',
];

export interface BuildEarlyResponseProtocolInput {
    state: PhysiologicalAnomalyState;
    unexplainedPersistenceDays: number;
    anomalySeverity: HealthAnomalySeverity;
    evidenceQuality: HealthAnomalyEvidenceQuality;
    calibrationStage: HealthAnomalyCalibrationStage;
    respirationStatus?: CoreSignalEvidence['status'];
}

/**
 * Pure builder mapping an anomaly assessment into graduated non-clinical athlete guidance.
 */
export function buildEarlyResponseProtocol(
    input: BuildEarlyResponseProtocolInput,
): EarlyResponseProtocol {
    if (input.state === 'symptoms_reported') {
        return {
            level: 'level_3_symptoms_reported',
            headline: 'Symptoms logged — prioritize recovery and rest',
            summary: 'Active wellness symptoms were reported in your check-in. Pause hard training today, support sleep and hydration, and follow warning-sign precautions before resuming structured load.',
            actions: [
                'Replace structured or intense sessions with complete rest or very light mobility if comfortable.',
                'Prioritize extended sleep, regular fluids, and nutrition while monitoring how symptoms change.',
                'Re-check resting heart rate, breathing rate, and wellness symptoms tomorrow morning.',
            ],
            reassessTiming: 'Daily morning symptom and wearable check until symptom-free and baseline-settled for 24-48 hours.',
            nonDiagnosticNotice: NON_DIAGNOSTIC_NOTICE,
            redFlagWarnings: [...IOC_RED_FLAG_WARNINGS],
            returnToSportGuidance: [...THREE_STAGE_RETURN_TO_SPORT_GUIDANCE],
            followupPromptEligible: true,
        };
    }

    if (input.state === 'possible_illness_or_systemic_stress') {
        const persistentPhrase = input.unexplainedPersistenceDays > 1
            ? 'Consecutive unexplained shifts across'
            : 'Corroborated multi-domain shifts across';
        return {
            level: 'level_2_persistent_or_corroborated',
            headline: 'Multi-domain or persistent physiological strain detected',
            summary: `${persistentPhrase} your recovery channels sit well outside baseline without an explanatory training or lifestyle note.`,
            actions: [
                'Reduce today\'s training load to an easy recovery day or unscheduled rest day.',
                'Log a quick symptom check-in so early wellness notes stay paired with wearable metrics.',
                'Prioritize sleep and hydration, and defer high-intensity intervals until markers settle.',
            ],
            reassessTiming: 'Re-evaluate after tonight\'s sleep and morning check-in within 24 hours.',
            nonDiagnosticNotice: NON_DIAGNOSTIC_NOTICE,
            redFlagWarnings: [...IOC_RED_FLAG_WARNINGS],
            returnToSportGuidance: input.anomalySeverity === 'strong'
                ? [THREE_STAGE_RETURN_TO_SPORT_GUIDANCE[0]!, THREE_STAGE_RETURN_TO_SPORT_GUIDANCE[1]!]
                : [THREE_STAGE_RETURN_TO_SPORT_GUIDANCE[1]!],
            followupPromptEligible: true,
        };
    }

    if (input.state === 'watch_unexplained') {
        const baselineCaveat = input.calibrationStage === 'emerging_baseline'
            ? ' Your wearable baseline is still maturing (7-13 nights), so treat this early shift cautiously.'
            : input.evidenceQuality === 'correlated_autonomic_only'
                ? (input.respirationStatus === 'unavailable'
                    ? ' Both autonomic markers shifted together while breathing rate was unavailable.'
                    : ' Both autonomic markers shifted together while breathing rate remained normal.')
                : '';
        return {
            level: 'level_1_early_watch',
            headline: 'Early unexplained physiological shift — monitor recovery',
            summary: `One or more overnight recovery markers deviated from baseline without a strong training or lifestyle explanation.${baselineCaveat}`,
            actions: [
                'Note any late meal, alcohol, travel, poor sleep, or early wellness changes in today\'s check-in.',
                'Favor steady aerobic pacing and adjust hard intervals downward if perceived effort feels elevated.',
                'Verify whether tomorrow\'s overnight wearable signals return toward baseline.',
            ],
            reassessTiming: 'Re-check tomorrow morning after one full sleep cycle.',
            nonDiagnosticNotice: NON_DIAGNOSTIC_NOTICE,
            redFlagWarnings: [],
            returnToSportGuidance: [],
            followupPromptEligible: true,
        };
    }

    if (input.state === 'insufficient_evidence') {
        return {
            level: 'none',
            headline: 'Insufficient wearable history for baseline comparison',
            summary: 'Overnight baseline coverage or current core signals are not yet complete enough to evaluate physiological strain.',
            actions: [],
            reassessTiming: 'Comparisons activate automatically once at least 7-14 recent baseline nights are recorded.',
            nonDiagnosticNotice: NON_DIAGNOSTIC_NOTICE,
            redFlagWarnings: [],
            returnToSportGuidance: [],
            followupPromptEligible: false,
        };
    }

    if (input.state === 'explained_recovery_strain') {
        return {
            level: 'none',
            headline: 'Physiological strain matches logged recovery context',
            summary: 'Overnight markers reflect transient strain aligned with recent training load or logged context rather than unexplained systemic stress.',
            actions: [],
            reassessTiming: 'Routine morning check tomorrow.',
            nonDiagnosticNotice: NON_DIAGNOSTIC_NOTICE,
            redFlagWarnings: [],
            returnToSportGuidance: [],
            followupPromptEligible: false,
        };
    }

    return {
        level: 'none',
        headline: 'Recovery signals are within normal baseline range',
        summary: 'Measured resting heart rate, breathing rate, and overnight HRV remain aligned with your personal baseline.',
        actions: [],
        reassessTiming: 'Routine morning check.',
        nonDiagnosticNotice: NON_DIAGNOSTIC_NOTICE,
        redFlagWarnings: [],
        returnToSportGuidance: [],
        followupPromptEligible: false,
    };
}

function rationaleFacts(
    coreSignals: readonly CoreSignalEvidence[],
    persistenceDays: number,
    symptomsReported: boolean,
    supportingSignals: readonly SupportingSignalEvidence[],
): HealthAnomalyRationaleFact[] {
    const facts: HealthAnomalyRationaleFact[] = [];
    for (const evidence of coreSignals) {
        if (!isAnomaly(evidence)) continue;
        facts.push({
            code: `${evidence.signal.toUpperCase()}_${evidence.direction === 'two_sided' ? 'OUTSIDE_RANGE' : evidence.direction === 'low' ? 'BELOW_BASELINE' : 'ABOVE_BASELINE'}`,
            value: evidence.standardizedDeviation,
            unit: 'baseline_scale',
        });
    }
    if (persistenceDays > 1) facts.push({ code: 'PERSISTENCE', value: persistenceDays, unit: 'days' });
    if (symptomsReported) facts.push({ code: 'SYMPTOMS_REPORTED', value: true });
    if (supportingSignals.some(item => item.code === 'CLOSE_SICK_CONTACT' && item.status === 'supportive')) {
        facts.push({ code: 'CLOSE_SICK_CONTACT', value: true });
    }
    return facts;
}

/**
 * HA3 pure evaluator. Supporting Garmin composites never increase evidence level or satisfy the
 * multi-signal requirement; only adverse core channels can do that. Context qualifies the
 * interpretation of observed physiology but never deletes the abnormal measurement or resets
 * its consecutive physiological persistence.
 */
export function evaluatePhysiologicalAnomaly(
    input: HealthAnomalyInput,
    policy: HealthAnomalyPolicy = 'off',
    thresholds: HealthAnomalyThresholdPolicy = SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
): PhysiologicalAnomalyAssessment | null {
    if (policy === 'off' || !isHealthAnomalyThresholdPolicy(thresholds)) return null;

    const categorized = CORE_SIGNALS.map(signal => categorizeSignal(input, signal, thresholds));
    const rawCoreSignals = categorized.map(item => item.evidence);
    const dataQuality = CORE_SIGNALS
        .map(signal => qualityForSignal(input, signal, featuresForSignal(input, signal)))
        .filter((quality): quality is CoreSignalDataQuality => quality !== null);
    const respirationQuality = dataQuality.find(quality => quality.signal === 'respiration');
    const respirationElevation = evaluateRespirationElevation({
        targetDate: input.date,
        measurementDate: input.recoverySnapshot?.source.metricDates?.sleep ?? null,
        timezone: input.timezone,
        currentValue: input.recoverySnapshot?.raw.respirationAvg ?? null,
        baseline7dValue: input.recoverySnapshot?.derived.respiration7dAvg ?? null,
        baseline28dValue: input.recoverySnapshot?.derived.respiration28dAvg ?? null,
        baselineVersion: input.recoverySnapshot?.derived.baselineComputationVersion ?? null,
        historyCount: respirationQuality?.historyCount ?? 0,
        recentDayCoverage: respirationQuality?.recentDayCoverage ?? 0,
        measurementEligible: (input.recoverySnapshot?.source.sourceSchemaVersion ?? 0) >= 3
            && input.recoverySnapshot?.source.timezone === 'Europe/Warsaw',
    });

    const coreSignals = rawCoreSignals.map((evidence) => {
        if (
            evidence.signal === 'respiration'
            && thresholds.downgradeResolvingRespiration === true
            && respirationElevation.status === 'resolving'
            && isAdverseCoreSignalEvidence(evidence)
        ) {
            return {
                ...evidence,
                status: 'normal' as const,
                direction: null,
            };
        }
        return evidence;
    });

    const emergingBySignal = new Map<HealthCoreSignal, boolean>(
        categorized.map(item => [item.evidence.signal, item.usedEmergingBaseline]),
    );
    const availableSignals = coreSignals.filter(evidence => evidence.status !== 'unavailable');
    const adverseSignals = coreSignals.filter(isAdverseCoreSignalEvidence);
    const allCoreUnavailable = availableSignals.length === 0;
    const stageCandidateSignals = adverseSignals.length > 0 ? adverseSignals : availableSignals;
    const anyEmergingCandidate = stageCandidateSignals.some(evidence => emergingBySignal.get(evidence.signal) === true);
    const anyReliableCandidate = stageCandidateSignals.some(evidence => emergingBySignal.get(evidence.signal) !== true);
    const calibrationStage = resolveCalibrationStage(
        allCoreUnavailable,
        anyEmergingCandidate && !anyReliableCandidate,
        input.personalCalibration,
    );

    const priorDaysAreContiguous = isAdjacentDate(input.persistence.previousAssessmentDate, input.date);
    const priorAdverseDays = priorDaysAreContiguous
        && Number.isFinite(input.persistence.unexplainedPersistenceDays)
        ? Math.max(0, Math.floor(input.persistence.unexplainedPersistenceDays))
        : 0;
    const rawPriorUnexplained = input.persistence.priorUnexplainedDays !== undefined
        ? input.persistence.priorUnexplainedDays
        : (input.persistence.previousState === 'explained_recovery_strain'
            ? 0
            : input.persistence.unexplainedPersistenceDays);
    const priorUnexplainedDays = priorDaysAreContiguous && Number.isFinite(rawPriorUnexplained)
        ? Math.max(0, Math.floor(rawPriorUnexplained))
        : 0;

    const supportingSignals = deriveSupportingSignals(input);
    const explanations = resolveExplanations(input, priorAdverseDays);
    const adverseAnomalies = coreSignals.filter(isAdverseCoreSignalEvidence);
    const unexplained = adverseAnomalies.filter(
        evidence => strongestCoverage(evidence.signal, explanations) !== 'strong',
    );
    const unexplainedEvidence = unexplained.map(
        evidence => `${evidence.signal}:${evidence.status}:${evidence.direction ?? 'unknown'}`,
    );
    const symptomsReported = input.subjectiveCheckin?.healthContext?.symptoms?.present === true
        || input.subjectiveCheckin?.illnessSymptoms === true;
    const persistenceDays = adverseAnomalies.length > 0 ? priorAdverseDays + 1 : 0;
    const unexplainedPersistenceDays = unexplained.length > 0 ? priorUnexplainedDays + 1 : 0;

    const reliableUnexplained = unexplained.filter(item => emergingBySignal.get(item.signal) !== true);
    const multiSignalPersistentEscalation = reliableUnexplained.length >= thresholds.minimumCoreSignalsForMultiSignal
        && unexplainedPersistenceDays >= thresholds.persistenceDaysForEscalation;
    const hasUnexplainedResp = reliableUnexplained.some(item => item.signal === 'respiration');
    const hasUnexplainedAutonomic = reliableUnexplained.some(item => item.signal === 'rhr' || item.signal === 'hrv');
    const strongUnexplainedCount = reliableUnexplained.filter(item => item.status === 'strong_anomaly').length;
    const closeSickContact = input.subjectiveCheckin?.healthContext?.closeSickContact === true;
    const firstNightMultiDomainEscalation = thresholds.allowFirstNightMultiDomainEscalation === true
        && unexplainedPersistenceDays === 1
        && hasUnexplainedResp
        && hasUnexplainedAutonomic
        && (
            (reliableUnexplained.length === 3 && strongUnexplainedCount >= 1)
            || strongUnexplainedCount >= 2
            || (strongUnexplainedCount >= 1 && closeSickContact)
        );

    let state: PhysiologicalAnomalyState;
    if (symptomsReported) {
        state = 'symptoms_reported';
    } else if (allCoreUnavailable) {
        state = 'insufficient_evidence';
    } else if (adverseAnomalies.length === 0) {
        state = 'normal';
    } else if (unexplained.length === 0) {
        state = 'explained_recovery_strain';
    } else if (
        calibrationStage !== 'emerging_baseline'
        && (multiSignalPersistentEscalation || firstNightMultiDomainEscalation)
    ) {
        state = 'possible_illness_or_systemic_stress';
    } else {
        state = 'watch_unexplained';
    }

    const anomalySeverity = resolveAnomalySeverity(
        state,
        adverseAnomalies,
        symptomsReported,
        input.subjectiveCheckin?.healthContext?.symptoms?.severity ?? null,
    );
    const evidenceQuality = resolveEvidenceQuality(
        allCoreUnavailable,
        calibrationStage,
        coreSignals,
        adverseAnomalies,
        unexplained,
    );
    const earlyResponse = buildEarlyResponseProtocol({
        state,
        unexplainedPersistenceDays,
        anomalySeverity,
        evidenceQuality,
        calibrationStage,
        respirationStatus: respirationQuality?.currentValueMissing ? 'unavailable' : coreSignals.find(signal => signal.signal === 'respiration')?.status,
    });
    const episode = episodeMetadata(input, state);

    const cautions: string[] = [];
    if (state === 'insufficient_evidence') {
        cautions.push('INSUFFICIENT_WEARABLE_BASELINE_OR_SIGNALS');
    }
    if (calibrationStage === 'emerging_baseline') {
        cautions.push('EMERGING_BASELINE_CAUTIOUS_INTERPRETATION');
    }
    if (state !== 'normal') {
        cautions.push('NOT_A_DIAGNOSIS');
    }

    return {
        state,
        evidenceLevel: evidenceLevel(coreSignals),
        coreSignals,
        supportingSignals,
        explanations,
        unexplainedEvidence,
        persistenceDays,
        unexplainedPersistenceDays,
        episodeId: episode.episodeId,
        episodeDay: episode.episodeDay,
        dataQuality,
        rationale: {
            facts: [
                ...rationaleFacts(coreSignals, persistenceDays, symptomsReported, supportingSignals),
                ...(respirationElevation.status === 'elevated' || respirationElevation.status === 'strongly_elevated'
                    ? [{
                        code: respirationElevation.status === 'strongly_elevated'
                            ? 'RESPIRATION_STRONGLY_ELEVATED'
                            : 'RESPIRATION_ELEVATED',
                        value: respirationElevation.deltaVs28d,
                        unit: 'breaths/min above 28d median',
                    }]
                    : []),
                ...(respirationElevation.status === 'resolving'
                    ? [{ code: 'RESPIRATION_RESOLVING', value: respirationElevation.deltaVs7d, unit: 'breaths/min vs 7d median' }]
                    : []),
            ],
            explanations: explanations.map(explanation => explanation.kind.toUpperCase()),
            cautions,
        },
        respirationElevation,
        calibrationStage,
        anomalySeverity,
        evidenceQuality,
        earlyResponse,
        activityMatchedExpectations: input.features?.activityMatchedExpectations ?? [],
        personalCalibration: input.personalCalibration ?? null,
        policyVersion: HEALTH_ANOMALY_POLICY_VERSION,
        thresholdPolicyVersion: thresholds.policyVersion,
        mode: policy,
    };
}
