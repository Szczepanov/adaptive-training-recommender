import {
    HEALTH_ANOMALY_POLICIES,
    type ContextExplanation,
    type CoreSignalDataQuality,
    type CoreSignalEvidence,
    type HealthAnomalyInput,
    type HealthAnomalyPolicy,
    type HealthAnomalyRationaleFact,
    type HealthAnomalyThresholdPolicy,
    type HealthCoreSignal,
    type HealthCoreSignalFeatures,
    type PhysiologicalAnomalyAssessment,
    type SupportingSignalEvidence,
} from './healthAnomalyModels';

export const HEALTH_ANOMALY_POLICY_VERSION = 'health-anomaly/ha3-v1';

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

function categorizeSignal(
    input: HealthAnomalyInput,
    signal: HealthCoreSignal,
    thresholds: HealthAnomalyThresholdPolicy,
): CoreSignalEvidence {
    const feature = featuresForSignal(input, signal);
    if (!feature) {
        return input.coreSignals.find(item => item.signal === signal) ?? unavailableEvidence(signal);
    }

    const candidate = feature.candidates.find(
        item => item.estimator === thresholds.estimatorBySignal[signal],
    );
    const quality = qualityForSignal(input, signal, feature);
    if (
        !candidate
        || candidate.status !== 'available'
        || candidate.standardizedDeviation === null
        || !Number.isFinite(candidate.standardizedDeviation)
        || !quality
        || quality.currentValueMissing
        || quality.historyCount < thresholds.minimumHistoryCount
        || quality.recentDayCoverage < thresholds.minimumRecentDayCoverage
        || quality.baselineAgeDays === null
        || quality.baselineAgeDays > thresholds.maxBaselineAgeDays
    ) {
        return {
            ...unavailableEvidence(signal),
            currentValue: candidate?.currentValue ?? null,
            baselineValue: candidate?.baselineValue ?? null,
            scaleValue: candidate?.scaleValue ?? null,
            estimator: candidate?.estimator ?? null,
            baselineVersion: candidate?.baselineVersion ?? null,
        };
    }

    const deviation = candidate.standardizedDeviation;
    let status: CoreSignalEvidence['status'] = 'normal';
    let direction: CoreSignalEvidence['direction'] = null;

    if (signal === 'rhr' || signal === 'respiration') {
        if (deviation >= thresholds.strongDeviation) {
            status = 'strong_anomaly';
            direction = 'high';
        } else if (deviation >= thresholds.moderateDeviation) {
            status = 'moderate_anomaly';
            direction = 'high';
        }
    } else if (deviation <= -thresholds.strongDeviation) {
        status = 'strong_anomaly';
        direction = 'low';
    } else if (deviation <= -thresholds.moderateDeviation) {
        status = 'moderate_anomaly';
        direction = 'low';
    } else if (deviation >= thresholds.strongDeviation) {
        // Retain unusually-high HRV as out-of-range telemetry without treating it as an
        // adverse illness vote. isAdverseEvidence deliberately excludes two_sided HRV.
        status = 'strong_anomaly';
        direction = 'two_sided';
    } else if (deviation >= thresholds.moderateDeviation) {
        status = 'moderate_anomaly';
        direction = 'two_sided';
    }

    return {
        signal,
        status,
        direction,
        currentValue: candidate.currentValue,
        baselineValue: candidate.baselineValue,
        scaleValue: candidate.scaleValue,
        standardizedDeviation: deviation,
        estimator: candidate.estimator,
        baselineVersion: candidate.baselineVersion,
    };
}

function isAnomaly(evidence: CoreSignalEvidence): boolean {
    return evidence.status === 'moderate_anomaly' || evidence.status === 'strong_anomaly';
}

function isAdverseEvidence(evidence: CoreSignalEvidence): boolean {
    if (!isAnomaly(evidence)) return false;
    if (evidence.signal === 'hrv') return evidence.direction === 'low';
    return evidence.direction === 'high';
}

