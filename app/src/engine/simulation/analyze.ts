import type { DimensionalFatigue, EquipmentKey, Recommendation, SessionTemplate, UserContext, WorkoutCostProfile, WorkoutStimulusProfile } from '../models';
import { evaluateNextDayPlanWithIntent, evaluateTrainingWithIntent } from '../rules';
import { generateWeekAheadPlanWithIntent, resolveWeeklyAnchors, type WeekAheadDay } from '../planner';
import type { CompletedExposure, TrainingHistoryProvider } from '../trainingHistory';
import { evaluatePeriodizationPhase } from '../periodization';
import { addDaysToLocalDateString } from '../../utils/localDate';
import { workoutForTemplate } from '../../workouts/prescription';
import type { AthleteScenario } from './scenarios';
import { SCENARIOS } from './scenarios';
import type { WeeklyRoleAllocationReport } from '../weeklyAllocation';
import type { FatigueFusionPolicy } from '../fatigue';

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
const ZERO_STIMULUS: WorkoutStimulusProfile = { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0 };
const ZERO_FATIGUE: DimensionalFatigue = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };

export interface ObjectiveTally { key: string; timesGenerated: number; timesResolved: number; }
export interface ObjectiveCredit { weekIndex: number; date: string; objectiveKey: string; objectiveTitle: string; templateId: string; templateTitle: string; modality: SessionTemplate['modality']; }
export interface UtilityDiagnosticsSummary { fragileSelectionCount: number; lowerBenefitSelectionCount: number; trainTierRestOrRecoveryCount: number; }
export interface AnchorWeekResult {
    weekIndex: number; weekStartDate: string; eventSpecificAnchorDate: string | null; qualityAnchorDate: string | null;
    eventSpecificAnchorHit: boolean | null; eventSpecificExposureDates: string[]; eventSpecificAnchorFulfilled: boolean | null; qualityAnchorHit: boolean | null;
}
export interface ScenarioDecisionTrace {
    weekIndex: number;
    date: string;
    readinessTier: 'train' | 'modify' | 'recover';
    mode: 'train' | 'modify' | 'recover';
    selected: {
        templateId: string;
        category: SessionTemplate['category'];
        modality: SessionTemplate['modality'];
        projectedCost: WorkoutCostProfile;
    };
    fatigue: {
        rawExternalLoad: DimensionalFatigue;
        clampedExternalLoad: DimensionalFatigue;
        internalResponse: DimensionalFatigue;
        combined: DimensionalFatigue;
    };
    activeObjectives: Array<{ key: string; completedCredit: number; projectedCredit: number; requiredCredit: number }>;
    contributorObjectiveChanges: { added: string[]; dropped: string[] };
    fixedActivity: { count: number; cost: WorkoutCostProfile; stimulus: WorkoutStimulusProfile };
    rejectionCounts: Record<string, number>;
    utility: {
        top: number;
        runnerUp: number | null;
        bestBenefitTemplateId: string | null;
        bestBenefitScore: number | null;
        selectedBenefitScore: number | null;
        selectedVsBestBenefitGap: number | null;
    };
}
export interface ScenarioResult {
    scenarioId: string; label: string; description: string; weeksSimulated: number; totalDays: number;
    tags: readonly string[];
    categoryDistribution: Partial<Record<SessionTemplate['category'], number>>;
    modalityDistribution: Partial<Record<SessionTemplate['modality'], number>>;
    restOrRecoveryDayCount: number; restOrRecoveryDayPct: number;
    maxConsecutiveSameTemplateStreakWithinCall: number; maxConsecutiveSameTemplateStreakAcrossWeeks: number;
    objectiveResolution: ObjectiveTally[]; objectiveCredits: ObjectiveCredit[]; utilityDiagnostics: UtilityDiagnosticsSummary;
    qualityWarnings: string[]; anchorWeeks: AnchorWeekResult[]; anchorScopeNote: string | null;
    fatigueTierDayCounts: { train: number; modify: number; recover: number }; constraintViolations: string[];
    allocationReports: Array<{ weekIndex: number; report: WeeklyRoleAllocationReport }>;
    decisionTraces: ScenarioDecisionTrace[];
    weekSummaries: Array<{
        weekIndex: number;
        fatigueTierDayCounts: { train: number; modify: number; recover: number };
        restOrRecoveryDayCount: number;
    }>;
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
        date, dayOffset: 0, confidence: 'provisional', phaseName, template: recommendation.template,
        mode: recommendation.mode === 'recover' ? 'recover' : 'train', rationale: recommendation.rationale, addressesObjectives: [],
    };
}

