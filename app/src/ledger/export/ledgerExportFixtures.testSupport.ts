/** Synthetic fixtures for the ledger export tests. Never a live API; identity markers are fake. */
import type {
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
    SessionResponseInput,
} from './inputs.ts';

export const FAKE_USER_ID = 'uid-SECRET-4471';
export const FAKE_EMAIL = 'athlete.secret@example.com';
export const FAKE_ACCOUNT_ID = 'garmin-acct-998877';

export const AS_OF = '2026-11-20';
export const EXPORTED_AT = '2026-11-20T06:12:03Z';

export function recoverySnapshot(date: string, overrides: Record<string, unknown> = {}): DailyRecoverySnapshot {
    return {
        userId: FAKE_USER_ID,
        date,
        source: { garminSyncedAt: '2026-11-20T05:00:00Z', sourceSchemaVersion: 1, garminAccountId: FAKE_ACCOUNT_ID },
        raw: {
            sleepScore: 81,
            sleepDurationSec: 27000,
            restingHr: 0,
            hrvOvernightAvg: 62,
            hrvStatus: 'BALANCED',
            respirationAvg: 14,
            bodyBatteryWake: 70,
            totalSteps: 9000,
            stress: { avg: 25 },
            weightKg: null,
            ...overrides,
        },
        derived: {},
    } as unknown as DailyRecoverySnapshot;
}

export function checkin(date: string): DailySubjectiveCheckin {
    return {
        userId: FAKE_USER_ID,
        date,
        readiness: 7,
        sleepQuality: 6,
        fatigue: 0,
        soreness: null,
        mentalStress: 3,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        notes: `Contact me at ${FAKE_EMAIL}`,
        email: FAKE_EMAIL,
    } as unknown as DailySubjectiveCheckin;
}

export function activity(index: number, segmentCount = 3): NormalizedGarminActivity {
    const day = String(20 - (index % 10)).padStart(2, '0');
    const segments = Array.from({ length: segmentCount }, (_, i) => ({
        segmentIndex: i,
        segmentType: 'work',
        identitySource: 'detected',
        durationSeconds: 60,
        averagePowerWatts: 250,
        evidenceConfidence: 'high',
    }));
    return {
        activityId: `act-${String(index).padStart(3, '0')}`,
        date: `2026-11-${day}`,
        startedAt: `2026-11-${day}T0${index % 9}:00:00Z`,
        type: 'cycling',
        durationMin: 60,
        averageHr: 140,
        activityTrainingLoad: 80,
        intensityTag: 'moderate',
        sessionCost: 'moderate',
        activityResponse: { derivationVersion: '1', segmentCountTotal: segmentCount, segmentsTruncated: false, segments },
        garminAccountId: FAKE_ACCOUNT_ID,
    } as unknown as NormalizedGarminActivity;
}

export const settings = {
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
} as unknown as TrainingSettings;

export const preferences = {
    userId: FAKE_USER_ID,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'morning',
    preferredModalities: ['Cycling'],
    deprioritizedModalities: [],
    avoidedModalities: [],
} as unknown as UserPreferences;

export const travelBlock = {
    id: 'block-1',
    userId: FAKE_USER_ID,
    phase: 'travel',
    startDate: '2026-11-25',
    endDate: '2026-11-28',
    volumeScale: 0.5,
    intensityScale: 0.8,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
} as AuthoredPlanBlock;

export const constraint = {
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
} as unknown as UserConstraint;

/** A fully populated record set exercising every collection. */
export function fullRecords(): LedgerExportRecords {
    return {
        recovery: [recoverySnapshot('2026-11-19'), recoverySnapshot('2026-11-20')],
        checkins: [checkin('2026-11-20')],
        performedOccurrences: [{
            performedOccurrenceId: 'occ-1',
            userId: FAKE_USER_ID,
            status: 'live',
            localDate: '2026-11-19',
            startedAt: '2026-11-19T16:00:00Z',
            endedAt: '2026-11-19T17:00:00Z',
            modality: 'Cycling',
            structuredEntries: { exerciseCount: 0, setCount: 0 },
        } as unknown as OccurrenceInput],
        sessionResponses: [{ responseId: 'resp-1', userId: FAKE_USER_ID, date: '2026-11-19', window: 'immediate', sessionRpe: 6 } as unknown as SessionResponseInput],
        assessments: [{ id: 'as-1', date: '2026-11-18', kind: 'ftp', metric: 'ftp_w', value: 250, unit: 'W' }],
        bodyComposition: [{ date: '2026-11-18', weightKg: 78.2 }],
        nutritionDays: [{ date: '2026-11-19', energyKcal: 2800, proteinG: 0 }],
        activities: [activity(1), activity(2)],
        competitionOutcomes: [{
            id: 'out-1',
            occurredAt: '2026-11-15T09:00:00Z',
            sport: 'cycling',
            result: { completed: true, placing: 4 },
        }],
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
        }],
        intentBlocks: [{ id: 'ib-1', dateRange: { startDate: '2026-11-17', endDate: '2026-12-14' }, title: 'Base block' }],
        constraints: [constraint],
        planRevisions: [{
            planId: 'plan-1',
            revision: 2,
            contentHash: 'sha256:abc',
            importedAt: '2026-11-10T08:00:00Z',
            schemaVersion: 'external-plan@6',
            notes: 'Build aerobic base first.',
        }],
        placements: [{
            planId: 'plan-1',
            assignments: [
                { assignmentId: 'a1', status: 'completed', date: '2026-11-19' },
                { assignmentId: 'a2', status: 'dropped', date: '2026-11-21' },
            ],
        }],
        plannedToPerformed: [{ planId: 'plan-1', placementRef: 'a1', performedOccurrenceId: 'occ-1' }],
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
