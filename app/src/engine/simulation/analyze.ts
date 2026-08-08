import type { EquipmentKey, Recommendation, SessionTemplate, UserContext, WorkoutCostProfile } from '../models';
import { evaluateNextDayPlanWithIntent, evaluateTrainingWithIntent } from '../rules';
import { generateWeekAheadPlanWithIntent, resolveWeeklyAnchors, type WeekAheadDay } from '../planner';
import type { CompletedExposure, TrainingHistoryProvider } from '../trainingHistory';
import { evaluatePeriodizationPhase } from '../periodization';
import { addDaysToLocalDateString } from '../../utils/localDate';
import type { AthleteScenario } from './scenarios';
import { SCENARIOS } from './scenarios';

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };

export interface ObjectiveTally {
    key: string;
    timesGenerated: number;
    timesResolved: number;
}

export interface ObjectiveCredit {
    weekIndex: number;
    date: string;
    objectiveKey: string;
    objectiveTitle: string;
    templateId: string;
    templateTitle: string;
    modality: SessionTemplate['modality'];
}

export interface UtilityDiagnosticsSummary {
    fragileSelectionCount: number;
    lowerBenefitSelectionCount: number;
    trainTierRestOrRecoveryCount: number;
}

export interface AnchorWeekResult {
    weekIndex: number;
    weekStartDate: string;
    eventSpecificAnchorDate: string | null;
    qualityAnchorDate: string | null;
    eventSpecificAnchorHit: boolean | null;
    eventSpecificExposureDates: string[];
    eventSpecificAnchorFulfilled: boolean | null;
    qualityAnchorHit: boolean | null;
}

export interface ScenarioResult {
    scenarioId: string;
    label: string;
    description: string;
    weeksSimulated: number;
    totalDays: number;
    categoryDistribution: Partial<Record<SessionTemplate['category'], number>>;
    modalityDistribution: Partial<Record<SessionTemplate['modality'], number>>;
    restOrRecoveryDayCount: number;
    restOrRecoveryDayPct: number;
    maxConsecutiveSameTemplateStreakWithinCall: number;
    maxConsecutiveSameTemplateStreakAcrossWeeks: number;
    objectiveResolution: ObjectiveTally[];
    objectiveCredits: ObjectiveCredit[];
    utilityDiagnostics: UtilityDiagnosticsSummary;
    qualityWarnings: string[];
    anchorWeeks: AnchorWeekResult[];
    anchorScopeNote: string | null;
    fatigueTierDayCounts: { train: number; modify: number; recover: number };
    constraintViolations: string[];
}

function equipmentSatisfied(context: UserContext, required: EquipmentKey[]): boolean {
    if (required.length === 0) return true;
    if (context.trainingSettings) return required.every(eq => context.trainingSettings!.equipment[eq]);
    return required.every(eq => {
        if (eq === 'free_weights') return context.constraints.hasFreeWeights;
        if (eq === 'cable_machine') return context.constraints.hasCableMachine;
        if (eq === 'treadmill') return context.constraints.hasTreadmill;
        if (eq === 'indoor_bike') return context.constraints.hasIndoorBike;
        return false;
    });
}

function recommendationAsDay(date: string, recommendation: Recommendation, phaseName: string): WeekAheadDay {
    return {
        date,
        dayOffset: 0,
        confidence: 'provisional',
        phaseName,
        template: recommendation.template,
        mode: recommendation.mode === 'recover' ? 'recover' : 'train',
        rationale: recommendation.rationale,
        addressesObjectives: [],
    };
}

function toCompletedExposure(day: WeekAheadDay): CompletedExposure {
    return {
        date: day.date,
        costProfile: day.template.costProfile ?? ZERO_COST,
        stimulusProfile: day.template.stimulusProfile,
        modality: day.template.modality,
        category: day.template.category,
        trainingRecordLike: {
            type: `${day.template.modality} ${day.template.category}`,
            duration_min: day.template.durationMin,
            training_effect: 0,
            intensity_tag: '',
        },
    };
}

