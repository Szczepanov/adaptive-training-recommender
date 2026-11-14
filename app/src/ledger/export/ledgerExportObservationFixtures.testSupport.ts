/**
 * Synthetic observation fixtures (nutrition, anthropometry, assessments, competition outcomes)
 * and the fake identity markers, split from `ledgerExportFixtures.testSupport.ts`. Typed as their
 * real models with no cast; never a live API.
 */
import type { AnthropometryEntry } from '../../anthropometry/models.ts';
import type { NutritionDay } from '../../nutrition/models.ts';
import type {
    AssessmentAttempt,
    CompetitionOutcome,
    MetricObservationRevision,
} from '../../observations/models.ts';

export const FAKE_USER_ID = 'uid-SECRET-4471';
export const FAKE_EMAIL = 'athlete.secret@example.com';
export const FAKE_ACCOUNT_ID = 'garmin-acct-998877';

/** A day with a logged zero: protein genuinely 0 g with intake data present. */
export const nutritionDay: NutritionDay = {
    schemaVersion: 1,
    date: '2026-11-19',
    source: { provider: 'garmin', transport: 'garmin_connect', origin: null },
    syncedAt: '2026-11-20T05:00:00Z',
    energyIntakeKcal: 2800,
    hasIntakeData: true,
    macronutrients: { proteinGrams: 0, carbsGrams: 350, fatGrams: 90 },
};

export const unloggedNutritionDay: NutritionDay = {
    schemaVersion: 1,
    date: '2026-11-18',
    source: { provider: 'garmin', transport: 'garmin_connect', origin: null },
    syncedAt: '2026-11-20T05:00:00Z',
    energyIntakeKcal: 0,
    hasIntakeData: false,
    macronutrients: { proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
};

export const anthropometryEntry: AnthropometryEntry = {
    id: 'anthro-1',
    userId: FAKE_USER_ID,
    date: '2026-11-18',
    observedAt: '2026-11-18T06:30:00Z',
    protocol: 'home_anthropometry@1',
    context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
    measurements: [{ metricId: 'body_mass_kg', unit: 'kg', readings: [78.2], value: 78.2 }],
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-11-18T06:30:00Z',
    updatedAt: '2026-11-18T06:30:00Z',
};

export const assessmentAttempt: AssessmentAttempt = {
    id: 'attempt-1',
    protocolRef: { id: 'ftp-ramp', revision: 1 },
    completedAt: '2026-11-18T08:00:00Z',
    state: 'completed',
    purpose: 'checkpoint',
};

export const metricObservation: MetricObservationRevision = {
    observationKey: 'obs-1',
    revision: 1,
    metricId: 'ftp_w',
    value: 250,
    unit: 'W',
    observedAt: '2026-11-18T08:00:00Z',
    source: 'manual',
    protocolRef: { id: 'ftp-ramp', revision: 1 },
    comparisonSeriesKey: 'ftp',
    comparisonCanonicalizationVersion: '1',
    assessmentAttemptId: 'attempt-1',
    validity: 'valid',
    context: {},
    createdAt: '2026-11-18T08:00:00Z',
};

export const competitionOutcome: CompetitionOutcome = {
    id: 'out-1',
    sport: 'cycling',
    occurredAt: '2026-11-15T09:00:00Z',
    source: 'manual',
    result: { completed: true, placing: 4 },
    metrics: {},
    context: {},
    createdAt: '2026-11-15T12:00:00Z',
};
