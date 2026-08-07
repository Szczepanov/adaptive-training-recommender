import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../engine/templates.ts';
import type { Recommendation, SessionTemplate, TrainingSettings } from '../engine/models.ts';
import { WORKOUTS } from './catalog.ts';
import { resolveWorkoutPrescription, variantFor, workoutForTemplate } from './prescription.ts';

function recommendation(templateId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const template = TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error(`Missing template ${templateId}`);
  return { template, rationale: 'test', mode: 'train', ...overrides };
}

function makeSettings(overrides: Partial<TrainingSettings['capabilities']> = {}): TrainingSettings {
  return {
    userId: 'u1',
    schemaVersion: 3,
    equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: false },
    guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
    defaults: { environment: 'either', weekdayMaxMinutes: null, weekendMaxMinutes: null },
    capabilities: { powerMeter: true, heartRateMonitor: true, cadenceData: true, ...overrides },
    preferences: { preferActiveRecovery: true },
    migration: { legacyReviewed: true, migratedAt: '2026-08-07T00:00:00Z' },
    createdAt: '2026-08-07T00:00:00Z',
    updatedAt: '2026-08-07T00:00:00Z'
  };
}

describe('resolveWorkoutPrescription', () => {
  it('resolves every selectable engine template to a detailed workout', () => {
    for (const template of TEMPLATES) {
      expect(resolveWorkoutPrescription({ template, rationale: 'test', mode: 'train' }, 'u1', '2026-08-07'))
        .not.toBeNull();
    }
  });

  it('keeps resolved workout modality aligned with its engine template and never sends lower-body work to an upper-body session', () => {
    for (const template of TEMPLATES) {
      const workout = workoutForTemplate(template.id);
      expect(workout).toBeDefined();
      if (template.modality !== 'None') expect(workout?.modality).toBe(template.modality.toLowerCase());
    }

    const lowerBody = workoutForTemplate('str_lower_01');
    const exerciseIds = lowerBody?.blocks.flatMap((block) => block.steps.map((step) => step.exerciseId));
    expect(lowerBody?.id).toBe('strength_lower_body_01');
    expect(exerciseIds).not.toContain('bench_press');
    expect(exerciseIds).not.toContain('pull_up');
  });

  it('does not resolve a deprecated matching workout', () => {
    const matching = WORKOUTS.find((workout) => workout.engineTemplateIds?.includes('str_lower_01'));
    expect(matching).toBeDefined();
    const deprecated = { ...matching!, status: 'deprecated' as const };
    expect(workoutForTemplate('str_lower_01', [deprecated])).toBeUndefined();
  });

  it('covers every declared session-template category', () => {
    const categories: SessionTemplate['category'][] = ['Hard Endurance', 'Moderate Endurance', 'Easy Endurance', 'Upper-body Strength', 'Lower-body Strength', 'Full-body Strength', 'Power Maintenance', 'Field Maintenance', 'Technical Skill', 'Mobility/Recovery', 'Rest'];
    for (const category of categories) expect(TEMPLATES.some((template) => template.category === category)).toBe(true);
  });

  it('uses the detailed candidate matching the selected cycling tempo template', () => {
    const prescription = resolveWorkoutPrescription(
      recommendation('end_mod_02'), 'u1', '2026-08-07', { ftpWatts: 250, lthrBpm: 170 }
    );

    expect(prescription?.workoutId).toBe('cycling_tempo_surges_01');
    expect(prescription?.displayBlocks.map((block) => block.role)).toEqual(['warmup', 'main', 'cooldown']);
    const interval = prescription?.displayBlocks[1].steps[0];
    expect(interval?.dose).toBe('20 min');
    expect(interval?.targets.some((target) => target.startsWith('RPE'))).toBe(true);
    expect(interval?.targets.some((target) => target.includes('170 bpm'))).toBe(true);
  });

  it('selects the detailed technical candidate and exposes quality guardrails', () => {
    const prescription = resolveWorkoutPrescription(recommendation('cycling_technical_01'), 'u1', '2026-08-07');

    expect(prescription?.workoutId).toBe('cycling_pedalling_economy_01');
    const ladder = prescription?.displayBlocks[1].steps[0];
    expect(ladder?.targets).toContain('Move through 85–100 rpm in light gears.');
    expect(ladder?.cues).toContain('Quality: Quiet pelvis and upper body.');
    expect(ladder?.cues.some((cue) => cue.startsWith('Stop:'))).toBe(true);
  });

  it('uses the reduced variant after an easier adjustment', () => {
    const prescription = resolveWorkoutPrescription(
      recommendation('end_easy_01', {
        adjustment: {
          direction: 'easier', tier: 1, originalTemplateId: 'end_easy_01', originalTemplateTitle: 'Zone 2 Spin', rationale: 'easier'
        }
      }), 'u1', '2026-08-07'
    );

    expect(prescription?.variantId).toBe('reduced');
    expect(prescription?.targetDurationMin).toBe(40);
  });

  it('uses the more conservative planned-dose variant when no manual adjustment is present', () => {
    expect(resolveWorkoutPrescription(recommendation('end_easy_01'), 'u1', '2026-08-07', undefined, 0.71)?.variantId).toBe('full');
    expect(resolveWorkoutPrescription(recommendation('end_easy_01'), 'u1', '2026-08-07', undefined, 0.65)?.variantId).toBe('reduced');
    expect(resolveWorkoutPrescription(recommendation('end_easy_01'), 'u1', '2026-08-07', undefined, 0.35)?.variantId).toBe('return_to_training');
  });

  it('uses the more conservative result when manual direction and execution dose disagree', () => {
    const easier = recommendation('end_easy_01', { adjustment: { direction: 'easier', tier: 1, originalTemplateId: 'end_easy_01', originalTemplateTitle: 'Zone 2 Spin', rationale: 'easier' } });
    const harder = recommendation('end_easy_01', { adjustment: { direction: 'harder', tier: 1, originalTemplateId: 'end_easy_01', originalTemplateTitle: 'Zone 2 Spin', rationale: 'harder' } });
    expect(variantFor(easier, 0.35)).toBe('return_to_training');
    expect(variantFor(harder, 0.65)).toBe('reduced');
  });

  it('keeps strength prescription relative when no 1RM is known and exposes tempo', () => {
    const prescription = resolveWorkoutPrescription(recommendation('str_full_01'), 'u1', '2026-08-07');
    const frontSquat = prescription?.displayBlocks.flatMap((block) => block.steps).find((step) => step.id === 'front_squat');

    expect(frontSquat?.targets.some((target) => target.includes('reps in reserve'))).toBe(true);
    expect(frontSquat?.targets).toContain('Tempo 31X1 (lower / pause / lift / pause)');
    expect(frontSquat?.targets.some((target) => target.includes('kg'))).toBe(false);
  });

  it('calculates Zone 2 cycling target watts from FTP and exposes structured step targets', () => {
    const prescription = resolveWorkoutPrescription(
      recommendation('end_easy_01'),
      'u1',
      '2026-08-07',
      { cycling: { ftpWatts: 200, lthrBpm: 155, measuredAt: '2026-08-01T00:00:00Z' } },
      1,
      makeSettings({ powerMeter: true, heartRateMonitor: true, cadenceData: true })
    );

    const mainStep = prescription?.displayBlocks.find((b) => b.role === 'main')?.steps[0];
    expect(mainStep?.structuredTargets).toBeDefined();
    const primaryPower = mainStep?.structuredTargets?.find((t) => t.metric === 'power');
    expect(primaryPower?.valueText).toBe('Primary target: FTP-based Zone 2, 56–75% FTP (112–150 W) [Power Zone 2 — FTP-based 5-zone system]');
    expect(primaryPower?.role).toBe('primary');
  });

  it('falls back to RPE when power meter is disabled in trainingSettings capabilities', () => {
    const prescription = resolveWorkoutPrescription(
      recommendation('end_easy_01'),
      'u1',
      '2026-08-07',
      { cycling: { ftpWatts: 200, lthrBpm: 155, measuredAt: '2026-08-01T00:00:00Z' } },
      1,
      makeSettings({ powerMeter: false, heartRateMonitor: true, cadenceData: true })
    );

    const mainStep = prescription?.displayBlocks.find((b) => b.role === 'main')?.steps[0];
    const powerTarget = mainStep?.structuredTargets?.find((t) => t.metric === 'power');
    expect(powerTarget).toBeUndefined();
    const rpeTarget = mainStep?.structuredTargets?.find((t) => t.metric === 'rpe');
    expect(rpeTarget?.role).toBe('fallback');
  });

  it('marks benchmark targets older than 56 days with a review needed tag', () => {
    const oldDate = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
    const prescription = resolveWorkoutPrescription(
      recommendation('end_easy_01'),
      'u1',
      '2026-08-07',
      { cycling: { ftpWatts: 200, measuredAt: oldDate } },
      1,
      makeSettings({ powerMeter: true })
    );

    const mainStep = prescription?.displayBlocks.find((b) => b.role === 'main')?.steps[0];
    const powerTarget = mainStep?.structuredTargets?.find((t) => t.metric === 'power');
    expect(powerTarget?.staleTag).toBe(true);
    expect(powerTarget?.valueText).toContain('Review needed');
  });
});