function longestStreak(days: WeekAheadDay[]): number {
    let max = days.length > 0 ? 1 : 0;
    let current = 1;
    for (let i = 1; i < days.length; i++) {
        current = days[i - 1].template.id === days[i].template.id ? current + 1 : 1;
        max = Math.max(max, current);
    }
    return max;
}

function computeMetrics(
    scenario: AthleteScenario,
    weeklyDays: WeekAheadDay[][],
    anchorWeeks: AnchorWeekResult[],
    objectiveTallies: Map<string, ObjectiveTally>,
    objectiveCredits: ObjectiveCredit[],
): ScenarioResult {
    const allDays = weeklyDays.flat();
    const categoryDistribution: Partial<Record<SessionTemplate['category'], number>> = {};
    const modalityDistribution: Partial<Record<SessionTemplate['modality'], number>> = {};
    const fatigueTierDayCounts = { train: 0, modify: 0, recover: 0 };
    const constraintViolations: string[] = [];
    let fragileSelectionCount = 0;
    let lowerBenefitSelectionCount = 0;
    let trainTierRestOrRecoveryCount = 0;
    let restOrRecoveryDayCount = 0;

    allDays.forEach((day) => {
        const cat = day.template.category;
        categoryDistribution[cat] = (categoryDistribution[cat] ?? 0) + 1;
        const mod = day.template.modality;
        modalityDistribution[mod] = (modalityDistribution[mod] ?? 0) + 1;
        if (cat === 'Rest' || cat === 'Mobility/Recovery') restOrRecoveryDayCount += 1;

        if (day.diagnostics) {
            fatigueTierDayCounts[day.diagnostics.fatigueTier] += 1;
            const runnerUp = day.diagnostics.runnerUpUtilityScore;
            if (runnerUp !== null && day.diagnostics.topUtilityScore > 0
                && (day.diagnostics.topUtilityScore - runnerUp) / day.diagnostics.topUtilityScore <= 0.05) {
                fragileSelectionCount += 1;
            }
            if (day.diagnostics.bestBenefitTemplateId !== day.template.id
                && day.diagnostics.bestBenefitScore > day.diagnostics.selectedBenefitScore) {
                lowerBenefitSelectionCount += 1;
            }
            if (day.diagnostics.fatigueTier === 'train' && (cat === 'Rest' || cat === 'Mobility/Recovery')) {
                trainTierRestOrRecoveryCount += 1;
            }
        }

        if (!equipmentSatisfied(scenario.context, day.template.requiredEquipment)) {
            constraintViolations.push(`${day.date}: picked ${day.template.id} requiring [${day.template.requiredEquipment.join(',')}] the athlete doesn't have`);
        }
        const lowerMod = day.template.modality.toLowerCase();
        if ((scenario.context.constraints.restrictedModalities ?? []).some(mod => mod.toLowerCase() === lowerMod)) {
            constraintViolations.push(`${day.date}: picked ${day.template.id} (${day.template.modality}) despite an active injury constraint`);
        }
    });

    const maxConsecutiveSameTemplateStreakWithinCall = Math.max(0, ...weeklyDays.map(longestStreak));
    const maxConsecutiveSameTemplateStreakAcrossWeeks = longestStreak(allDays);

    const isCyclingRelevantEvent = scenario.event?.category === 'cycling_event' || scenario.event?.category === 'triathlon';
    const anchorScopeNote = isCyclingRelevantEvent ? null :
        'Anchor-day nomination only requires SOME focus event (Race-Specific Endurance templates\' phaseEligibility.requiresFocusEvent doesn\'t check event category), so a nomination can appear even here -- but the optimizer\'s event-priority penalty for non-matching modalities makes it unlikely to actually win the day\'s pick. Treat eventSpecificAnchorHit/qualityAnchorHit, not the raw nomination, as the meaningful signal for non-cycling scenarios.';

    const objectiveResolution = Array.from(objectiveTallies.values());
    const qualityWarnings: string[] = [];
    const missedObjectives = objectiveResolution.filter(o => o.timesResolved < o.timesGenerated);
    if (missedObjectives.length > 0) {
        qualityWarnings.push(`Unresolved weekly objectives: ${missedObjectives.map(o => `${o.key} ${o.timesResolved}/${o.timesGenerated}`).join(', ')}.`);
    }
    const creditedKeys = new Set(objectiveCredits.map(credit => credit.objectiveKey));
    const resolvedWithoutProjectedCredit = objectiveResolution
        .filter(o => o.timesResolved > 0 && !creditedKeys.has(o.key));
    if (resolvedWithoutProjectedCredit.length > 0) {
        qualityWarnings.push(`Resolved objective(s) without a projected credit source in this window: ${resolvedWithoutProjectedCredit.map(o => o.key).join(', ')}. Verify whether completion was seeded from prior history.`);
    }
    const missedAnchors = anchorWeeks.filter(w => w.eventSpecificAnchorDate && !w.eventSpecificAnchorFulfilled).length;
    if (missedAnchors > 0) qualityWarnings.push(`Event-specific anchor missed in ${missedAnchors} nominated week(s).`);
    const anchorPlacementDrift = anchorWeeks.filter(w => w.eventSpecificAnchorDate && !w.eventSpecificAnchorHit && w.eventSpecificAnchorFulfilled).length;
    if (anchorPlacementDrift > 0) {
        qualityWarnings.push(`Event-specific exposure occurred off the nominated anchor date in ${anchorPlacementDrift} week(s).`);
    }
    if (trainTierRestOrRecoveryCount > 0) qualityWarnings.push(`Rest or mobility selected on ${trainTierRestOrRecoveryCount} projected train-tier day(s).`);
    if (maxConsecutiveSameTemplateStreakAcrossWeeks >= 4) {
        qualityWarnings.push(`Same-template streak reached ${maxConsecutiveSameTemplateStreakAcrossWeeks} days.`);
    }
    if (scenario.event?.category === 'triathlon') {
        qualityWarnings.push('Triathlon capability is partial: the engine has no Swimming modality or swim objective/catalog support.');
    }
    if (scenario.event?.category === 'strength_meet') {
        qualityWarnings.push('Strength-meet capability is partial: one generic weekly strength-maintenance objective cannot represent competition-lift programming.');
    }

    return {
        scenarioId: scenario.id,
        label: scenario.label,
        description: scenario.description,
        weeksSimulated: scenario.weeks,
        totalDays: allDays.length,
        categoryDistribution,
        modalityDistribution,
        restOrRecoveryDayCount,
        restOrRecoveryDayPct: allDays.length > 0 ? Math.round((restOrRecoveryDayCount / allDays.length) * 1000) / 10 : 0,
        maxConsecutiveSameTemplateStreakWithinCall,
        maxConsecutiveSameTemplateStreakAcrossWeeks,
        objectiveResolution,
        objectiveCredits,
        utilityDiagnostics: { fragileSelectionCount, lowerBenefitSelectionCount, trainTierRestOrRecoveryCount },
        qualityWarnings,
        anchorWeeks,
        anchorScopeNote,
        fatigueTierDayCounts,
        constraintViolations,
    };
}

