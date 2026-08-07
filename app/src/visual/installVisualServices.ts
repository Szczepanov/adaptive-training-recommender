import { decisionComposer } from '../engine/composer';
import { checkinService } from '../services/checkinService';
import { goalService } from '../services/goalService';
import { preferencesService } from '../services/preferencesService';
import { recommendationService } from '../services/recommendationService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import { trainingSettingsService } from '../services/trainingSettingsService';
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
