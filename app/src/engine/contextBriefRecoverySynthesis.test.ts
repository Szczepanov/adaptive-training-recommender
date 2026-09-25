import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
    DailyReadiness,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    EngineObjectiveInput,
    SubjectiveInput,
    UserContext,
} from './models';
import { renderRecoveryEvidenceSynthesis, synthesizeRecoveryEvidence, type EvidenceFamily } from './contextBriefRecoverySynthesis';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import { buildContextBrief } from './contextBrief';

const AS_OF = '2026-09-25';

type Core = { hrvDelta?: number; rhrDelta?: number; sleepDelta?: number; sleepScore?: number };

function snapshot(date: string, core: Core = {}, raw: Partial<DailyRecoverySnapshot['raw']> = {}, quality: Partial<DailyRecoverySnapshot['dataQuality']> = {}): DailyRecoverySnapshot {
    return {
        userId: 'u1', date,
        source: { garminSyncedAt: `${date}T06:15:00Z`, sourceSchemaVersion: 3 },
        raw: {
            sleepScore: core.sleepScore ?? 78, sleepDurationSec: 27000, restingHr: 48, hrvOvernightAvg: 62,
            hrvStatus: 'balanced', respirationAvg: 13, bodyBatteryWake: 80, bodyBatteryChange: 40,
            totalSteps: 9000, last3DaysHardSessionsCount: 0, yesterdayTraining: null,
            trainingReadiness: { score: 85, level: 'HIGH' },
            ...raw,
        },
        derived: {
            baselineComputationVersion: 2,
            sleepScore7dAvg: 78, sleepScore28dAvg: 78, restingHr7dAvg: 48, restingHr28dAvg: 48,
            hrv7dAvg: 62, hrv28dAvg: 62, respiration7dAvg: 13, respiration28dAvg: 13,
            hrv28dStdev: 6, restingHr28dStdev: 2, sleepScore28dStdev: 6,
            deltas: {
                sleepScoreVs7d: core.sleepDelta ?? 0, sleepScoreVs28d: 0,
                restingHrVs7d: core.rhrDelta ?? 0, restingHrVs28d: 0,
                hrvVs7d: core.hrvDelta ?? 0, hrvVs28d: 0,
                respirationVs7d: 0, respirationVs28d: 0,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true,
            baseline7dReady: true, baseline28dReady: true, ...quality,
        },
    };
}

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1', date: AS_OF,
        readiness: 8, sleepQuality: 7, fatigue: 2, soreness: 2, mentalStress: 3, motivation: 8,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 75, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: `${AS_OF}T06:30:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1, createdAt: `${AS_OF}T06:30:00Z`, updatedAt: `${AS_OF}T06:30:00Z`,
        ...overrides,
    };
}

const synth = (snaps: DailyRecoverySnapshot[], checkins: DailySubjectiveCheckin[]) =>
    synthesizeRecoveryEvidence({ asOfDate: AS_OF, snapshots: snaps, checkins });
const stateOf = (s: ReturnType<typeof synth>, family: EvidenceFamily) => s.families.find(f => f.family === family)?.state;

const poorNight = snapshot(AS_OF, { sleepDelta: -20, sleepScore: 58 });
const concordantBad = snapshot(AS_OF, { sleepDelta: -20, sleepScore: 45, hrvDelta: -15, rhrDelta: 6 }, { bodyBatteryWake: 20 });

describe('synthesizeRecoveryEvidence (#812)', () => {
    it('low sleep with favorable HRV, baseline RHR and low fatigue is MIXED, not an adverse cluster', () => {
        const s = synth([snapshot(AS_OF, { sleepDelta: -20, sleepScore: 58, hrvDelta: 8 })], [checkin()]);
        expect(s.pattern).toBe('MIXED');
        expect(stateOf(s, 'sleep')).toBe('adverse');
        expect(stateOf(s, 'hrv')).toBe('reassuring');
        expect(stateOf(s, 'rhr')).toBe('reassuring');
        expect(stateOf(s, 'subjective')).toBe('reassuring');
        expect(s.uncertainty.join(' ')).toContain('one isolated adverse signal (Sleep score)');
        expect(s.implications.join(' ')).toContain('no multi-signal adverse cluster supports an automatic downgrade');
    });

    it('concordant poor sleep, suppressed HRV, elevated RHR and high fatigue converge adverse', () => {
        const s = synth([concordantBad], [checkin({ fatigue: 8, readiness: 3, sleepQuality: 3 })]);
        expect(s.pattern).toBe('CONVERGENT_ADVERSE');
        expect(s.families.every(f => f.state === 'adverse')).toBe(true);
    });

    it('favorable vendor composites cannot hide current pain: pain renders first as the dominant fact', () => {
        const s = synth([snapshot(AS_OF, {}, { bodyBatteryWake: 95, trainingReadiness: { score: 95, level: 'PRIME' } })],
            [checkin({ painOrInjury: true, tissueResponses: { knee: { region: 'knee', morningState: 'moderate' } } })]);
        expect(s.safetyFacts).toEqual(['pain/injury reported today', 'tissue response knee: moderate morning']);
        const text = renderRecoveryEvidenceSynthesis(s);
        const dominant = text.findIndex(l => l.includes('Dominant safety facts'));
        expect(dominant).toBeGreaterThan(-1);
        expect(dominant).toBeLessThan(text.findIndex(l => l.startsWith('Recovery pattern')));
        expect(s.implications[0]).toContain('override this synthesis');
    });

    it('illness is surfaced as a safety fact', () => {
        expect(synth([snapshot(AS_OF)], [checkin({ illnessSymptoms: true })]).safetyFacts).toContain('illness symptoms reported today');
    });

    it('removing Body Battery / Training Readiness / stress / HRV status does not change the synthesis', () => {
        for (const snap of [poorNight, concordantBad, snapshot(AS_OF)]) {
            const stripped: DailyRecoverySnapshot = {
                ...snap,
                raw: { ...snap.raw, bodyBatteryWake: null, trainingReadiness: null, stress: null, hrvStatus: null },
            };
            const a = synth([snap], [checkin()]);
            const b = synth([stripped], [checkin()]);
            expect({ ...b, vendorContext: [] }).toEqual({ ...a, vendorContext: [] });
        }
    });

    it('stale wearable data is INSUFFICIENT and never read as normal recovery', () => {
        const s = synth([snapshot('2026-09-23')], [checkin()]);
        expect(s.confidence.wearable).toBe('stale');
        expect(s.pattern).toBe('INSUFFICIENT');
        expect(s.families.filter(f => f.kind === 'measured_core').every(f => f.state === 'unavailable')).toBe(true);
        expect(s.vendorContext).toEqual([]);
        expect(s.implications.join(' ')).toContain('do not read missing or stale data as normal recovery');
    });

    it('missing wearable data leaves a subjective-only INSUFFICIENT read', () => {
        const s = synth([], [checkin()]);
        expect(s.confidence.wearable).toBe('missing');
        expect(stateOf(s, 'subjective')).toBe('reassuring');
        expect(s.pattern).toBe('INSUFFICIENT');
    });

    it('a missing check-in is represented as missing, not favorable', () => {
        const s = synth([snapshot(AS_OF)], []);
        expect(stateOf(s, 'subjective')).toBe('unavailable');
        expect(s.families[0].detail).toContain('missing, not assumed favorable');
        expect(s.uncertainty).toContain('subjective check-in missing');
        expect(s.pattern).toBe('CONVERGENT_REASSURING');
        expect(s.implications.join(' ')).toContain('never justifies raising volume or intensity');
    });

    it('an immature baseline blocks objective judgement', () => {
        const s = synth([snapshot(AS_OF, {}, {}, { baseline7dReady: false, baseline28dReady: false })], [checkin()]);
        expect(s.confidence.baseline).toBe('immature');
        expect(s.pattern).toBe('INSUFFICIENT');
    });

    it('a partial (7d-only) baseline still judges but flags reduced confidence', () => {
        const s = synth([snapshot(AS_OF, {}, {}, { baseline28dReady: false })], [checkin()]);
        expect(s.confidence.baseline).toBe('partial_7d');
        expect(s.uncertainty.join(' ')).toContain('28-day baseline not yet mature');
    });

    it('implausible values are ignored and reported', () => {
        const s = synth([snapshot(AS_OF, {}, { restingHr: 250 })], [checkin()]);
        expect(stateOf(s, 'rhr')).toBe('unavailable');
        expect(s.confidence.implausible).toEqual(['Resting HR']);
    });

    it('only uses snapshots on or before the as-of date', () => {
        const s = synth([snapshot('2026-09-26', { hrvDelta: -30 }), snapshot(AS_OF)], [checkin()]);
        expect(s.confidence.wearableDate).toBe(AS_OF);
        expect(stateOf(s, 'hrv')).toBe('reassuring');
    });

    it('carries provenance (source date and delta) on every judged family', () => {
        const s = synth([poorNight], [checkin()]);
        expect(s.families.find(f => f.family === 'sleep')?.detail).toContain(`on ${AS_OF}, -20 vs 7d`);
        expect(s.families[0].detail).toContain(`(${AS_OF})`);
    });

    it('produces no numeric score field', () => {
        const s = synth([poorNight], [checkin()]);
        expect(Object.keys(s).sort()).toEqual(['asOfDate', 'confidence', 'families', 'implications', 'pattern', 'safetyFacts', 'uncertainty', 'vendorContext']);
    });
});

describe('subjective adverse band mirrors rules.ts (#812 parity)', () => {
    function readiness(s: Partial<SubjectiveInput>): DailyReadiness {
        const objective: EngineObjectiveInput = {
            total_steps: 8000, sleep_score: 85, sleep_duration_min: 460, rhr: 48, rhr_7d_avg: 48, rhr_delta: 0,
            hrv_weekly_avg: 60, hrv_last_night: 60, hrv_delta: 0, respiration: 13, body_battery_wake: 85,
            last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
            sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8,
        };
        return {
            subjective: {
                readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
                timeAvailable: 150, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null, ...s,
            },
            objective,
        };
    }
    const context: UserContext = {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 180 },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
    };

    const cases: Array<[string, Partial<DailySubjectiveCheckin>, Partial<SubjectiveInput>, boolean]> = [
        ['fatigue 8', { fatigue: 8 }, { fatigue: 8 }, true],
        ['soreness 7', { soreness: 7 }, { soreness: 7 }, true],
        ['readiness 3', { readiness: 3 }, { readiness: 3 }, true],
        ['mental stress 9', { mentalStress: 9 }, { stress: 9 }, true],
        ['readiness 4 + fatigue 6', { readiness: 4, fatigue: 6 }, { readiness: 4, fatigue: 6 }, true],
        ['fatigue 7 alone', { fatigue: 7 }, { fatigue: 7 }, false],
        ['soreness 6 alone', { soreness: 6 }, { soreness: 6 }, false],
        ['mental stress 8 alone', { mentalStress: 8 }, { stress: 8 }, false],
    ];

    it.each(cases)('%s', (_label, briefValues, engineValues, adverse) => {
        const base = { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, mentalStress: 2 };
        const s = synth([snapshot(AS_OF)], [checkin({ ...base, ...briefValues })]);
        const mode = evaluateReadinessAndSafetyEnvelope(readiness(engineValues), context, AS_OF).mode;
        expect(stateOf(s, 'subjective') === 'adverse').toBe(adverse);
        expect(mode !== 'train').toBe(adverse);
    });
});

describe('context brief integration (#812)', () => {
    it('places the synthesis ahead of secondary vendor composites in planning and diagnostic exports', () => {
        for (const purpose of ['planning', 'diagnostic'] as const) {
            const text = buildContextBrief({
                asOfDate: AS_OF, windowDays: 14, snapshots: [poorNight], checkins: [checkin()],
                activities: [], recommendations: [], trainingSettings: null, preferences: null, intentProfile: null, purpose,
            });
            const synthesisAt = text.indexOf('### Recovery evidence synthesis');
            expect(synthesisAt).toBeGreaterThan(-1);
            expect(synthesisAt).toBeLessThan(text.indexOf('Body battery on waking'));
            expect(text).toContain('not a readiness score, no decision authority');
        }
    });

    it('is not imported by any engine decision module (recommendation invariance)', () => {
        const dir = __dirname;
        const importers = readdirSync(dir)
            .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
            .filter(f => readFileSync(join(dir, f), 'utf8').includes("from './contextBriefRecoverySynthesis'"));
        expect(importers.sort()).toEqual(['contextBrief.ts', 'contextBriefPlanningHandoff.ts']);
    });
});
