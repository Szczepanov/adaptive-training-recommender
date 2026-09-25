import { describe, expect, it } from 'vitest';
import type { NormalizedGarminActivity, TrainingSettings } from './models';
import { renderSensorEvidence, summarizeSensorEvidence } from './contextBriefSensorEvidence';

const AS_OF = '2026-09-25';

function activity(overrides: Partial<NormalizedGarminActivity>): NormalizedGarminActivity {
    return {
        activityId: `a-${overrides.date ?? AS_OF}-${overrides.type ?? 'road_biking'}`,
        date: AS_OF,
        type: 'road_biking',
        durationMin: 60,
        trainingEffectAerobic: 3,
        trainingEffectAnaerobic: 1,
        averageHr: null,
        activityTrainingLoad: 80,
        intensityTag: 'moderate',
        ...overrides,
    };
}

const powerRide = (date: string) => activity({ date, normalizedPower: 220, averageHr: 140 });
const plainRide = (date: string) => activity({ date });

function settings(powerMeter: boolean | undefined, heartRateMonitor?: boolean): TrainingSettings {
    return { capabilities: { powerMeter, heartRateMonitor } } as TrainingSettings;
}

function powerLine(s: TrainingSettings | null, acts: NormalizedGarminActivity[]): string {
    return renderSensorEvidence(s, acts, AS_OF).find(line => line.includes('Power meter:')) ?? '';
}

describe('renderSensorEvidence (#816)', () => {
    const observed = [powerRide('2026-09-20'), powerRide('2026-09-24')];
    const stale = [powerRide('2026-09-01')];
    const none = [plainRide('2026-09-24')];

    const cases: Array<[string, boolean | undefined, NormalizedGarminActivity[], string[], string[]]> = [
        ['unknown × observed', undefined, observed, ['configuration unknown; recent cycling power observed on 2 activities; latest 2026-09-24'], ['STALE', 'override']],
        ['unknown × not observed', undefined, none, ['configuration unknown; cycling power not observed in recent evidence'], ['unavailable']],
        ['unknown × stale', undefined, stale, ['configuration unknown', 'latest 2026-09-01; STALE'], []],
        ['yes × observed', true, observed, ['configured available; recent cycling power observed'], []],
        ['yes × not observed', true, none, ['configured available; cycling power not observed in recent evidence'], []],
        ['yes × stale', true, stale, ['configured available', 'STALE'], []],
        ['no × observed', false, observed, ['configured unavailable (authoritative)', 'historical data does not override'], ['configured available']],
        ['no × not observed', false, none, ['configured unavailable (authoritative); cycling power not observed'], ['override']],
        ['no × stale', false, stale, ['configured unavailable (authoritative)', 'STALE', 'does not override'], ['configured available']],
    ];

    it.each(cases)('%s', (_label, configured, acts, present, absent) => {
        const line = powerLine(settings(configured), acts);
        for (const text of present) expect(line).toContain(text);
        for (const text of absent) expect(line).not.toContain(text);
    });

    it('applies the same distinction to HR and keeps wrist HR from overriding a configured "no" monitor', () => {
        const acts = [activity({ averageHr: 130 })];
        const hrLine = renderSensorEvidence(settings(undefined, false), acts, AS_OF).find(l => l.includes('Heart-rate monitor:')) ?? '';
        expect(hrLine).toContain('configured unavailable (authoritative); recent HR observed on 1 activity');
        expect(hrLine).not.toContain('override');

        const strap = [activity({ averageHr: 130, hrMeasurement: { externalHrSensorPresent: true } as NormalizedGarminActivity['hrMeasurement'] })];
        const strapLine = renderSensorEvidence(settings(undefined, false), strap, AS_OF).find(l => l.includes('Heart-rate monitor:')) ?? '';
        expect(strapLine).toContain('external HR sensor confirmed on 1');
        expect(strapLine).toContain('historical data does not override');
    });

    it('reports cadence honestly as not observable from canonical fields', () => {
        const line = renderSensorEvidence(settings(undefined), observed, AS_OF).find(l => l.includes('Cadence:')) ?? '';
        expect(line).toContain('configuration unknown; not observable');
    });

    it('says provenance is unavailable when no activity is in the window, and when settings are unreadable', () => {
        const lines = renderSensorEvidence(null, [], AS_OF).join('\n');
        expect(lines).toContain('configuration unavailable (training settings not readable)');
        expect(lines).toContain('telemetry provenance is unavailable');
    });

    it('keeps the non-sensor fallback rule', () => {
        expect(renderSensorEvidence(settings(true), observed, AS_OF).join('\n')).toContain('Do not assume permanent availability from observation alone');
    });

    it('bounds the horizon, ignores non-cycling power for cycling and counts running power separately', () => {
        const acts = [
            powerRide('2026-08-01'),
            activity({ type: 'running', normalizedPower: 300 }),
            activity({ type: 'running', runningDynamics: { avgRunningPowerWatts: 250 } }),
        ];
        const summary = summarizeSensorEvidence(acts, AS_OF);
        expect(summary.activitiesInHorizon).toBe(2);
        expect(summary.cyclingPower.count).toBe(0);
        expect(summary.runningPower.count).toBe(1);
    });
});
