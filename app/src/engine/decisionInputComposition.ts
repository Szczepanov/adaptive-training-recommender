import type { DailyDecisionInput, DailyRecoverySnapshot, DailySubjectiveCheckin, ScheduleOverlay, TrainingIntentProfile, TrainingSettings, UserGoal, UserPreferences } from './models';
import type { DataIssue, DataState, DataStateSummary } from './dataState';
import { summarizeDataState } from './dataState';
import { computeSubjectiveBaseline, REFERENCE_SUBJECTIVE_BASELINE_POLICY, type SubjectiveBaseline } from './subjectiveBaseline';
import { evaluateDataConfidence } from './dataConfidence';
import { deriveCarriedRegionRestrictions, type CarriedRegionRestriction } from './injuryPolicy';
import { addDaysToLocalDateString } from '../utils/localDate';

/** Raw history stays inside composition; only compact evidence leaves this boundary.
 * Schedule overlays retain their source state for audit and debugging. */
export interface ComposedDailyDecisionInput extends DailyDecisionInput {
    sourceStates: DailyDecisionInput['sourceStates'] & { scheduleOverlays: DataStateSummary };
    subjectiveBaseline: SubjectiveBaseline | null;
    subjectiveHistoryState: DataStateSummary;
    subjectiveHistoryIssues: DataIssue[];
    /** Pass the one-day tissue carry only to today's real context, never a forecast day. */
    carriedRegionRestrictions: CarriedRegionRestriction[];
}

type AvailableState<T> = Extract<DataState<T>, { status: 'AVAILABLE' }>;

export interface DailyDecisionSourceStates {
    userId: string;
    date: string;
    evaluatedAt: string;
    recoveryState: DataState<DailyRecoverySnapshot>;
    checkinState: DataState<DailySubjectiveCheckin>;
    goalsState: DataState<UserGoal[]>;
    trainingSettingsState: AvailableState<TrainingSettings>;
    preferencesState: DataState<UserPreferences>;
    trainingIntentProfileState: DataState<TrainingIntentProfile>;
    subjectiveHistoryState: DataState<DailySubjectiveCheckin[]>;
    scheduleOverlaysState: AvailableState<ScheduleOverlay[]>;
}

export function composeDailyDecisionInputFromSources({
    userId,
    date,
    evaluatedAt,
    recoveryState,
    checkinState,
    goalsState,
    trainingSettingsState,
    preferencesState,
    trainingIntentProfileState,
    subjectiveHistoryState: subjectiveHistoryRawState,
    scheduleOverlaysState,
}: DailyDecisionSourceStates): ComposedDailyDecisionInput {
    const recoverySnapshot = recoveryState.status === 'AVAILABLE' ? recoveryState.data : null;
    const subjectiveCheckin = checkinState.status === 'AVAILABLE' ? checkinState.data : null;
    const activeGoals = goalsState.status === 'AVAILABLE' ? goalsState.data : [];
    const trainingSettings = trainingSettingsState.data;
    const preferences = preferencesState.status === 'AVAILABLE' ? preferencesState.data : null;
    const trainingIntentProfile = trainingIntentProfileState.status === 'AVAILABLE' ? trainingIntentProfileState.data : null;
    const subjectiveBaseline = subjectiveHistoryRawState.status === 'AVAILABLE'
        ? computeSubjectiveBaseline(subjectiveHistoryRawState.data, date, REFERENCE_SUBJECTIVE_BASELINE_POLICY)
        : null;
    // Missing or unavailable history has no carry, matching the baseline's fail-open policy.
    const priorDay = addDaysToLocalDateString(date, -1);
    const priorDayCheckin = subjectiveHistoryRawState.status === 'AVAILABLE'
        ? subjectiveHistoryRawState.data.find(checkin => checkin.date === priorDay) ?? null
        : null;
    const carriedRegionRestrictions = deriveCarriedRegionRestrictions(
        trainingSettings.injuries,
        priorDayCheckin?.tissueResponses,
        priorDay,
    );
    const subjectiveHistoryIssues = subjectiveHistoryRawState.status === 'AVAILABLE'
        ? [...(subjectiveHistoryRawState.issues ?? [])]
        : subjectiveHistoryRawState.status === 'INVALID'
            ? [...subjectiveHistoryRawState.issues]
            : [];

    const sourceStates = {
        recoverySnapshot: summarizeDataState(recoveryState),
        subjectiveCheckin: summarizeDataState(checkinState),
        activeGoals: summarizeDataState(goalsState),
        trainingSettings: summarizeDataState(trainingSettingsState),
        preferences: summarizeDataState(preferencesState),
        trainingIntentProfile: summarizeDataState(trainingIntentProfileState),
        scheduleOverlays: summarizeDataState(scheduleOverlaysState),
    };
    const dataQuality = {
        hasRecoverySnapshot: recoverySnapshot !== null,
        hasSubjectiveCheckin: subjectiveCheckin !== null,
        subjectiveCheckinComplete: subjectiveCheckin?.dataQuality.isComplete ?? false,
        profileReady: preferences !== null,
    };
    const baseInput = {
        userId,
        date,
        recoverySnapshot,
        subjectiveCheckin,
        activeGoals,
        trainingSettings,
        preferences,
        trainingIntentProfile,
        scheduleOverlays: scheduleOverlaysState.data,
        sourceStates,
        dataQuality,
    } satisfies DailyDecisionInput;

    return {
        ...baseInput,
        dataConfidence: evaluateDataConfidence(baseInput, evaluatedAt),
        subjectiveBaseline,
        subjectiveHistoryState: summarizeDataState(subjectiveHistoryRawState),
        subjectiveHistoryIssues,
        carriedRegionRestrictions,
    };
}
