/**
 * Synthetic fixtures for the ledger export tests. Never a live API; identity markers are fake.
 * Every fixture is typed as its real model with no cast, so a model change breaks `tsc`.
 * Identity fields the models do not declare are layered on by `withExtra`.
 */
import type { AnthropometryEntry } from '../../anthropometry/models.ts';
import type { NutritionDay } from '../../nutrition/models.ts';
import type {
    AssessmentAttempt,
    CompetitionOutcome,
    MetricObservationRevision,
} from '../../observations/models.ts';
import type { SessionResponse } from '../../responses/models.ts';
import type {
    ActivitySegmentSummary,
    AuthoredPlanBlock,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    NormalizedGarminActivity,
    TrainingSettings,
    UserConstraint,
    UserPreferences,
} from '../models.ts';
import type {
    BuildLedgerExportInput,
    LedgerExportRecords,
    OccurrenceInput,
} from './inputs.ts';

export const FAKE_USER_ID = 'uid-SECRET-4471';
export const FAKE_EMAIL = 'athlete.secret@example.com';
export const FAKE_ACCOUNT_ID = 'garmin-acct-998877';

export const AS_OF = '2026-11-20';
export const EXPORTED_AT = '2026-11-20T06:12:03Z';

/** Adds fields a real model does not declare (identity leaks in stored data) without a cast. */
export function withExtra<T extends object>(value: T, extra: Record<string, unknown>): T {
    return { ...value, ...extra };
}

