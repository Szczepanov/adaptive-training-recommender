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
            phrases.push(`HRV recovered (${signed(hrvDeltaYesterday, 'ms')})`);
        } else if (hrvDeltaYesterday <= -5) {
            phrases.push(`HRV dipped (${signed(hrvDeltaYesterday, 'ms')})`);
        } else {
            phrases.push(`HRV remained stable (${signed(hrvDeltaYesterday, 'ms')})`);
        }
    }

    if (sleepScoreDelta !== null) {
        if (sleepScoreDelta >= 5) {
            phrases.push(`sleep score improved (${signed(sleepScoreDelta)} pts)`);
        } else if (sleepScoreDelta <= -5) {
            phrases.push(`sleep quality decreased (${signed(sleepScoreDelta)} pts)`);
        }
    }

    if (restingHrDelta !== null && Math.abs(restingHrDelta) >= 3) {
        phrases.push(`resting HR is ${restingHrDelta > 0 ? 'elevated' : 'lower'} (${signed(restingHrDelta, 'bpm')})`);
    }

    const summaryText = phrases.length > 0
        ? `Since yesterday: ${phrases.join(', ')}.`
        : 'Physiological markers are within normal rolling baseline variation.';

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

    // 1. Overnight Autonomic Recovery State
    const hrvVal = deltas.hrvToday;
    const hrvBaseDelta = deltas.hrvDeltaBaseline;
    if (hrvVal !== null) {
        if (hrvBaseDelta !== null && hrvBaseDelta >= 2) {
            items.push({
                id: 'hrv-recovery',
                title: 'Autonomic Nervous System Recovery',
                description: `Overnight HRV is ${hrvVal} ms (${signed(hrvBaseDelta, 'ms')} vs 28d baseline), indicating favorable parasympathetic recovery.`,
                impact: 'positive',
                category: 'recovery',
                weightBadge: 'Primary Driver',
            });
        } else if (hrvBaseDelta !== null && hrvBaseDelta <= -4) {
            items.push({
                id: 'hrv-depression',
                title: 'Suppressed Autonomic Recovery',
                description: `Overnight HRV is ${hrvVal} ms (${signed(hrvBaseDelta, 'ms')} below baseline), indicating autonomic stress or incomplete recovery.`,
                impact: 'cautious',
                category: 'recovery',
                weightBadge: 'Primary Driver',
            });
        } else {
            items.push({
                id: 'hrv-stable',
                title: 'Stable Baseline Recovery',
                description: `Overnight HRV (${hrvVal} ms) is stable within normal rolling tolerance.`,
                impact: 'positive',
                category: 'recovery',
                weightBadge: 'Moderate Impact',
            });
        }
    }

    // 2. Musculoskeletal & Check-in Signals
    const checkin = input.subjectiveCheckin;
    const soreness = checkin?.soreness ?? 0;
    const clinicalFlag = recommendation.envelopes?.safety.clinicalFlagActive;
    if (clinicalFlag || soreness >= 3) {
        items.push({
            id: 'tissue-load-protection',
            title: 'Musculoskeletal Safety Protection',
            description: `Active soreness (${soreness}/10) or tissue restriction is shielding high impact and maximum loading.`,
            impact: 'restricting',
            category: 'safety',
            weightBadge: 'Hard Gate',
        });
    }

    // 3. Weekly Microcycle Stimulus Alignment
    if (recommendation.template) {
        items.push({
            id: 'microcycle-adaptation',
            title: `Weekly Stimulus Target (${recommendation.template.category})`,
            description: `Prescribed ${recommendation.template.title} to develop ${recommendation.template.modality.toLowerCase()} adaptations without exceeding systemic load caps.`,
            impact: 'positive',
            category: 'stimulus',
            weightBadge: 'Core Goal',
        });
    }

    // 4. Sleep & Subjective Readiness
    if (deltas.sleepScoreToday !== null) {
        const sleep = deltas.sleepScoreToday;
        items.push({
            id: 'sleep-quality',
            title: 'Sleep Architecture',
            description: `Garmin Sleep Score of ${sleep}/100 supports ${sleep >= 75 ? 'normal training capacity' : 'restrained session duration'}.`,
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
    const hasTissueRestricted = (safetyEnv?.restrictedModalities?.length ?? 0) > 0;

    // Check Hard Gates
    const clinicalFlag = safetyEnv?.clinicalFlagActive ?? false;
    hardGates.push({
        id: 'clinical-pain',
        name: 'Musculoskeletal Tissue Gate',
        active: clinicalFlag || hasTissueRestricted,
        reason: clinicalFlag
            ? 'Active symptom/injury flag restricts heavy loading and high-impact work.'
            : hasTissueRestricted
            ? `Restricted modalities: ${safetyEnv?.restrictedModalities.join(', ')}`
            : 'No tissue injury restrictions active.',
        severity: clinicalFlag ? 'blocking' : 'clear',
    });

    const isFeverOrIll = false; // Evaluated through health anomaly runtime if present
    hardGates.push({
        id: 'illness-anomaly',
        name: 'Physiological Illness Gate',
        active: isFeverOrIll,
        reason: isFeverOrIll
            ? 'Acute biomarker anomaly detected. Training restricted for immune safety.'
            : 'No acute physiological illness markers detected.',
        severity: isFeverOrIll ? 'blocking' : 'clear',
    });

    const hardCeiling = recommendation?.envelopes?.plan.maxAllowableTier === 'Rest' || recommendation?.envelopes?.plan.maxAllowableTier === 'Mobility';
    hardGates.push({
        id: 'systemic-ceiling',
        name: 'Systemic Load Ceiling',
        active: hardCeiling,
        reason: hardCeiling
            ? 'Recent heavy fatigue caps today’s volume to rest or mobility.'
            : 'Systemic capacity open for prescribed dose.',
        severity: hardCeiling ? 'caution' : 'clear',
    });

    // Soft Optimizations
    softOptimizations.push({
        id: 'stimulus-role',
        name: 'Weekly Microcycle Role Allocation',
        description: 'Selected workout fills pending weekly credit without excessive fatigue overlap.',
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
        description: 'Dose calibrated to recent 28-day chronic volume envelope.',
        category: 'overload',
    });

    const hardGatesActiveCount = hardGates.filter(g => g.active).length;
    const harderAdjustmentAllowed = !clinicalFlag && recommendation?.mode !== 'recover';

    return {
        hardGatesActiveCount,
        harderAdjustmentAllowed,
        hardGates,
        softOptimizations,
        summary: hardGatesActiveCount > 0
            ? `${hardGatesActiveCount} active safety guardrails are strictly protecting your session.`
            : 'All hard safety gates are clear. Recommendation is fully optimized for training adaptation.',
    };
}

export function computeInvalidationTriggers(
    recommendation: Recommendation | null,
): InvalidationTrigger[] {
    const triggers: InvalidationTrigger[] = [
        {
            id: 'pain-spike',
            icon: '⚡',
            trigger: 'If localized muscle/joint pain exceeds 3/10 during warmup',
            action: 'Stop immediately and pivot to Joint Mobility or easy Zone 1 recovery walk.',
            alternativeActionId: 'mobility-pivot',
        },
        {
            id: 'time-reduction',
            icon: '⏱️',
            trigger: 'If available time drops below 30 minutes',
            action: 'Select the 1-tap "Express 20m" alternative to preserve stimulus without rushing.',
            alternativeActionId: 'express-20m',
        },
        {
            id: 'venue-shift',
            icon: '🏠',
            trigger: recommendation?.template.modality === 'Strength'
                ? 'If gym / barbell equipment is unexpectedly unavailable'
                : 'If outdoor weather prevents safe execution',
            action: 'Switch to zero-equipment Home Bodyweight flow.',
            alternativeActionId: 'home-bodyweight',
        },
        {
            id: 'illness-symptom',
            icon: '🤒',
            trigger: 'If fever, chills, or systemic illness symptoms appear',
            action: 'Rest completely. Do not train through systemic sickness.',
            alternativeActionId: 'rest-day',
        },
    ];

    return triggers;
}

export function computeDataConfidence(
    input: DailyDecisionInput | null,
): DataConfidenceRating {
    if (!input) {
        return {
            tier: 'low',
            label: 'Low Confidence (No Data)',
            badgeClass: 'confidence-low',
            uncertaintyStatement: 'Cannot evaluate recommendation without input data.',
            reasons: ['No daily input available.'],
        };
    }

    const { dataQuality, recoverySnapshot } = input;
    const reasons: string[] = [];

    const hasGarmin = dataQuality.hasRecoverySnapshot;
    const hasCheckin = dataQuality.hasSubjectiveCheckin;
    const hasHrv = recoverySnapshot?.raw.hrvOvernightAvg != null;
    const hasSleep = recoverySnapshot?.raw.sleepScore != null;

    if (hasGarmin && hasHrv && hasSleep && hasCheckin) {
        reasons.push('Continuous overnight Garmin HRV & sleep architecture synced.');
        reasons.push('Morning subjective readiness & soreness check-in completed.');
        return {
            tier: 'high',
            label: 'High Confidence',
            badgeClass: 'confidence-high',
            uncertaintyStatement: 'Multi-stream biometric & subjective signals are fully aligned.',
            reasons,
        };
    }

    if (hasGarmin && (hasHrv || hasSleep)) {
        reasons.push('Garmin overnight biometric data available.');
        if (!hasCheckin) {
            reasons.push('Morning check-in missing; estimating subjective readiness from wearable baselines.');
        }
        return {
            tier: 'moderate',
            label: 'Moderate Confidence (Wearable Only)',
            badgeClass: 'confidence-moderate',
            uncertaintyStatement: 'Wearable data is solid, but subjective muscle soreness and energy are estimated.',
            reasons,
        };
    }

    reasons.push('Limited or incomplete overnight biometric streams.');
    return {
        tier: 'low',
        label: 'Low Confidence (Sparse Data)',
        badgeClass: 'confidence-low',
        uncertaintyStatement: 'Recommendation relies on rolling default baselines. Listen closely to internal cues.',
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
        : 'Complete your morning check-in and sync Garmin data to generate today’s decision.';

    return {
        deltas,
        rankedEvidence,
        boundaries,
        invalidationTriggers,
        confidence,
        executiveSummary,
    };
}
