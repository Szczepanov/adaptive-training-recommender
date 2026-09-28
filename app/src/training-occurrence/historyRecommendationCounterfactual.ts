/**
 * TO4 (#646) recommendation-output counterfactual: runs the production
 * `evaluateTrainingWithIntent` decision path twice per date from one fixed non-history input,
 * swapping only the broad `CompletedExposure` history (live legacy vs canonical
 * counterfactual). Diagnostic only: no Firestore, no persistence, no flags, and no wall-clock
 * input -- history is served from memory through an injected provider with fixed metadata.
 */
import type {
    DailyReadiness,
    FixedActivity,
    Recommendation,
    TrainingIntentProfile,
    UserContext,
    UserEvent,
    UserPreferences,
} from '../engine/models';
import type { CompletedExposure, TrainingHistoryProvider } from '../engine/trainingHistory';
import type { TrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import { evaluateTrainingWithIntent } from '../engine/rules';
import { addDaysToLocalDateString } from '../utils/localDate';
import { workoutForTemplate } from '../workouts/prescription';
import { compareRecommendationOutputs, type RecommendationDelta } from './historyCounterfactual';

export interface NonHistoryDecisionInputs {
    readiness: DailyReadiness;
    context: UserContext;
    events: UserEvent[];
    fixedActivities: FixedActivity[];
    trainingIntentProfile: TrainingIntentProfile | null;
    preferences: UserPreferences | null;
}

export type DecisionProjection = Record<
    'verdict' | 'mode' | 'selectedTemplate' | 'prescription' | 'dose' | 'variant' | 'coverage' | 'sequence' | 'fatigue' | 'guardrails',
    unknown
>;

const EVIDENCE_USER = 'training-occurrence-evidence';
const FIXED_GENERATED_AT = '1970-01-01T00:00:00.000Z';

function windowed(exposures: readonly CompletedExposure[], throughDateExclusive: string, windowDays: number): CompletedExposure[] {
    const start = addDaysToLocalDateString(throughDateExclusive, -windowDays);
    return exposures.filter(exposure => exposure.date >= start && exposure.date < throughDateExclusive);
}

/** Read-only in-memory history with snapshot support, so wider evidence windows (rolling load,
 * athlete state) come from the same rows instead of a hidden Firestore read. */
export function inMemoryHistoryProvider(exposures: readonly CompletedExposure[], label: string): TrainingHistoryProvider {
    return {
        reconstruct: async (_userId, throughDateExclusive, windowDays) => windowed(exposures, throughDateExclusive, windowDays),
        getSnapshot: async (_userId, throughDateExclusive, windowDays): Promise<TrainingHistorySnapshot> => {
            const rows = windowed(exposures, throughDateExclusive, windowDays);
            return {
                throughDateExclusive,
                windowDays,
                completedEvents: [],
                exposures: rows,
                sourceStates: {
                    activities: { status: 'AVAILABLE', revision: label },
                    recommendations: { status: 'AVAILABLE', revision: label },
                    manualTraining: { status: 'MISSING' },
                },
                generatedAt: FIXED_GENERATED_AT,
                revision: `to4-${label}:${throughDateExclusive}:${windowDays}:${rows.length}`,
            };
        },
    };
}

function rounded(value: unknown): unknown {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;
    if (Array.isArray(value)) return value.map(rounded);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, rounded(child)]));
    }
    return value ?? null;
}

/** The decision-relevant, non-narrative projection of one engine result. Rationale text is
 * excluded; candidate ranking and exclusion reasons stand in for sequence and guardrails. */
export function projectRecommendation(recommendation: Recommendation): DecisionProjection {
    const trace = recommendation.decisionTrace;
    const ranked = [...(trace?.candidateScores ?? [])]
        .sort((left, right) => right.utilityScore - left.utilityScore || left.templateId.localeCompare(right.templateId));
    return rounded({
        verdict: recommendation.externalVerdict?.decision ?? null,
        mode: recommendation.mode,
        selectedTemplate: recommendation.template.id,
        prescription: { workoutId: workoutForTemplate(recommendation.template.id)?.id ?? null },
        dose: { planned: recommendation.plannedDose ?? null, execution: recommendation.executionDose ?? null, active: recommendation.activeDose ?? null },
        variant: recommendation.adjustment ?? null,
        coverage: trace?.calibration?.activeObjectives ?? null,
        sequence: ranked.slice(0, 5).map(candidate => ({ templateId: candidate.templateId, utilityScore: candidate.utilityScore })),
        fatigue: trace?.calibration?.fatigue ?? null,
        guardrails: {
            safety: recommendation.envelopes?.safety ?? null,
            plan: recommendation.envelopes?.plan ?? null,
            excludedReasons: [...new Set(ranked.flatMap(candidate => candidate.excludedReasons))].sort(),
        },
    }) as DecisionProjection;
}

async function evaluate(inputs: NonHistoryDecisionInputs, date: string, provider: TrainingHistoryProvider): Promise<DecisionProjection> {
    const recommendation = await evaluateTrainingWithIntent(
        EVIDENCE_USER, inputs.readiness, inputs.context, inputs.events, date, undefined, provider, null,
        inputs.fixedActivities, [], inputs.trainingIntentProfile, inputs.preferences, 'max',
    );
    return projectRecommendation(recommendation);
}

export interface CounterfactualEvaluation {
    date: string;
    live: DecisionProjection;
    canonical: DecisionProjection;
    delta: RecommendationDelta;
}

export interface CounterfactualSeries {
    evaluations: CounterfactualEvaluation[];
    evaluatedDates: number;
    changedDates: number;
    unresolvedDates: number;
    changedFieldCounts: Record<string, number>;
}

/**
 * Evaluates each date twice with identical non-history inputs. Every changed field is
 * `unresolved` unless the caller supplies a reviewed classification for it.
 */
export async function runHistoryCounterfactualSeries(
    inputs: NonHistoryDecisionInputs,
    liveHistory: readonly CompletedExposure[],
    canonicalHistory: readonly CompletedExposure[],
    dates: readonly string[],
    classifications: Readonly<Record<string, 'expected' | 'explainable' | 'unresolved'>> = {},
): Promise<CounterfactualSeries> {
    const liveProvider = inMemoryHistoryProvider(liveHistory, 'live');
    const canonicalProvider = inMemoryHistoryProvider(canonicalHistory, 'canonical');
    const evaluations: CounterfactualEvaluation[] = [];
    for (const date of [...dates].sort()) {
        const live = await evaluate(inputs, date, liveProvider);
        const canonical = await evaluate(inputs, date, canonicalProvider);
        evaluations.push({ date, live, canonical, delta: compareRecommendationOutputs(live, canonical, classifications) });
    }
    const changedFieldCounts: Record<string, number> = {};
    for (const evaluation of evaluations) {
        for (const field of evaluation.delta.changedFields) changedFieldCounts[field] = (changedFieldCounts[field] ?? 0) + 1;
    }
    return {
        evaluations,
        evaluatedDates: evaluations.length,
        changedDates: evaluations.filter(evaluation => evaluation.delta.changedFields.length > 0).length,
        unresolvedDates: evaluations.filter(evaluation => evaluation.delta.classification === 'unresolved').length,
        changedFieldCounts,
    };
}
