import type { EquipmentKey, SessionTemplate, UserContext, WorkoutCostProfile } from '../models';
import { evaluateNextDayPlanWithIntent, evaluateTrainingWithIntent } from '../rules';
import { generateWeekAheadPlanWithIntent, resolveWeeklyAnchors, type WeekAheadDay } from '../planner';
import type { CompletedExposure, TrainingHistoryProvider } from '../trainingHistory';
import { addDaysToLocalDateString } from '../../utils/localDate';
import type { AthleteScenario } from './scenarios';
import { SCENARIOS } from './scenarios';

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };

export interface ObjectiveTally {
    key: string;
    /** Weeks in which this objective was generated at all (its demand threshold was met). */
    timesGenerated: number;
    /** Weeks in which it was generated AND fully resolved (completedExposures >= target) by week's end. */
    timesResolved: number;
}

export interface AnchorWeekResult {
    weekIndex: number;
    weekStartDate: string;
    eventSpecificAnchorDate: string | null;
    qualityAnchorDate: string | null;
    /** Did the actual displayed pick on the nominated date match the anchor's intended
     *  role? A nomination can exist (phase-eligible + duration/equipment-feasible) but
     *  still lose the final ranking to something else -- this is what actually happened. */
    eventSpecificAnchorHit: boolean | null;
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
    /** Longest same-template streak found *within a single week-strip generation call*.
     *  This remains a diagnostic rather than a hard cap: anti-stacking applies soft
     *  modality and intensity penalties, not a template-level exclusion. */
    maxConsecutiveSameTemplateStreakWithinCall: number;
    /** Longest same-template streak across the WHOLE chained horizon, including the
     *  boundary between one week's call and the next. Real completed history is now
     *  seeded into each fresh planner call, so its anti-stacking policy sees the boundary;
     *  the metric remains diagnostic because that policy is deliberately soft. */
    maxConsecutiveSameTemplateStreakAcrossWeeks: number;
    objectiveResolution: ObjectiveTally[];
    anchorWeeks: AnchorWeekResult[];
    /** Explanatory note for scenarios where the anchor mechanism's own eligibility check
     *  (isTemplatePhaseEligible on the Race-Specific Endurance templates) only requires
     *  *some* focus event, not specifically a cycling-relevant one -- so a nomination can
     *  technically appear even for a running/strength scenario, but the optimizer's
     *  event-priority penalty makes it very unlikely to ever win the final pick. Null for
     *  cycling_event/triathlon scenarios, where this is the intended, well-scoped case. */
    anchorScopeNote: string | null;
    fatigueTierDayCounts: { train: number; modify: number; recover: number };
    /** Must be empty -- both a metric and a hard sanity invariant. Each entry describes a
     *  concrete violation (equipment the athlete doesn't own, or a modality matching an
     *  active injury) found in the actual generated plan. */
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
        return false; // pullup_bar has no engine-level constraint flag -- can't verify, treat as unmet
    });
}

function toCompletedExposure(day: WeekAheadDay): CompletedExposure {
    return {
        date: day.date,
        costProfile: day.template.costProfile ?? ZERO_COST,
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
): ScenarioResult {
    const allDays = weeklyDays.flat();
    const categoryDistribution: Partial<Record<SessionTemplate['category'], number>> = {};
    const modalityDistribution: Partial<Record<SessionTemplate['modality'], number>> = {};
    const fatigueTierDayCounts = { train: 0, modify: 0, recover: 0 };
    const constraintViolations: string[] = [];
    let restOrRecoveryDayCount = 0;

    allDays.forEach((day) => {
        const cat = day.template.category;
        categoryDistribution[cat] = (categoryDistribution[cat] ?? 0) + 1;
        const mod = day.template.modality;
        modalityDistribution[mod] = (modalityDistribution[mod] ?? 0) + 1;
        if (cat === 'Rest' || cat === 'Mobility/Recovery') restOrRecoveryDayCount += 1;

        if (day.diagnostics) fatigueTierDayCounts[day.diagnostics.fatigueTier] += 1;

        if (!equipmentSatisfied(scenario.context, day.template.requiredEquipment)) {
            constraintViolations.push(`${day.date}: picked ${day.template.id} requiring [${day.template.requiredEquipment.join(',')}] the athlete doesn't have`);
        }
        const lowerMod = day.template.modality.toLowerCase();
        if (scenario.context.constraints.injuries.some(inj => inj.toLowerCase().includes(lowerMod))) {
            constraintViolations.push(`${day.date}: picked ${day.template.id} (${day.template.modality}) despite an active injury constraint`);
        }
    });

    const maxConsecutiveSameTemplateStreakWithinCall = Math.max(0, ...weeklyDays.map(longestStreak));
    const maxConsecutiveSameTemplateStreakAcrossWeeks = longestStreak(allDays);

    const isCyclingRelevantEvent = scenario.event?.category === 'cycling_event' || scenario.event?.category === 'triathlon';
    const anchorScopeNote = isCyclingRelevantEvent ? null :
        'Anchor-day nomination only requires SOME focus event (Race-Specific Endurance templates\' phaseEligibility.requiresFocusEvent doesn\'t check event category), so a nomination can appear even here -- but the optimizer\'s event-priority penalty for non-matching modalities makes it unlikely to actually win the day\'s pick. Treat eventSpecificAnchorHit/qualityAnchorHit, not the raw nomination, as the meaningful signal for non-cycling scenarios.';

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
        objectiveResolution: Array.from(objectiveTallies.values()),
        anchorWeeks,
        anchorScopeNote,
        fatigueTierDayCounts,
        constraintViolations,
    };
}

