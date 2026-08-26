import type {
    DailyDecisionInput,
    DailyRecommendation,
    DailyRecoverySnapshot,
    Recommendation,
} from './models';

export interface DayOverDayDeltas {
    hasYesterdayData: boolean;
    sleepScoreDelta: number | null;
    sleepScoreToday: number | null;
    sleepScoreYesterday: number | null;
    hrvToday: number | null;
    hrvYesterday: number | null;
    hrvDeltaYesterday: number | null;
    hrvDeltaBaseline: number | null;
    restingHrToday: number | null;
    restingHrYesterday: number | null;
    restingHrDelta: number | null;
    bodyBatteryToday: number | null;
    bodyBatteryYesterday: number | null;
    bodyBatteryDelta: number | null;
    modeYesterday: DailyRecommendation['mode'] | null;
    modeToday: Recommendation['mode'];
    summaryText: string;
}

export interface RankedEvidenceItem {
    id: string;
    title: string;
    description: string;
    impact: 'positive' | 'cautious' | 'restricting';
    category: 'recovery' | 'stimulus' | 'periodization' | 'safety';
    weightBadge: string;
}

export interface HardSafetyGate {
    id: string;
    name: string;
    active: boolean;
    reason: string;
    severity: 'blocking' | 'caution' | 'clear';
}

export interface SoftOptimizationFactor {
    id: string;
    name: string;
    description: string;
    category: 'stimulus' | 'periodization' | 'preference' | 'overload';
}

export interface DecisionBoundaryState {
    hardGatesActiveCount: number;
    harderAdjustmentAllowed: boolean;
    hardGates: HardSafetyGate[];
    softOptimizations: SoftOptimizationFactor[];
    summary: string;
}

export interface InvalidationTrigger {
    id: string;
    icon: string;
    trigger: string;
    action: string;
    alternativeActionId?: string;
}

export interface DataConfidenceRating {
    tier: 'high' | 'moderate' | 'low';
    label: string;
    badgeClass: string;
    uncertaintyStatement: string;
    reasons: string[];
}

export interface MorningDecisionEvidence {
    deltas: DayOverDayDeltas;
    rankedEvidence: RankedEvidenceItem[];
    boundaries: DecisionBoundaryState;
    invalidationTriggers: InvalidationTrigger[];
    confidence: DataConfidenceRating;
    executiveSummary: string;
}

function signed(val: number | null, unit = ''): string {
    if (val === null || !Number.isFinite(val)) return '—';
    const rounded = Math.round(val * 10) / 10;
    const prefix = rounded > 0 ? `+${rounded}` : `${rounded}`;
    return unit ? `${prefix} ${unit}` : prefix;
}

