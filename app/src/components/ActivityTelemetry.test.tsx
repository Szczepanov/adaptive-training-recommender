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

  it('explains available HR fidelity evidence without claiming a calibrated accuracy', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{ status: 'AVAILABLE', revision: null, data: [{
      ...base,
      hrMeasurement: {
        externalHrSensorPresent: false,
        sourceForActivity: 'wrist',
        provenanceConfidence: 'inferred',
        sensorTechnology: 'wrist_ppg',
        activityMotionRisk: 'high',
        coveragePct: 92,
        longestGapSeconds: 4,
        signalQuality: 'suspect',
        measurementConfidence: 'low',
        summaryCompatibility: 'unknown',
        artifactFlags: ['ISOLATED_SPIKE'],
        reasons: [],
        diagnosticVersion: '1.0.0',
      },
    }] }} />);

    expect(html).toContain('Heart-rate measurement');
    expect(html).toContain('Low confidence');
    expect(html).toContain('wrist optical HR + high arm-motion risk + isolated spikes');
    expect(html).not.toMatch(/accuracy\s*=/i);
  });

  it('labels missing fidelity as not assessed, never unreliable', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{ status: 'AVAILABLE', revision: null, data: [base] }} />);

    expect(html).toContain('Not assessed');
    expect(html).toContain('No fidelity assessment is available for this activity.');
    expect(html).not.toContain('Unreliable');
  });

  it('keeps an assessed unknown confidence distinct from a missing assessment', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{ status: 'AVAILABLE', revision: null, data: [{
      ...base,
      hrMeasurement: {
        externalHrSensorPresent: null,
        sourceForActivity: 'unknown',
        provenanceConfidence: 'unknown',
        sensorTechnology: 'unknown',
        activityMotionRisk: 'unknown',
        coveragePct: null,
        longestGapSeconds: null,
        signalQuality: 'unknown',
        measurementConfidence: 'unknown',
        summaryCompatibility: 'unknown',
        artifactFlags: [],
        reasons: ['FIT_DATA_INCOMPLETE'],
        diagnosticVersion: '1.0.0',
      },
    }] }} />);

    expect(html).toContain('Assessment incomplete');
    expect(html).toContain('fit data incomplete');
    expect(html).not.toContain('Not assessed');
  });

  it('renders a stable empty-detail state for historical activities', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{
      status: 'AVAILABLE', revision: null, data: [{ ...base, powerInZones: [], hrInZones: [], laps: [] }],
    }} />);
    expect(html).toContain('No zone, lap, or running-dynamics telemetry is available');
  });

  it('renders running dynamics and biomechanical symmetry', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{
      status: 'AVAILABLE', revision: null, data: [{
        ...base,
        type: 'running',
        runningDynamics: {
          groundContactBalanceLeftPct: 49.6,
          groundContactTimeMs: 238,
          verticalOscillationCm: 8.2,
          verticalRatioPct: 7.1,
          strideLengthM: 1.18,
          avgRunningPowerWatts: 285,
          maxRunningPowerWatts: 410,
        },
      }],
    }} />);
    expect(html).toContain('Running Dynamics &amp; Symmetry');
    expect(html).toContain('49.6% L / 50.4% R');
    expect(html).toContain('238 ms');
    expect(html).toContain('8.2 cm');
    expect(html).toContain('7.1%');
    expect(html).toContain('1.18 m');
    expect(html).toContain('285 W avg · 410 W max');
  });

  it('does not render an empty running-dynamics section', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{
      status: 'AVAILABLE', revision: null, data: [{ ...base, type: 'running', runningDynamics: {} }],
    }} />);
    expect(html).not.toContain('Running Dynamics &amp; Symmetry');
    expect(html).toContain('No zone, lap, or running-dynamics telemetry is available');
  });

  it('renders primary benefit, training effect, EPOC, and recovery hours', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{
      status: 'AVAILABLE', revision: null, data: [{
        ...base,
        primaryBenefit: 'TEMPO',
        trainingEffectAerobic: 3.8,
        trainingEffectAnaerobic: 1.1,
        epoc: 135,
        recoveryTimeHours: 24,
      }],
    }} />);
    expect(html).toContain('TEMPO');
    expect(html).toContain('Aerobic TE 3.8');
    expect(html).toContain('Anaerobic TE 1.1');
    expect(html).toContain('EPOC 135');
    expect(html).toContain('Rec 24h');
  });

  it('falls back to Garmin trainingEffectLabel and humanizes it', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{
      status: 'AVAILABLE', revision: null, data: [{
        ...base,
        primaryBenefit: null,
        trainingEffectLabel: 'AEROBIC_BASE',
      }],
    }} />);

    expect(html).toContain('AEROBIC BASE');
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

  it('renders Copy JSON button and capability badges for detailed telemetry', () => {
    const html = renderToStaticMarkup(<ActivityTelemetry state={{
      status: 'AVAILABLE', revision: null, data: [{
        ...base,
        powerInZones: [{ zoneNumber: 2, secondsInZone: 1200, lowBoundary: 150 }],
        hrInZones: [{ zoneNumber: 3, secondsInZone: 600, lowBoundary: 140 }],
        laps: [{ lapIndex: 1, durationSeconds: 1800 }],
      }],
    }} />);
    expect(html).toContain('btn-copy-activity-json');
    expect(html).toContain('Copy JSON');
    expect(html).toContain('⚡ Power');
    expect(html).toContain('❤️ HR Zones');
    expect(html).toContain('⏱️ Laps');
  });
});