/**
 * Runs one scenario end to end through the real production code path (the same
 * `evaluateTrainingWithIntent` / `evaluateNextDayPlanWithIntent` / `generateWeekAheadPlanWithIntent`
 * chain `Home.tsx` calls), chaining 7-day windows rather than one large `days:` call --
 * `resolveWeeklyAnchors` only nominates one anchor pair per call, so a single big call
 * would produce one "big day" for the whole horizon instead of a recurring weekly one.
 *
 * A single accumulating `TrainingHistoryProvider` is shared across all three calls in
 * every week, and is fed forward with each week's own picks before the next week runs --
 * this keeps `evaluateTrainingWithIntent`'s view of history consistent with what
 * `generateWeekAheadPlanWithIntent`'s own seed sees, rather than each week starting from
 * an artificially empty history.
 */
export async function runScenario(scenario: AthleteScenario): Promise<ScenarioResult> {
    const events = scenario.event ? [scenario.event] : [];
    const accumulatedHistory: CompletedExposure[] = [];
    const historyProvider: TrainingHistoryProvider = {
        reconstruct: async () => accumulatedHistory,
    };

    const weeklyDays: WeekAheadDay[][] = [];
    const anchorWeeks: AnchorWeekResult[] = [];
    const objectiveTallies = new Map<string, ObjectiveTally>();
    let currentDate = scenario.startDate;

    for (let week = 0; week < scenario.weeks; week++) {
        const readiness = scenario.readinessForWeek(week);

        const todayRec = await evaluateTrainingWithIntent('sim-user', readiness, scenario.context, events, currentDate, undefined, historyProvider);
        const nextDayPlan = await evaluateNextDayPlanWithIntent('sim-user', events, readiness, scenario.context, currentDate, todayRec, historyProvider);
        const tomorrowRec = nextDayPlan.branches.yellow.recommendation;

        const plan = await generateWeekAheadPlanWithIntent(
            'sim-user', readiness, scenario.context, null, events, currentDate, todayRec, tomorrowRec,
            { days: 7 }, historyProvider,
        );

        const anchors = resolveWeeklyAnchors(currentDate, 7, events, [], scenario.context);
        const findPick = (date: string | null) => date ? plan.days.find(d => d.date === date) ?? null : null;
        anchorWeeks.push({
            weekIndex: week,
            weekStartDate: currentDate,
            eventSpecificAnchorDate: anchors.eventSpecificAnchorDate,
            qualityAnchorDate: anchors.qualityAnchorDate,
            eventSpecificAnchorHit: anchors.eventSpecificAnchorDate
                ? (findPick(anchors.eventSpecificAnchorDate)?.template.category === 'Race-Specific Endurance')
                : null,
            qualityAnchorHit: anchors.qualityAnchorDate
                ? (['Moderate Endurance', 'Hard Endurance'].includes(findPick(anchors.qualityAnchorDate)?.template.category ?? ''))
                : null,
        });

        weeklyDays.push(plan.days);
        plan.days.forEach(d => accumulatedHistory.push(toCompletedExposure(d)));

        plan.microcycleObjectives.forEach(obj => {
            const tally = objectiveTallies.get(obj.key) ?? { key: obj.key, timesGenerated: 0, timesResolved: 0 };
            tally.timesGenerated += 1;
            if (obj.completedExposures >= obj.targetExposures) tally.timesResolved += 1;
            objectiveTallies.set(obj.key, tally);
        });

        currentDate = addDaysToLocalDateString(currentDate, 7);
    }

    return computeMetrics(scenario, weeklyDays, anchorWeeks, objectiveTallies);
}

export interface SimulationReport {
    commit: string;
    capturedAt: string;
    scenarios: ScenarioResult[];
}

/** `commit` is supplied by the caller rather than resolved here: this module runs both
 *  inside vitest (`scenarios.test.ts`) and as a plain Node script
 *  (`scripts/simulate-scenarios.ts`), and `node:child_process` isn't available under
 *  `src/`'s (browser-targeted) tsconfig -- only the unchecked script has real Node access,
 *  so the git lookup lives there. */
export async function runAllScenarios(scenarios: AthleteScenario[] = SCENARIOS, commit = 'unknown'): Promise<SimulationReport> {
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
        results.push(await runScenario(scenario));
    }
    return { commit, capturedAt: new Date().toISOString(), scenarios: results };
}