export function computeDayOverDayDeltas(
    todaySnapshot: DailyRecoverySnapshot | null,
    yesterdaySnapshot: DailyRecoverySnapshot | null,
    todayMode: Recommendation['mode'],
    yesterdayRec: DailyRecommendation | null,
): DayOverDayDeltas {
    if (!todaySnapshot) {
        return {
            hasYesterdayData: false,
            sleepScoreDelta: null,
            sleepScoreToday: null,
            sleepScoreYesterday: null,
            hrvToday: null,
            hrvYesterday: null,
            hrvDeltaYesterday: null,
            hrvDeltaBaseline: null,
            restingHrToday: null,
            restingHrYesterday: null,
            restingHrDelta: null,
            bodyBatteryToday: null,
            bodyBatteryYesterday: null,
            bodyBatteryDelta: null,
            modeYesterday: yesterdayRec?.mode ?? null,
            modeToday: todayMode,
            summaryText: 'Waiting for Garmin recovery data to compute day-over-day changes.',
        };
    }

    const sToday = todaySnapshot.raw;
    const sYest = yesterdaySnapshot?.raw;

    const sleepScoreToday = sToday.sleepScore ?? null;
    const sleepScoreYesterday = sYest?.sleepScore ?? null;
    const sleepScoreDelta = sleepScoreToday != null && sleepScoreYesterday != null
        ? sleepScoreToday - sleepScoreYesterday
        : null;

    const hrvToday = sToday.hrvOvernightAvg ?? null;
    const hrvYesterday = sYest?.hrvOvernightAvg ?? null;
    const hrvDeltaYesterday = hrvToday != null && hrvYesterday != null
        ? hrvToday - hrvYesterday
        : null;

    const hrvBaseline = todaySnapshot.derived?.hrv28dAvg ?? null;
    const hrvDeltaBaseline = hrvToday != null && hrvBaseline != null
        ? hrvToday - hrvBaseline
        : null;

    const restingHrToday = sToday.restingHr ?? null;
    const restingHrYesterday = sYest?.restingHr ?? null;
    const restingHrDelta = restingHrToday != null && restingHrYesterday != null
        ? restingHrToday - restingHrYesterday
        : null;

    const bodyBatteryToday = sToday.bodyBatteryWake ?? null;
    const bodyBatteryYesterday = sYest?.bodyBatteryWake ?? null;
    const bodyBatteryDelta = bodyBatteryToday != null && bodyBatteryYesterday != null
        ? bodyBatteryToday - bodyBatteryYesterday
        : null;

    const phrases: string[] = [];
    if (hrvDeltaYesterday !== null) {
        if (hrvDeltaYesterday >= 4) {
            phrases.push(`HRV increased (${signed(hrvDeltaYesterday, 'ms')})`);
        } else if (hrvDeltaYesterday <= -5) {
            phrases.push(`HRV decreased (${signed(hrvDeltaYesterday, 'ms')})`);
        } else {
            phrases.push(`HRV remained stable (${signed(hrvDeltaYesterday, 'ms')})`);
        }
    }

    if (sleepScoreDelta !== null) {
        if (sleepScoreDelta >= 5) {
            phrases.push(`sleep score improved (${signed(sleepScoreDelta)} pts)`);
        } else if (sleepScoreDelta <= -5) {
            phrases.push(`sleep score decreased (${signed(sleepScoreDelta)} pts)`);
        }
    }

    if (restingHrDelta !== null && Math.abs(restingHrDelta) >= 3) {
        phrases.push(`resting HR is ${restingHrDelta > 0 ? 'higher' : 'lower'} (${signed(restingHrDelta, 'bpm')})`);
    }

    let summaryText: string;
    if (!yesterdaySnapshot) {
        summaryText = hrvDeltaBaseline !== null
            ? `No comparable prior-day snapshot is available. Today's HRV is ${signed(hrvDeltaBaseline, 'ms')} versus the 28-day mean.`
            : 'No comparable prior-day snapshot is available; showing today’s signals without day-over-day claims.';
    } else if (phrases.length > 0) {
        summaryText = `Since yesterday: ${phrases.join(', ')}.`;
    } else {
        summaryText = 'Comparable day-over-day signals show only small changes.';
    }

    return {
        hasYesterdayData: !!yesterdaySnapshot,
        sleepScoreDelta,
        sleepScoreToday,
        sleepScoreYesterday,
        hrvToday,
        hrvYesterday,
        hrvDeltaYesterday,
        hrvDeltaBaseline,
        restingHrToday,
        restingHrYesterday,
        restingHrDelta,
        bodyBatteryToday,
        bodyBatteryYesterday,
        bodyBatteryDelta,
        modeYesterday: yesterdayRec?.mode ?? null,
        modeToday: todayMode,
        summaryText,
    };
}

