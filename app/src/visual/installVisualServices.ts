import { decisionComposer } from '../engine/composer';
import { checkinService } from '../services/checkinService';
import { activityService } from '../services/activityService';
import { goalService } from '../services/goalService';
import { preferencesService } from '../services/preferencesService';
import { planBlockService } from '../services/planBlockService';
import { recommendationService } from '../services/recommendationService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import { activityOverrideService } from '../services/activityOverrideService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { trainingIntentProfileService } from '../services/trainingIntentProfileService';
import { strengthSessionService } from '../services/strengthSessionService';
import { strengthHistoryReadService } from '../services/strengthHistoryReadService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { sessionDefinitionService } from '../services/sessionDefinitionService';
import { executionPrescriptionService } from '../services/executionPrescriptionService';
import { externalPlanService } from '../services/externalPlanService';
import { fixedActivityService } from '../services/fixedActivityService';
import { sessionOccurrenceService } from '../services/sessionOccurrenceService';
import { decisionJournalService } from '../services/decisionJournalService';
import { computeContentHash } from '../engine/externalPlanHash';
import type { VisualFixture } from './fixtures';

/**
 * The production pages import singleton services directly. The visual-only entry point
 * replaces just their I/O methods before React renders, allowing the actual UI to run
 * against stable synthetic inputs without authenticating or reading Firestore.
 */