function rejectionCounts(candidates: readonly { excludedReasons: string[] }[]): Record<string, number> {
    const counts: Record<string, number> = {};
    candidates.forEach(candidate => candidate.excludedReasons.forEach(reason => {
        counts[reason] = (counts[reason] ?? 0) + 1;
    }));
    return counts;
}

function traceFromRecommendation(weekIndex: number, date: string, recommendation: Recommendation): ScenarioDecisionTrace {
    const calibration = recommendation.decisionTrace?.calibration;
    const candidates = recommendation.decisionTrace?.candidateScores ?? [];
    const accepted = candidates.filter(candidate => candidate.excludedReasons.length === 0)
        .sort((left, right) => right.utilityScore - left.utilityScore);
    const selectedCandidate = candidates.find(candidate => candidate.templateId === recommendation.template.id);
    const bestBenefit = [...accepted].sort((left, right) => (right.benefitScore ?? -Infinity) - (left.benefitScore ?? -Infinity))[0];
    const selectedBenefitScore = selectedCandidate?.benefitScore ?? null;
    const bestBenefitScore = bestBenefit?.benefitScore ?? null;
    return {
        weekIndex, date, readinessTier: recommendation.mode, mode: recommendation.mode,
        selected: {
            templateId: recommendation.template.id,
            category: recommendation.template.category,
            modality: recommendation.template.modality,
            projectedCost: recommendation.template.costProfile ?? ZERO_COST,
        },
        fatigue: calibration?.fatigue ?? {
            rawExternalLoad: ZERO_FATIGUE, clampedExternalLoad: ZERO_FATIGUE,
            internalResponse: ZERO_FATIGUE, combined: ZERO_FATIGUE,
        },
        activeObjectives: calibration?.activeObjectives ?? [],
        contributorObjectiveChanges: {
            added: [],
            dropped: recommendation.decisionTrace?.droppedContributorObjectives.map(objective => objective.objectiveKey) ?? [],
        },
        fixedActivity: calibration?.fixedActivity ?? { count: 0, cost: ZERO_COST, stimulus: ZERO_STIMULUS },
        rejectionCounts: rejectionCounts(candidates),
        utility: {
            top: selectedCandidate?.utilityScore ?? 0,
            runnerUp: accepted.filter(candidate => candidate.templateId !== recommendation.template.id)[0]?.utilityScore ?? null,
            bestBenefitTemplateId: bestBenefit?.templateId ?? null,
            bestBenefitScore,
            selectedBenefitScore,
            selectedVsBestBenefitGap: bestBenefitScore === null || selectedBenefitScore === null ? null : bestBenefitScore - selectedBenefitScore,
        },
    };
}

function traceFromForecastDay(weekIndex: number, day: WeekAheadDay): ScenarioDecisionTrace {
    const diagnostics = day.diagnostics;
    if (!diagnostics) throw new Error(`Expected forecast diagnostics for ${day.date}.`);
    return {
        weekIndex, date: day.date, readinessTier: diagnostics.fatigueTier, mode: diagnostics.fatigueTier,
        selected: { templateId: day.template.id, category: day.template.category, modality: day.template.modality, projectedCost: day.template.costProfile ?? ZERO_COST },
        fatigue: {
            rawExternalLoad: diagnostics.fatigue?.rawExternalLoadFatigue ?? diagnostics.fatigue?.externalLoadFatigue ?? ZERO_FATIGUE,
            clampedExternalLoad: diagnostics.fatigue?.externalLoadFatigue ?? ZERO_FATIGUE,
            internalResponse: diagnostics.fatigue?.internalResponseStrain ?? ZERO_FATIGUE,
            combined: diagnostics.fatigue?.combinedFatigue ?? ZERO_FATIGUE,
        },
        activeObjectives: diagnostics.activeObjectives ?? [],
        contributorObjectiveChanges: diagnostics.contributorObjectiveChanges ?? { added: [], dropped: [] },
        fixedActivity: diagnostics.fixedActivity ?? { count: 0, cost: ZERO_COST, stimulus: ZERO_STIMULUS },
        rejectionCounts: diagnostics.rejectionCounts ?? {},
        utility: {
            top: diagnostics.topUtilityScore,
            runnerUp: diagnostics.runnerUpUtilityScore,
            bestBenefitTemplateId: diagnostics.bestBenefitTemplateId,
            bestBenefitScore: diagnostics.bestBenefitScore,
            selectedBenefitScore: diagnostics.selectedBenefitScore,
            selectedVsBestBenefitGap: diagnostics.bestBenefitScore - diagnostics.selectedBenefitScore,
        },
    };
}

