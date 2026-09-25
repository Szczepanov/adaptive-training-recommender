import { describe, expect, it } from 'vitest';
import {
    briefPurposeFor,
    briefWindowDaysFor,
    buildContextBrief,
    type BriefPurpose,
    type ContextBriefInput,
} from './contextBrief';
import { injectActivityTelemetryIntoContextBrief } from './contextBriefActivityTelemetry';
import {
    enhanceContextBriefForPlanning,
    type ContextBriefPlanningHandoffInput,
} from './contextBriefPlanningHandoff';
import type {
    ActivityLapSummary,
    DailyRecoverySnapshot,
    NormalizedGarminActivity,
    TrainingIntentProfile,
    UserGoal,
} from './models';

// Issue #811: purpose-driven exports. Synthetic fixtures only.
const AS_OF = '2026-08-20';

function snapshot(): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date: AS_OF,
        source: { garminSyncedAt: `${AS_OF}T06:00:00Z`, sourceSchemaVersion: 3 },
        raw: {
            sleepScore: 80, sleepDurationSec: 27_000, restingHr: 50, hrvOvernightAvg: 60,
            hrvStatus: 'balanced', respirationAvg: 15, bodyBatteryWake: 70, bodyBatteryChange: 35,
            totalSteps: 10_000, last3DaysHardSessionsCount: 0, yesterdayTraining: null,
            stress: { avg: 25, max: 50 }, trainingReadiness: { score: 80, level: 'high' },
        },
        derived: {
            baselineComputationVersion: 5,
            sleepScore7dAvg: 76, sleepScore28dAvg: 74, restingHr7dAvg: 51, restingHr28dAvg: 52,
            hrv7dAvg: 58, hrv28dAvg: 56, respiration7dAvg: 14, respiration28dAvg: 13.5, respiration28dMad: 0.7,
            sleepScore7dMedian: 77, sleepScore28dMedian: 75, sleepScore28dMad: 3,
            hrv7dMedian: 59, hrv28dMedian: 57, hrv28dMad: 5,
            bodyBatteryWake7dMedian: 68, bodyBatteryWake28dMedian: 65, bodyBatteryWake28dMad: 8,
            deltas: { sleepScoreVs7d: 4, sleepScoreVs28d: 6, restingHrVs7d: -1, restingHrVs28d: -2, hrvVs7d: 2, hrvVs28d: 4 },
        },
        dataQuality: {
            sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true,
            baseline7dReady: true, baseline28dReady: true,
        },
    } as unknown as DailyRecoverySnapshot;
}

function laps(count: number): ActivityLapSummary[] {
    return Array.from({ length: count }, (_, index) => ({
        lapIndex: index + 1,
        durationSeconds: 60 + (index % 5) * 30,
        averagePowerWatts: 200 + (index % 7) * 15,
        averageHrBpm: 140 + (index % 6) * 3,
    }));
}

function ride(lapCount: number): NormalizedGarminActivity {
    return {
        activityId: 'ride-1',
        date: '2026-08-19',
        type: 'road_biking',
        durationMin: 90,
        trainingEffectAerobic: 4.2,
        trainingEffectAnaerobic: 2.1,
        averageHr: 150,
        activityTrainingLoad: 180,
        intensityTag: 'hard',
        normalizedPower: 280,
        intensityFactor: 0.9,
        powerInZones: [
            { zoneNumber: 2, secondsInZone: 2400, lowBoundary: 150 },
            { zoneNumber: 4, secondsInZone: 1800, lowBoundary: 250 },
        ],
        hrInZones: [{ zoneNumber: 3, secondsInZone: 3000, lowBoundary: 140 }],
        laps: laps(lapCount),
    };
}

const PROFILE = {
    weeklyCommitment: { minSessions: 3, targetSessions: 5, maxSessions: 6 },
    priorities: ['endurance', 'strength'],
} as unknown as TrainingIntentProfile;

const GOAL = {
    id: 'g1',
    title: 'Autumn road race',
    status: 'active',
    priority: 'primary',
    targetDate: '2026-10-10',
    eventCategory: 'cycling_event',
    eventPreset: 'road_race',
    description: 'Hilly course, attacks on the climbs',
} as unknown as UserGoal;

function briefInput(purpose: BriefPurpose | undefined, activities: NormalizedGarminActivity[]): ContextBriefInput {
    return {
        asOfDate: AS_OF,
        windowDays: 14,
        snapshots: [snapshot()],
        checkins: [],
        activities,
        recommendations: [],
        trainingSettings: null,
        preferences: null,
        intentProfile: PROFILE,
        goals: [GOAL],
        ...(purpose ? { purpose } : {}),
    };
}

function handoffInput(purpose: BriefPurpose, activities: NormalizedGarminActivity[]): ContextBriefPlanningHandoffInput {
    return {
        asOfDate: AS_OF,
        snapshots: [snapshot()],
        checkins: [],
        activities,
        recommendations: [],
        trainingSettings: null,
        preferences: null,
        effectivePlanningMode: 'externally_planned',
        externalFallback: false,
        externalFallbackUncertain: false,
        eventStrategy: null,
        goals: [GOAL],
        upcomingFixedActivities: [],
        upcomingPlanBlocks: [],
        upcomingExternalSessions: [{
            date: '2026-08-21', planId: 'p1', planTitle: 'Race prep', revision: 2, sessionId: 's1',
            title: 'Threshold quality', priority: 'key', modality: 'cycling', intensity: 'hard',
            durationMin: 60, durationMax: 75, flexibility: 'preferred', status: 'planned', moved: false,
            isEvent: false, prescription: { summary: '3 x 10 min threshold', steps: [] },
        }],
        recommendationsReadable: true,
        restDirectiveToday: null,
        unavailableSources: [],
        purpose,
    };
}

