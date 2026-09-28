import { describe, expect, it } from 'vitest';

import {
  TEMPLATES,
  TEMPLATES_BY_ID,
  ENRICHED_TEMPLATES,
  ENRICHED_TEMPLATES_BY_ID,
  ENRICHED_TEMPLATES_BY_MODALITY,
} from './templates';
import { EXERCISES, EXERCISES_BY_ID } from '../workouts/exercises';
import { WORKOUTS, WORKOUTS_BY_ID } from '../workouts/catalog';
import {
  ATHLETIC_CAPABILITY_IDENTITIES,
  athleticCapabilitiesCreditedBy,
  capabilityIdentitiesFor,
  grantsAthleticCapabilityCredit,
} from '../workouts/athleticCapability';
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

  it('indexes the first enriched session template for each modality', () => {
    const seenModalities = new Set<string>();

    for (const template of ENRICHED_TEMPLATES) {
      if (seenModalities.has(template.modality)) continue;
      seenModalities.add(template.modality);
      expect(ENRICHED_TEMPLATES_BY_MODALITY.get(template.modality)).toBe(template);
    }

    expect(ENRICHED_TEMPLATES_BY_MODALITY.size).toBe(seenModalities.size);
  });

  it('preserves athletic-capability grouped and first-match lookup semantics', () => {
    for (const capability of new Set(ATHLETIC_CAPABILITY_IDENTITIES.map(identity => identity.capability))) {
      const expected = ATHLETIC_CAPABILITY_IDENTITIES.filter(identity => identity.capability === capability);
      const indexed = capabilityIdentitiesFor(capability);
      expect(indexed).toHaveLength(expected.length);
      expected.forEach((identity, index) => expect(indexed[index]).toBe(identity));
    }

    const variants = [undefined, 'full', 'reduced', 'return_to_training'] as const;
    for (const identity of ATHLETIC_CAPABILITY_IDENTITIES) {
      for (const variant of variants) {
        const first = ATHLETIC_CAPABILITY_IDENTITIES.find(candidate =>
          candidate.workoutId === identity.workoutId && candidate.capability === identity.capability);
        const expected = Boolean(first && (variant === undefined || first.qualifyingVariants.includes(variant)));
        expect(grantsAthleticCapabilityCredit({
          workoutId: identity.workoutId,
          capability: identity.capability,
          ...(variant === undefined ? {} : { variant }),
        })).toBe(expected);
      }
    }

    for (const workoutId of new Set(ATHLETIC_CAPABILITY_IDENTITIES.map(identity => identity.workoutId))) {
      const expected = [...new Set(ATHLETIC_CAPABILITY_IDENTITIES
        .filter(identity => {
          const first = ATHLETIC_CAPABILITY_IDENTITIES.find(candidate =>
            candidate.workoutId === workoutId && candidate.capability === identity.capability);
          return Boolean(first);
        })
        .map(identity => identity.capability))];
      expect(athleticCapabilitiesCreditedBy({ workoutId })).toEqual(expected);
    }
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