function toCompletedExposure(day: WeekAheadDay): CompletedExposure {
    const workoutId = workoutForTemplate(day.template.id)?.id;
    return {
        occurrenceKey: `recommendation:${day.date}`,
        date: day.date,
        costProfile: day.template.costProfile ?? ZERO_COST,
        stimulusProfile: day.template.stimulusProfile,
        stimulusConfidence: 'exact',
        templateId: day.template.id,
        ...(workoutId ? { workoutId } : {}),
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
    allocationReports: Array<{ weekIndex: number; report: WeeklyRoleAllocationReport }>,
    decisionTraces: ScenarioDecisionTrace[],
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
                && (day.diagnostics.topUtilityScore - runnerUp) / day.diagnostics.topUtilityScore <= 0.05) fragileSelectionCount += 1;
            if (day.diagnostics.bestBenefitTemplateId !== day.template.id
                && day.diagnostics.bestBenefitScore > day.diagnostics.selectedBenefitScore) lowerBenefitSelectionCount += 1;
            if (day.diagnostics.fatigueTier === 'train' && (cat === 'Rest' || cat === 'Mobility/Recovery')) trainTierRestOrRecoveryCount += 1;
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
    const weekSummaries = weeklyDays.map((days, weekIndex) => {
        const weekFatigueTiers = { train: 0, modify: 0, recover: 0 };
        let weekRestOrRecoveryDays = 0;
        days.forEach(day => {
            if (day.template.category === 'Rest' || day.template.category === 'Mobility/Recovery') weekRestOrRecoveryDays += 1;
            if (day.diagnostics) weekFatigueTiers[day.diagnostics.fatigueTier] += 1;
        });
        return { weekIndex, fatigueTierDayCounts: weekFatigueTiers, restOrRecoveryDayCount: weekRestOrRecoveryDays };
    });
    const scenarioEvents = scenario.events ?? (scenario.event ? [scenario.event] : []);
    const primaryEvent = scenarioEvents[0] ?? null;
    const isCyclingRelevantEvent = primaryEvent?.category === 'cycling_event' || primaryEvent?.category === 'triathlon';
    const anchorScopeNote = isCyclingRelevantEvent ? null :
        'Anchor-day nomination only requires SOME focus event (Race-Specific Endurance templates\' phaseEligibility.requiresFocusEvent doesn\'t check event category), so a nomination can appear even here -- but the optimizer\'s event-priority penalty for non-matching modalities makes it unlikely to actually win the day\'s pick. Treat eventSpecificAnchorHit/qualityAnchorHit, not the raw nomination, as the meaningful signal for non-cycling scenarios.';

    const objectiveResolution = Array.from(objectiveTallies.values());
    const qualityWarnings: string[] = [];
    const missedObjectives = objectiveResolution.filter(o => o.timesResolved < o.timesGenerated);
    const isEvergreen = scenario.trainingIntentProfile?.planningMode === 'evergreen';
    // Evergreen packing reports safe partial-dose and target shortfalls in its weekly
    // budget. Those are athlete-facing feasibility facts, not a planner-quality failure.
    // Event-directed objectives remain strict calibration contracts.
    if (!isEvergreen && missedObjectives.length > 0) qualityWarnings.push(`Unresolved weekly objectives: ${missedObjectives.map(o => `${o.key} ${o.timesResolved}/${o.timesGenerated}`).join(', ')}.`);
    const creditedKeys = new Set(objectiveCredits.map(credit => credit.objectiveKey));
    const resolvedWithoutProjectedCredit = objectiveResolution.filter(o => o.timesResolved > 0 && !creditedKeys.has(o.key));
    if (resolvedWithoutProjectedCredit.length > 0) qualityWarnings.push(`Resolved objective(s) without a projected credit source in this window: ${resolvedWithoutProjectedCredit.map(o => o.key).join(', ')}. Verify whether completion was seeded from prior history.`);
    const missedAnchors = anchorWeeks.filter(w => w.eventSpecificAnchorDate && !w.eventSpecificAnchorFulfilled).length;
    if (missedAnchors > 0) qualityWarnings.push(`Event-specific anchor missed in ${missedAnchors} nominated week(s).`);
    const anchorPlacementDrift = anchorWeeks.filter(w => w.eventSpecificAnchorDate && !w.eventSpecificAnchorHit && w.eventSpecificAnchorFulfilled).length;
    if (anchorPlacementDrift > 0) qualityWarnings.push(`Event-specific exposure occurred off the nominated anchor date in ${anchorPlacementDrift} week(s).`);
    if (trainTierRestOrRecoveryCount > 0) qualityWarnings.push(`Rest or mobility selected on ${trainTierRestOrRecoveryCount} projected train-tier day(s).`);
    if (!isEvergreen && maxConsecutiveSameTemplateStreakAcrossWeeks >= 4) qualityWarnings.push(`Same-template streak reached ${maxConsecutiveSameTemplateStreakAcrossWeeks} days.`);
    if (primaryEvent?.category === 'triathlon') qualityWarnings.push('Triathlon capability is partial: the engine has no Swimming modality or swim objective/catalog support.');
    if (primaryEvent?.category === 'strength_meet') qualityWarnings.push('Strength-meet capability is partial: one generic weekly strength-maintenance objective cannot represent competition-lift programming.');
    const unexplainedMisses = allocationReports.flatMap(item => item.report.outcomes)
        .filter(outcome => outcome.status === 'missed' && !outcome.reason);
    if (unexplainedMisses.length > 0) qualityWarnings.push(`Required-role allocation misses without a typed reason: ${unexplainedMisses.map(item => item.occurrence.id).join(', ')}.`);

    return {
        scenarioId: scenario.id, label: scenario.label, description: scenario.description, tags: scenario.tags ?? [], weeksSimulated: scenario.weeks, totalDays: allDays.length,
        categoryDistribution, modalityDistribution, restOrRecoveryDayCount,
        restOrRecoveryDayPct: allDays.length > 0 ? Math.round((restOrRecoveryDayCount / allDays.length) * 1000) / 10 : 0,
        maxConsecutiveSameTemplateStreakWithinCall, maxConsecutiveSameTemplateStreakAcrossWeeks,
        objectiveResolution, objectiveCredits,
        utilityDiagnostics: { fragileSelectionCount, lowerBenefitSelectionCount, trainTierRestOrRecoveryCount },
        qualityWarnings, anchorWeeks, anchorScopeNote, fatigueTierDayCounts, constraintViolations, allocationReports, decisionTraces, weekSummaries,
    };
}