/**
 * Runs one scenario end to end through the real production code path. Each iteration is
 * one non-overlapping seven-calendar-day block: today's real readiness-driven decision
 * plus the next six forecast days. The previous harness counted tomorrow..day+7 and then
 * advanced the next block to day+7, which both omitted the only day where a scenario's
 * weekly readiness input was directly evaluated and duplicated that boundary day across
 * consecutive windows. That made the sustained-stress scenario look artificially similar
 * to baseline (its weekly mandated recovery day was never part of the metrics).
 */
export async function runScenario(scenario: AthleteScenario): Promise<ScenarioResult> {
    const events = scenario.event ? [scenario.event] : [];
    const accumulatedHistory: CompletedExposure[] = [];
    const historyProvider: TrainingHistoryProvider = {
        reconstruct: async (_userId, throughDateExclusive, windowDays) => {
            const windowStart = addDaysToLocalDateString(throughDateExclusive, -windowDays);
            return accumulatedHistory.filter(exposure =>
                exposure.date >= windowStart && exposure.date < throughDateExclusive
            );
        },
    };

    const weeklyDays: WeekAheadDay[][] = [];
    const anchorWeeks: AnchorWeekResult[] = [];
    const objectiveTallies = new Map<string, ObjectiveTally>();
    const objectiveCredits: ObjectiveCredit[] = [];
    let currentDate = scenario.startDate;

    for (let week = 0; week < scenario.weeks; week++) {
        const readiness = scenario.readinessForWeek(week);

        const todayRec = await evaluateTrainingWithIntent('sim-user', readiness, scenario.context, events, currentDate, undefined, historyProvider);
        const nextDayPlan = await evaluateNextDayPlanWithIntent('sim-user', events, readiness, scenario.context, currentDate, todayRec, historyProvider);
        const tomorrowRec = nextDayPlan.branches.yellow.recommendation;

        // Six future days + today's actual decision = one non-overlapping 7-day block.
        const plan = await generateWeekAheadPlanWithIntent(
            'sim-user', readiness, scenario.context, null, events, currentDate, todayRec, tomorrowRec,
            { days: 6 }, historyProvider,
        );
        const todayPhase = evaluatePeriodizationPhase(events, currentDate).phase.phaseName;
        const simulatedDays: WeekAheadDay[] = [
            recommendationAsDay(currentDate, todayRec, todayPhase),
            ...plan.days,
        ];

        // Mirror the planner's real pre-pass inputs, including tomorrow's realized
        // category/modality. Diagnostics must evaluate the same nominated dates the plan
        // actually ranked, not recompute a subtly different anchor pair afterward.
        const anchors = resolveWeeklyAnchors(
            currentDate,
            6,
            events,
            [],
            scenario.context,
            tomorrowRec.template.category,
            tomorrowRec.template.modality,
        );
        const findPick = (date: string | null) => date ? simulatedDays.find(d => d.date === date) ?? null : null;
        const eventSpecificExposureDates = simulatedDays
            .filter(day => day.template.modality === 'Cycling' && day.template.category === 'Race-Specific Endurance')
            .map(day => day.date);
        anchorWeeks.push({
            weekIndex: week,
            weekStartDate: currentDate,
            eventSpecificAnchorDate: anchors.eventSpecificAnchorDate,
            qualityAnchorDate: anchors.qualityAnchorDate,
            eventSpecificAnchorHit: anchors.eventSpecificAnchorDate
                ? (() => {
                    const pick = findPick(anchors.eventSpecificAnchorDate);
                    return pick?.template.modality === 'Cycling' && pick.template.category === 'Race-Specific Endurance';
                })()
                : null,
            eventSpecificExposureDates,
            eventSpecificAnchorFulfilled: anchors.eventSpecificAnchorDate
                ? eventSpecificExposureDates.length > 0
                : null,
            qualityAnchorHit: anchors.qualityAnchorDate
                ? (() => {
                    const pick = findPick(anchors.qualityAnchorDate);
                    return pick?.template.modality === 'Cycling'
                        && ['Moderate Endurance', 'Hard Endurance'].includes(pick.template.category);
                })()
                : null,
        });

        weeklyDays.push(simulatedDays);
        plan.objectiveCredits.forEach(credit => {
            objectiveCredits.push({ weekIndex: week, ...credit });
        });
        simulatedDays.forEach(day => accumulatedHistory.push(toCompletedExposure(day)));

        plan.microcycleObjectives.forEach(obj => {
            const tally = objectiveTallies.get(obj.key) ?? { key: obj.key, timesGenerated: 0, timesResolved: 0 };
            tally.timesGenerated += 1;
            if (obj.completedExposures >= obj.targetExposures) tally.timesResolved += 1;
            objectiveTallies.set(obj.key, tally);
        });

        currentDate = addDaysToLocalDateString(currentDate, 7);
    }

    return computeMetrics(scenario, weeklyDays, anchorWeeks, objectiveTallies, objectiveCredits);
}