export function installVisualServices(fixture: VisualFixture): void {
  // Phase 9.4: visual fixtures model canonical DailyDecisionInput, while the composer now
  // returns a composition-only extension carrying normalized/compact history evidence.
  // Visual review has no Firestore history source, so represent that honestly as missing.
  decisionComposer.composeDailyDecisionInput = async () => ({
    ...fixture.input,
    subjectiveBaseline: null,
    subjectiveHistoryState: { status: 'MISSING' },
    subjectiveHistoryIssues: [],
  });

  checkinService.getCheckin = async () => fixture.checkin;
  checkinService.upsertTodayCheckin = async (_userId, update) => ({
    ...(fixture.checkin ?? { userId: fixture.input.userId, date: fixture.input.date }),
    ...update,
  }) as Awaited<ReturnType<typeof checkinService.upsertTodayCheckin>>;

  recoverySnapshotService.getRecoverySnapshotByDate = async () => fixture.recovery;
  recoverySnapshotService.getRecoverySnapshotState = async () => (
    fixture.recovery
      ? { status: 'AVAILABLE', data: fixture.recovery, revision: null }
      : { status: 'MISSING' }
  );
  activityOverrideService.getAllOverrides = async () => ({});
  activityOverrideService.getOverride = async () => null;
  activityOverrideService.setOverride = async () => {};
  activityOverrideService.deleteOverride = async () => {};
  activityService.getActivitiesInRange = async () => ({
    status: 'AVAILABLE', data: fixture.activities, revision: null,
  });

  goalService.listGoals = async () => fixture.goals;
  goalService.getActiveGoals = async () => fixture.goals;

  preferencesService.getPreferences = async () => fixture.preferences;
  preferencesService.initializeDefaultPreferences = async () => fixture.preferences;
  preferencesService.upsertPreferences = async (_userId, updates) => ({ ...fixture.preferences, ...updates });

  trainingSettingsService.getTrainingSettings = async () => fixture.settings;
  trainingSettingsService.updateTrainingSettings = async (_userId, update) => ({
    ...fixture.settings,
    ...update,
    equipment: { ...fixture.settings.equipment, ...update.equipment },
    guardrails: { ...fixture.settings.guardrails, ...update.guardrails },
    defaults: { ...fixture.settings.defaults, ...update.defaults },
    preferences: { ...fixture.settings.preferences, ...update.preferences },
    migration: { ...fixture.settings.migration, ...update.migration },
  });
  trainingIntentProfileService.getProfileState = async () => (
    fixture.input.trainingIntentProfile
      ? { status: 'AVAILABLE', data: fixture.input.trainingIntentProfile, revision: null }
      : { status: 'MISSING' }
  );
  trainingIntentProfileService.upsert = async (_userId, profile) => ({
    ...profile,
    userId: fixture.input.userId,
    createdAt: fixture.input.date,
    updatedAt: fixture.input.date,
  });

  fixedActivityService.getActivitiesInRangeState = async () => ({ status: 'AVAILABLE', data: [], revision: null });
  planBlockService.getBlocksInRangeState = async () => ({ status: 'AVAILABLE', data: [], revision: null });
  const plan = fixture.externalPlan;
  externalPlanService.listPlanIds = async () => (plan
    ? { status: 'AVAILABLE', data: [plan.planId], revision: null }
    : { status: 'AVAILABLE', data: [], revision: null });
  externalPlanService.getHeaderState = async () => {
    if (!plan) return { status: 'MISSING' };
    const contentHash = await computeContentHash(plan);
    return {
      status: 'AVAILABLE',
      revision: contentHash,
      data: {
        userId: fixture.input.userId, planId: plan.planId, revision: plan.revision, title: plan.title,
        startDate: plan.startDate, weekCount: plan.weekCount, contentHash,
        importedAt: fixture.input.date, supersededFrom: null, updatedAt: fixture.input.date,
      },
    };
  };
  externalPlanService.getRevisionState = async () => (plan
    ? { status: 'AVAILABLE', data: plan, revision: String(plan.revision) }
    : { status: 'MISSING' });
  externalPlanService.getPlacementState = async () => ({ status: 'MISSING' });
  externalPlanService.savePlacement = async (_userId, placement) => ({
    ...placement, userId: fixture.input.userId, updatedAt: fixture.input.date,
  });

  recommendationService.getRecommendation = async () => null;
  recommendationService.getRecommendationsInRange = async () => ({ status: 'AVAILABLE', data: [], revision: null });
  recommendationService.saveRecommendation = async () => null;

  strengthSessionService.getSessionsInRange = async () => ({
    sessions: fixture.strengthSession ? [fixture.strengthSession] : [],
    invalidRecords: 0,
  });
  strengthHistoryReadService.getSessionsInRange = async () => ({
    sessions: fixture.strengthSession ? [fixture.strengthSession] : [],
    invalidRecords: 0,
  });
  strengthSessionService.findActiveSession = async () => fixture.strengthSession ?? null;
  strengthSessionService.getSessionState = async () => (
    fixture.strengthSession
      ? { status: 'AVAILABLE', data: fixture.strengthSession, revision: null }
      : { status: 'MISSING' }
  );
  strengthSessionService.observeSession = (_userId, _sessionId, listener) => {
    if (fixture.strengthSession) {
      listener({ status: 'AVAILABLE', data: fixture.strengthSession, revision: null }, false);
    } else {
      listener({ status: 'MISSING' }, false);
    }
    return () => {};
  };
  strengthSessionService.saveExercises = async () => {};
  strengthSessionService.startSession = async () => fixture.strengthSession ?? {
    userId: fixture.input.userId,
    sessionId: 'visual-strength-session-new',
    date: fixture.input.date,
    startedAt: fixture.input.date,
    updatedAt: fixture.input.date,
    state: 'in_progress',
    exercises: [],
    schemaVersion: 1,
  };
  strengthSessionService.transitionState = async (_userId, _sessionId, next) => ({
    ...(fixture.strengthSession ?? {
      userId: fixture.input.userId,
      sessionId: 'visual-strength-session-new',
      date: fixture.input.date,
      startedAt: fixture.input.date,
      exercises: [],
      schemaVersion: 1,
    }),
    state: next,
    updatedAt: fixture.input.date,
  });

  // The general session runner owns its execution records independently of the
  // retired Strength-session service. Keep visual scenarios local and repeatable.
  sessionExecutionService.findInProgressExecution = async () => null;
  sessionExecutionService.getEntries = async () => [];
  sessionExecutionService.getExecutionsInRange = async () => ({ executions: [], invalidRecords: 0 });
  sessionExecutionService.startExecution = async (_userId, executionId, params) => ({
    userId: fixture.input.userId,
    executionId,
    sessionSource: params.sessionSource,
    ...(params.occurrenceId ? { occurrenceId: params.occurrenceId } : {}),
    ...(params.prescriptionHash ? { prescriptionHash: params.prescriptionHash } : {}),
    date: params.date,
    startedAt: fixture.input.date,
    updatedAt: fixture.input.date,
    state: 'in_progress' as const,
    schemaVersion: 1,
  });
  sessionExecutionService.logEntry = async () => {};
  sessionExecutionService.correctEntry = async () => {};
  sessionExecutionService.deleteEntry = async () => {};
  sessionExecutionService.transitionExecution = async () => {};
  sessionDefinitionService.listDefinitionHeaders = async () => ({ status: 'AVAILABLE', data: [], revision: null });
  // Home persists the content-addressed catalog prescription before exposing its Start CTA.
  // Keep that evidence write inside the visual harness rather than waiting on real Firestore.
  executionPrescriptionService.savePrescription = async () => {};

  sessionOccurrenceService.getReplaceOccurrenceForDate = async () => null;
  sessionOccurrenceService.getAdditionalOccurrencesForDate = async () => [];
  sessionOccurrenceService.getOccurrencesForDate = async () => [];
  sessionOccurrenceService.getOccurrence = async () => ({ status: 'MISSING' });
  sessionOccurrenceService.saveOccurrence = async () => {};

  decisionJournalService.getEntryState = async () => ({ status: 'MISSING' });
  decisionJournalService.getEntry = async () => null;
  decisionJournalService.recordActualVerdict = async (_userId, _date, actualVerdict) => ({
    userId: fixture.input.userId,
    date: fixture.input.date,
    externalVerdict: 'proceed',
    actualVerdict,
    sawEngineVerdictFirst: false,
    schemaVersion: 1,
    createdAt: fixture.input.date,
    updatedAt: fixture.input.date,
  });
  decisionJournalService.recordMorningEntry = async () => ({
    userId: fixture.input.userId,
    date: fixture.input.date,
    externalVerdict: 'proceed',
    sawEngineVerdictFirst: false,
    schemaVersion: 1,
    createdAt: fixture.input.date,
    updatedAt: fixture.input.date,
  });

  recommendationService.getAdherenceStats = async () => ({
    totalRecommendations: 14,
    answered: 12,
    awaitingResponse: 2,
    followedCount: 9,
    modifiedCount: 2,
    skippedCount: 1,
    followedRate: 75,
    byMode: {
      train: { total: 8, followedRate: 88 },
      modify: { total: 4, followedRate: 50 },
      recover: { total: 2, followedRate: 100 },
    },
  });
}