type WeekAheadPlanGenerator = typeof generateWeekAheadPlanWithIntent;

export interface SimulationRunOptions {
    /** Only the simulation harness may override this. Production entry points use `max`. */
    fatigueFusionPolicy?: FatigueFusionPolicy;
}

export async function runScenario(
    scenario: AthleteScenario,
    planGenerator: WeekAheadPlanGenerator = generateWeekAheadPlanWithIntent,
    options: SimulationRunOptions = {},
): Promise<ScenarioResult> {
    const events = [...(scenario.events ?? (scenario.event ? [scenario.event] : []))];
    const fixedActivities = scenario.fixedActivities ?? [];
    const fatigueFusionPolicy = options.fatigueFusionPolicy ?? 'max';
    const accumulatedHistory: CompletedExposure[] = [...(scenario.initialHistory ?? [])];
    const historyProvider: TrainingHistoryProvider = {
        reconstruct: async (_userId, throughDateExclusive, windowDays) => {
            const windowStart = addDaysToLocalDateString(throughDateExclusive, -windowDays);
            return accumulatedHistory.filter(exposure => exposure.date >= windowStart && exposure.date < throughDateExclusive);
        },
    };

    const weeklyDays: WeekAheadDay[][] = [];
    const anchorWeeks: AnchorWeekResult[] = [];
    const objectiveTallies = new Map<string, ObjectiveTally>();
    const objectiveCredits: ObjectiveCredit[] = [];
    const allocationReports: Array<{ weekIndex: number; report: WeeklyRoleAllocationReport }> = [];
    const decisionTraces: ScenarioDecisionTrace[] = [];
    let currentDate = scenario.startDate;

    for (let week = 0; week < scenario.weeks; week++) {
        const readiness = scenario.readinessForDate?.(currentDate, week) ?? scenario.readinessForWeek(week);
        const todayRec = await evaluateTrainingWithIntent(
            'sim-user', readiness, scenario.context, events, currentDate, undefined, historyProvider,
            null, fixedActivities, [], scenario.trainingIntentProfile ?? null, scenario.preferences ?? null, fatigueFusionPolicy,
        );
        const nextDayPlan = await evaluateNextDayPlanWithIntent(
            'sim-user', events, readiness, scenario.context, currentDate, todayRec, historyProvider,
            null, fixedActivities, [], scenario.trainingIntentProfile ?? null, scenario.preferences ?? null, fatigueFusionPolicy,
        );
        const tomorrowRec = nextDayPlan.branches.yellow.recommendation;

        const plan = await planGenerator(
            'sim-user', readiness, scenario.context, scenario.preferences ?? null, events, currentDate, todayRec, tomorrowRec,
            { days: 6, fixedActivities, fatigueFusionPolicy }, historyProvider, null, scenario.trainingIntentProfile ?? null,
        );
        const todayPhase = evaluatePeriodizationPhase(events, currentDate).phase.phaseName;
        const simulatedDays: WeekAheadDay[] = [recommendationAsDay(currentDate, todayRec, todayPhase), ...plan.days];
        decisionTraces.push(
            traceFromRecommendation(week, currentDate, todayRec),
            traceFromRecommendation(week, addDaysToLocalDateString(currentDate, 1), tomorrowRec),
            ...plan.days.filter(day => day.dayOffset > 1).map(day => traceFromForecastDay(week, day)),
        );

        const anchors = resolveWeeklyAnchors(currentDate, 6, events, fixedActivities, scenario.context, tomorrowRec.template.category, tomorrowRec.template.modality);
        const findPick = (date: string | null) => date ? simulatedDays.find(d => d.date === date) ?? null : null;
        const eventSpecificExposureDates = simulatedDays.filter(day => day.template.modality === 'Cycling' && day.template.category === 'Race-Specific Endurance').map(day => day.date);
        anchorWeeks.push({
            weekIndex: week, weekStartDate: currentDate, eventSpecificAnchorDate: anchors.eventSpecificAnchorDate, qualityAnchorDate: anchors.qualityAnchorDate,
            eventSpecificAnchorHit: anchors.eventSpecificAnchorDate ? (() => { const pick = findPick(anchors.eventSpecificAnchorDate); return pick?.template.modality === 'Cycling' && pick.template.category === 'Race-Specific Endurance'; })() : null,
            eventSpecificExposureDates,
            eventSpecificAnchorFulfilled: anchors.eventSpecificAnchorDate ? eventSpecificExposureDates.length > 0 : null,
            qualityAnchorHit: anchors.qualityAnchorDate ? (() => { const pick = findPick(anchors.qualityAnchorDate); return pick?.template.modality === 'Cycling' && ['Moderate Endurance', 'Hard Endurance'].includes(pick.template.category); })() : null,
        });

        weeklyDays.push(simulatedDays);
        allocationReports.push({ weekIndex: week, report: plan.allocationReport });
        plan.objectiveCredits.forEach(credit => objectiveCredits.push({ weekIndex: week, ...credit }));
        simulatedDays.forEach(day => accumulatedHistory.push(toCompletedExposure(day)));

        plan.microcycleObjectives.forEach(obj => {
            const tally = objectiveTallies.get(obj.key) ?? { key: obj.key, timesGenerated: 0, timesResolved: 0 };
            tally.timesGenerated += 1;
            if (obj.completedExposures >= obj.targetExposures) tally.timesResolved += 1;
            objectiveTallies.set(obj.key, tally);
        });
        currentDate = addDaysToLocalDateString(currentDate, 7);
    }
    return computeMetrics(scenario, weeklyDays, anchorWeeks, objectiveTallies, objectiveCredits, allocationReports, decisionTraces);
}