export function computeRankedEvidence(
    recommendation: Recommendation | null,
    input: DailyDecisionInput | null,
    deltas: DayOverDayDeltas,
): RankedEvidenceItem[] {
    const items: RankedEvidenceItem[] = [];

    if (!recommendation || !input) return items;

    const hrvVal = deltas.hrvToday;
    const hrvBaseDelta = deltas.hrvDeltaBaseline;
    if (hrvVal !== null) {
        if (hrvBaseDelta !== null && hrvBaseDelta >= 2) {
            items.push({
                id: 'hrv-recovery',
                title: 'Overnight HRV Signal',
                description: `Overnight HRV is ${hrvVal} ms (${signed(hrvBaseDelta, 'ms')} vs 28d mean), a favorable recovery signal when interpreted with the other inputs.`,
                impact: 'positive',
                category: 'recovery',
                weightBadge: 'Primary Driver',
            });
        } else if (hrvBaseDelta !== null && hrvBaseDelta <= -4) {
            items.push({
                id: 'hrv-depression',
                title: 'Lower Overnight HRV Signal',
                description: `Overnight HRV is ${hrvVal} ms (${signed(hrvBaseDelta, 'ms')} vs 28d mean), a cautious recovery signal that should be interpreted with the other inputs.`,
                impact: 'cautious',
                category: 'recovery',
                weightBadge: 'Primary Driver',
            });
        } else {
            items.push({
                id: 'hrv-stable',
                title: 'Stable Overnight HRV Signal',
                description: `Overnight HRV (${hrvVal} ms) is close to the available 28-day mean.`,
                impact: 'positive',
                category: 'recovery',
                weightBadge: 'Moderate Impact',
            });
        }
    }

    const checkin = input.subjectiveCheckin;
    const soreness = checkin?.soreness ?? 0;
    const safetyEnv = recommendation.envelopes?.safety;
    const clinicalFlag = safetyEnv?.clinicalFlagActive ?? false;
    const restrictedModalities = safetyEnv?.restrictedModalities ?? [];
    if (clinicalFlag || restrictedModalities.length > 0) {
        items.push({
            id: 'tissue-load-protection',
            title: 'Musculoskeletal Safety Protection',
            description: clinicalFlag
                ? 'The engine safety envelope contains an active clinical restriction, so higher-risk loading remains constrained.'
                : `The engine safety envelope restricts: ${restrictedModalities.join(', ')}.`,
            impact: 'restricting',
            category: 'safety',
            weightBadge: 'Hard Gate',
        });
    } else if (soreness >= 3) {
        items.push({
            id: 'soreness-context',
            title: 'Reported Soreness',
            description: `Morning soreness is ${soreness}/10. This is a caution signal, not by itself an engine hard gate.`,
            impact: 'cautious',
            category: 'recovery',
            weightBadge: 'Supporting',
        });
    }

    if (recommendation.template) {
        items.push({
            id: 'microcycle-adaptation',
            title: `Weekly Stimulus Target (${recommendation.template.category})`,
            description: `Prescribed ${recommendation.template.title} to develop ${recommendation.template.modality.toLowerCase()} adaptations within the engine's current load envelope.`,
            impact: 'positive',
            category: 'stimulus',
            weightBadge: 'Core Goal',
        });
    }

    if (deltas.sleepScoreToday !== null) {
        const sleep = deltas.sleepScoreToday;
        items.push({
            id: 'sleep-quality',
            title: 'Garmin Sleep Score',
            description: `Garmin Sleep Score is ${sleep}/100, providing a ${sleep >= 75 ? 'favorable' : 'cautious'} recovery signal alongside the other decision inputs.`,
            impact: sleep >= 75 ? 'positive' : 'cautious',
            category: 'recovery',
            weightBadge: 'Supporting',
        });
    }

    return items.slice(0, 4);
}