export interface SimulationReport {
    commit: string;
    capturedAt: string;
    engineVersion: string;
    policyVersion: string;
    scenarios: ScenarioResult[];
    preferenceSensitivity: PreferenceSensitivityResult[];
    readinessSensitivity: ReadinessSensitivityResult[];
}

export interface PreferenceSensitivityResult {
    preferredModality: string;
    preferredScenarioId: string;
    baselineScenarioId: string;
    changedPlannedDays: number;
    summary: string;
}

export interface ReadinessSensitivityResult {
    trajectory: 'fresh' | 'stressed';
    scenarioId: string;
    baselineScenarioId: string;
    changedPlannedDays: number;
    restOrRecoveryDayDelta: number;
    raceSpecificExposureDelta: number;
    summary: string;
}

function distributionDifference(
    preferred: Partial<Record<SessionTemplate['modality'], number>>,
    baseline: Partial<Record<SessionTemplate['modality'], number>>,
): number {
    const modalities = new Set([...Object.keys(preferred), ...Object.keys(baseline)]);
    return Array.from(modalities).reduce((sum, modality) =>
        sum + Math.abs((preferred[modality as SessionTemplate['modality']] ?? 0) - (baseline[modality as SessionTemplate['modality']] ?? 0)), 0) / 2;
}

