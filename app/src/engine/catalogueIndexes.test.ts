import { describe, expect, it } from 'vitest';

import { TEMPLATES, TEMPLATES_BY_ID } from './templates';
import { EXERCISES, EXERCISES_BY_ID } from '../workouts/exercises';

function expectIndexMatchesSource<T extends { id: string }>(
  source: readonly T[],
  index: ReadonlyMap<string, T>,
): void {
  // A smaller Map means at least one duplicate id was overwritten while indexing.
  expect(index.size).toBe(source.length);

  for (const item of source) {
    // Preserve object identity as well as value lookup so the index cannot drift from
    // the ordered source catalogue used for filtering and iteration.
    expect(index.get(item.id)).toBe(item);
  }
}

describe('catalogue lookup indexes', () => {
  it('indexes every session template by a unique id', () => {
    expectIndexMatchesSource(TEMPLATES, TEMPLATES_BY_ID);
  });

  it('indexes every exercise by a unique id', () => {
    expectIndexMatchesSource(EXERCISES, EXERCISES_BY_ID);
  });
});
