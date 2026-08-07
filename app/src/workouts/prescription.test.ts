import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../engine/templates.ts';
import type { Recommendation } from '../engine/models.ts';
import { resolveWorkoutPrescription } from './prescription.ts';

function recommendation(templateId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const template = TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error(`Missing template ${templateId}`);
  return { template, rationale: 'test', mode: 'train', ...overrides };
}

describe('resolveWorkoutPrescription', () => {
  it('resolves every selectable engine template to a detailed workout', () => {
    for (const template of TEMPLATES) {
      expect(resolveWorkoutPrescription({ template, rationale: 'test', mode: 'train' }, 'u1', '2026-08-07'))
        .not.toBeNull();
    }
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
    expect(resolveWorkoutPrescription(recommendation('end_easy_01'), 'u1', '2026-08-07', undefined, 0.65)?.variantId).toBe('reduced');
    expect(resolveWorkoutPrescription(recommendation('end_easy_01'), 'u1', '2026-08-07', undefined, 0.35)?.variantId).toBe('return_to_training');
  });

  it('keeps strength prescription relative when no 1RM is known and exposes tempo', () => {
    const prescription = resolveWorkoutPrescription(recommendation('str_full_01'), 'u1', '2026-08-07');
    const frontSquat = prescription?.displayBlocks.flatMap((block) => block.steps).find((step) => step.id === 'front_squat');

    expect(frontSquat?.targets.some((target) => target.includes('reps in reserve'))).toBe(true);
    expect(frontSquat?.targets).toContain('Tempo 31X1 (lower / pause / lift / pause)');
    expect(frontSquat?.targets.some((target) => target.includes('kg'))).toBe(false);
  });
});
