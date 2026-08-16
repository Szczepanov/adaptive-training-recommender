import { decisionComposer } from '../engine/composer';
import { checkinService } from '../services/checkinService';
import { goalService } from '../services/goalService';
import { preferencesService } from '../services/preferencesService';
import { recommendationService } from '../services/recommendationService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import { trainingSettingsService } from '../services/trainingSettingsService';
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
  decisionComposer.composeDailyDecisionInput = async () => fixture.input;

  checkinService.getCheckin = async () => fixture.checkin;
  checkinService.upsertTodayCheckin = async (_userId, update) => ({
    ...(fixture.checkin ?? { userId: fixture.input.userId, date: fixture.input.date }),
    ...update,
  }) as Awaited<ReturnType<typeof checkinService.upsertTodayCheckin>>;

  recoverySnapshotService.getRecoverySnapshotByDate = async () => fixture.recovery;

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

  // ADR-0019. Without these the externally-planned screens would fall through to real
  // Firestore reads, which fail closed to "no plan" and would capture the ranked path
  // instead -- a screenshot of the wrong feature.
  fixedActivityService.getActivitiesInRangeState = async () => ({ status: 'AVAILABLE', data: [], revision: null });
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
  recommendationService.saveRecommendation = async () => null;
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