export function recoverySnapshot(
    date: string,
    raw: Partial<DailyRecoverySnapshot['raw']> = {},
    metricDates?: NonNullable<DailyRecoverySnapshot['source']['metricDates']>,
): DailyRecoverySnapshot {
    const snapshot: DailyRecoverySnapshot = {
        userId: FAKE_USER_ID,
        date,
        source: { garminSyncedAt: '2026-11-20T05:00:00Z', sourceSchemaVersion: 1, metricDates },
        raw: {
            sleepScore: 81,
            sleepDurationSec: 27000,
            restingHr: 48,
            hrvOvernightAvg: 62,
            hrvStatus: 'BALANCED',
            respirationAvg: 14,
            bodyBatteryWake: 70,
            bodyBatteryChange: 60,
            totalSteps: 0,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            stress: { avg: 25 },
            weightKg: null,
            ...raw,
        },
        derived: {
            baselineComputationVersion: 3,
            sleepScore7dAvg: null,
            sleepScore28dAvg: null,
            restingHr7dAvg: null,
            restingHr28dAvg: null,
            hrv7dAvg: null,
            hrv28dAvg: null,
            respiration7dAvg: null,
            respiration28dAvg: null,
            deltas: {
                sleepScoreVs7d: null,
                sleepScoreVs28d: null,
                restingHrVs7d: null,
                restingHrVs28d: null,
                hrvVs7d: null,
                hrvVs28d: null,
                respirationVs7d: null,
                respirationVs28d: null,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true,
            restingHrAvailable: true,
            hrvAvailable: true,
            baseline7dReady: false,
            baseline28dReady: false,
        },
    };
    return withExtra(snapshot, { garminAccountId: FAKE_ACCOUNT_ID });
}

export function checkin(date: string, overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    const row: DailySubjectiveCheckin = {
        userId: FAKE_USER_ID,
        date,
        readiness: 7,
        sleepQuality: 6,
        fatigue: 3,
        soreness: null,
        mentalStress: 3,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: `Contact me at ${FAKE_EMAIL}`,
        submittedAt: `${date}T06:00:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: `${date}T06:00:00Z`,
        updatedAt: `${date}T06:00:00Z`,
        ...overrides,
    };
    return withExtra(row, { email: FAKE_EMAIL });
}

export function segment(segmentIndex: number): ActivitySegmentSummary {
    return {
        segmentIndex,
        segmentType: 'work',
        identitySource: 'detected',
        durationSeconds: 60,
        averagePowerWatts: 250,
        evidenceConfidence: 'high',
    };
}

export function activity(index: number, segmentCount = 3, date?: string): NormalizedGarminActivity {
    const day = date ?? `2026-11-${String(20 - (index % 10)).padStart(2, '0')}`;
    const row: NormalizedGarminActivity = {
        activityId: `act-${String(index).padStart(3, '0')}`,
        date: day,
        startedAt: `${day}T0${index % 9}:00:00Z`,
        type: 'cycling',
        durationMin: 60,
        trainingEffectAerobic: 3,
        trainingEffectAnaerobic: 0,
        averageHr: 140,
        activityTrainingLoad: 80,
        intensityTag: 'moderate',
        sessionCost: 'moderate',
        activityResponse: {
            derivationVersion: '1',
            sourceResolution: {},
            segmentCountTotal: segmentCount,
            segmentsTruncated: false,
            segments: Array.from({ length: segmentCount }, (_, i) => segment(i)),
            powerDurationPeaks: [],
        },
    };
    return withExtra(row, { garminAccountId: FAKE_ACCOUNT_ID });
}

export const settings: TrainingSettings = {
    userId: FAKE_USER_ID,
    schemaVersion: 3,
    equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: false },
    guardrails: {
        avoid_high_impact: false,
        avoid_heavy_lower_body: false,
        avoid_overhead_pressing: true,
        avoid_heavy_spinal_loading: false,
    },
    injuries: [{ region: 'knee', severity: 'limit', note: 'patellar tendon', reviewBy: '2026-12-01' }],
    defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: null, environment: 'either' },
    preferences: { preferActiveRecovery: false },
    migration: { legacyReviewed: true, migratedAt: null },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
};

export const preferences: UserPreferences = {
    userId: FAKE_USER_ID,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'morning',
    preferredModalities: ['Cycling'],
    deprioritizedModalities: [],
    avoidedModalities: [],
    explanationVerbosity: 'brief',
    conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
};

export const travelBlock: AuthoredPlanBlock = {
    id: 'block-1',
    userId: FAKE_USER_ID,
    phase: 'travel',
    startDate: '2026-11-25',
    endDate: '2026-11-28',
    volumeScale: 0.5,
    intensityScale: 0.8,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
};

export const constraint: UserConstraint = {
    userId: FAKE_USER_ID,
    key: 'no_barbell',
    label: 'No barbell',
    valueType: 'boolean',
    type: 'boolean',
    value: true,
    severity: 'soft',
    isActive: true,
    category: 'equipment',
    displayName: 'No barbell',
    description: null,
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
};

export const sessionResponse: SessionResponse = {
    userId: FAKE_USER_ID,
    responseId: 'resp-1',
    sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-11-19' },
    occurrenceId: 'occ-1',
    window: 'immediate',
    date: '2026-11-19',
    checkinRef: { date: '2026-11-19' },
    sessionRpe: 6,
    createdAt: '2026-11-19T18:00:00Z',
    updatedAt: '2026-11-19T18:00:00Z',
};

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

export const occurrence: OccurrenceInput = withExtra({
    performedOccurrenceId: 'occ-1',
    status: 'active',
    localDate: '2026-11-19',
    startedAt: '2026-11-19T16:00:00Z',
    endedAt: '2026-11-19T17:00:00Z',
    modality: 'Cycling',
}, { userId: FAKE_USER_ID });

/** A fully populated record set exercising every collection. */
export function fullRecords(): LedgerExportRecords {
    return {
        recovery: [recoverySnapshot('2026-11-19'), recoverySnapshot('2026-11-20')],
        checkins: [checkin('2026-11-20'), checkin('2026-11-19', { nutritionAdherenceYesterday: 'mostly_tracked' })],
        performedOccurrences: [occurrence],
        sessionResponses: [sessionResponse],
        assessmentAttempts: [assessmentAttempt],
        metricObservations: [metricObservation],
        anthropometry: [anthropometryEntry],
        nutritionDays: [nutritionDay, unloggedNutritionDay],
        activities: [activity(1), activity(2)],
        competitionOutcomes: [competitionOutcome],
        trainingSettings: settings,
        planBlocks: [travelBlock],
        fixedActivities: [{
            id: 'fx-1',
            title: 'Hotel gym',
            date: '2026-11-26',
            durationMin: 45,
            fixed: true,
            availabilityContextOverride: { environment: 'indoor', equipment: ['free_weights'] },
        }],
        scheduleWindows: [{ id: 'win-1', date: '2026-11-21', startLocal: '06:00', endLocal: '07:30' }],
        preferences,
        goals: [{
            id: 'goal-1',
            title: 'Spring gran fondo',
            domain: 'endurance',
            status: 'active',
            priority: 4,
            targetDate: '2027-04-18',
            eventCategory: 'race',
            timing: { earliestDate: '2027-04-18', latestDate: '2027-04-18', planningDate: '2027-04-18' },
        }],
        intentBlocks: [{ id: 'ib-1', dateRange: { startDate: '2026-11-17', endDate: '2026-12-14' }, title: 'Base block' }],
        constraints: [constraint],
        planRevisions: [
            {
                planId: 'plan-1',
                revision: 1,
                contentHash: 'sha256:old',
                importedAt: '2026-10-01T08:00:00Z',
                schema: 'adaptive-training-recommender/external-plan@6',
            },
            {
                planId: 'plan-1',
                revision: 2,
                contentHash: 'sha256:abc',
                importedAt: '2026-11-10T08:00:00Z',
                schema: 'adaptive-training-recommender/external-plan@6',
                notes: 'Build aerobic base first.',
            },
        ],
        placements: [{
            planId: 'plan-1',
            revision: 2,
            assignments: [
                { sessionId: 's1', date: '2026-11-19', status: 'completed' },
                { sessionId: 's2', date: '2026-11-18', status: 'dropped' },
            ],
        }],
        plannedToPerformed: [{ planId: 'plan-1', revision: 2, sessionId: 's1', date: '2026-11-19', performedOccurrenceId: 'occ-1' }],
    };
}

export function fullInput(overrides: Partial<BuildLedgerExportInput> = {}): BuildLedgerExportInput {
    return {
        records: fullRecords(),
        sources: { daily_recovery_snapshots: { readAt: '2026-11-20T06:12:00Z', newestObservedOn: '2026-11-20' } },
        asOfDate: AS_OF,
        purpose: 'planning',
        exportedAt: EXPORTED_AT,
        ...overrides,
    };
}
