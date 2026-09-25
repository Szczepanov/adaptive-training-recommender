import { describe, expect, it } from 'vitest';
import type { ActivityLapSummary, DailySubjectiveCheckin, HrMeasurement, NormalizedGarminActivity } from './models';
import {
    deriveDecoupling,
    deriveEfficiencyComparison,
    deriveIntervalRepetition,
    thresholdProvenance,
} from './contextBriefResponseFeatures';
import { deriveNextDayResponse, deriveStrengthProgression } from './contextBriefSessionResponse';
import { deriveKeySessionSummaries, renderKeySessionSummaries } from './contextBriefResponseSummary';
import { injectActivityTelemetryIntoContextBrief } from './contextBriefActivityTelemetry';

function ride(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'ride',
        date: '2026-09-18',
        type: 'road_biking',
        durationMin: 71,
        trainingEffectAerobic: 3.5,
        trainingEffectAnaerobic: 1.5,
        averageHr: 145,
        activityTrainingLoad: 120,
        intensityTag: 'hard',
        ...overrides,
    };
}

function lap(lapIndex: number, minutes: number, power: number, hr: number): ActivityLapSummary {
    return { lapIndex, durationSeconds: minutes * 60, averagePowerWatts: power, averageHrBpm: hr };
}

const NO_CHECKINS = { records: [], unreadableDates: [] };
const HIGH_HR = {
    measurementConfidence: 'high', signalQuality: 'clean', summaryCompatibility: 'verified_same_effective_trace',
    artifactFlags: [], reasons: [],
} as unknown as HrMeasurement;

const ZONES_250 = [
    { zoneNumber: 1, secondsInZone: 600, lowBoundary: 0 },
    { zoneNumber: 2, secondsInZone: 3000, lowBoundary: 138 },
];
const ZONES_270 = [
    { zoneNumber: 1, secondsInZone: 600, lowBoundary: 0 },
    { zoneNumber: 2, secondsInZone: 3000, lowBoundary: 149 },
];

const intervalRide = (powers: [number, number, number]) => ride({
    stimulusDomain: 'threshold',
    normalizedPower: 199,
    intensityFactor: 0.78,
    laps: [
        lap(1, 15, 150, 120),
        lap(2, 11, powers[0], 154), lap(3, 5, 120, 125),
        lap(4, 11, powers[1], 152), lap(5, 5, 120, 126),
        lap(6, 11, powers[2], 155), lap(7, 20, 130, 128),
    ],
});

function steady(id: string, date: string, overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return ride({
        activityId: id,
        date,
        durationMin: 90,
        intensityTag: 'easy',
        stimulusDomain: 'endurance',
        normalizedPower: 180,
        variabilityIndex: 1.02,
        averageHr: 135,
        powerInZones: ZONES_250,
        laps: [lap(1, 45, 180, 132), lap(2, 45, 178, 138)],
        ...overrides,
    });
}

