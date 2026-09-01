import { describe, expect, it } from 'vitest';

import { TEMPLATES, TEMPLATES_BY_ID, ENRICHED_TEMPLATES, ENRICHED_TEMPLATES_BY_ID } from './templates';
import { EXERCISES, EXERCISES_BY_ID } from '../workouts/exercises';
import { WORKOUTS, WORKOUTS_BY_ID } from '../workouts/catalog';
import { PERFORMANCE_TEST_DEFINITIONS, PERFORMANCE_TEST_DEFINITIONS_BY_ID } from '../observations/performanceTestingCatalog';
import {
  SPORTS_KNOWLEDGE_CLAIMS,
  SPORTS_KNOWLEDGE_CLAIMS_BY_ID,
  SPORTS_KNOWLEDGE_SOURCES,
  SPORTS_KNOWLEDGE_SOURCES_BY_ID,
} from '../knowledge/sportsKnowledgeRegistry';

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

  it('indexes every enriched session template by a unique id', () => {
    expectIndexMatchesSource(ENRICHED_TEMPLATES, ENRICHED_TEMPLATES_BY_ID);
  });

  it('indexes every exercise by a unique id', () => {
    expectIndexMatchesSource(EXERCISES, EXERCISES_BY_ID);
  });

  it('indexes every workout by a unique id', () => {
    expectIndexMatchesSource(WORKOUTS, WORKOUTS_BY_ID);
  });

  it('indexes every performance test definition by a unique id', () => {
    expectIndexMatchesSource(PERFORMANCE_TEST_DEFINITIONS, PERFORMANCE_TEST_DEFINITIONS_BY_ID);
  });

  it('indexes every sports knowledge claim by a unique id', () => {
    expectIndexMatchesSource(SPORTS_KNOWLEDGE_CLAIMS, SPORTS_KNOWLEDGE_CLAIMS_BY_ID);
  });

  it('indexes every sports knowledge source by a unique id', () => {
    expectIndexMatchesSource(SPORTS_KNOWLEDGE_SOURCES, SPORTS_KNOWLEDGE_SOURCES_BY_ID);
  });
});
