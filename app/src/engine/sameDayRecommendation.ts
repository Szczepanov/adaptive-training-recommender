/** Shared Home/evidence call shape for the current same-day evaluator. */
import { evaluateTrainingWithIntent } from './rules';

type RecommendationArgs = Parameters<typeof evaluateTrainingWithIntent>;

export interface SameDayRecommendationInputs {
    userId: RecommendationArgs[0];
    readiness: RecommendationArgs[1];
    context: RecommendationArgs[2];
    events: RecommendationArgs[3];
    date: RecommendationArgs[4];
    previousMode?: RecommendationArgs[5];
    historyProvider?: RecommendationArgs[6];
    preparedHistorySnapshot?: RecommendationArgs[7];
    fixedActivities: RecommendationArgs[8];
    authoredPlanBlocks: RecommendationArgs[9];
    trainingIntentProfile: RecommendationArgs[10];
    preferences: RecommendationArgs[11];
    externalPlan: RecommendationArgs[13];
    externalRest: RecommendationArgs[16];
    scheduleOverlays: RecommendationArgs[18];
    confirmedProgressionOverrides: RecommendationArgs[19];
    mechanicalCheckinHistory?: RecommendationArgs[21];
}

export function sameDayRecommendationArguments(input: SameDayRecommendationInputs): RecommendationArgs {
    return [
        input.userId,
        input.readiness,
        input.context,
        input.events,
        input.date,
        input.previousMode,
        input.historyProvider,
        input.preparedHistorySnapshot,
        input.fixedActivities,
        input.authoredPlanBlocks,
        input.trainingIntentProfile,
        input.preferences,
        'max',
        input.externalPlan,
        undefined,
        undefined,
        input.externalRest,
        false,
        input.scheduleOverlays,
        input.confirmedProgressionOverrides,
        undefined,
        input.mechanicalCheckinHistory,
    ];
}

export function evaluateSameDayRecommendation(input: SameDayRecommendationInputs) {
    return evaluateTrainingWithIntent(...sameDayRecommendationArguments(input));
}