describe('interval repetition (#814)', () => {
    it('summarises a structured 3-interval ride with first-to-last change', () => {
        const feature = deriveIntervalRepetition(intervalRide([229, 225, 237]));
        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.intervals.map(item => item.powerWatts)).toEqual([229, 225, 237]);
        expect(feature.intervals.map(item => item.hrBpm)).toEqual([154, 152, 155]);
        expect(feature.firstToLastPct).toBe(3.5);
        expect(feature.pattern).toBe('repeatable');
    });

    it('labels a late fade', () => {
        const feature = deriveIntervalRepetition(intervalRide([240, 232, 224]));
        expect(feature.state === 'available' && feature.pattern).toBe('late_fade');
    });

    it('labels a late collapse', () => {
        const feature = deriveIntervalRepetition(intervalRide([250, 245, 212]));
        expect(feature.state === 'available' && feature.pattern).toBe('late_collapse');
    });

    it('reports 250/245/185 W as a late collapse, never as a repeatable two-interval set', () => {
        const feature = deriveIntervalRepetition(intervalRide([250, 245, 185]));
        expect(feature.state === 'available' && feature.pattern).toBe('late_collapse');
        expect(feature.state === 'available' && feature.intervals).toHaveLength(3);
        const context = { history: [intervalRide([250, 245, 185])], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries(context.history, context), context);
        expect(text).not.toContain('repeatable');
        expect(text).not.toContain('2 × 11 min');
    });

    it('refuses to judge when a later work lap is off-protocol (possibly truncated)', () => {
        const laps = [lap(1, 15, 150, 120), lap(2, 11, 250, 154), lap(3, 5, 120, 125), lap(4, 11, 245, 152), lap(5, 5, 120, 126), lap(6, 4, 190, 150), lap(7, 20, 130, 128)];
        const feature = deriveIntervalRepetition(ride({ stimulusDomain: 'threshold', laps }));
        expect(feature).toEqual({ state: 'insufficient_evidence', reason: 'off-protocol work lap (possibly a truncated interval); repeatability not judged' });
    });

    it('describes a repeatable set without asserting the absence of collapse', () => {
        const context = { history: [intervalRide([229, 225, 237])], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries(context.history, context), context);
        expect(text).toContain('Response: repeatable across the 3 protocol-length intervals');
        expect(text).not.toContain('no late power collapse');
    });

    it('refuses to judge when a protocol-length interval falls below the work-power bar', () => {
        // 13-min cooldown (protocol-length) and 185 W both sit under the work-power bar.
        const laps = [lap(1, 15, 150, 120), lap(2, 11, 250, 154), lap(3, 5, 120, 125), lap(4, 11, 245, 152), lap(5, 5, 120, 126), lap(6, 11, 185, 150), lap(7, 13, 130, 128)];
        const feature = deriveIntervalRepetition(ride({ stimulusDomain: 'threshold', laps }));
        expect(feature.state).toBe('insufficient_evidence');
        expect(feature.state === 'insufficient_evidence' && feature.reason).toContain('possible late collapse');
    });

    it('does not treat an auto-lapped race without a workout fingerprint as intervals', () => {
        const race = ride({
            stimulusDomain: 'race',
            laps: [lap(1, 10, 150, 140), lap(2, 10, 260, 170), lap(3, 10, 170, 150), lap(4, 10, 255, 172), lap(5, 10, 160, 150)],
        });
        expect(deriveIntervalRepetition(race).state).toBe('insufficient_evidence');
        expect(deriveIntervalRepetition({ ...race, fitWorkoutFingerprint: 'fw' }).state).toBe('insufficient_evidence');
    });

    it('does not treat a steady endurance ride as an interval session', () => {
        expect(deriveIntervalRepetition(steady('s', '2026-09-18')).state).toBe('insufficient_evidence');
    });

    it('labels interval HR observational with the HR authority reasons when no measurement exists', () => {
        const feature = deriveIntervalRepetition(intervalRide([229, 225, 237]));
        expect(feature.state === 'available' && feature.hrNote).toBe('HR observational only: HR authority BLOCKED (MEASUREMENT_UNAVAILABLE)');
    });

    it('withholds interval HR when the HR authority rates the measurement unreliable', () => {
        const feature = deriveIntervalRepetition({
            ...intervalRide([229, 225, 237]),
            hrMeasurement: { ...HIGH_HR, measurementConfidence: 'unreliable', signalQuality: 'poor' },
        });
        expect(feature.state === 'available' && feature.intervals.every(item => item.hrBpm === undefined)).toBe(true);
    });
});