export function computeDecisionBoundaries(
    recommendation: Recommendation | null,
    input: DailyDecisionInput | null,
): DecisionBoundaryState {
    const hardGates: HardSafetyGate[] = [];
    const softOptimizations: SoftOptimizationFactor[] = [];

    const safetyEnv = recommendation?.envelopes?.safety;
    const restrictedModalities = safetyEnv?.restrictedModalities ?? [];
    const hasTissueRestricted = restrictedModalities.length > 0;
    const clinicalFlag = safetyEnv?.clinicalFlagActive ?? false;
    const tissueGateActive = clinicalFlag || hasTissueRestricted;
    hardGates.push({
        id: 'clinical-pain',
        name: 'Musculoskeletal Tissue Gate',
        active: tissueGateActive,
        reason: clinicalFlag
            ? safetyEnv?.clinicalReason || 'Active symptom/injury flag restricts heavy loading and high-impact work.'
            : hasTissueRestricted
                ? `Restricted modalities: ${restrictedModalities.join(', ')}`
                : 'No tissue injury restrictions active.',
        severity: clinicalFlag ? 'blocking' : hasTissueRestricted ? 'caution' : 'clear',
    });

    const illnessSymptoms = input?.subjectiveCheckin?.illnessSymptoms === true;
    hardGates.push({
        id: 'illness-anomaly',
        name: 'Physiological Illness Gate',
        active: illnessSymptoms,
        reason: illnessSymptoms
            ? 'The morning check-in reports illness symptoms. Harder training is locked pending a fresh decision.'
            : 'No illness symptoms are reported in the available morning check-in.',
        severity: illnessSymptoms ? 'blocking' : 'clear',
    });

    const maxAllowableTier = recommendation?.envelopes?.plan.maxAllowableTier;
    const hardCeiling = maxAllowableTier === 'Rest' || maxAllowableTier === 'Mobility';
    hardGates.push({
        id: 'systemic-ceiling',
        name: 'Systemic Load Ceiling',
        active: hardCeiling,
        reason: hardCeiling
            ? `The engine currently caps today at ${maxAllowableTier}.`
            : 'The plan envelope does not impose a rest/mobility ceiling.',
        severity: hardCeiling ? 'caution' : 'clear',
    });

    softOptimizations.push({
        id: 'stimulus-role',
        name: 'Weekly Microcycle Role Allocation',
        description: 'The selected workout reflects the engine’s current weekly stimulus allocation.',
        category: 'stimulus',
    });

    if (input?.preferences?.preferredModalities && input.preferences.preferredModalities.length > 0) {
        softOptimizations.push({
            id: 'modality-preference',
            name: 'Athlete Sport Preference',
            description: `Prioritizing ${input.preferences.preferredModalities.join(', ')} where safety gates permit.`,
            category: 'preference',
        });
    }

    softOptimizations.push({
        id: 'progressive-overload',
        name: 'Prescription Dose Titration',
        description: 'The displayed dose is the engine-selected prescription for the current decision context.',
        category: 'overload',
    });

    const hardGatesActiveCount = hardGates.filter(g => g.active).length;
    const harderAdjustmentAllowed = Boolean(recommendation)
        && !clinicalFlag
        && !hasTissueRestricted
        && !illnessSymptoms
        && !hardCeiling
        && recommendation?.mode !== 'recover';

    return {
        hardGatesActiveCount,
        harderAdjustmentAllowed,
        hardGates,
        softOptimizations,
        summary: hardGatesActiveCount > 0
            ? `${hardGatesActiveCount} active safety guardrail${hardGatesActiveCount === 1 ? '' : 's'} represented here; harder adjustment stays locked while any is active.`
            : 'No active hard gates are represented by today’s safety envelope and available check-in.',
    };
}

export function computeInvalidationTriggers(
    recommendation: Recommendation | null,
): InvalidationTrigger[] {
    return [
        {
            id: 'pain-spike',
            icon: '⚡',
            trigger: 'If localized muscle/joint pain exceeds 3/10 during warmup',
            action: 'Stop immediately and pivot to Joint Mobility or another low-load option allowed by the current safety envelope.',
            alternativeActionId: 'mobility',
        },
        {
            id: 'time-reduction',
            icon: '⏱️',
            trigger: 'If available time drops below 30 minutes',
            action: 'Select the 1-tap "Express 20m" alternative to preserve the planned structure without rushing.',
            alternativeActionId: 'time-20',
        },
        {
            id: 'venue-shift',
            icon: '🏠',
            trigger: recommendation?.template.modality === 'Strength'
                ? 'If gym / barbell equipment is unexpectedly unavailable'
                : 'If the planned venue or weather prevents safe execution',
            action: 'Switch to the zero-equipment Home Bodyweight option.',
            alternativeActionId: 'home-bodyweight',
        },
        {
            id: 'illness-symptom',
            icon: '🤒',
            trigger: 'If fever, chills, or systemic illness symptoms appear',
            action: 'Do not use a harder alternative. Update the check-in and follow the resulting safety decision; seek medical care when clinically indicated.',
        },
    ];
}