export interface SimulationReport { commit: string; capturedAt: string; engineVersion: string; policyVersion: string; scenarios: ScenarioResult[]; preferenceSensitivity: PreferenceSensitivityResult[]; readinessSensitivity: ReadinessSensitivityResult[]; }
export interface PreferenceSensitivityResult { preferredModality: string; preferredScenarioId: string; baselineScenarioId: string; changedPlannedDays: number; summary: string; }
export interface ReadinessSensitivityResult { trajectory: 'fresh' | 'stressed'; scenarioId: string; baselineScenarioId: string; changedPlannedDays: number; restOrRecoveryDayDelta: number; raceSpecificExposureDelta: number; summary: string; }
export interface CalibrationScenarioSummary {
    scenarioId: string;
    label: string;
    tags: readonly string[];
    modeCounts: { train: number; modify: number; recover: number };
    fatigueTierCounts: { train: number; modify: number; recover: number };
    rejectionCounts: Record<string, number>;
    recoverySelections: number;
    objectives: { created: number; resolved: number; missed: number };
    fragileTopTwoSelections: number;
    fixedActivityActivations: number;
    contributorTransitions: { added: number; dropped: number };
}
export interface CalibrationReport {
    evidenceType: 'synthetic policy-regression evidence; not clinical calibration';
    generatedFrom: { scenarioCount: number; totalDays: number };
    scenarios: CalibrationScenarioSummary[];
    aggregate: Omit<CalibrationScenarioSummary, 'scenarioId' | 'label' | 'tags'>;
}
export interface FatigueFusionScenarioComparison {
    scenarioId: string;
    changedSelections: number;
    increasedPeakFatigueDays: number;
    recoverySelectionDelta: number;
    restOrRecoveryDayDelta: number;
    objectiveMissDelta: number;
    constraintViolationDelta: number;
}
export interface FatigueFusionComparison {
    baselinePolicy: 'max';
    candidatePolicy: 'additive';
    baselineRuntimeMs: number;
    candidateRuntimeMs: number;
    scenarios: FatigueFusionScenarioComparison[];
    aggregate: Omit<FatigueFusionScenarioComparison, 'scenarioId'>;
}

