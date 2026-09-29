import { describe, expect, it } from 'vitest';
import type { ActivityLapSummary, DailySubjectiveCheckin, HrMeasurement, NormalizedGarminActivity } from './models';
import {
    deriveDecoupling,
    deriveEfficiencyComparison,
    deriveIntervalRepetition,
    deriveSprintRepetition,
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
    it('uses legacy-lap fallback for a 3-interval ride with first-to-last change', () => {
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

    it('ranks exact prescription identity ahead of a newer provider fingerprint match', () => {
        const recentFingerprint = steady('recent-fit', '2026-09-15', { fitWorkoutFingerprint: 'fit-1' });
        const olderExact = steady('older-exact', '2026-09-08');
        const feature = deriveEfficiencyComparison(
            current,
            [recentFingerprint, olderExact],
            new Map([
                ['now', { prescriptionHash: 'rx-1' }],
                ['older-exact', { prescriptionHash: 'rx-1' }],
            ]),
        );
        expect(feature.state === 'available' && feature.priorActivityId).toBe('older-exact');
    });

    it('keeps provider-only comparison available when canonical occurrence reads fail', () => {
        const prior = steady('prior', '2026-09-10');
        const summaries = deriveKeySessionSummaries([current], {
            history: [current, prior], historyStart: '2026-09-01', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            evidence: [{
                localDate: current.date, modality: 'Cycling',
                identity: { level: 'provider_activity_only', sourceKinds: ['provider_activity'] },
                measuredSources: [{ provider: 'garmin', activityId: current.activityId, activity: current }],
                sourceCompleteness: {
                    occurrenceRead: 'unavailable', structuredExecution: 'unavailable', providerActivities: 'available',
                },
            }],
        });
        const comparison = summaries.find(summary => summary.activity.activityId === current.activityId)?.efficiency;
        expect(comparison?.state).toBe('available');
        expect(comparison?.state === 'available' && comparison.confidence).toBe('low');
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
        expect(text).toContain('Main set: 3 × 11 min @ 229 / 225 / 237 W actual');
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

    it('planning keeps the semantic summary plus bounded quality execution evidence, without the compact lap digest', () => {
        const text = injectActivityTelemetryIntoContextBrief(brief, [session], true, context);
        expect(text).toContain('### Training-response features');
        expect(text).toContain('### Quality-session execution detail (bounded)');
        expect(text).toContain('| Lap | Duration | Avg power | Avg HR |');
        expect(text).toContain('| 7 | 20:00 | 130 W | 128 bpm |');
        expect(text).not.toContain('7 laps');
        expect(text.indexOf('Training-response features')).toBeLessThan(text.indexOf('Quality-session execution detail'));
        expect(text.indexOf('Quality-session execution detail')).toBeLessThan(text.indexOf('## 3. Next'));
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


describe('multi-resolution semantic response (#850)', () => {
    const semanticThreshold = ride({
        durationMin: 85,
        stimulusDomain: 'threshold',
        normalizedPower: 205,
        variabilityIndex: 1.08,
        activityResponse: {
            derivationVersion: 'multi-resolution-v1',
            sourceResolution: { powerSeconds: 1, hrSeconds: 1, cadenceSeconds: 1 },
            segmentCountTotal: 7,
            segmentsTruncated: false,
            powerDurationPeaks: [
                { durationSeconds: 5, powerWatts: 610, confidence: 'high' },
                { durationSeconds: 60, powerWatts: 330, confidence: 'high' },
                { durationSeconds: 300, powerWatts: 270, confidence: 'high' },
            ],
            segments: [
                { segmentIndex: 1, segmentType: 'warmup', identitySource: 'fit_workout_step', durationSeconds: 1200, averagePowerWatts: 150, evidenceConfidence: 'high' },
                { segmentIndex: 2, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_watts', value: 230 }, averagePowerWatts: 229, averageHrBpm: 154, lastThirdHrBpm: 158, firstThirdPowerWatts: 232, middleThirdPowerWatts: 230, lastThirdPowerWatts: 225, evidenceConfidence: 'high' },
                { segmentIndex: 3, segmentType: 'recovery', identitySource: 'fit_workout_step', durationSeconds: 300, averagePowerWatts: 120, evidenceConfidence: 'high' },
                { segmentIndex: 4, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_watts', value: 230 }, averagePowerWatts: 231, averageHrBpm: 156, lastThirdHrBpm: 160, firstThirdPowerWatts: 233, middleThirdPowerWatts: 231, lastThirdPowerWatts: 228, evidenceConfidence: 'high' },
                { segmentIndex: 5, segmentType: 'recovery', identitySource: 'fit_workout_step', durationSeconds: 300, averagePowerWatts: 119, evidenceConfidence: 'high' },
                { segmentIndex: 6, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_watts', value: 230 }, averagePowerWatts: 226, averageHrBpm: 158, lastThirdHrBpm: 163, firstThirdPowerWatts: 230, middleThirdPowerWatts: 227, lastThirdPowerWatts: 221, evidenceConfidence: 'high' },
                { segmentIndex: 7, segmentType: 'cooldown', identitySource: 'fit_workout_step', durationSeconds: 1200, averagePowerWatts: 130, evidenceConfidence: 'high' },
            ],
        },
        // Deliberately misleading equal-duration laps: semantic FIT steps must win.
        laps: [lap(1, 15, 120, 120), lap(2, 15, 400, 170), lap(3, 15, 110, 120)],
    });

    it('uses executed FIT-semantic workout-step identity ahead of misleading lap heuristics', () => {
        const feature = deriveIntervalRepetition(semanticThreshold);
        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.intervals.map(item => item.powerWatts)).toEqual([229, 231, 226]);
        expect(feature.intervals.every(item => item.identitySource === 'fit_workout_step')).toBe(true);
        expect(feature.intervals.map(item => item.prescribedTarget?.value)).toEqual([230, 230, 230]);
    });

    it('excludes the 2026-09-27 low-target terminal rollout from the primary work set', () => {
        const session = ride({
            activityId: '2026-09-27-aerobic-engine',
            date: '2026-09-27',
            stimulusDomain: 'threshold',
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1 },
                segmentCountTotal: 8,
                segmentsTruncated: false,
                powerDurationPeaks: [],
                segments: [
                    { segmentIndex: 1, segmentType: 'warmup', identitySource: 'fit_workout_step', durationSeconds: 600, averagePowerWatts: 150, evidenceConfidence: 'high' },
                    { segmentIndex: 2, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_3s_target', low: 220, high: 240 }, averagePowerWatts: 234, evidenceConfidence: 'high' },
                    { segmentIndex: 3, segmentType: 'recovery', identitySource: 'fit_workout_step', durationSeconds: 300, averagePowerWatts: 120, evidenceConfidence: 'high' },
                    { segmentIndex: 4, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_3s_target', low: 220, high: 240 }, averagePowerWatts: 231, evidenceConfidence: 'high' },
                    { segmentIndex: 5, segmentType: 'recovery', identitySource: 'fit_workout_step', durationSeconds: 300, averagePowerWatts: 120, evidenceConfidence: 'high' },
                    { segmentIndex: 6, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_3s_target', low: 220, high: 240 }, averagePowerWatts: 228, evidenceConfidence: 'high' },
                    { segmentIndex: 7, segmentType: 'recovery', identitySource: 'fit_workout_step', durationSeconds: 300, averagePowerWatts: 120, evidenceConfidence: 'high' },
                    { segmentIndex: 8, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 774, prescribedTarget: { kind: 'power_3s_target', low: 140, high: 175 }, averagePowerWatts: 67, evidenceConfidence: 'high' },
                ],
            },
        });

        const feature = deriveIntervalRepetition(session);
        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.intervals.map(item => item.powerWatts)).toEqual([234, 231, 228]);
        expect(feature.firstToLastPct).toBe(-2.6);
        expect(feature.spreadPct).toBe(2.6);
        expect(feature.pattern).toBe('repeatable');

        const context = { history: [session], historyStart: '2026-09-01', checkins: NO_CHECKINS, asOfDate: '2026-09-28' };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([session], context), context);
        expect(text).toContain('Main set: 3 × 15 min @ 234 / 231 / 228 W actual');
        expect(text).toContain('First→last work interval: -2.6% · spread 2.6% of mean');
        expect(text).not.toContain('67 W actual');
        expect(text).not.toContain('late collapse');
    });

    it('excludes a Z2 recovery target from a dominant Z3+ semantic work set', () => {
        const session = ride({
            stimulusDomain: 'tempo',
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1 },
                segmentCountTotal: 3,
                segmentsTruncated: false,
                powerDurationPeaks: [],
                segments: [
                    { segmentIndex: 1, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_zone', value: 3 }, averagePowerWatts: 234, evidenceConfidence: 'high' },
                    { segmentIndex: 2, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_zone', value: 3 }, averagePowerWatts: 231, evidenceConfidence: 'high' },
                    { segmentIndex: 3, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 774, prescribedTarget: { kind: 'power_zone', value: 2 }, averagePowerWatts: 110, evidenceConfidence: 'high' },
                ],
            },
        });

        const feature = deriveIntervalRepetition(session);
        expect(feature.state === 'available' && feature.intervals.map(item => item.powerWatts))
            .toEqual([234, 231]);
        expect(feature.state === 'available' && feature.pattern).toBe('repeatable');
    });

    it('preserves a high-target terminal work step instead of flattening mixed work', () => {
        const session = ride({
            stimulusDomain: 'threshold',
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1 },
                segmentCountTotal: 3,
                segmentsTruncated: false,
                powerDurationPeaks: [],
                segments: [
                    { segmentIndex: 1, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_watts', value: 230 }, averagePowerWatts: 234, evidenceConfidence: 'high' },
                    { segmentIndex: 2, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_watts', value: 230 }, averagePowerWatts: 231, evidenceConfidence: 'high' },
                    { segmentIndex: 3, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 180, prescribedTarget: { kind: 'power_watts', value: 320 }, averagePowerWatts: 315, evidenceConfidence: 'high' },
                ],
            },
        });

        const feature = deriveIntervalRepetition(session);
        expect(feature.state === 'available' && feature.intervals.map(item => item.powerWatts))
            .toEqual([234, 231, 315]);
    });

    it('preserves an internal low-target work step when an explicit cooldown follows it', () => {
        const session = ride({
            stimulusDomain: 'threshold',
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1 },
                segmentCountTotal: 4,
                segmentsTruncated: false,
                powerDurationPeaks: [],
                segments: [
                    { segmentIndex: 1, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_watts', value: 230 }, averagePowerWatts: 234, evidenceConfidence: 'high' },
                    { segmentIndex: 2, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 900, prescribedTarget: { kind: 'power_watts', value: 230 }, averagePowerWatts: 231, evidenceConfidence: 'high' },
                    { segmentIndex: 3, segmentType: 'work', identitySource: 'fit_workout_step', durationSeconds: 180, prescribedTarget: { kind: 'power_watts', value: 150 }, averagePowerWatts: 150, evidenceConfidence: 'high' },
                    { segmentIndex: 4, segmentType: 'cooldown', identitySource: 'fit_workout_step', durationSeconds: 600, averagePowerWatts: 120, evidenceConfidence: 'high' },
                ],
            },
        });

        const feature = deriveIntervalRepetition(session);
        expect(feature.state === 'available' && feature.intervals.map(item => item.powerWatts))
            .toEqual([234, 231, 150]);
    });

    it('keeps a same-target final repetition eligible for a real late-collapse flag', () => {
        const session = ride({
            stimulusDomain: 'threshold',
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1 },
                segmentCountTotal: 3,
                segmentsTruncated: false,
                powerDurationPeaks: [],
                segments: [234, 231, 67].map((power, index) => ({
                    segmentIndex: index + 1,
                    segmentType: 'work' as const,
                    identitySource: 'fit_workout_step' as const,
                    durationSeconds: 900,
                    prescribedTarget: { kind: 'power_3s_target', low: 220, high: 240 },
                    averagePowerWatts: power,
                    evidenceConfidence: 'high' as const,
                })),
            },
        });

        const feature = deriveIntervalRepetition(session);
        expect(feature.state === 'available' && feature.intervals.map(item => item.powerWatts))
            .toEqual([234, 231, 67]);
        expect(feature.state === 'available' && feature.pattern).toBe('late_collapse');
    });

    it('keeps the prescribed target separate from actual power and renders within-rep trajectory', () => {
        const context = { history: [semanticThreshold], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([semanticThreshold], context), context);
        expect(text).toContain('3 × 15 min @ 229 / 231 / 226 W actual');
        expect(text).toContain('Prescription: 230 W (kept separate from performed power)');
        expect(text).toContain('Within-rep power thirds: #1 232/230/225 W');
        expect(text).toContain('HR final third: 158 / 160 / 163 bpm');
        expect(text).not.toContain('400 W actual');
    });

    it('represents 30/30 work and equal-duration recovery without confusing recoveries for work', () => {
        const segments = Array.from({ length: 8 }, (_, index) => [
            { segmentIndex: index * 2 + 1, segmentType: 'work' as const, identitySource: 'fit_workout_step' as const, durationSeconds: 30, averagePowerWatts: 360 - index * 2, evidenceConfidence: 'high' as const },
            { segmentIndex: index * 2 + 2, segmentType: 'recovery' as const, identitySource: 'fit_workout_step' as const, durationSeconds: 30, averagePowerWatts: 120, evidenceConfidence: 'high' as const },
        ]).flat();
        const session = ride({
            stimulusDomain: 'vo2',
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1 },
                segmentCountTotal: segments.length,
                segmentsTruncated: false,
                segments,
                powerDurationPeaks: [],
            },
        });
        const feature = deriveIntervalRepetition(session);
        expect(feature.state === 'available' && feature.intervals).toHaveLength(8);
        expect(feature.state === 'available' && feature.intervals.every(item => item.powerWatts > 300)).toBe(true);
    });

    it('uses FIT-semantic steps for 4x4 even though the legacy 120 s gate is no longer the identity mechanism', () => {
        const segments = [330, 326, 323, 319].map((power, index) => ({
            segmentIndex: index + 1,
            segmentType: 'work' as const,
            identitySource: 'fit_workout_step' as const,
            durationSeconds: 240,
            averagePowerWatts: power,
            evidenceConfidence: 'high' as const,
        }));
        const feature = deriveIntervalRepetition(ride({
            stimulusDomain: 'vo2',
            laps: undefined,
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1 },
                segmentCountTotal: 4,
                segmentsTruncated: false,
                segments,
                powerDurationPeaks: [],
            },
        }));
        expect(feature.state === 'available' && feature.intervals.map(item => item.powerWatts)).toEqual([330, 326, 323, 319]);
    });

    it('uses FIT-semantic steps for 6x10 s sprints, with power/cadence as the primary signal', () => {
        const powers = [720, 715, 700, 690, 680, 665];
        const session = ride({
            stimulusDomain: 'anaerobic',
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1, cadenceSeconds: 1 },
                segmentCountTotal: 6,
                segmentsTruncated: false,
                powerDurationPeaks: [{ durationSeconds: 5, powerWatts: 760, confidence: 'high' }],
                segments: powers.map((power, index) => ({
                    segmentIndex: index + 1,
                    segmentType: 'sprint' as const,
                    identitySource: 'fit_workout_step' as const,
                    durationSeconds: 10,
                    averagePowerWatts: power,
                    peak5sPowerWatts: power + 25,
                    peak10sPowerWatts: power,
                    maxCadenceRpm: 122 - index,
                    averageHrBpm: 130 + index,
                    evidenceConfidence: 'high' as const,
                })),
            },
        });
        const feature = deriveSprintRepetition(session);
        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.sprints).toHaveLength(6);
        expect(feature.sprints.every(item => item.hrBpm === undefined)).toBe(true);
        expect(feature.meanPeak5sWatts).toBeGreaterThan(feature.meanPowerWatts);
        const context = { history: [session], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([session], context), context);
        expect(text).toContain('Sprints: 6 × 10 s');
        expect(text).toContain('Sprint peak 5 s');
        expect(text).toContain('Mean 10 s');
        expect(text).toContain('Peak cadence');
    });

    it('uses deterministic continuous halves for steady decoupling when detailed laps are absent', () => {
        const session = steady('steady-native', '2026-09-18', {
            laps: undefined,
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1, hrSeconds: 1 },
                segmentCountTotal: 0,
                segmentsTruncated: false,
                segments: [],
                powerDurationPeaks: [],
                steadyHalves: {
                    firstPowerWatts: 180,
                    secondPowerWatts: 180,
                    firstHrBpm: 130,
                    secondHrBpm: 136,
                },
            },
        });
        const feature = deriveDecoupling(session);
        expect(feature.state).toBe('available');
        expect(feature.state === 'available' && feature.decouplingPct).toBeGreaterThan(4);
        const context = { history: [session], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([session], context), context);
        expect(text).toContain('Pw:HR decoupling (first vs second half)');
        expect(text).not.toContain('lap averages');
    });

    it('keeps planning output bounded for long microinterval protocols', () => {
        const segments = Array.from({ length: 40 }, (_, index) => ({
            segmentIndex: index + 1,
            segmentType: 'work' as const,
            identitySource: 'fit_workout_step' as const,
            durationSeconds: 30,
            averagePowerWatts: 350 - (index % 5),
            prescribedTarget: { kind: 'power_watts', value: 350 },
            firstThirdPowerWatts: 352,
            middleThirdPowerWatts: 350,
            lastThirdPowerWatts: 348,
            evidenceConfidence: 'high' as const,
        }));
        const session = ride({
            stimulusDomain: 'vo2',
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1 },
                segmentCountTotal: 40,
                segmentsTruncated: false,
                segments,
                powerDurationPeaks: [],
            },
        });
        const context = { history: [session], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([session], context), context);
        expect(text).toContain('… +30');
        expect(text.length).toBeLessThan(5000);
    });
});