export function computeDataConfidence(
    input: DailyDecisionInput | null,
): DataConfidenceRating {
    if (!input) {
        return {
            tier: 'low',
            label: 'Low Confidence (No Data)',
            badgeClass: 'confidence-low',
            uncertaintyStatement: 'Cannot evaluate recommendation confidence without daily input data.',
            reasons: ['No daily input available.'],
        };
    }

    const { dataQuality, recoverySnapshot } = input;
    const reasons: string[] = [];

    const hasGarmin = dataQuality.hasRecoverySnapshot;
    const hasCheckin = dataQuality.hasSubjectiveCheckin;
    const checkinComplete = dataQuality.subjectiveCheckinComplete;
    const hasHrv = recoverySnapshot?.raw.hrvOvernightAvg != null;
    const hasSleep = recoverySnapshot?.raw.sleepScore != null;

    if (hasGarmin && hasHrv && hasSleep && hasCheckin && checkinComplete) {
        reasons.push('Garmin overnight HRV and sleep score are available.');
        reasons.push('Morning subjective check-in is complete.');
        return {
            tier: 'high',
            label: 'High Confidence',
            badgeClass: 'confidence-high',
            uncertaintyStatement: 'The decision has both core wearable signals and a complete subjective check-in.',
            reasons,
        };
    }

    if (hasGarmin && (hasHrv || hasSleep)) {
        reasons.push('At least one core Garmin overnight biometric signal is available.');
        if (!hasCheckin) {
            reasons.push('Morning subjective check-in is missing.');
        } else if (!checkinComplete) {
            reasons.push('Morning subjective check-in exists but is incomplete.');
        }
        return {
            tier: 'moderate',
            label: 'Moderate Confidence',
            badgeClass: 'confidence-moderate',
            uncertaintyStatement: 'Useful wearable data is available, but at least one decision input stream is incomplete.',
            reasons,
        };
    }

    if (hasCheckin && checkinComplete) {
        reasons.push('Morning subjective check-in is complete.');
        reasons.push('Core overnight Garmin signals are missing or incomplete.');
        return {
            tier: 'moderate',
            label: 'Moderate Confidence (Check-in Only)',
            badgeClass: 'confidence-moderate',
            uncertaintyStatement: 'The subjective check-in is usable, but wearable corroboration is limited.',
            reasons,
        };
    }

    reasons.push('Core overnight biometric and/or subjective inputs are incomplete.');
    return {
        tier: 'low',
        label: 'Low Confidence (Sparse Data)',
        badgeClass: 'confidence-low',
        uncertaintyStatement: 'The decision has limited direct input evidence. Follow the safety envelope and update missing data when possible.',
        reasons,
    };
}

export function assembleMorningDecisionEvidence(
    todaySnapshot: DailyRecoverySnapshot | null,
    yesterdaySnapshot: DailyRecoverySnapshot | null,
    recommendation: Recommendation | null,
    yesterdayRec: DailyRecommendation | null,
    input: DailyDecisionInput | null,
): MorningDecisionEvidence {
    const todayMode = recommendation?.mode ?? 'train';
    const deltas = computeDayOverDayDeltas(todaySnapshot, yesterdaySnapshot, todayMode, yesterdayRec);
    const rankedEvidence = computeRankedEvidence(recommendation, input, deltas);
    const boundaries = computeDecisionBoundaries(recommendation, input);
    const invalidationTriggers = computeInvalidationTriggers(recommendation);
    const confidence = computeDataConfidence(input);

    const executiveSummary = recommendation
        ? `${recommendation.template.title} (${recommendation.template.durationMin}m ${recommendation.template.modality}): ${recommendation.rationale}`
        : 'Complete your morning check-in and sync available recovery data to generate today’s decision.';

    return {
        deltas,
        rankedEvidence,
        boundaries,
        invalidationTriggers,
        confidence,
        executiveSummary,
    };
}
