import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXERCISES } from './exercises';
import type { ExerciseDefinition } from './models';
import { validateWorkoutLibrary } from './validation';

describe('exercise facet validation (M3.5)', () => {
  it('accepts the reviewed catalog facet declarations', () => {
    expect(validateWorkoutLibrary(EXERCISES, []).errors).toEqual([]);
  });

  it('resolves every reviewed positive fixture movement that is not deliberately custom', () => {
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../sessions/fixtures');
    const catalogIds = new Set(EXERCISES.map(exercise => exercise.id));
    const missing: string[] = [];

    for (const fileName of readdirSync(fixturesDir).filter(name => name.endsWith('.json') && name !== '07-malformed-and-custom-movement.json')) {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, fileName), 'utf8')) as { blocks?: Array<{ steps?: Array<{ exerciseRef?: { kind?: string; exerciseId?: string } }> }> };
      for (const step of fixture.blocks?.flatMap(block => block.steps ?? []) ?? []) {
        if (step.exerciseRef?.kind === 'catalog' && !catalogIds.has(step.exerciseRef.exerciseId ?? '')) {
          missing.push(`${fileName}:${step.exerciseRef.exerciseId}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('rejects incompatible timed-sprint and field-domain declarations', () => {
    const sprint = EXERCISES.find(exercise => exercise.id === 'sprint_15m')!;
    const invalid: ExerciseDefinition = {
      ...sprint,
      facets: {
        ...sprint.facets!,
        allowedDoseKinds: ['repetition'],
        fieldDomains: ['acceleration', 'acceleration'],
      },
    };

    const result = validateWorkoutLibrary([invalid], []);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('timed_sprint requires distance dose support'),
      expect.stringContaining('fieldDomains are unique field_drill-only facets'),
    ]));
  });
});
