import { addDaysToLocalDateString } from '../utils/localDate';
import { stimulusConfidenceForTier } from './completedTraining';
import { deriveExternalSessionProfiles, toSyntheticTemplate } from './externalSessionProfiles';
import { occupiesDate, type PlacedSession } from './externalPlacement';
import { creditObjectivesFromStimulus, getUnresolvedObjectives } from './microcycle';
import { evaluateRecoveryConstraints, normalizeHistory, type RecentHistoryEntry } from './optimizer';
import {
    fatigueTierFor,
    fixedActivityCostProfileForDate,
    maxFatigueDimension,
    projectFatigueForRankingDate,
    PROJECTED_MODIFY_MAX_SYSTEMIC_COST,
} from './planner';
import { applyCompletedSessionLoad } from './fatigue';
import type { FatigueFusionPolicy } from './fatigue';
import type {
    DimensionalFatigue,
    FatigueState,
    FixedActivity,
    MicrocycleState,
    SessionHistoryEntry,
    TrainingIntentProfile,
} from './models';

/** Days in one plan week. The import contract fixes weeks to Monday-start. */
const WEEK_LENGTH_DAYS = 7;

export type ExternalCritiqueCode =
    /** The week's placed sessions do not cover an objective the athlete's phase asks for. */
    | 'unmet_weekly_objective'
    /** Projected fatigue on the session's own date would exclude an equivalent catalog template. */
    | 'projected_fatigue_exceeds_tier'
    /** One of `optimizer.ts`'s recovery-spacing constraints, applied to the imported session. */
    | 'recovery_constraint_violation'
    /** Placed session count sits outside the athlete's declared weekly commitment. */
    | 'weekly_session_count_outside_commitment';

export interface ExternalCritiqueFinding {
    code: ExternalCritiqueCode;
    /** The date the finding is about; `null` for a finding about the week as a whole. */
    date: string | null;
    sessionId: string | null;
    sessionTitle: string | null;
    /**
     * The engine rule that produced this finding, named in the engine's own vocabulary
     * (e.g. `QUALITY_SPACING_VIOLATION`) so a finding can be traced to the code that
     * raised it rather than only to prose.
     */
    rule: string;
    /** Athlete-facing statement of what the rule saw. */
    detail: string;
}

export interface ExternalWeekCritique {
    weekStartDate: string;
    findings: readonly ExternalCritiqueFinding[];
}

export interface ExternalWeekCritiqueInput {
    /** Monday of the week under review. */
    weekStartDate: string;
    planId: string;
    revision: number;
    /** Every resolved placement for the plan; this function selects the week's own. */
    placed: readonly PlacedSession[];
    /** Objectives already seeded from completed history (`buildMicrocycleState`). */
    microcycle: MicrocycleState;
    /** Objective fatigue as last measured, decayed forward from its own `lastUpdatedDate`. */
    fatigue: FatigueState;
    internalStrain: DimensionalFatigue;
    internalStrainAsOf: string;
    /** Simulation-only comparison knob. Live callers use the default `max`. */
    fatigueFusionPolicy?: FatigueFusionPolicy;
    weeklyCommitment: TrainingIntentProfile['weeklyCommitment'];
    /** Completed work before the week, for the spacing rules that look backwards. */
    trailingHistory?: readonly (RecentHistoryEntry | SessionHistoryEntry)[];
    fixedActivities?: readonly FixedActivity[];
}

const RECOVERY_CONSTRAINT_DETAIL: Record<string, string> = {
    QUALITY_SPACING_VIOLATION: 'a hard session sits on the day immediately after another hard session',
    HARD_LOWER_BODY_SPACING_VIOLATION: 'heavy lower-body work repeats before the spacing this engine requires',
    ROLLING_HARD_CAP_EXCEEDED: 'this would be the fourth hard session inside a rolling seven days',
    ANCHOR_PROTECTION_VIOLATION: 'heavy strength work and a key cycling session are stacked within a day of each other',
    RECOVERY_WINDOW_UNELAPSED: 'a hard session sits within the declared recovery window of a prior session',
};

