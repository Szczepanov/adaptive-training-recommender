import { describe, expect, it } from 'vitest';
import { WORKOUTS } from './catalog.ts';
import type { WorkoutDefinition } from './models.ts';
import { workoutForTemplate } from './prescription.ts';

function requireAutomaticWorkoutSeed(): WorkoutDefinition {
  const seed = WORKOUTS.find((workout) => workout.status === 'active' && !workout.manualOnly);
  if (!seed) throw new Error('Expected at least one active automatic workout fixture');
  return seed;
}

const seedWorkout = requireAutomaticWorkoutSeed();

function workout(overrides: Partial<WorkoutDefinition>): WorkoutDefinition {
  return { ...seedWorkout, ...overrides };
}

describe('workoutForTemplate lookup semantics', () => {
  it('selects the lowest priority and preserves catalog order when priorities tie', () => {
    const templateId = 'test_priority';
    const first = workout({ id: 'test_first', engineTemplateIds: [templateId], engineTemplatePriority: 2 });
    const tiedLater = workout({ id: 'test_tied_later', engineTemplateIds: [templateId], engineTemplatePriority: 2 });
    const preferred = workout({ id: 'test_preferred', engineTemplateIds: [templateId], engineTemplatePriority: 1 });

    expect(workoutForTemplate(templateId, [first, tiedLater])).toBe(first);
    expect(workoutForTemplate(templateId, [first, preferred, tiedLater])).toBe(preferred);
  });

  it('keeps caller-supplied mutable arrays live across repeated lookups', () => {
    const templateId = 'test_mutable_catalog';
    const initial = workout({ id: 'test_initial', engineTemplateIds: [templateId], engineTemplatePriority: 2 });
    const candidates = [initial];

    expect(workoutForTemplate(templateId, candidates)).toBe(initial);

    const preferred = workout({ id: 'test_after_mutation', engineTemplateIds: [templateId], engineTemplatePriority: 1 });
    candidates.unshift(preferred);

    expect(workoutForTemplate(templateId, candidates)).toBe(preferred);
  });

  it('ignores deprecated and manual-only direct matches', () => {
    const templateId = 'test_eligibility';
    const manual = workout({ id: 'test_manual', manualOnly: true, engineTemplateIds: [templateId], engineTemplatePriority: 0 });
    const deprecated = workout({ id: 'test_deprecated', status: 'deprecated', engineTemplateIds: [templateId], engineTemplatePriority: 0 });
    const active = workout({ id: 'test_active', manualOnly: false, status: 'active', engineTemplateIds: [templateId], engineTemplatePriority: 3 });

    expect(workoutForTemplate(templateId, [manual, deprecated, active])).toBe(active);
  });

  it('prefers a direct template match before fallback and preserves last-ID fallback semantics', () => {
    const templateId = 'end_easy_01';
    const firstFallback = workout({
      id: 'cycling_zone2_standard_01',
      engineTemplateIds: [],
      manualOnly: false,
      status: 'active'
    });
    const secondFallback = workout({ ...firstFallback, name: `${firstFallback.name} second` });
    const direct = workout({
      id: 'test_direct',
      engineTemplateIds: [templateId],
      engineTemplatePriority: 99,
      manualOnly: false,
      status: 'active'
    });

    expect(workoutForTemplate(templateId, [firstFallback, secondFallback])).toBe(secondFallback);
    expect(workoutForTemplate(templateId, [firstFallback, secondFallback, direct])).toBe(direct);
  });
});