function emptyTierCounts(): { train: number; modify: number; recover: number } {
    return { train: 0, modify: 0, recover: 0 };
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
    Object.entries(source).forEach(([key, value]) => { target[key] = (target[key] ?? 0) + value; });
}

function calibrationSummary(result: ScenarioResult): CalibrationScenarioSummary {
    const modeCounts = emptyTierCounts();
    const fatigueTierCounts = emptyTierCounts();
    const rejectionCounts: Record<string, number> = {};
    let recoverySelections = 0;
    let fixedActivityActivations = 0;
    let added = 0;
    let dropped = 0;
    result.decisionTraces.forEach(trace => {
        modeCounts[trace.readinessTier] += 1;
        fatigueTierCounts[trace.readinessTier] += 1;
        mergeCounts(rejectionCounts, trace.rejectionCounts);
        if (trace.selected.category === 'Rest' || trace.selected.category === 'Mobility/Recovery') recoverySelections += 1;
        fixedActivityActivations += trace.fixedActivity.count;
        added += trace.contributorObjectiveChanges.added.length;
        dropped += trace.contributorObjectiveChanges.dropped.length;
    });
    const objectives = result.objectiveResolution.reduce((total, objective) => ({
        created: total.created + objective.timesGenerated,
        resolved: total.resolved + objective.timesResolved,
        missed: total.missed + Math.max(0, objective.timesGenerated - objective.timesResolved),
    }), { created: 0, resolved: 0, missed: 0 });
    return {
        scenarioId: result.scenarioId, label: result.label, tags: result.tags,
        modeCounts, fatigueTierCounts, rejectionCounts, recoverySelections, objectives,
        fragileTopTwoSelections: result.utilityDiagnostics.fragileSelectionCount,
        fixedActivityActivations, contributorTransitions: { added, dropped },
    };
}

