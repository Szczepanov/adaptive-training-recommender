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
  it('turns a selected cycling template into a detailed, immutable block plan', () => {
    const prescription = resolveWorkoutPrescription(
      recommendation('end_mod_02'), 'u1', '2026-08-07', { ftpWatts: 250, lthrBpm: 170 }
    );

    expect(prescription?.workoutId).toBe('cycling_controlled_threshold_4x8_01');
    expect(prescription?.displayBlocks.map((block) => block.role)).toEqual(['warmup', 'main', 'cooldown']);
    const interval = prescription?.displayBlocks[1].steps[0];
    expect(interval?.dose).toBe('4 × 8 min');
    expect(interval?.targets).toContain('88–94% FTP (220–235 W)');
    expect(interval?.targets.some((target) => target.includes('170 bpm'))).toBe(true);
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

  it('keeps strength prescription relative when no 1RM is known and exposes tempo', () => {
    const prescription = resolveWorkoutPrescription(recommendation('str_full_01'), 'u1', '2026-08-07');
    const frontSquat = prescription?.displayBlocks.flatMap((block) => block.steps).find((step) => step.id === 'front_squat');

    expect(frontSquat?.targets).toContain('3–5 reps in reserve');
    expect(frontSquat?.targets).toContain('Tempo 31X1 (lower / pause / lift / pause)');
    expect(frontSquat?.targets.some((target) => target.includes('kg'))).toBe(false);
  });
});
