import { describe, expect, it } from 'vitest';
import type { ActivityLapSummary, DailySubjectiveCheckin, HrMeasurement, NormalizedGarminActivity } from './models';
import type { ResponseSessionIdentity } from './contextBriefComparability';
import type { TrainingResponseSessionEvidence } from '../training-occurrence/trainingResponseEvidence';
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

function responseEvidence(activity: NormalizedGarminActivity, occurrenceId: string): TrainingResponseSessionEvidence {
    return {
        performedOccurrenceId: occurrenceId,
        localDate: activity.date,
        modality: 'Cycling',
        identity: { level: 'canonical_occurrence', sourceKinds: ['provider_activity'] },
        measuredSources: [{
            sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: activity.activityId },
            provider: 'garmin',
            activityId: activity.activityId,
            activity,
        }],
        sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'not_linked', providerActivities: 'available' },
    };
}

describe('response summary provenance and bounds (#814 WP7)', () => {
    it('fails closed for provider response features when an occurrence has multiple Garmin recordings', () => {
        const first = steady('recording-a', '2026-09-18');
        const second = steady('recording-b', '2026-09-18');
        const evidence: TrainingResponseSessionEvidence = {
            performedOccurrenceId: 'pto-ambiguous',
            localDate: '2026-09-18',
            modality: 'Cycling',
            identity: { level: 'canonical_occurrence', sourceKinds: ['provider_activity'] },
            measuredSources: [first, second].map(activity => ({
                sourceRef: { kind: 'provider_activity' as const, provider: 'garmin', activityId: activity.activityId },
                provider: 'garmin',
                activityId: activity.activityId,
                activity,
            })),
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'not_linked', providerActivities: 'ambiguous' },
        };
        const context = {
            history: [first, second], historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: '2026-09-18', windowEnd: '2026-09-18', evidence: [evidence],
        };

        const summaries = deriveKeySessionSummaries([first, second], context);
        expect(summaries).toHaveLength(1);
        expect(summaries[0].activity).toBeUndefined();
        expect(summaries[0].efficiency.state).toBe('insufficient_evidence');
        expect(renderKeySessionSummaries(summaries, context)).toContain('multiple recordings represent this occurrence');
    });

    it('fails closed with accurate provenance when provider activity evidence is partial', () => {
        const activity = steady('partial-recording', '2026-09-18');
        const evidence: TrainingResponseSessionEvidence = {
            ...responseEvidence(activity, 'pto-partial'),
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'not_linked', providerActivities: 'partial' },
        };
        const context = {
            history: [activity], historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: activity.date, windowEnd: activity.date, evidence: [evidence],
        };

        const summaries = deriveKeySessionSummaries([activity], context);
        const text = renderKeySessionSummaries(summaries, context);

        expect(summaries).toHaveLength(1);
        expect(summaries[0].activity).toBeUndefined();
        expect(summaries[0].providerSelectionFailure).toBe('partial');
        expect(text).toContain('provider activity evidence is only partially available');
        expect(text).not.toContain('multiple recordings represent this occurrence');
        expect(text).not.toContain('Steady power–HR response ratio');
    });

    it('suppresses failed provider-source detail in planning but retains it in diagnostic output', () => {
        const first = steady('ambiguous-detail-a', '2026-09-18');
        const second = steady('ambiguous-detail-b', '2026-09-18');
        const evidence: TrainingResponseSessionEvidence = {
            ...responseEvidence(first, 'pto-ambiguous-detail'),
            measuredSources: [first, second].map(activity => ({
                sourceRef: { kind: 'provider_activity' as const, provider: 'garmin', activityId: activity.activityId },
                provider: 'garmin',
                activityId: activity.activityId,
                activity,
            })),
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'not_linked', providerActivities: 'ambiguous' },
        };
        const brief = '# Brief\n\n## 2. Completed training (recorded by the wearable)\n\nrows\n\n## 3. Next\n';
        const context = {
            history: [first, second], historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: '2026-09-18', windowEnd: '2026-09-18', evidence: [evidence],
        };

        const planning = injectActivityTelemetryIntoContextBrief(brief, [first, second], true, context);
        const diagnostic = injectActivityTelemetryIntoContextBrief(
            brief,
            [first, second],
            false,
            { ...context, diagnostic: true },
        );

        expect(planning).toContain('multiple recordings represent this occurrence');
        expect(planning).not.toContain('### Key-session telemetry (compact)');
        expect(planning).not.toContain('### Quality-session execution detail (bounded)');
        expect(diagnostic).toContain('### Detailed activity telemetry');
        expect(diagnostic.match(/- Power summary:/g)).toHaveLength(2);
    });

    it('suppresses failed provider detail when provider and canonical dates straddle the render-window boundary', () => {
        const activity = steady('partial-boundary', '2026-09-18');
        const evidence: TrainingResponseSessionEvidence = {
            ...responseEvidence(activity, 'pto-partial-boundary'),
            localDate: '2026-09-17',
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'not_linked', providerActivities: 'partial' },
        };
        const brief = '# Brief\n\n## 2. Completed training (recorded by the wearable)\n\nrows\n\n## 3. Next\n';
        const context = {
            history: [activity], historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: '2026-09-18', windowEnd: '2026-09-18', evidence: [evidence],
        };

        expect(deriveKeySessionSummaries([activity], context)).toEqual([]);

        const planning = injectActivityTelemetryIntoContextBrief(brief, [activity], true, context);
        const diagnostic = injectActivityTelemetryIntoContextBrief(
            brief,
            [activity],
            false,
            { ...context, diagnostic: true },
        );

        expect(planning).toBe(brief);
        expect(diagnostic).toContain('### Detailed activity telemetry');
        expect(diagnostic).toContain('- Power summary:');
    });

    it('does not use ambiguous prior recordings through the provider fallback', () => {
        const current = steady('current', '2026-09-18');
        const priorA = steady('prior-a', '2026-09-11');
        const priorB = steady('prior-b', '2026-09-11');
        const ambiguousPrior: TrainingResponseSessionEvidence = {
            ...responseEvidence(priorA, 'pto-prior'),
            measuredSources: [priorA, priorB].map(activity => ({
                sourceRef: { kind: 'provider_activity' as const, provider: 'garmin', activityId: activity.activityId },
                provider: 'garmin',
                activityId: activity.activityId,
                activity,
            })),
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'not_linked', providerActivities: 'ambiguous' },
        };
        const context = {
            history: [current, priorA, priorB], historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: current.date, windowEnd: current.date,
            evidence: [responseEvidence(current, 'pto-current'), ambiguousPrior],
        };
        const summaries = deriveKeySessionSummaries([current], context);

        expect(summaries).toHaveLength(1);
        expect(summaries[0].efficiency).toMatchObject({ state: 'insufficient_evidence', kind: 'no_comparable', rejected: [] });
    });

    it('keeps canonical structured strength when ambiguous provider rows are unavailable', () => {
        const evidence: TrainingResponseSessionEvidence = {
            ...structuredStrengthEvidence({
                activityId: 'missing-garmin-a', occurrenceId: 'pto-strength', localDate: '2026-09-18',
                executionId: 'exec-strength', performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
            }),
            measuredSources: ['missing-garmin-a', 'missing-garmin-b'].map(activityId => ({
                sourceRef: { kind: 'provider_activity' as const, provider: 'garmin', activityId },
                provider: 'garmin',
                activityId,
            })),
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'available', providerActivities: 'ambiguous' },
        };
        const context = {
            history: [], historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: '2026-09-18', windowEnd: '2026-09-18', evidence: [evidence],
        };
        const summaries = deriveKeySessionSummaries([], context);
        const text = renderKeySessionSummaries(summaries, context);

        expect(summaries).toHaveLength(1);
        expect(summaries[0].strength.state).toBe('available');
        expect(text).toContain('Strength front_squat: Adaptive structured identity');
    });

    it('does not widen an implicit render window to older comparison evidence', () => {
        const current = ride({ activityId: 'current', date: '2026-09-18', stimulusDomain: 'unknown' });
        const oldStructured = structuredStrengthEvidence({
            activityId: 'old-structured', occurrenceId: 'pto-old', localDate: '2026-08-01',
            executionId: 'exec-old', performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
        });
        const context = {
            history: [current], historyStart: '2026-08-01', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', evidence: [oldStructured],
        };

        expect(deriveKeySessionSummaries([current], context)).toEqual([]);
    });

    it('renders bounded diagnostic identity and the selected comparison provenance', () => {
        const current = steady('current', '2026-09-18', { hrMeasurement: HIGH_HR });
        const prior = steady('prior', '2026-09-11', { hrMeasurement: HIGH_HR });
        const currentEvidence = responseEvidence(current, 'pto-current');
        currentEvidence.identity.sourceKinds = ['structured_execution', 'provider_activity'];
        const context = {
            history: [current, prior], historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: current.date, windowEnd: current.date,
            evidence: [currentEvidence, responseEvidence(prior, 'pto-prior')],
            diagnostic: true,
        };
        const summaries = deriveKeySessionSummaries([current], context);
        const text = renderKeySessionSummaries(summaries, context);
        const planningText = renderKeySessionSummaries(summaries, { ...context, diagnostic: false });

        expect(text).toContain('Diagnostic provenance: occurrence pto-current; identity canonical_occurrence; source kinds provider_activity, structured_execution; sources garmin:current; provider selection available');
        expect(text).toContain('Diagnostic comparison: selected prior prior (2026-09-11); cycling_steady_power_hr comparable via controlled_steady_match; occurrence distinct; protocol unknown; measurement observational; threshold same; venue/environment unknown; source completeness canonical; limitations measurement/sensor authority observational, venue/environment context unknown');
        expect(planningText).not.toContain('Diagnostic provenance');
        expect(planningText).not.toContain('garmin:current');
    });

    it('sorts and caps diagnostic provider source provenance', () => {
        const activities = Array.from({ length: 10 }, (_, index) =>
            steady(`source-${String(index).padStart(2, '0')}`, '2026-09-18'));
        const evidence: TrainingResponseSessionEvidence = {
            ...responseEvidence(activities[9], 'pto-many-sources'),
            measuredSources: [...activities].reverse().map(activity => ({
                sourceRef: { kind: 'provider_activity' as const, provider: 'garmin', activityId: activity.activityId },
                provider: 'garmin',
                activityId: activity.activityId,
                activity,
            })),
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'not_linked', providerActivities: 'ambiguous' },
        };
        const context = {
            history: activities, historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: '2026-09-18', windowEnd: '2026-09-18',
            evidence: [evidence], diagnostic: true,
        };

        const text = renderKeySessionSummaries(deriveKeySessionSummaries([activities[9]], context), context);

        expect(text).toContain('sources garmin:source-00, garmin:source-01, garmin:source-02, garmin:source-03, garmin:source-04, garmin:source-05, garmin:source-06, garmin:source-07; 2 additional sources omitted; provider selection ambiguous');
        expect(text).not.toContain('garmin:source-08');
    });

    it('caps retained comparison rejections and reports omitted candidates', () => {
        const current = steady('current', '2026-09-18');
        const priors = Array.from({ length: 12 }, (_, index) => steady(`prior-${index}`, `2026-09-${String(index + 1).padStart(2, '0')}`, { stimulusDomain: 'vo2' }));
        const result = deriveEfficiencyComparison(current, priors);

        expect(result.state).toBe('insufficient_evidence');
        expect(result.state === 'insufficient_evidence' && result.kind === 'no_comparable' ? result.rejected : []).toHaveLength(8);
        expect(result.state === 'insufficient_evidence' && result.kind === 'no_comparable' ? result.rejectedOmittedCount : 0).toBe(4);
    });

    it('keeps planning rejection output bounded with 100 historical candidates', () => {
        const current = steady('current-bounded', '2026-09-18');
        const priors = Array.from({ length: 100 }, (_, index) =>
            steady(`prior-bounded-${String(index).padStart(3, '0')}`, '2026-09-01', { stimulusDomain: 'vo2' }));
        const context = {
            history: [current, ...priors], historyStart: '2026-08-22', checkins: NO_CHECKINS,
            asOfDate: '2026-09-20', windowStart: current.date, windowEnd: current.date,
        };

        const text = renderKeySessionSummaries(deriveKeySessionSummaries([current], context), context);

        expect(text).toContain('+97 more');
        expect(text.length).toBeLessThan(2500);
    });
});

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

    it('qualifies verified-HR decoupling when the available aggregates cannot support a confidence grade', () => {
        const session = steady('verified', '2026-09-18');
        const context = { history: [session], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20' };
        const summary = deriveKeySessionSummaries([session], context)[0];
        expect(summary.decoupling.state).toBe('available');
        if (summary.decoupling.state !== 'available') return;
        const text = renderKeySessionSummaries([{
            ...summary,
            decoupling: { ...summary.decoupling, observational: false },
        }], context);
        expect(text).toContain('evidence confidence cannot be graded from HR authority and half aggregates alone');
        expect(text).not.toContain('evidence confidence ungraded');
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
        expect(feature.state === 'available' && feature.basis).toBe('same authored prescription');
    });

    it('keeps provider-only comparison available when canonical occurrence reads fail', () => {
        const prior = steady('prior', '2026-09-10');
        const summaries = deriveKeySessionSummaries([current], {
            history: [current, prior], historyStart: '2026-09-01', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            evidence: [{
                localDate: current.date, modality: 'Cycling',
                identity: { level: 'provider_activity_only', sourceKinds: ['provider_activity'] },
                measuredSources: [{
                    sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: current.activityId },
                    provider: 'garmin',
                    activityId: current.activityId,
                    activity: current,
                }],
                sourceCompleteness: {
                    occurrenceRead: 'unavailable', structuredExecution: 'unavailable', providerActivities: 'available',
                },
            }],
        });
        const comparison = summaries.find(summary => summary.activity?.activityId === current.activityId)?.efficiency;
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

    it('uses canonical occurrence dates for chronology and the rendered prior date', () => {
        const prior = steady('prior-adjacent', '2026-09-18');
        const identities = new Map<string, ResponseSessionIdentity>([
            ['now', { localDate: '2026-09-19' }],
            ['prior-adjacent', { localDate: '2026-09-10' }],
        ]);
        const feature = deriveEfficiencyComparison(current, [prior], identities);
        expect(feature.state).toBe('available');
        expect(feature.state === 'available' && feature.priorDate).toBe('2026-09-10');
    });

    it('uses canonical occurrence dates when ranking equally strong prior comparators', () => {
        const providerNewerButCanonicalOlder = steady('provider-newer', '2026-09-16');
        const providerOlderButCanonicalNewer = steady('provider-older', '2026-09-15');
        const identities = new Map<string, ResponseSessionIdentity>([
            ['now', { localDate: '2026-09-19' }],
            ['provider-newer', { localDate: '2026-09-10' }],
            ['provider-older', { localDate: '2026-09-11' }],
        ]);
        const feature = deriveEfficiencyComparison(
            current,
            [providerNewerButCanonicalOlder, providerOlderButCanonicalNewer],
            identities,
        );
        expect(feature.state === 'available' && feature.priorActivityId).toBe('provider-older');
        expect(feature.state === 'available' && feature.priorDate).toBe('2026-09-11');
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

function structuredStrengthEvidence(input: {
    activityId: string;
    occurrenceId: string;
    localDate: string;
    executionId: string;
    performedExerciseId?: string;
    reps: number;
    weightKg: number;
    warmupWeightKg?: number;
}): TrainingResponseSessionEvidence {
    const prescriptionHash = `rx-${input.occurrenceId}`;
    const workSet = {
        entryId: `${input.occurrenceId}-work`,
        setNumber: 1,
        isWarmup: false,
        completedAt: `${input.localDate}T07:10:00Z`,
        payload: { kind: 'repetition' as const, setIndex: 0, reps: input.reps, weightKg: input.weightKg },
        ...(input.performedExerciseId ? { exerciseRef: { kind: 'catalog' as const, exerciseId: input.performedExerciseId } } : {}),
    };
    const warmupSet = input.warmupWeightKg === undefined ? [] : [{
        entryId: `${input.occurrenceId}-warmup`,
        setNumber: 1,
        isWarmup: true,
        completedAt: `${input.localDate}T07:00:00Z`,
        payload: { kind: 'repetition' as const, setIndex: 0, reps: input.reps, weightKg: input.warmupWeightKg, isWarmup: true },
        ...(input.performedExerciseId ? { exerciseRef: { kind: 'catalog' as const, exerciseId: input.performedExerciseId } } : {}),
    }];
    return {
        performedOccurrenceId: input.occurrenceId,
        localDate: input.localDate,
        modality: 'Strength',
        identity: {
            level: 'canonical_occurrence',
            reconciliationStatus: 'matched',
            sourceKinds: ['structured_execution', 'provider_activity'],
        },
        structured: {
            sourceRef: { kind: 'structured_execution', executionId: input.executionId, prescriptionHash },
            executionId: input.executionId,
            prescriptionHash,
            sessionSource: { kind: 'catalog', workoutId: 'strength-fixture', catalogVersion: 'v1' },
            steps: [{
                stepId: 'main-lift',
                ...(input.performedExerciseId ? { exerciseRef: { kind: 'catalog', exerciseId: input.performedExerciseId } } : {}),
                title: 'Back Squat',
                isOptional: false,
                prescribed: { sets: 1, reps: input.reps },
                sets: [...warmupSet, workSet],
            }],
        },
        measuredSources: [{
            sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: input.activityId },
            provider: 'garmin',
            activityId: input.activityId,
        }],
        sourceCompleteness: {
            occurrenceRead: 'available',
            structuredExecution: 'available',
            providerActivities: 'available',
        },
    };
}

function executionEvidence(
    activityId: string,
    occurrenceId: string,
    localDate: string,
    executionId: string,
    extraActivityIds: readonly string[] = [],
    structuredAvailable = true,
): TrainingResponseSessionEvidence {
    const structuredSourceRef = { kind: 'structured_execution' as const, executionId };
    return {
        performedOccurrenceId: occurrenceId,
        localDate,
        modality: 'Cycling',
        identity: {
            level: 'canonical_occurrence',
            reconciliationStatus: 'matched',
            sourceKinds: ['structured_execution', 'provider_activity'],
        },
        structuredSourceRef,
        ...(structuredAvailable ? { structured: {
            sourceRef: structuredSourceRef,
            executionId,
            sessionSource: { kind: 'catalog' as const, workoutId: 'cycling-fixture', catalogVersion: 'v1' },
            steps: [],
        } } : {}),
        measuredSources: [activityId, ...extraActivityIds].map(id => ({
            sourceRef: { kind: 'provider_activity' as const, provider: 'garmin', activityId: id },
            provider: 'garmin',
            activityId: id,
        })),
        sourceCompleteness: {
            occurrenceRead: 'available',
            structuredExecution: structuredAvailable ? 'available' : 'unavailable',
            providerActivities: extraActivityIds.length > 0 ? 'ambiguous' : 'available',
        },
    };
}

describe('strength progression (#814)', () => {
    it('renders structured-only strength and next-day evidence without a Garmin activity', () => {
        const prior = structuredStrengthEvidence({
            activityId: 'not-loaded-prior', occurrenceId: 'structured-prior', localDate: '2026-09-11',
            executionId: 'exec-prior', performedExerciseId: 'front_squat', reps: 5, weightKg: 77.5,
        });
        const current: TrainingResponseSessionEvidence = {
            ...structuredStrengthEvidence({
                activityId: 'not-loaded-current', occurrenceId: 'structured-current', localDate: '2026-09-18',
                executionId: 'exec-current', performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
            }),
            modality: 'strength_training',
        };
        const nextDay = {
            ...checkin('2026-09-19', 4, 5),
            tissueResponses: {
                right_knee: {
                    region: 'right_knee', nextMorningReaction: 'moderate',
                    sourceSessionRef: { kind: 'execution', id: 'exec-current', date: '2026-09-18' },
                },
            },
        } as unknown as DailySubjectiveCheckin;
        const context = {
            history: [], historyStart: '2026-08-22', checkins: {
                records: [checkin('2026-09-18', 3, 4), nextDay], unreadableDates: [],
            }, asOfDate: '2026-09-20', windowStart: '2026-09-18', windowEnd: '2026-09-20', evidence: [prior, current],
        };
        const summaries = deriveKeySessionSummaries([], context);
        const text = renderKeySessionSummaries(summaries, context);
        expect(summaries).toHaveLength(1);
        expect(text).toContain('2026-09-18 — Strength — structured execution');
        expect(text).toContain('Strength front_squat: Adaptive structured identity · 1 working set · top 80 kg × 5');
        expect(text).toContain('prior 2026-09-11: 77.5 kg × 5; comparison comparable via canonical exercise identity; moderate confidence');
        expect(text).toContain('Next morning (observational, not proof the session caused it)');
        expect(text).toContain('right_knee moderate (linked to this session)');
        expect(text).not.toContain('NormalizedGarminActivity');
    });


    it('renders canonical structured strength evidence inside a hybrid occurrence', () => {
        const evidence: TrainingResponseSessionEvidence = {
            ...structuredStrengthEvidence({
                activityId: 'not-loaded-hybrid', occurrenceId: 'structured-hybrid', localDate: '2026-09-18',
                executionId: 'exec-hybrid', performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
            }),
            modality: 'Cross Training',
        };
        const context = {
            history: [], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            windowStart: '2026-09-18', windowEnd: '2026-09-20', evidence: [evidence],
        };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([], context), context);
        expect(text).toContain('2026-09-18 — Cross Training — structured execution');
        expect(text).toContain('Strength front_squat: Adaptive structured identity · 1 working set · top 80 kg × 5');
    });

    it('does not emit a strength-unavailable row for a non-strength structured occurrence', () => {
        const unavailable: TrainingResponseSessionEvidence = {
            performedOccurrenceId: 'structured-cross-unavailable',
            localDate: '2026-09-18', modality: 'Cross Training',
            identity: { level: 'canonical_occurrence', sourceKinds: ['structured_execution'] },
            structuredSourceRef: { kind: 'structured_execution', executionId: 'exec-cross-unavailable' },
            measuredSources: [],
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'unavailable', providerActivities: 'not_linked' },
        };
        const context = {
            history: [], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            windowStart: '2026-09-18', windowEnd: '2026-09-20', evidence: [unavailable],
        };
        expect(deriveKeySessionSummaries([], context)).toHaveLength(0);
    });

    it('shows structured-only unavailable execution and does not fall back to a provider activity', () => {
        const unavailable: TrainingResponseSessionEvidence = {
            performedOccurrenceId: 'structured-only-unavailable',
            localDate: '2026-09-18', modality: 'Strength',
            identity: { level: 'canonical_occurrence', sourceKinds: ['structured_execution'] },
            structuredSourceRef: { kind: 'structured_execution', executionId: 'exec-unavailable' },
            measuredSources: [],
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'unavailable', providerActivities: 'not_linked' },
        };
        const context = {
            history: [], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            windowStart: '2026-09-18', windowEnd: '2026-09-20', evidence: [unavailable],
        };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([], context), context);
        expect(text).toContain('Strength response: insufficient evidence — structured execution linked but unavailable; provider exercise identity not used');
        expect(text).not.toContain('provider-recognized identity');
    });

    it('caps structured-only strength output at eight exercises', () => {
        const base = structuredStrengthEvidence({
            activityId: 'not-loaded', occurrenceId: 'structured-many', localDate: '2026-09-18',
            executionId: 'exec-many', reps: 5, weightKg: 80,
        });
        const step = base.structured!.steps[0];
        const evidence: TrainingResponseSessionEvidence = {
            ...base,
            structured: {
                ...base.structured!,
                steps: Array.from({ length: 12 }, (_, index) => ({
                    ...step,
                    stepId: `step-${index}`,
                    exerciseRef: { kind: 'catalog' as const, exerciseId: `exercise-${index}` },
                    sets: step.sets.map(set => ({
                        ...set,
                        exerciseRef: { kind: 'catalog' as const, exerciseId: `exercise-${index}` },
                    })),
                })),
            },
        };
        const context = {
            history: [], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            windowStart: '2026-09-18', windowEnd: '2026-09-20', evidence: [evidence],
        };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([], context), context);
        expect(text.match(/^- Strength /gm)).toHaveLength(8);
        expect(text).toContain('- 4 additional exercises omitted');
    });

    it('does not let a non-Garmin source ID hide a structured-only Garmin summary', () => {
        const activity = ride({ activityId: 'provider-id-collision', type: 'road_biking', stimulusDomain: 'unknown' });
        const base = structuredStrengthEvidence({
            activityId: activity.activityId, occurrenceId: 'structured-collision', localDate: activity.date,
            executionId: 'exec-collision', performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
        });
        const evidence: TrainingResponseSessionEvidence = {
            ...base,
            measuredSources: [{
                sourceRef: { kind: 'provider_activity', provider: 'other_provider', activityId: activity.activityId },
                provider: 'other_provider', activityId: activity.activityId,
            }],
        };
        const context = {
            history: [activity], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            windowStart: '2026-09-18', windowEnd: '2026-09-20', evidence: [evidence],
        };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([activity], context), context);
        expect(text).toContain('2026-09-18 — Strength — structured execution');
        expect(text).toContain('Strength front_squat');
    });

    it('compares an activity-backed structured lift with a structured-only prior', () => {
        const activity = lift('loaded-current', '2026-09-18', 80);
        const current = structuredStrengthEvidence({
            activityId: activity.activityId, occurrenceId: 'loaded-current-occurrence', localDate: '2026-09-18',
            executionId: 'loaded-current-execution', performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
        });
        const prior = structuredStrengthEvidence({
            activityId: 'not-loaded-prior', occurrenceId: 'structured-only-prior', localDate: '2026-09-11',
            executionId: 'structured-prior-execution', performedExerciseId: 'front_squat', reps: 5, weightKg: 77.5,
        });
        const context = {
            history: [activity], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            windowStart: '2026-09-18', windowEnd: '2026-09-20', evidence: [current, prior],
        };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([activity], context), context);
        expect(text).toContain('prior 2026-09-11: 77.5 kg × 5; comparison comparable via canonical exercise identity; moderate confidence');
    });

    it('caps structured-only occurrence summaries at eight and reports omissions', () => {
        const evidence = Array.from({ length: 10 }, (_, index) => structuredStrengthEvidence({
            activityId: `not-loaded-${index}`, occurrenceId: `structured-${index}`, localDate: `2026-09-${String(10 + index).padStart(2, '0')}`,
            executionId: `exec-${index}`, performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
        }));
        const context = {
            history: [], historyStart: '2026-08-22', checkins: NO_CHECKINS, asOfDate: '2026-09-20',
            windowStart: '2026-09-01', windowEnd: '2026-09-20', evidence,
        };
        const summaries = deriveKeySessionSummaries([], context);
        const text = renderKeySessionSummaries(summaries, context);
        expect(summaries).toHaveLength(8);
        expect(text).toContain('- 2 additional structured-only strength occurrences omitted');
    });

    it('reports top set against the prior same-exercise session', () => {
        const feature = deriveStrengthProgression(lift('now', '2026-09-18', 80), [lift('prior', '2026-09-11', 77.5)]);
        expect(feature).toEqual({
            state: 'available',
            exercises: [{ exercise: 'BARBELL_BACK_SQUAT', identitySource: 'provider-recognized identity; confidence limited', workingSets: 2, topWeightKg: 80, topReps: 5, prior: {
                date: '2026-09-11', topWeightKg: 77.5, topReps: 5, comparison: 'like-for-like',
                decision: {
                    state: 'comparable', matchBasis: 'provider_fallback', hardRejections: [],
                    limitations: ['provider-recognized exercise identity limits confidence'], confidenceCeiling: 'low',
                },
            } }],
        });
    });

    it('is withheld when any working set lacks an exercise identity', () => {
        const feature = deriveStrengthProgression(lift('now', '2026-09-18', 80, false), []);
        expect(feature.state).toBe('insufficient_evidence');
    });

    it('uses performed structured identity, canonical dates and excludes warm-up sets from the marker', () => {
        const current = lift('now-structured', '2026-09-17', 80);
        const prior = lift('prior-structured', '2026-09-17', 75);
        const currentEvidence = structuredStrengthEvidence({
            activityId: current.activityId, occurrenceId: 'pto-now', localDate: '2026-09-18',
            executionId: 'exec-now', performedExerciseId: 'front_squat', reps: 5, weightKg: 80, warmupWeightKg: 100,
        });
        const priorEvidence = structuredStrengthEvidence({
            activityId: prior.activityId, occurrenceId: 'pto-prior', localDate: '2026-09-11',
            executionId: 'exec-prior', performedExerciseId: 'front_squat', reps: 5, weightKg: 75,
        });
        const feature = deriveStrengthProgression(current, [prior], new Map([
            [current.activityId, currentEvidence],
            [prior.activityId, priorEvidence],
        ]), new Map([
            [current.activityId, { performedOccurrenceId: 'pto-now', localDate: '2026-09-18', sourceCompleteness: 'canonical' }],
            [prior.activityId, { performedOccurrenceId: 'pto-prior', localDate: '2026-09-11', sourceCompleteness: 'canonical' }],
        ]));
        expect(feature).toEqual({
            state: 'available',
            exercises: [{
                exercise: 'front_squat',
                identitySource: 'Adaptive structured identity',
                workingSets: 1,
                topWeightKg: 80,
                topReps: 5,
                prior: { date: '2026-09-11', topWeightKg: 75, topReps: 5, comparison: 'like-for-like', decision: {
                    state: 'comparable', matchBasis: 'canonical_exercise_identity', hardRejections: [],
                    limitations: [], confidenceCeiling: 'moderate',
                } },
            }],
        });
    });

    it('keeps structured strength comparable when unrelated provider-source selection is ambiguous', () => {
        const current = lift('now-structured-ambiguous', '2026-09-18', 80);
        const prior = lift('prior-structured-ambiguous', '2026-09-11', 75);
        const currentEvidence = structuredStrengthEvidence({
            activityId: current.activityId, occurrenceId: 'pto-now-ambiguous', localDate: '2026-09-18',
            executionId: 'exec-now-ambiguous', performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
        });
        const priorEvidence = structuredStrengthEvidence({
            activityId: prior.activityId, occurrenceId: 'pto-prior-ambiguous', localDate: '2026-09-11',
            executionId: 'exec-prior-ambiguous', performedExerciseId: 'front_squat', reps: 5, weightKg: 75,
        });
        const feature = deriveStrengthProgression(current, [prior], new Map([
            [current.activityId, currentEvidence],
            [prior.activityId, priorEvidence],
        ]), new Map([
            [current.activityId, { performedOccurrenceId: 'pto-now-ambiguous', localDate: '2026-09-18', sourceCompleteness: 'ambiguous' }],
            [prior.activityId, { performedOccurrenceId: 'pto-prior-ambiguous', localDate: '2026-09-11', sourceCompleteness: 'ambiguous' }],
        ]));
        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.exercises[0].prior?.decision).toMatchObject({
            state: 'comparable',
            matchBasis: 'canonical_exercise_identity',
            confidenceCeiling: 'moderate',
        });
    });

    it('selects a same-rep prior working set even when a heavier different-rep set exists', () => {
        const current = lift('now-structured', '2026-09-18', 82.5);
        const prior = lift('prior-structured', '2026-09-11', 90);
        const currentEvidence = structuredStrengthEvidence({
            activityId: current.activityId, occurrenceId: 'pto-now', localDate: '2026-09-18',
            executionId: 'exec-now', performedExerciseId: 'front_squat', reps: 5, weightKg: 82.5,
        });
        const priorEvidence = structuredStrengthEvidence({
            activityId: prior.activityId, occurrenceId: 'pto-prior', localDate: '2026-09-11',
            executionId: 'exec-prior', performedExerciseId: 'front_squat', reps: 3, weightKg: 90,
        });
        if (!priorEvidence.structured) throw new Error('fixture requires structured evidence');
        priorEvidence.structured.steps[0].sets.push({
            entryId: 'pto-prior-work-5',
            setNumber: 2,
            isWarmup: false,
            completedAt: '2026-09-11T07:15:00Z',
            payload: { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 80 },
            exerciseRef: { kind: 'catalog', exerciseId: 'front_squat' },
        });
        const feature = deriveStrengthProgression(current, [prior], new Map([
            [current.activityId, currentEvidence],
            [prior.activityId, priorEvidence],
        ]), new Map([
            [current.activityId, { performedOccurrenceId: 'pto-now', localDate: '2026-09-18', sourceCompleteness: 'canonical' }],
            [prior.activityId, { performedOccurrenceId: 'pto-prior', localDate: '2026-09-11', sourceCompleteness: 'canonical' }],
        ]));
        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.exercises[0].prior).toEqual({
            date: '2026-09-11', topWeightKg: 80, topReps: 5, comparison: 'like-for-like',
            decision: {
                state: 'comparable', matchBasis: 'canonical_exercise_identity', hardRejections: [],
                limitations: [], confidenceCeiling: 'moderate',
            },
        });
    });

    it('does not call different-rep structured top sets like-for-like', () => {
        const current = lift('now-structured', '2026-09-18', 80);
        const prior = lift('prior-structured', '2026-09-11', 85);
        const currentEvidence = structuredStrengthEvidence({
            activityId: current.activityId, occurrenceId: 'pto-now', localDate: '2026-09-18',
            executionId: 'exec-now', performedExerciseId: 'front_squat', reps: 5, weightKg: 80,
        });
        const priorEvidence = structuredStrengthEvidence({
            activityId: prior.activityId, occurrenceId: 'pto-prior', localDate: '2026-09-11',
            executionId: 'exec-prior', performedExerciseId: 'front_squat', reps: 3, weightKg: 85,
        });
        const feature = deriveStrengthProgression(current, [prior], new Map([
            [current.activityId, currentEvidence],
            [prior.activityId, priorEvidence],
        ]));
        expect(feature.state === 'available' && feature.exercises[0].prior?.comparison).toBe('different reps');
        expect(feature.state === 'available' && feature.exercises[0].prior?.decision).toMatchObject({
            state: 'not_comparable', hardRejections: ['different repetition count'],
        });
    });

    it('selects an older comparable set over a newer mechanically mismatched set', () => {
        const current = lift('now', '2026-09-18', 80);
        const recent = lift('recent', '2026-09-15', 90);
        const older = lift('older', '2026-09-11', 75);
        const evidence = new Map([
            [current.activityId, structuredStrengthEvidence({ activityId: current.activityId, occurrenceId: 'now-occ', localDate: '2026-09-18', executionId: 'now-exec', performedExerciseId: 'front_squat', reps: 5, weightKg: 80 })],
            [recent.activityId, structuredStrengthEvidence({ activityId: recent.activityId, occurrenceId: 'recent-occ', localDate: '2026-09-15', executionId: 'recent-exec', performedExerciseId: 'front_squat', reps: 3, weightKg: 90 })],
            [older.activityId, structuredStrengthEvidence({ activityId: older.activityId, occurrenceId: 'older-occ', localDate: '2026-09-11', executionId: 'older-exec', performedExerciseId: 'front_squat', reps: 5, weightKg: 75 })],
        ]);
        const identities = new Map([
            [current.activityId, { performedOccurrenceId: 'now-occ', localDate: '2026-09-18', sourceCompleteness: 'canonical' as const }],
            [recent.activityId, { performedOccurrenceId: 'recent-occ', localDate: '2026-09-15', sourceCompleteness: 'canonical' as const }],
            [older.activityId, { performedOccurrenceId: 'older-occ', localDate: '2026-09-11', sourceCompleteness: 'canonical' as const }],
        ]);
        const feature = deriveStrengthProgression(current, [recent, older], evidence, identities);
        expect(feature.state === 'available' && feature.exercises[0].prior).toMatchObject({
            date: '2026-09-11', topWeightKg: 75, topReps: 5, comparison: 'like-for-like',
            decision: { state: 'comparable', confidenceCeiling: 'moderate' },
        });
    });

    it('keeps structured step-only sets visible but withholds longitudinal identity comparison', () => {
        const current = lift('now-step-only', '2026-09-18', 80);
        const prior = lift('prior-step-only', '2026-09-11', 75);
        const currentEvidence = structuredStrengthEvidence({
            activityId: current.activityId, occurrenceId: 'pto-now-step', localDate: '2026-09-18',
            executionId: 'exec-now-step', reps: 5, weightKg: 80,
        });
        const priorEvidence = structuredStrengthEvidence({
            activityId: prior.activityId, occurrenceId: 'pto-prior-step', localDate: '2026-09-11',
            executionId: 'exec-prior-step', reps: 5, weightKg: 75,
        });
        const feature = deriveStrengthProgression(current, [prior], new Map([
            [current.activityId, currentEvidence], [prior.activityId, priorEvidence],
        ]), new Map([
            [current.activityId, { performedOccurrenceId: 'pto-now-step', localDate: '2026-09-18', sourceCompleteness: 'canonical' }],
            [prior.activityId, { performedOccurrenceId: 'pto-prior-step', localDate: '2026-09-11', sourceCompleteness: 'canonical' }],
        ]));
        expect(feature.state).toBe('available');
        if (feature.state !== 'available') return;
        expect(feature.exercises[0]).toMatchObject({
            identitySource: 'Adaptive structured step identity; comparison unavailable',
            topWeightKg: 80,
            prior: {
                topWeightKg: 75,
                comparison: 'insufficient evidence',
                decision: { state: 'insufficient_evidence', hardRejections: ['canonical exercise identity unavailable'] },
            },
        });
    });

    it('fails closed when a structured execution is linked but unavailable', () => {
        const current = lift('now-structured', '2026-09-18', 80);
        const unavailable: TrainingResponseSessionEvidence = {
            performedOccurrenceId: 'pto-now',
            localDate: '2026-09-18',
            modality: 'Strength',
            identity: { level: 'canonical_occurrence', sourceKinds: ['structured_execution', 'provider_activity'] },
            measuredSources: [{
                sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: current.activityId },
                provider: 'garmin',
                activityId: current.activityId,
            }],
            sourceCompleteness: {
                occurrenceRead: 'available',
                structuredExecution: 'unavailable',
                providerActivities: 'available',
            },
        };
        const feature = deriveStrengthProgression(current, [], new Map([[current.activityId, unavailable]]));
        expect(feature).toEqual({
            state: 'insufficient_evidence',
            reason: 'structured execution linked but unavailable; provider exercise identity not used',
        });
    });

    it('treats provider zero-weight sets as repetition-only rather than a different load type', () => {
        const current = ride({
            activityId: 'bw-now', date: '2026-09-18', type: 'strength_training', stimulusDomain: 'strength',
            exerciseSets: [{ setOrder: 1, setType: 'ACTIVE', repetitionCount: 10, weightKg: 0, exerciseName: 'PUSH_UP' }],
        });
        const prior = ride({
            activityId: 'bw-prior', date: '2026-09-11', type: 'strength_training', stimulusDomain: 'strength',
            exerciseSets: [{ setOrder: 1, setType: 'ACTIVE', repetitionCount: 10, exerciseName: 'PUSH_UP' }],
        });
        const feature = deriveStrengthProgression(current, [prior]);
        expect(feature.state === 'available' && feature.exercises[0].prior?.comparison).toBe('like-for-like');
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
        expect(text).toContain('day-to-day self-report comparison on the same rating scale; confidence cannot be graded from check-ins alone');
        expect(text).toContain('Main set: 3 × 11 min @ 229 / 225 / 237 W actual');
        expect(text).toContain('First→last work interval: +3.5%');
    });

    it('uses the canonical date, deduplicates occurrences and keeps tissue linkage session-specific', () => {
        const adjacent = { ...session, activityId: 'adjacent-session', date: '2026-09-17' };
        const currentEvidence = executionEvidence(adjacent.activityId, 'pto-current', '2026-09-18', 'exec-current', ['adjacent-duplicate']);
        const otherEvidence = executionEvidence('other-activity', 'pto-other', '2026-09-18', 'exec-other');
        const next = {
            ...checkin('2026-09-19', 6, 5),
            painOrInjury: true,
            tissueResponses: {
                right_knee: {
                    region: 'right_knee', morningState: 'mild', nextMorningReaction: 'moderate',
                    sourceSessionRef: { kind: 'execution', id: 'exec-current', date: '2026-09-18' },
                },
                left_knee: {
                    region: 'left_knee', morningState: 'mild', nextMorningReaction: 'mild',
                    sourceSessionRef: { kind: 'execution', id: 'exec-other', date: '2026-09-18' },
                },
                right_achilles: {
                    region: 'right_achilles', morningState: 'mild', nextMorningReaction: 'mild',
                    sourceSessionRef: { kind: 'execution', id: 'exec-unresolved', date: '2026-09-18' },
                },
            },
        } as unknown as DailySubjectiveCheckin;
        const checkins = {
            records: [checkin('2026-09-18', 3, 4), next],
            unreadableDates: [],
        };
        const response = deriveNextDayResponse(
            adjacent,
            checkins,
            [adjacent],
            '2026-09-20',
            [currentEvidence, otherEvidence],
        );
        expect(response.state).toBe('available');
        if (response.state !== 'available') return;
        expect(response.sessionDay?.soreness).toBe(3);
        expect(response.otherActivitiesSameDay).toBe(1);
        expect(response.tissueResponses).toEqual([
            { region: 'right_knee', reaction: 'moderate', linkedToSession: true },
            { region: 'right_achilles', reaction: 'mild', linkedToSession: false },
        ]);

        const context = {
            history: [adjacent], historyStart: '2026-09-01', checkins, asOfDate: '2026-09-20',
            evidence: [currentEvidence, otherEvidence],
        };
        const text = renderKeySessionSummaries(deriveKeySessionSummaries([adjacent], context), context);
        expect(text).toContain('day-level response after 2 recorded sessions; attribution ambiguous');
        expect(text).toContain('right_knee moderate (linked to this session)');
        expect(text).toContain('right_achilles mild (not linked to this session)');
        expect(text).not.toContain('left_knee');
    });

    it('links an execution source ref even when structured execution hydration is unavailable', () => {
        const adjacent = { ...session, activityId: 'unavailable-structured', date: '2026-09-17' };
        const currentEvidence = executionEvidence(
            adjacent.activityId, 'pto-unavailable', '2026-09-18', 'exec-linked', [], false,
        );
        const next = {
            ...checkin('2026-09-19', 4, 4),
            tissueResponses: {
                right_knee: {
                    region: 'right_knee', morningState: 'mild', nextMorningReaction: 'mild',
                    sourceSessionRef: { kind: 'execution', id: 'exec-linked', date: '2026-09-18' },
                },
            },
        } as unknown as DailySubjectiveCheckin;
        const response = deriveNextDayResponse(
            adjacent,
            { records: [next], unreadableDates: [] },
            [adjacent],
            '2026-09-20',
            [currentEvidence],
        );
        expect(response.state === 'available' && response.tissueResponses).toEqual([
            { region: 'right_knee', reaction: 'mild', linkedToSession: true },
        ]);
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
        expect(text).toContain(`Evidence lineage: Garmin provider activity ${session.activityId}; canonical identity unavailable`);
        expect(text).toContain('Display-only; comparison confidence is stated on each comparable feature.');
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
        expect(text).toMatch(/First→last work interval: [^\n]+within-session comparison; source fit_workout_step; evidence confidence high; cross-session comparability not assessed/);
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
        expect(text).toMatch(/Sprint fade: [^\n]+within-session comparison; source fit_workout_step; evidence confidence high; cross-session comparability not assessed/);
        expect(text).not.toContain('Strength response: insufficient evidence');
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
        expect(text).toMatch(/Pw:HR decoupling \(first vs second half\): [^\n]+within-session comparison; source continuous halves; evidence confidence low \(observational HR\); cross-session comparability not assessed/);
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