/** Produces review evidence from the bounded synthetic corpus. It intentionally makes no
 * threshold recommendation: rule frequency is not physiological calibration. */
export function buildCalibrationReport(report: SimulationReport): CalibrationReport {
    const scenarios = report.scenarios.map(calibrationSummary);
    const aggregate: Omit<CalibrationScenarioSummary, 'scenarioId' | 'label' | 'tags'> = {
        modeCounts: emptyTierCounts(),
        fatigueTierCounts: emptyTierCounts(),
        rejectionCounts: {},
        recoverySelections: 0,
        objectives: { created: 0, resolved: 0, missed: 0 },
        fragileTopTwoSelections: 0,
        fixedActivityActivations: 0,
        contributorTransitions: { added: 0, dropped: 0 },
    };
    scenarios.forEach(scenario => {
        (Object.keys(aggregate.modeCounts) as (keyof typeof aggregate.modeCounts)[])
            .forEach(tier => { aggregate.modeCounts[tier] += scenario.modeCounts[tier]; aggregate.fatigueTierCounts[tier] += scenario.fatigueTierCounts[tier]; });
        mergeCounts(aggregate.rejectionCounts, scenario.rejectionCounts);
        aggregate.recoverySelections += scenario.recoverySelections;
        aggregate.objectives.created += scenario.objectives.created;
        aggregate.objectives.resolved += scenario.objectives.resolved;
        aggregate.objectives.missed += scenario.objectives.missed;
        aggregate.fragileTopTwoSelections += scenario.fragileTopTwoSelections;
        aggregate.fixedActivityActivations += scenario.fixedActivityActivations;
        aggregate.contributorTransitions.added += scenario.contributorTransitions.added;
        aggregate.contributorTransitions.dropped += scenario.contributorTransitions.dropped;
    });
    return {
        evidenceType: 'synthetic policy-regression evidence; not clinical calibration',
        generatedFrom: { scenarioCount: scenarios.length, totalDays: report.scenarios.reduce((total, scenario) => total + scenario.totalDays, 0) },
        scenarios,
        aggregate,
    };
}

function peak(trace: ScenarioDecisionTrace): number {
    return Math.max(...Object.values(trace.fatigue.combined));
}

function objectiveMisses(result: ScenarioResult): number {
    return result.objectiveResolution.reduce((total, objective) => total + Math.max(0, objective.timesGenerated - objective.timesResolved), 0);
}

/** Runs the unchanged production planner twice; the only altered input is the explicitly
 * simulation-only fatigue fusion policy. */
export async function runFatigueFusionComparison(
    scenarios: AthleteScenario[] = SCENARIOS,
): Promise<FatigueFusionComparison> {
    const baselineStarted = performance.now();
    const baseline = await runAllScenarios(scenarios, 'simulation', { fatigueFusionPolicy: 'max' });
    const baselineRuntimeMs = performance.now() - baselineStarted;
    const candidateStarted = performance.now();
    const candidate = await runAllScenarios(scenarios, 'simulation', { fatigueFusionPolicy: 'additive' });
    const candidateRuntimeMs = performance.now() - candidateStarted;
    const baselineById = new Map(baseline.scenarios.map(result => [result.scenarioId, result]));
    const summaries = candidate.scenarios.map(next => {
        const current = baselineById.get(next.scenarioId);
        if (!current) throw new Error(`Missing max-policy result for ${next.scenarioId}.`);
        const candidateTraces = new Map(next.decisionTraces.map(trace => [trace.date, trace]));
        let changedSelections = 0;
        let increasedPeakFatigueDays = 0;
        current.decisionTraces.forEach(trace => {
            const compared = candidateTraces.get(trace.date);
            if (!compared) return;
            if (trace.selected.templateId !== compared.selected.templateId) changedSelections += 1;
            if (peak(compared) > peak(trace)) increasedPeakFatigueDays += 1;
        });
        const currentCalibration = calibrationSummary(current);
        const nextCalibration = calibrationSummary(next);
        return {
            scenarioId: next.scenarioId,
            changedSelections,
            increasedPeakFatigueDays,
            recoverySelectionDelta: nextCalibration.recoverySelections - currentCalibration.recoverySelections,
            restOrRecoveryDayDelta: next.restOrRecoveryDayCount - current.restOrRecoveryDayCount,
            objectiveMissDelta: objectiveMisses(next) - objectiveMisses(current),
            constraintViolationDelta: next.constraintViolations.length - current.constraintViolations.length,
        };
    });
    const aggregate = summaries.reduce<Omit<FatigueFusionScenarioComparison, 'scenarioId'>>((total, summary) => ({
        changedSelections: total.changedSelections + summary.changedSelections,
        increasedPeakFatigueDays: total.increasedPeakFatigueDays + summary.increasedPeakFatigueDays,
        recoverySelectionDelta: total.recoverySelectionDelta + summary.recoverySelectionDelta,
        restOrRecoveryDayDelta: total.restOrRecoveryDayDelta + summary.restOrRecoveryDayDelta,
        objectiveMissDelta: total.objectiveMissDelta + summary.objectiveMissDelta,
        constraintViolationDelta: total.constraintViolationDelta + summary.constraintViolationDelta,
    }), { changedSelections: 0, increasedPeakFatigueDays: 0, recoverySelectionDelta: 0, restOrRecoveryDayDelta: 0, objectiveMissDelta: 0, constraintViolationDelta: 0 });
    return { baselinePolicy: 'max', candidatePolicy: 'additive', baselineRuntimeMs, candidateRuntimeMs, scenarios: summaries, aggregate };
}

