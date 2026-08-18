import { decisionComposer } from '../engine/composer';
import { checkinService } from '../services/checkinService';
import { activityService } from '../services/activityService';
import { goalService } from '../services/goalService';
import { preferencesService } from '../services/preferencesService';
import { planBlockService } from '../services/planBlockService';
import { recommendationService } from '../services/recommendationService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { trainingIntentProfileService } from '../services/trainingIntentProfileService';
import { strengthSessionService } from '../services/strengthSessionService';
import { externalPlanService } from '../services/externalPlanService';
import { fixedActivityService } from '../services/fixedActivityService';
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
  strengthSessionService.getSessionsInRange = async () => ({ sessions: [], invalidRecords: 0 });
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
