# Catalogue lookup indexes

Static catalogues such as `TEMPLATES`, `ENRICHED_TEMPLATES`, `EXERCISES`, and `WORKOUTS` serve two different access patterns:

1. **ordered iteration/filtering** — keep using the source arrays;
2. **repeated exact-ID resolution** — use the module-scoped `ReadonlyMap` indexes (`TEMPLATES_BY_ID`, `ENRICHED_TEMPLATES_BY_ID`, `EXERCISES_BY_ID`, and `WORKOUTS_BY_ID`).

## Why this pattern

An exact-ID `Array.find(...)` scans entries until it finds a match. A precomputed `Map` avoids repeating that linear scan on render paths such as exercise-swap option resolution. ECMAScript requires `Map` implementations to provide **average sublinear** access time; engines may use hash tables or another qualifying representation, so code and documentation should not claim that `Map#get` is specification-guaranteed O(1).

References:

- MDN `Map`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
- MDN `Array.prototype.find`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find

## Correctness invariant: IDs must be unique

`Array.find(...)` returns the first matching element. A `Map` can contain only one value per key, and setting an existing key replaces its value. Consequently, converting an ID lookup from `find(...)` to `Map#get(...)` is behavior-preserving only when catalogue IDs are unique.

`app/src/engine/catalogueIndexes.test.ts` protects this invariant by checking that:

- index size equals source-catalogue length; and
- every source item resolves to the same object through its ID index.

A duplicate ID therefore fails tests instead of silently changing lookup semantics.

## Non-unique indexes: preserve ordered first-match semantics

A non-ID key such as modality is intentionally not unique. If a repeated predicate lookup is indexed, the index must preserve the source array's ordering semantics rather than silently adopting Map's last-write-wins behavior.

`ENRICHED_TEMPLATES_BY_MODALITY` is used by `trainingHistory.ts` for modified-adherence reconstruction. It is built once in source order and only sets a modality that has not been seen yet, so its result is object-identical to the previous ordered `Array.find(...)` fallback.

The same rule applies to composite keys. `athleticCapability.ts` now indexes the first `workoutId + capability` identity while also maintaining source-ordered groups by workout and by capability. This removes repeated scans from capability-maintenance evaluation without changing first-match or grouping order if the registry grows.

`catalogueIndexes.test.ts` protects both contracts. Do not construct a non-unique index with a plain `new Map(array.map(...))` unless last-match semantics are explicitly intended.

## What not to index

Do not mechanically replace every `.find()`. Keep direct scans when the collection is already a dynamically filtered candidate set, when the lookup is one-off on a tiny per-object list (for example workout variants), or when indexing would require rebuilding the index per render/call. The repository review for PR #849 intentionally leaves those cases unchanged.

## Usage rules

- Prefer `*_BY_ID.get(id)` for repeated exact-ID lookups when an index already exists.
- Keep the index at module scope. Do not rebuild a `Map` inside a component render, loop, or event handler; that would replace repeated lookup cost with repeated index-construction cost.
- Keep arrays as the source of truth for ordered iteration, filtering, and predicate searches.
- Do **not** mechanically replace non-ID predicates such as `TEMPLATES.find(t => t.modality === 'Mobility')`. Add another index only when there is a repeated access pattern and a meaningful reason to maintain it, and explicitly preserve ordering/duplicate-key semantics.
- Describe the benefit as avoiding repeated linear scans or using indexed lookup, rather than promising a particular constant-time complexity.

## Trade-off

The indexes add a small one-time module-initialization and memory cost in exchange for cheaper repeated exact-ID resolution. For these static catalogues that trade is appropriate, particularly in render paths that resolve multiple IDs per update.