function distributionDifference(preferred: Partial<Record<SessionTemplate['modality'], number>>, baseline: Partial<Record<SessionTemplate['modality'], number>>): number {
    const modalities = new Set([...Object.keys(preferred), ...Object.keys(baseline)]);
    return Array.from(modalities).reduce((sum, modality) => sum + Math.abs((preferred[modality as SessionTemplate['modality']] ?? 0) - (baseline[modality as SessionTemplate['modality']] ?? 0)), 0) / 2;
}

function evaluatePreferenceSensitivity(results: ScenarioResult[]): PreferenceSensitivityResult[] {
    const byId = new Map(results.map(result => [result.scenarioId, result]));
    const comparisons = [{ preferredModality: 'Field', preferredScenarioId: 'field_sport_general_target', baselineScenarioId: 'no_event_base_phase' }];
    return comparisons.flatMap(comparison => {
        const preferred = byId.get(comparison.preferredScenarioId);
        const baseline = byId.get(comparison.baselineScenarioId);
        if (!preferred || !baseline) return [];
        const changedPlannedDays = distributionDifference(preferred.modalityDistribution, baseline.modalityDistribution);
        return [{ ...comparison, changedPlannedDays, summary: changedPlannedDays === 0 ? `${comparison.preferredModality} preference had no observable effect against its matched baseline.` : `${comparison.preferredModality} preference changed ${changedPlannedDays} planned modality day(s) against its matched baseline.` }];
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
        const raceSpecificExposureDelta = (scenario.categoryDistribution['Race-Specific Endurance'] ?? 0) - (baseline.categoryDistribution['Race-Specific Endurance'] ?? 0);
        return [{ trajectory, scenarioId: scenario.scenarioId, baselineScenarioId: baseline.scenarioId, changedPlannedDays, restOrRecoveryDayDelta, raceSpecificExposureDelta, summary: `${trajectory} trajectory: ${changedPlannedDays} modality day(s) changed; Rest/Mobility delta ${restOrRecoveryDayDelta >= 0 ? '+' : ''}${restOrRecoveryDayDelta}; race-specific exposure delta ${raceSpecificExposureDelta >= 0 ? '+' : ''}${raceSpecificExposureDelta}.` }];
    });
}

export async function runAllScenarios(
    scenarios: AthleteScenario[] = SCENARIOS,
    commit = 'unknown',
    options: SimulationRunOptions = {},
): Promise<SimulationReport> {
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) results.push(await runScenario(scenario, generateWeekAheadPlanWithIntent, options));
    return {
        commit, capturedAt: new Date().toISOString(), engineVersion: 'v2', policyVersion: '2026.08.x', scenarios: results,
        preferenceSensitivity: evaluatePreferenceSensitivity(results), readinessSensitivity: evaluateReadinessSensitivity(results),
    };
}
