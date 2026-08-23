import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NormalizedGarminActivity } from '../engine/models';
import { ActivityTelemetry } from './ActivityTelemetry';

const base: NormalizedGarminActivity = {
  activityId: 'ride-1', date: '2026-08-17', type: 'cycling', durationMin: 60,
  trainingEffectAerobic: 3.2, trainingEffectAnaerobic: 0.4, averageHr: 145,
  activityTrainingLoad: 110, intensityTag: 'moderate',
};

describe('ActivityTelemetry', () => {
  it('renders full telemetry', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{ status: 'AVAILABLE', revision: null, data: [{
      ...base,
      normalizedPower: 229, intensityFactor: 0.82, variabilityIndex: 1.07,
      powerInZones: [{ zoneNumber: 2, secondsInZone: 1200, lowBoundary: 150 }],
      hrInZones: [{ zoneNumber: 4, secondsInZone: 420, lowBoundary: 156 }],
      laps: [{ lapIndex: 1, durationSeconds: 900, averagePowerWatts: 250, averageHrBpm: 148 }],
    }] }} />);
    expect(html).toContain('Power zones');
    expect(html).toContain('Heart-rate zones');
    expect(html).toContain('Lap summaries');
    expect(html).toContain('229</strong> W NP');
  });

  it('renders partial HR-only telemetry', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{ status: 'AVAILABLE', revision: null, data: [{
      ...base, type: 'running', hrInZones: [{ zoneNumber: 3, secondsInZone: 900 }],
    }] }} />);
    expect(html).toContain('Heart-rate zones');
    expect(html).not.toContain('Power zones');
  });

  it('renders a stable empty-detail state for historical activities', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{
      status: 'AVAILABLE', revision: null, data: [{ ...base, powerInZones: [], hrInZones: [], laps: [] }],
    }} />);
    expect(html).toContain('No zone or lap telemetry is available');
  });

  it('renders strength exercise sets and repetitions table', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{
      status: 'AVAILABLE', revision: null, data: [{
        ...base,
        type: 'strength_training',
        exerciseSets: [
          {
            setOrder: 0,
            setType: 'active',
            repetitionCount: 10,
            weightKg: 60,
            exerciseName: 'BARBELL_BENCH_PRESS',
            durationSeconds: 35,
            restDurationSeconds: 90,
          },
        ],
      }],
    }} />);
    expect(html).toContain('Strength sets &amp; reps');
    expect(html).toContain('BARBELL BENCH PRESS');
    expect(html).toContain('10');
    expect(html).toContain('60 kg');
    expect(html).toContain('35s');
    expect(html).toContain('90s rest');
  });
});