/**
 * Non-blocking review of one week of an imported plan.
 *
 * This is what keeps Phases 2–7 load-bearing in `externally_planned` mode: the engine no
 * longer selects the week, but it still knows what a well-formed week looks like, and it
 * says so.
 *
 * **Advisory only (ADR-0019 D-CRITIQUE).** Nothing here can change an
 * `ExternalSessionVerdict`: this module does not import `externalSession.ts`, returns only
 * findings, and mutates none of its inputs. A critique the athlete disagrees with costs
 * them nothing — the plan's author remains the authority on what to train.
 *
 * Every finding is produced by an evaluator that already governs catalog selection, rather
 * than by a second set of rules written for imported plans. A week that the engine would
 * have refused to build is a week worth flagging, and the two must not be able to disagree
 * because they were implemented twice.
 */
export function critiqueExternalWeek(input: ExternalWeekCritiqueInput): ExternalWeekCritique {
    const weekEnd = addDaysToLocalDateString(input.weekStartDate, WEEK_LENGTH_DAYS - 1);
    const inWeek = input.placed
        .filter(item => occupiesDate(item.status) && item.date >= input.weekStartDate && item.date <= weekEnd)
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date) || left.session.id.localeCompare(right.session.id));

    const findings: ExternalCritiqueFinding[] = [
        ...weeklyCommitmentFindings(inWeek, input.weeklyCommitment),
        ...perDateFindings(inWeek, input),
        ...unmetObjectiveFindings(inWeek, input.microcycle),
    ];

    return { weekStartDate: input.weekStartDate, findings };
}

function weeklyCommitmentFindings(
    inWeek: readonly PlacedSession[],
    commitment: TrainingIntentProfile['weeklyCommitment'],
): ExternalCritiqueFinding[] {
    const count = inWeek.length;
    if (count >= commitment.minSessions && count <= commitment.maxSessions) return [];
    const direction = count < commitment.minSessions
        ? `${count} placed session${count === 1 ? '' : 's'}, below the ${commitment.minSessions} you committed to as a minimum`
        : `${count} placed sessions, above the ${commitment.maxSessions} you set as your ceiling`;
    return [{
        code: 'weekly_session_count_outside_commitment',
        date: null,
        sessionId: null,
        sessionTitle: null,
        rule: 'weeklyCommitment',
        detail: `This week has ${direction}.`,
    }];
}

/**
 * Walks the week in date order, carrying projected fatigue and a growing history forward,
 * so a session is judged against the load the earlier sessions of the same week would have
 * left behind — the same forward projection `planner.ts` uses to build a week itself.
 */
function perDateFindings(
    inWeek: readonly PlacedSession[],
    input: ExternalWeekCritiqueInput,
): ExternalCritiqueFinding[] {
    const findings: ExternalCritiqueFinding[] = [];
    const fusionPolicy = input.fatigueFusionPolicy ?? 'max';
    const fixedActivities = [...(input.fixedActivities ?? [])];
    let carriedFatigue = input.fatigue;
    // Raw entries, normalised together below. `normalizeHistory` is what derives `role` and
    // `intensityClass` from cost when they are absent, and every spacing rule in
    // `evaluateRecoveryConstraints` reads those. Pushing the week's own sessions in
    // un-normalised would silently exempt any imported session whose derived category is
    // not itself an anchor category -- a hard field session, for one.
    const rawHistory: (RecentHistoryEntry | SessionHistoryEntry)[] =
        [...(input.trailingHistory ?? [])].filter(entry => !entry.date || entry.date < input.weekStartDate);

    for (const placed of inWeek) {
        const template = toSyntheticTemplate(placed.session, input.planId, input.revision);
        const profiles = deriveExternalSessionProfiles(placed.session);
        const history = normalizeHistory(rawHistory, placed.date);

        // Same two steps as `evaluateProjectedDate`: decay to the date, then charge the
        // day's already-booked commitments before judging what the plan adds on top.
        const rankingFatigue = applyCompletedSessionLoad(
            projectFatigueForRankingDate(carriedFatigue, input.internalStrain, input.internalStrainAsOf, placed.date, fusionPolicy),
            placed.date,
            fixedActivityCostProfileForDate(fixedActivities, placed.date),
            fusionPolicy,
        );
        const peakFatigue = maxFatigueDimension(rankingFatigue.combinedFatigue);
        const fatigueTier = fatigueTierFor(peakFatigue);

        const tierFinding = fatigueTierFinding(placed, template.category, profiles.systemicCost, fatigueTier, peakFatigue);
        if (tierFinding) findings.push(tierFinding);

        for (const reason of evaluateRecoveryConstraints(template, placed.date, history, {
            date: placed.date,
            recentHistory: history,
            anchorRole: null,
            fatigueTier,
        })) {
            findings.push({
                code: 'recovery_constraint_violation',
                date: placed.date,
                sessionId: placed.session.id,
                sessionTitle: placed.session.title,
                rule: reason,
                detail: `“${placed.session.title}” on ${placed.date}: ${RECOVERY_CONSTRAINT_DETAIL[reason] ?? 'a recovery-spacing rule this engine applies to every session is not satisfied'}.`,
            });
        }

        rawHistory.push({
            date: placed.date,
            templateId: template.id,
            category: template.category,
            modality: template.modality,
            systemicCost: profiles.systemicCost,
            lowerBodyCost: profiles.costProfile.lowerBody,
        });
        carriedFatigue = applyCompletedSessionLoad(rankingFatigue, placed.date, profiles.costProfile, fusionPolicy);
    }

    return findings;
}