function hasHardTraining(snapshot: HealthAnomalyInput['recoverySnapshot']): boolean {
    const raw = snapshot?.raw;
    return !!raw && (
        (raw.yesterdayTraining?.hardActivityCount ?? 0) > 0
        || raw.yesterdayTraining?.primaryActivity?.intensityTag === 'hard'
        || (raw.todayTraining?.hardActivityCount ?? 0) > 0
        || raw.todayTraining?.primaryActivity?.intensityTag === 'hard'
    );
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

function resolveExplanations(input: HealthAnomalyInput): ContextExplanation[] {
    const explanations: ContextExplanation[] = [];
    const snapshot = input.recoverySnapshot;
    const checkin = input.subjectiveCheckin;
    const health = checkin?.healthContext;
    const immediateHardTraining = hasHardTraining(snapshot);

    if (immediateHardTraining) {
        addExplanation(explanations, 'hard_training', 'strong', ['rhr', 'hrv'], ['RECENT_HARD_SESSION']);
        addExplanation(explanations, 'hard_training', 'weak', ['respiration'], ['RECENT_HARD_SESSION']);
    } else if (input.last3DaysHardSessionsCount > 0) {
        addExplanation(explanations, 'hard_training', 'moderate', ['rhr', 'hrv'], ['HARD_SESSION_WITHIN_3D']);
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
    if (health?.recentVaccination === true) {
        addExplanation(explanations, 'vaccination', 'strong', ['rhr', 'respiration', 'hrv'], ['RECENT_VACCINATION']);
    }
    if (health?.medicationChange === true) {
        addExplanation(explanations, 'medication_change', 'strong', ['rhr', 'respiration', 'hrv'], ['MEDICATION_CHANGE']);
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
        {
            code: 'SUBJECTIVE_RHR_HIGHER',
            status: health?.subjectiveRhrHigher === true ? 'supportive' : health?.subjectiveRhrHigher === false ? 'normal' : 'unavailable',
            value: health?.subjectiveRhrHigher ?? null,
        },
        {
            code: 'SUBJECTIVE_HRV_LOWER',
            status: health?.subjectiveHrvLower === true ? 'supportive' : health?.subjectiveHrvLower === false ? 'normal' : 'unavailable',
            value: health?.subjectiveHrvLower ?? null,
        },
        {
            code: 'SUBJECTIVE_RESPIRATION_HIGHER',
            status: health?.subjectiveRespirationHigher === true ? 'supportive' : health?.subjectiveRespirationHigher === false ? 'normal' : 'unavailable',
            value: health?.subjectiveRespirationHigher ?? null,
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
    const adverse = coreSignals.filter(isAdverseEvidence);
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
    if (state === 'normal') return { episodeId: null, episodeDay: null };
    const canContinue = input.persistence.previousState !== null
        && input.persistence.previousState !== 'normal'
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
 * multi-signal requirement; only adverse core channels can do that. Context explains observed
 * physiology but never deletes it from the trace.
 */
export function evaluatePhysiologicalAnomaly(
    input: HealthAnomalyInput,
    policy: HealthAnomalyPolicy = 'off',
    thresholds: HealthAnomalyThresholdPolicy = SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
): PhysiologicalAnomalyAssessment | null {
    if (policy === 'off' || !isHealthAnomalyThresholdPolicy(thresholds)) return null;

    const coreSignals = CORE_SIGNALS.map(signal => categorizeSignal(input, signal, thresholds));
    const dataQuality = CORE_SIGNALS
        .map(signal => qualityForSignal(input, signal, featuresForSignal(input, signal)))
        .filter((quality): quality is CoreSignalDataQuality => quality !== null);
    const supportingSignals = deriveSupportingSignals(input);
    const explanations = resolveExplanations(input);
    const adverseAnomalies = coreSignals.filter(isAdverseEvidence);
    const unexplained = adverseAnomalies.filter(
        evidence => strongestCoverage(evidence.signal, explanations) !== 'strong',
    );
    const unexplainedEvidence = unexplained.map(
        evidence => `${evidence.signal}:${evidence.status}:${evidence.direction ?? 'unknown'}`,
    );
    const symptomsReported = input.subjectiveCheckin?.healthContext?.symptoms?.present === true
        || input.subjectiveCheckin?.illnessSymptoms === true;
    const priorDaysAreContiguous = isAdjacentDate(input.persistence.previousAssessmentDate, input.date);
    const priorUnexplainedDays = priorDaysAreContiguous
        && Number.isFinite(input.persistence.unexplainedPersistenceDays)
        ? Math.max(0, Math.floor(input.persistence.unexplainedPersistenceDays))
        : 0;
    const persistenceDays = unexplained.length > 0
        ? priorUnexplainedDays + 1
        : 0;

    let state: PhysiologicalAnomalyAssessment['state'];
    if (symptomsReported) {
        state = 'symptoms_reported';
    } else if (adverseAnomalies.length === 0) {
        state = 'normal';
    } else if (unexplained.length === 0) {
        state = 'explained_recovery_strain';
    } else if (
        unexplained.length >= thresholds.minimumCoreSignalsForMultiSignal
        && persistenceDays >= thresholds.persistenceDaysForEscalation
    ) {
        state = 'possible_illness_or_systemic_stress';
    } else {
        state = 'watch_unexplained';
    }

    const episode = episodeMetadata(input, state);
    return {
        state,
        evidenceLevel: evidenceLevel(coreSignals),
        coreSignals,
        supportingSignals,
        explanations,
        unexplainedEvidence,
        persistenceDays,
        episodeId: episode.episodeId,
        episodeDay: episode.episodeDay,
        dataQuality,
        rationale: {
            facts: rationaleFacts(coreSignals, persistenceDays, symptomsReported, supportingSignals),
            explanations: explanations.map(explanation => explanation.kind.toUpperCase()),
            cautions: state === 'normal' ? [] : ['NOT_A_DIAGNOSIS'],
        },
        policyVersion: HEALTH_ANOMALY_POLICY_VERSION,
        thresholdPolicyVersion: thresholds.policyVersion,
        mode: policy,
    };
}