describe('cardiac drift / decoupling (#814)', () => {
    it('computes decoupling for a steady ride without hrMeasurement, labelled observational by the HR authority', () => {
        const feature = deriveDecoupling(steady('s', '2026-09-18'));
        expect(feature.state).toBe('available');
        expect(feature.state === 'available' && feature.observational).toBe(true);
        expect(feature.state === 'available' && feature.hrNote).toBe('HR observational only: HR authority BLOCKED (MEASUREMENT_UNAVAILABLE)');
    });

    it('refuses unbalanced halves (80 + 10 min laps)', () => {
        const feature = deriveDecoupling(steady('s', '2026-09-18', { laps: [lap(1, 80, 180, 132), lap(2, 10, 178, 140)] }));
        expect(feature.state === 'insufficient_evidence' && feature.reason).toContain('balanced halves');
    });

    it('withholds a steady ride whose HR the authority rates unreliable', () => {
        const feature = deriveDecoupling(steady('s', '2026-09-18', { hrMeasurement: { ...HIGH_HR, measurementConfidence: 'unreliable' } }));
        expect(feature.state === 'insufficient_evidence' && feature.reason).toContain('HR withheld');
    });

    it('refuses a variable unstructured ride', () => {
        const variable = steady('v', '2026-09-18', { variabilityIndex: 1.18, stimulusDomain: 'mixed' });
        const feature = deriveDecoupling(variable);
        expect(feature.state).toBe('insufficient_evidence');
        const text = renderKeySessionSummaries(
            deriveKeySessionSummaries([variable], { history: [variable], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' }),
            { history: [variable], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' },
        );
        expect(text).not.toContain('decoupling');
    });

    it('refuses when the variability index is not reported', () => {
        expect(deriveDecoupling(steady('s', '2026-09-18', { variabilityIndex: undefined })).state).toBe('insufficient_evidence');
    });
});

describe('aerobic-efficiency comparison (#814)', () => {
    const current = steady('now', '2026-09-18', { normalizedPower: 185, averageHr: 134 });

    it('compares two comparable steady rides with confidence and provenance', () => {
        const feature = deriveEfficiencyComparison(current, [current, steady('prior', '2026-09-10')]);
        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.priorDate).toBe('2026-09-10');
        expect(feature.thresholdProvenance).toBe('same');
        // No verified lineage/segment context: the HR authority keeps HR observational.
        expect(feature.confidence).toBe('low');
        expect(feature.hrNote).toContain('HR observational only: HR authority BLOCKED');
        expect(feature.changePct).toBeCloseTo(((185 / 134) / (180 / 135) - 1) * 100, 0);
    });

    it('never reports high confidence while the HR authority keeps HR observational', () => {
        const feature = deriveEfficiencyComparison(
            { ...current, fitWorkoutFingerprint: 'fw1', hrMeasurement: HIGH_HR },
            [steady('prior', '2026-09-10', { fitWorkoutFingerprint: 'fw1', hrMeasurement: HIGH_HR })],
        );
        expect(feature.state === 'available' && feature.confidence).toBe('low');
        expect(feature.state === 'available' && feature.basis).toBe('same device structured workout');
    });

    it('rejects a materially different protocol', () => {
        const feature = deriveEfficiencyComparison(current, [steady('long', '2026-09-10', { durationMin: 240 })]);
        expect(feature.state).toBe('insufficient_evidence');
        expect(feature.state === 'insufficient_evidence' && feature.rejected[0]).toContain('different protocol duration');
    });

    it('rejects a comparison across an FTP / zone-definition change', () => {
        const prior = steady('prior', '2026-09-10', { powerInZones: ZONES_270 });
        expect(thresholdProvenance(current, prior)).toBe('changed');
        const feature = deriveEfficiencyComparison(current, [prior]);
        expect(feature.state === 'insufficient_evidence' && feature.rejected[0]).toContain('FTP');
    });

    it('downgrades confidence when zone definitions are unknown', () => {
        const feature = deriveEfficiencyComparison(current, [steady('prior', '2026-09-10', { powerInZones: undefined })]);
        expect(feature.state === 'available' && feature.confidence).toBe('low');
    });

    it('refuses without power evidence', () => {
        const noPower = steady('np', '2026-09-18', { normalizedPower: undefined });
        const feature = deriveEfficiencyComparison(noPower, [steady('prior', '2026-09-10')]);
        expect(feature.state === 'insufficient_evidence' && feature.reason).toContain('no power');
    });

    it('does not use sessions after the current one', () => {
        const feature = deriveEfficiencyComparison(current, [steady('later', '2026-09-19')]);
        expect(feature.state).toBe('insufficient_evidence');
    });
});

function lift(id: string, date: string, weight: number, named = true): NormalizedGarminActivity {
    return ride({
        activityId: id,
        date,
        type: 'strength_training',
        stimulusDomain: 'strength',
        exerciseSets: [
            { setOrder: 1, setType: 'ACTIVE', repetitionCount: 5, weightKg: weight, ...(named ? { exerciseName: 'BARBELL_BACK_SQUAT' } : {}) },
            { setOrder: 2, setType: 'REST', durationSeconds: 120 },
            { setOrder: 3, setType: 'ACTIVE', repetitionCount: 5, weightKg: weight - 5, exerciseName: 'BARBELL_BACK_SQUAT' },
        ],
    });
}

describe('strength progression (#814)', () => {
    it('reports top set against the prior same-exercise session', () => {
        const feature = deriveStrengthProgression(lift('now', '2026-09-18', 80), [lift('prior', '2026-09-11', 77.5)]);
        expect(feature).toEqual({
            state: 'available',
            exercises: [{ exercise: 'BARBELL_BACK_SQUAT', workingSets: 2, topWeightKg: 80, topReps: 5, prior: { date: '2026-09-11', topWeightKg: 77.5, topReps: 5 } }],
        });
    });

    it('is withheld when any working set lacks an exercise identity', () => {
        const feature = deriveStrengthProgression(lift('now', '2026-09-18', 80, false), []);
        expect(feature.state).toBe('insufficient_evidence');
    });
});

function checkin(date: string, soreness: number | null, fatigue: number | null): DailySubjectiveCheckin {
    return {
        userId: 'u', date, readiness: 7, sleepQuality: 7, fatigue, soreness, mentalStress: 3, motivation: 7,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
    } as DailySubjectiveCheckin;
}

describe('next-day response (#814)', () => {
    const session = intervalRide([229, 225, 237]);

    it('links the next-morning check-in and labels it observational', () => {
        const context = { history: [session], historyStart: '2026-08-22', checkins: { records: [checkin('2026-09-18', 3, 4), checkin('2026-09-19', 6, 5)], unreadableDates: [] }, asOfDate: '2026-09-20' };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([session], context), context);
        expect(text).toContain('Next morning (observational, not proof the session caused it): soreness 6 (session-day morning 3) · fatigue 5 (session-day morning 4)');
        expect(text).toContain('Main set: 3 × 11 min @ 229 / 225 / 237 W');
        expect(text).toContain('First→last work interval: +3.5%');
    });

    it('distinguishes an unreadable check-in history from a missing check-in', () => {
        expect(deriveNextDayResponse(session, null, [], '2026-09-20')).toEqual({ state: 'insufficient_evidence', reason: 'check-in history unavailable' });
        expect(deriveNextDayResponse(session, NO_CHECKINS, [], '2026-09-20')).toEqual({ state: 'insufficient_evidence', reason: 'no next-morning check-in recorded' });
        expect(deriveNextDayResponse(session, { records: [], unreadableDates: ['2026-09-19'] }, [], '2026-09-20'))
            .toEqual({ state: 'insufficient_evidence', reason: 'next-morning check-in unreadable (invalid stored record)' });
        expect(deriveNextDayResponse(session, { records: [], unreadableDates: [], undatedUnreadable: 1 }, [], '2026-09-20'))
            .toEqual({ state: 'insufficient_evidence', reason: 'next-morning check-in possibly unreadable (an invalid stored record has no readable date)' });
        expect(deriveNextDayResponse(session, NO_CHECKINS, [], '2026-09-18')).toEqual({ state: 'insufficient_evidence', reason: 'next morning not yet reached' });
    });
});

describe('planning vs diagnostic export (#814)', () => {
    const session = intervalRide([229, 225, 237]);
    const brief = '# Brief\n\n## 2. Completed training (recorded by the wearable)\n\nrows\n\n## 3. Next\n';
    const context = { history: [session], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };

    it('planning replaces the lap digest with the semantic summary', () => {
        const text = injectActivityTelemetryIntoContextBrief(brief, [session], true, context);
        expect(text).toContain('### Training-response features');
        expect(text).not.toContain('| Lap |');
        expect(text).not.toContain('7 laps');
        expect(text.indexOf('Training-response features')).toBeLessThan(text.indexOf('## 3. Next'));
    });

    it('keeps the compact digest for a key session with no available feature', () => {
        const lonely = steady('lonely', '2026-09-18', { hrInZones: [{ zoneNumber: 2, secondsInZone: 5400 }] });
        const ctx = { history: [lonely], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };
        const shortRide = { ...lonely, durationMin: 30, laps: undefined };
        const text = injectActivityTelemetryIntoContextBrief(brief, [shortRide], true, { ...ctx, history: [shortRide] });
        expect(text).toContain('no comparable prior steady session');
        expect(text).toContain('most time in HR Z2');
    });

    it('diagnostic keeps the full lap table alongside the summary', () => {
        const text = injectActivityTelemetryIntoContextBrief(brief, [session], false, context);
        expect(text).toContain('| Lap |');
        expect(text).toContain('### Training-response features');
    });
});