function fatigueTierFinding(
    placed: PlacedSession,
    category: string,
    systemicCost: number,
    fatigueTier: 'train' | 'modify' | 'recover',
    peakFatigue: number,
): ExternalCritiqueFinding | null {
    const peak = peakFatigue.toFixed(2);
    if (fatigueTier === 'recover' && category !== 'Rest' && category !== 'Mobility/Recovery') {
        return {
            code: 'projected_fatigue_exceeds_tier',
            date: placed.date,
            sessionId: placed.session.id,
            sessionTitle: placed.session.title,
            rule: 'PROJECTED_FATIGUE_RECOVER_THRESHOLD',
            detail: `Projected fatigue on ${placed.date} reaches ${peak}, where this engine would offer only rest or recovery. “${placed.session.title}” is neither.`,
        };
    }
    if (fatigueTier === 'modify' && systemicCost > PROJECTED_MODIFY_MAX_SYSTEMIC_COST) {
        return {
            code: 'projected_fatigue_exceeds_tier',
            date: placed.date,
            sessionId: placed.session.id,
            sessionTitle: placed.session.title,
            rule: 'PROJECTED_MODIFY_MAX_SYSTEMIC_COST',
            detail: `Projected fatigue on ${placed.date} reaches ${peak}, capping systemic load at ${PROJECTED_MODIFY_MAX_SYSTEMIC_COST}. “${placed.session.title}” is costed at ${systemicCost.toFixed(2)}.`,
        };
    }
    return null;
}

/**
 * Credits the week's placed sessions against the objective ledger and reports what is left
 * unmet. Credit is discounted at the `authoredExternal` rung (D-EXTTIER), so the critique
 * assumes exactly the credit the session would actually earn once completed rather than
 * flattering an imported plan into looking more complete than it is.
 */
function unmetObjectiveFindings(
    inWeek: readonly PlacedSession[],
    microcycle: MicrocycleState,
): ExternalCritiqueFinding[] {
    const confidence = stimulusConfidenceForTier('authoredExternal');
    const projected = inWeek.reduce((state, placed) => {
        const template = toSyntheticTemplate(placed.session, 'critique', 0);
        const profiles = deriveExternalSessionProfiles(placed.session);
        return creditObjectivesFromStimulus(state, profiles.stimulusProfile, template.modality, template.category, {}, confidence);
    }, microcycle);

    return getUnresolvedObjectives(projected).map(objective => {
        const required = objective.requiredCredit ?? objective.targetExposures;
        const completed = objective.completedCredit ?? objective.completedExposures;
        return {
            code: 'unmet_weekly_objective' as const,
            date: null,
            sessionId: null,
            sessionTitle: null,
            rule: `objective:${objective.key}`,
            detail: `Even with every session this week done as written, “${objective.title}” reaches ${completed.toFixed(2)} of the ${required.toFixed(2)} credit your current phase asks for.`,
        };
    });
}
