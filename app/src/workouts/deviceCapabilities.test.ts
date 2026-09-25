import { describe, expect, it, vi } from 'vitest';
import type { Recommendation, TrainingSettings } from '../engine/models.ts';
import type { AthletePerformanceProfile, DeviceCapabilities, WorkoutDefinition } from './models.ts';

// Synthetic workout: one step with one RPE target per sensor requirement, so each target's
// presence in the resolved prescription reveals prescription.ts's own capability decision.
const PROBE = {
    id: 'probe',
    status: 'active',
    engineTemplateIds: ['probe'],
    version: 1,
    modality: 'cycling',
    description: 'probe',
    variants: [{ id: 'full', rationale: 'probe', targetDurationMin: 10, stepOverrides: [] }],
    blocks: [{
        id: 'b', name: 'b', role: 'main',
        steps: [{
            id: 's', name: 's', exerciseId: 'none', duration: { type: 'time', seconds: 600 },
            targets: [
                { role: 'primary', metric: 'rpe', value: { min: 1, max: 1 }, requires: 'power_meter' },
                { role: 'primary', metric: 'rpe', value: { min: 2, max: 2 }, requires: 'heart_rate_monitor' },
                { role: 'primary', metric: 'rpe', value: { min: 3, max: 3 }, requires: 'cadence_data' },
            ],
        }],
    }],
} as unknown as WorkoutDefinition;

vi.mock('./catalog.ts', () => ({ WORKOUTS: [PROBE], WORKOUTS_BY_ID: new Map([['probe', PROBE]]) }));

const { resolveWorkoutPrescription } = await import('./prescription.ts');
const { resolveDeviceCapabilities } = await import('./deviceCapabilities.ts');

type Sensor = keyof DeviceCapabilities;
const SENSORS: Array<[Sensor, number]> = [['powerMeter', 1], ['heartRateMonitor', 2], ['cadenceData', 3]];
const VALUES = [true, false, undefined] as const;

/** prescription.ts drops a target only when the sensor resolves to explicit `false`. */
function prescriptionSaysUnavailable(rpe: number, settings?: TrainingSettings, profile?: AthletePerformanceProfile): boolean {
    const rec = { template: { id: 'probe', durationMax: 10, category: 'Endurance' }, mode: 'train' } as unknown as Recommendation;
    const prescription = resolveWorkoutPrescription(rec, 'u', '2026-09-25', profile, undefined, settings);
    if (!prescription) throw new Error('probe workout did not resolve');
    const targets = prescription.displayBlocks[0].steps[0].targets;
    return !targets.includes(`RPE ${rpe}–${rpe}/10`);
}

describe('resolveDeviceCapabilities parity with prescription.ts (#816)', () => {
    const cases: Array<[string, boolean | undefined, boolean | undefined, boolean, boolean]> = [];
    for (const s of VALUES) for (const p of VALUES) {
        cases.push([`settings=${s} prefs=${p}`, s, p, true, true]);
    }
    cases.push(['neither object', undefined, undefined, false, false]);
    cases.push(['settings only', true, undefined, true, false]);
    cases.push(['settings only false', false, undefined, true, false]);
    cases.push(['prefs only false', undefined, false, false, true]);
    cases.push(['prefs only true', undefined, true, false, true]);

    for (const [sensor, rpe] of SENSORS) {
        it.each(cases)(`${sensor}: %s`, (_label, s, p, withSettings, withProfile) => {
            const settings = withSettings ? ({ capabilities: { [sensor]: s } } as TrainingSettings) : undefined;
            const profile = withProfile ? ({ capabilities: { [sensor]: p } } as AthletePerformanceProfile) : undefined;
            const resolved = resolveDeviceCapabilities(settings, profile)[sensor];
            expect(resolved === false).toBe(prescriptionSaysUnavailable(rpe, settings, profile));
        });
    }
});