describe('multi-resolution HR-fidelity propagation (#850)', () => {
    it('withholds semantic interval HR when the existing HR authority rejects the measurement', () => {
        const session = ride({
            stimulusDomain: 'threshold',
            hrMeasurement: {
                measurementConfidence: 'low',
                signalQuality: 'unreliable',
                summaryCompatibility: 'verified_same_effective_trace',
                artifactFlags: [],
                reasons: ['synthetic low-confidence fixture'],
            } as unknown as HrMeasurement,
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1, hrSeconds: 1 },
                segmentCountTotal: 2,
                segmentsTruncated: false,
                powerDurationPeaks: [],
                segments: [
                    {
                        segmentIndex: 1,
                        segmentType: 'work',
                        identitySource: 'fit_workout_step',
                        durationSeconds: 900,
                        averagePowerWatts: 230,
                        averageHrBpm: 155,
                        endHrBpm: 160,
                        lastThirdHrBpm: 158,
                        evidenceConfidence: 'high',
                    },
                    {
                        segmentIndex: 2,
                        segmentType: 'work',
                        identitySource: 'fit_workout_step',
                        durationSeconds: 900,
                        averagePowerWatts: 228,
                        averageHrBpm: 158,
                        endHrBpm: 163,
                        lastThirdHrBpm: 161,
                        evidenceConfidence: 'high',
                    },
                ],
            },
        });

        const feature = deriveIntervalRepetition(session);

        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.intervals.every(interval => interval.hrBpm === undefined)).toBe(true);
        expect(feature.intervals.every(interval => interval.endHrBpm === undefined)).toBe(true);
        expect(feature.intervals.every(interval => interval.lastThirdHrBpm === undefined)).toBe(true);
        expect(feature.hrNote).toContain('HR withheld');
    });
});
