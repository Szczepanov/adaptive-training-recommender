import type {
    DailyReadiness,
    DimensionalFatigue,
    FatigueState,
    MicrocycleState,
    Recommendation,
    SessionHistoryEntry,
    SessionTemplate,
    UserContext,
    UserEvent,
    UserPreferences,
    WeeklyObjective,
} from './models';
import type { TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { resolvePlannedDoseForDate, resolveTrainingIntent } from './trainingIntent';
import { resolveAvailability } from './schedule';
import { isTemplatePhaseEligible, evaluatePeriodizationPhase, type PeriodizationResult } from './periodization';
import { eligibleTemplates } from './eligibility';
import { addDaysToLocalDateString } from '../utils/localDate';
import { applyCompletedSessionLoad, createEmptyFatigue } from './fatigue';
import { generateWeeklyObjectives, getUnresolvedObjectives } from './microcycle';
import { buildOptimizationContext, rankCandidates, type RecentHistoryEntry } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import { resolvePlanDefinitionForEvent } from './planSchedule';
import { deriveObjectiveCreditFromProfile } from './stimulus';
import { resolveMinimumDaysAfterHardLowerBody } from './planningCandidate';
import type { PlannedObjectiveCredit, WeekAheadDay, WeekAheadOptions, WeekAheadPlan, WeekAheadPlanSeed } from './planner';
import {
    applyProjectedObjectiveCredits,
    displayModeFromCategory,
    enrichedCostProfile,
    enrichedStimulusProfile,
    fatigueTierFor,
    isAdjacentDate,
    maxFatigueDimension,
    NEUTRAL_PREFERENCES,
    PROJECTED_FATIGUE_MODIFY_THRESHOLD,
    PROJECTED_FATIGUE_RECOVER_THRESHOLD,
    PROJECTED_MODIFY_MAX_SYSTEMIC_COST,
    projectFatigueForRankingDate,
    realizedSessionRole,
    resolveWeeklyAnchors,
    trailingHistoryFromCompletedExposures,
} from './planner';

/**
 * Phase 5.1: bounded sequence search -- an EXPERIMENT, not a scheduled migration.
 *
 * `generateWeekAheadPlan` (planner.ts) walks the "projected" tier one day at a time,
 * greedily: each day takes `rankCandidates`' rank-0 pick with no visibility into how that
 * choice constrains the days after it. This module scores the whole partial sequence
 * across a bounded beam instead, so the planner can prefer
 *
 *   Tue threshold / Thu easy aerobic / Sat race-specific
 *
 * over
 *
 *   Tue threshold / Wed threshold / Thu rest / Fri race-specific
 *
 * even when Wednesday's threshold scores higher in isolation -- the class of judgement
 * the greedy walk structurally cannot make.
 *
 * Deliberately maximal reuse, not a parallel engine: per (branch, day) this calls the
 * exact same `rankCandidates` Phase-3 lexicographic pipeline the greedy loop uses --
 * hard-gate rejection (`excludedReasons`) already happens *before* `rankCandidates`
 * returns a score at all, which is this prototype's "reject hard spacing/recovery
 * violations before scoring" for free, from the prerequisite the plan names. What
 * changes is which -- and how many -- of `rankCandidates`' accepted results a branch
 * keeps (top `candidatesPerDay`, not just rank 0), and that pruning after each day is by
 * *cumulative* sequence score, not that day's score alone.
 *
 * Today and tomorrow (the confirmed/provisional tiers) are copied verbatim from the
 * greedy inputs, unsearched -- this experiment concerns only the "projected" tier's
 * day-by-day walk, matching the plan's own framing (`Prerequisite: Phase 3's
 * lexicographic layer`, not a rethink of the confirmed/provisional tiers).
 *
 * NOT wired into the live default path. See docs/adr/0015-sequence-planning-and-session-role-model.md
 * for the recorded adoption decision and the comparison data behind it.
 */

export const DEFAULT_BEAM_WIDTH = 15;
export const DEFAULT_CANDIDATES_PER_DAY = 5;

const ZERO_DIMENSIONAL: DimensionalFatigue = {
    systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
};

interface SearchBranch {
    days: WeekAheadDay[];
    microcycle: MicrocycleState;
    externalFatigue: FatigueState;
    objectiveCredits: PlannedObjectiveCredit[];
    /** Sum of each day's utilityScore across the branch's whole sequence so far -- the
     *  thing beam pruning actually ranks on, not any single day's score. */
    cumulativeScore: number;
}

export interface SequenceExplainEntry {
    date: string;
    templateId: string;
    templateTitle: string;
    utilityScore: number;
    runnerUpUtilityScore: number | null;
    cumulativeScoreAfter: number;
}

export interface BeamSearchWeekAheadPlan {
    startDate: string;
    days: WeekAheadDay[];
    objectiveCredits: PlannedObjectiveCredit[];
    microcycleObjectives: WeeklyObjective[];
    /** The winning branch's own day-by-day trail -- "why is this the best week" in a
     *  directly answerable form: each day's chosen template, its score, the runner-up's
     *  score, and the running cumulative total that pruning actually selected on. */
    explain: SequenceExplainEntry[];
    beamWidthUsed: number;
    candidatesPerDayUsed: number;
    /** Total (branch, candidate) pairs scored across the whole search -- a rough cost
     *  signal for the "beam search cost" risk the plan calls out. */
    branchDaysScored: number;
}

export function beamSearchWeekAheadPlan(
    context: UserContext,
    preferences: UserPreferences | null,
    todayDate: string,
    todayRec: Recommendation,
    tomorrowRec: Recommendation | null,
    seed: WeekAheadPlanSeed,
    options: WeekAheadOptions = {},
    beamWidth: number = DEFAULT_BEAM_WIDTH,
    candidatesPerDay: number = DEFAULT_CANDIDATES_PER_DAY
): BeamSearchWeekAheadPlan {
    const totalDays = Math.max(1, options.days ?? 7);
    const events = options.events ?? [];
    const fixedActivities = options.fixedActivities ?? [];
    const effectivePreferences = preferences ?? NEUTRAL_PREFERENCES;

    const periodizationToday = evaluatePeriodizationPhase(events, todayDate);
    const initialMicrocycle: MicrocycleState = seed.microcycle ?? generateWeeklyObjectives(periodizationToday.phase, todayDate, periodizationToday.focusEvent);
    const internalStrain: DimensionalFatigue = seed.fatigue?.internalResponseStrain ?? ZERO_DIMENSIONAL;
    const internalStrainAsOf = todayDate;
    const initialFatigue: FatigueState = seed.fatigue?.externalLoadFatigue ? seed.fatigue : createEmptyFatigue(todayDate);

    const anchors = resolveWeeklyAnchors(todayDate, totalDays, events, fixedActivities, context, tomorrowRec?.template.category, tomorrowRec?.template.modality);

    const creditingObjectivesFor = (microcycle: MicrocycleState, template: SessionTemplate) => {
        const stimulus = enrichedStimulusProfile(template);
        return getUnresolvedObjectives(microcycle, true).flatMap(objective => {
            const credit = deriveObjectiveCreditFromProfile(objective, stimulus, {}, {
                modality: template.modality,
                category: template.category,
            });
            return credit.qualifies && credit.earnedCredit > 0
                ? [{ objective, earnedCredit: credit.earnedCredit }]
                : [];
        });
    };

    const applyPick = (
        branch: SearchBranch,
        date: string,
        template: SessionTemplate,
        derivedCredits = creditingObjectivesFor(branch.microcycle, template)
    ): SearchBranch => {
        const projected = applyProjectedObjectiveCredits(
            branch.microcycle,
            derivedCredits.map(item => ({ objectiveId: item.objective.id, earnedCredit: item.earnedCredit })),
        );
        const allocationById = new Map(projected.allocations.map(item => [item.objectiveId, item.earnedCredit]));
        const newCredits: PlannedObjectiveCredit[] = [];
        derivedCredits.forEach(({ objective }) => {
            const allocated = allocationById.get(objective.id) ?? 0;
            if (allocated <= 0) return;
            newCredits.push({
                date, objectiveKey: objective.key, objectiveTitle: objective.title,
                templateId: template.id, templateTitle: template.title, modality: template.modality,
                earnedCredit: allocated,
            });
        });
        return {
            ...branch,
            microcycle: projected.microcycle,
            externalFatigue: applyCompletedSessionLoad(branch.externalFatigue, date, enrichedCostProfile(template.id)),
            objectiveCredits: [...branch.objectiveCredits, ...newCredits],
        };
    };

    const extendBranch = (
        branch: SearchBranch,
        date: string,
        offset: number,
        periodization: PeriodizationResult,
        template: SessionTemplate,
        utilityScore: number,
        benefitScore: number,
        costPenalty: number,
        peakFatigue: number,
        runnerUpUtility: number | null,
        bestBenefitTemplateId: string,
        bestBenefitScore: number,
        rationale: string
    ): SearchBranch => {
        const pickCredits = creditingObjectivesFor(branch.microcycle, template);
        const addressed = pickCredits.map(item => item.objective.title);
        const applied = applyPick(branch, date, template, pickCredits);
        const day: WeekAheadDay = {
            date, dayOffset: offset, confidence: 'projected', phaseName: periodization.phase.phaseName,
            template, mode: displayModeFromCategory(template.category), rationale, addressesObjectives: addressed,
            diagnostics: {
                peakFatigue, fatigueTier: fatigueTierFor(peakFatigue), topUtilityScore: utilityScore,
                runnerUpUtilityScore: runnerUpUtility, selectedBenefitScore: benefitScore, selectedCostPenalty: costPenalty,
                bestBenefitTemplateId, bestBenefitScore,
            },
        };
        return { ...applied, days: [...branch.days, day], cumulativeScore: branch.cumulativeScore + utilityScore };
    };

    // Today + tomorrow: copied from the greedy inputs verbatim, unsearched (see module doc).
    let seedBranch: SearchBranch = {
        days: [], microcycle: initialMicrocycle, externalFatigue: initialFatigue, objectiveCredits: [], cumulativeScore: 0,
    };
    seedBranch = applyPick(seedBranch, todayDate, todayRec.template);

    const confirmedDays: WeekAheadDay[] = [];
    if (tomorrowRec) {
        const tomorrowDate = addDaysToLocalDateString(todayDate, 1);
        const tomorrowPeriodization = evaluatePeriodizationPhase(events, tomorrowDate);
        const tomorrowCredits = creditingObjectivesFor(seedBranch.microcycle, tomorrowRec.template);
        const tomorrowDay: WeekAheadDay = {
            date: tomorrowDate, dayOffset: 1, confidence: 'provisional', phaseName: tomorrowPeriodization.phase.phaseName,
            template: tomorrowRec.template, mode: tomorrowRec.mode === 'recover' ? 'recover' : 'train',
            rationale: tomorrowRec.rationale, addressesObjectives: tomorrowCredits.map(item => item.objective.title),
        };
        confirmedDays.push(tomorrowDay);
        seedBranch = applyPick(seedBranch, tomorrowDate, tomorrowRec.template, tomorrowCredits);
    }

    let beam: SearchBranch[] = [seedBranch];
    let branchDaysScored = 0;
    const restFallback = ENRICHED_TEMPLATES.find(t => t.category === 'Rest');

    for (let offset = confirmedDays.length + 1; offset <= totalDays; offset++) {
        const date = addDaysToLocalDateString(todayDate, offset);
        const periodization = evaluatePeriodizationPhase(events, date);
        const availability = resolveAvailability(date, null, fixedActivities, context);
        const planDefinition = resolvePlanDefinitionForEvent(periodization.focusEvent);

        const nextGeneration: SearchBranch[] = [];

        for (const branch of beam) {
            const rankingFatigue = projectFatigueForRankingDate(branch.externalFatigue, internalStrain, internalStrainAsOf, date);
            const unresolved = getUnresolvedObjectives(branch.microcycle, true);
            const eligible = eligibleTemplates(ENRICHED_TEMPLATES, context, availability.maxTimeMinutes, date)
                .filter(t => isTemplatePhaseEligible(t, periodization));

            const peakFatigue = maxFatigueDimension(rankingFatigue.combinedFatigue);
            const fatigueGated = eligible.filter(t => {
                if (peakFatigue >= PROJECTED_FATIGUE_RECOVER_THRESHOLD) return t.category === 'Rest' || t.category === 'Mobility/Recovery';
                if (peakFatigue >= PROJECTED_FATIGUE_MODIFY_THRESHOLD) return t.systemicCost <= PROJECTED_MODIFY_MAX_SYSTEMIC_COST;
                return true;
            });

            const anchorRole = date === anchors.eventSpecificAnchorDate ? 'event-specific'
                : date === anchors.qualityAnchorDate ? 'quality' : null;
            const adjacentToAnchor = isAdjacentDate(date, anchors.eventSpecificAnchorDate)
                || isAdjacentDate(date, anchors.qualityAnchorDate);

            const projectedHistory: (RecentHistoryEntry | SessionHistoryEntry)[] = [
                ...(seed.trailingHistory ?? []),
                {
                    date: todayDate, templateId: todayRec.template.id, category: todayRec.template.category,
                    modality: todayRec.template.modality, role: realizedSessionRole(todayDate, todayRec.template, anchors),
                    systemicCost: todayRec.template.systemicCost, lowerBodyCost: todayRec.template.costProfile?.lowerBody ?? 0,
                    type: todayRec.template.title,
                },
                ...[...confirmedDays, ...branch.days].map(d => ({
                    date: d.date, templateId: d.template.id, category: d.template.category, modality: d.template.modality,
                    role: realizedSessionRole(d.date, d.template, anchors), systemicCost: d.template.systemicCost,
                    lowerBodyCost: d.template.costProfile?.lowerBody ?? 0, type: d.template.title,
                })),
            ];

            const optContext = buildOptimizationContext(
                {
                    unresolvedObjectives: unresolved,
                    fatigue: rankingFatigue,
                    periodization,
                    history: projectedHistory,
                    plannedDose: resolvePlannedDoseForDate(periodization.phase, branch.microcycle.objectives, unresolved, planDefinition, date),
                },
                context, effectivePreferences, date,
                { anchorRole, adjacentToAnchor, resolveMinimumDaysAfterHardLowerBody }
            );

            const rankingResult = rankCandidates(
                fatigueGated, optContext.unresolvedObjectives, optContext.fatigueState, optContext.availability,
                optContext.injuryConstraints, optContext.preferences, optContext.options
            );

            // Hard-constraint rejection already happened inside rankCandidates -- accepted
            // is the post-rejection, scored candidate set. This is the plan's "reject
            // before scoring" step, reused rather than reimplemented.
            const accepted = rankingResult.accepted;
            branchDaysScored += accepted.length;

            if (accepted.length === 0) {
                if (restFallback) {
                    nextGeneration.push(extendBranch(
                        branch, date, offset, periodization, restFallback,
                        0, 0, 0, peakFatigue, null, restFallback.id, 0, 'No admissible candidate; fell back to rest.'
                    ));
                }
                continue;
            }

            const bestBenefit = [...accepted].sort((a, b) => b.benefitScore - a.benefitScore)[0];
            accepted.slice(0, candidatesPerDay).forEach(candidate => {
                nextGeneration.push(extendBranch(
                    branch, date, offset, periodization, candidate.template,
                    candidate.utilityScore, candidate.benefitScore, candidate.costPenalty,
                    peakFatigue, accepted[1]?.utilityScore ?? null,
                    bestBenefit.template.id, bestBenefit.benefitScore, candidate.rationale
                ));
            });
        }

        // Whole-sequence pruning: the beam survives on cumulative score, not the best
        // single day -- this is what lets the search prefer a slightly weaker day if it
        // keeps stronger options open for the rest of the week.
        nextGeneration.sort((a, b) => b.cumulativeScore - a.cumulativeScore);
        // Only replace the beam if at least one branch survived this day. Every branch
        // pushes a rest-fallback extension when `accepted.length === 0`, so an empty
        // `nextGeneration` should not happen -- but resetting to `[seedBranch]` on it would
        // discard every previously-planned day while `offset` keeps advancing, producing a
        // truncated/misnumbered plan. Keeping the current (pre-this-day) beam instead means
        // the search simply stalls on this day rather than corrupting what came before it.
        if (nextGeneration.length > 0) {
            beam = nextGeneration.slice(0, beamWidth);
        }
    }

    const winner = beam[0] ?? seedBranch;
    const explain: SequenceExplainEntry[] = winner.days.map(day => ({
        date: day.date,
        templateId: day.template.id,
        templateTitle: day.template.title,
        utilityScore: day.diagnostics?.topUtilityScore ?? 0,
        runnerUpUtilityScore: day.diagnostics?.runnerUpUtilityScore ?? null,
        cumulativeScoreAfter: winner.days
            .slice(0, winner.days.indexOf(day) + 1)
            .reduce((sum, d) => sum + (d.diagnostics?.topUtilityScore ?? 0), 0),
    }));

    return {
        startDate: addDaysToLocalDateString(todayDate, 1),
        days: [...confirmedDays, ...winner.days],
        objectiveCredits: winner.objectiveCredits,
        microcycleObjectives: winner.microcycle.objectives ?? [],
        explain,
        beamWidthUsed: beamWidth,
        candidatesPerDayUsed: candidatesPerDay,
        branchDaysScored,
    };
}

/**
 * Drop-in beam-search analog of `planner.ts`'s `generateWeekAheadPlanWithIntent`, same
 * arity through `preparedHistorySnapshot` so a comparison harness (see
 * `simulation/analyze.ts`'s `runScenario` optional `planGenerator` parameter) can swap it
 * in for the exact same scenario without duplicating history/microcycle/fatigue
 * resolution. Strips `BeamSearchWeekAheadPlan`'s extra diagnostic fields
 * (`explain`/`beamWidthUsed`/etc.) down to the plain `WeekAheadPlan` shape the harness
 * already knows how to score.
 */
export async function generateWeekAheadPlanWithIntentBeamSearch(
    userId: string,
    todayReadiness: DailyReadiness,
    context: UserContext,
    preferences: UserPreferences | null,
    events: UserEvent[],
    todayDate: string,
    todayRec: Recommendation,
    tomorrowRec: Recommendation | null,
    options: WeekAheadOptions = {},
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
    beamWidth: number = DEFAULT_BEAM_WIDTH,
    candidatesPerDay: number = DEFAULT_CANDIDATES_PER_DAY
): Promise<WeekAheadPlan> {
    const intent = await resolveTrainingIntent(userId, events, todayDate, todayReadiness, 7, historyProvider, preparedHistorySnapshot);
    const result = beamSearchWeekAheadPlan(
        context,
        preferences,
        todayDate,
        todayRec,
        tomorrowRec,
        {
            microcycle: intent.microcycle,
            fatigue: intent.fatigue,
            trailingHistory: trailingHistoryFromCompletedExposures(intent.history, todayDate),
            droppedContributorObjectives: intent.droppedContributorObjectives,
        },
        { ...options, events },
        beamWidth,
        candidatesPerDay
    );
    return {
        startDate: result.startDate,
        days: result.days,
        objectiveCredits: result.objectiveCredits,
        microcycleObjectives: result.microcycleObjectives,
        droppedContributorObjectives: intent.droppedContributorObjectives,
    };
}