function evaluatePreferenceSensitivity(results: ScenarioResult[]): PreferenceSensitivityResult[] {
    const byId = new Map(results.map(result => [result.scenarioId, result]));
    const comparisons = [{ preferredModality: 'Field', preferredScenarioId: 'field_sport_general_target', baselineScenarioId: 'no_event_base_phase' }];
    return comparisons.flatMap(comparison => {
        const preferred = byId.get(comparison.preferredScenarioId);
        const baseline = byId.get(comparison.baselineScenarioId);
        if (!preferred || !baseline) return [];
        const changedPlannedDays = distributionDifference(preferred.modalityDistribution, baseline.modalityDistribution);
        return [{
            ...comparison,
            changedPlannedDays,
            summary: changedPlannedDays === 0
                ? `${comparison.preferredModality} preference had no observable effect against its matched baseline.`
                : `${comparison.preferredModality} preference changed ${changedPlannedDays} planned modality day(s) against its matched baseline.`,
        }];
    });
}

function evaluateReadinessSensitivity(results: ScenarioResult[]): ReadinessSensitivityResult[] {
    const byId = new Map(results.map(result => [result.scenarioId, result]));
    const baseline = byId.get('cycling_criterium_A');
    if (!baseline) return [];
    return (['fresh', 'stressed'] as const).flatMap(trajectory => {
        const scenario = byId.get(`cycling_criterium_${trajectory}_A`);
        if (!scenario) return [];
        const changedPlannedDays = distributionDifference(scenario.modalityDistribution, baseline.modalityDistribution);
        const restOrRecoveryDayDelta = scenario.restOrRecoveryDayCount - baseline.restOrRecoveryDayCount;
        const raceSpecificExposureDelta = (scenario.categoryDistribution['Race-Specific Endurance'] ?? 0)
            - (baseline.categoryDistribution['Race-Specific Endurance'] ?? 0);
        return [{
            trajectory,
            scenarioId: scenario.scenarioId,
            baselineScenarioId: baseline.scenarioId,
            changedPlannedDays,
            restOrRecoveryDayDelta,
            raceSpecificExposureDelta,
            summary: `${trajectory} trajectory: ${changedPlannedDays} modality day(s) changed; Rest/Mobility delta ${restOrRecoveryDayDelta >= 0 ? '+' : ''}${restOrRecoveryDayDelta}; race-specific exposure delta ${raceSpecificExposureDelta >= 0 ? '+' : ''}${raceSpecificExposureDelta}.`,
        }];
    });
}

export async function runAllScenarios(scenarios: AthleteScenario[] = SCENARIOS, commit = 'unknown'): Promise<SimulationReport> {
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
        results.push(await runScenario(scenario));
    }
    return {
        commit,
        capturedAt: new Date().toISOString(),
        engineVersion: 'v2',
        policyVersion: '2026.08.x',
        scenarios: results,
        preferenceSensitivity: evaluatePreferenceSensitivity(results),
        readinessSensitivity: evaluateReadinessSensitivity(results),
    };
}