/** The full service pipeline, minus I/O: base brief → telemetry → handoff. */
function exportFor(purpose: 'planning' | 'diagnostic', lapCount: number, overrides: Partial<ContextBriefPlanningHandoffInput> = {}): string {
    const activities = [ride(lapCount)];
    const base = buildContextBrief(briefInput(purpose, activities));
    const withTelemetry = injectActivityTelemetryIntoContextBrief(base, activities, purpose === 'planning');
    return enhanceContextBriefForPlanning(withTelemetry, { ...handoffInput(purpose, activities), ...overrides });
}

describe('brief purposes (#811)', () => {
    it('maps each compatible UI preset to exactly one explicit purpose', () => {
        expect(briefPurposeFor('daily')).toBe('morning');
        expect(briefPurposeFor('full')).toBe('planning');
        expect(briefPurposeFor('diagnostic')).toBe('diagnostic');
    });

    it('never widens the lookback for diagnostic relative to planning', () => {
        expect(briefWindowDaysFor('diagnostic')).toBe(briefWindowDaysFor('full'));
        expect(briefWindowDaysFor('daily')).toBeLessThan(briefWindowDaysFor('full'));
    });

    it('defaults the pure builder to the complete diagnostic rendering', () => {
        expect(buildContextBrief(briefInput(undefined, []))).toBe(buildContextBrief(briefInput('diagnostic', [])));
    });
});

describe('planning export (#811)', () => {
    it('omits candidate median/MAD baselines and the disabled respiration candidate', () => {
        const planning = buildContextBrief(briefInput('planning', []));
        expect(planning).not.toContain('Respiration robust baseline');
        expect(planning).not.toContain('Observation-only candidate baselines');
        expect(planning).not.toContain('candidate:');
        expect(planning).toContain('observation-only candidate baselines (median/MAD) and the respiration candidate');
        // Vendor composites stay, but only as clearly secondary context.
        expect(planning).toContain('Secondary device composites');
        expect(planning).toContain('- Body battery on waking: 70');
    });

    it('orders sections by decision authority: constraints, intent, recovery, load, execution', () => {
        const text = buildContextBrief(briefInput('planning', [ride(3)]));
        const order = [
            '## 1. Constraints',
            '## 2. Current training intent & goals',
            '## 3. Objective recovery',
            '## 4. Subjective reports',
            '## 5. Completed training',
            '## 6. Plan adherence',
        ].map(heading => text.indexOf(heading));
        expect(order.every(index => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('does not emit a lap table, and a 100-lap activity costs the same as a 3-lap one', () => {
        const small = exportFor('planning', 3);
        const huge = exportFor('planning', 100);
        expect(huge).not.toContain('| Lap | Duration |');
        expect(huge).toContain('### Key-session telemetry (compact)');
        expect(huge).toContain('100 laps');
        // Only digits in the lap digest may differ; growth is bounded, not linear.
        expect(Math.abs(huge.length - small.length)).toBeLessThan(40);
    });

    it('puts authority state, current intent and authoritative upcoming sessions before telemetry', () => {
        const text = exportFor('planning', 100);
        const authority = text.indexOf('## 0. Planning handoff & data currency');
        const intent = text.indexOf('## 2. Current training intent & goals');
        const upcoming = text.indexOf('Threshold quality');
        const telemetry = text.indexOf('### Key-session telemetry (compact)');
        expect(authority).toBeGreaterThanOrEqual(0);
        expect(authority).toBeLessThan(intent);
        expect(intent).toBeLessThan(telemetry);
        expect(upcoming).toBeGreaterThanOrEqual(0);
        expect(text.indexOf('## 7. Existing commitments')).toBeLessThan(text.indexOf('### Longer-term goals (compact)'));
    });

    it('compresses goals: no demand vector, still keeps event identity', () => {
        const text = exportFor('planning', 3);
        expect(text).toContain('### Longer-term goals (compact)');
        expect(text).toContain('event: Road race');
        expect(text).not.toContain('demand 0–1');
    });

    it('keeps missing-data honesty and the importable schedule contract', () => {
        const text = exportFor('planning', 3, { unavailableSources: ['recorded activities'] });
        expect(text).toContain('**DATA INCOMPLETE:** could not reliably read: recorded activities');
        expect(text).toContain('### If the user asks for an importable schedule');
    });

    it('is deterministic for identical inputs', () => {
        expect(exportFor('planning', 40)).toBe(exportFor('planning', 40));
        expect(exportFor('diagnostic', 40)).toBe(exportFor('diagnostic', 40));
    });
});

describe('diagnostic export (#811)', () => {
    it('keeps full lap/zone telemetry, candidate baselines and demand vectors', () => {
        const text = exportFor('diagnostic', 100);
        expect(text).toContain('### Detailed activity telemetry');
        expect(text).toContain('| 100 |');
        expect(text).toContain('Respiration robust baseline');
        expect(text).toContain('Observation-only candidate baselines');
        expect(text).toContain('demand 0–1');
        expect(text).toContain('None of that detail has recommendation authority');
    });

    it('grows with lap count, unlike planning', () => {
        expect(exportFor('diagnostic', 100).length - exportFor('diagnostic', 3).length).toBeGreaterThan(2000);
    });
});

describe('morning export (#811)', () => {
    it('still renders the today-focused morning coach brief, without an import schedule', () => {
        const input = handoffInput('morning', []);
        const text = enhanceContextBriefForPlanning('ignored', input);
        expect(text).toBe(enhanceContextBriefForPlanning('ignored', { ...input, purpose: undefined, preset: 'daily' }));
        expect(text).not.toContain('### If the user asks for an importable schedule');
        expect(text).not.toContain('### Detailed activity telemetry');
    });
});
