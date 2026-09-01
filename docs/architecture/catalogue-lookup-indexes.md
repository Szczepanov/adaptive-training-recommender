# Catalogue lookup indexes

Static catalogues such as `TEMPLATES` and `EXERCISES` serve two different access patterns:

1. **ordered iteration/filtering** — keep using the source arrays;
2. **repeated exact-ID resolution** — use the module-scoped `ReadonlyMap` indexes (`TEMPLATES_BY_ID` and `EXERCISES_BY_ID`).

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

## Usage rules

- Prefer `*_BY_ID.get(id)` for repeated exact-ID lookups when an index already exists.
- Keep the index at module scope. Do not rebuild a `Map` inside a component render, loop, or event handler; that would replace repeated lookup cost with repeated index-construction cost.
- Keep arrays as the source of truth for ordered iteration, filtering, and predicate searches.
- Do **not** mechanically replace non-ID predicates such as `TEMPLATES.find(t => t.modality === 'Mobility')`. Add another index only when there is a repeated access pattern and a meaningful reason to maintain it.
- Describe the benefit as avoiding repeated linear scans or using indexed lookup, rather than promising a particular constant-time complexity.

## Trade-off

The indexes add a small one-time module-initialization and memory cost in exchange for cheaper repeated exact-ID resolution. For these static catalogues that trade is appropriate, particularly in render paths that resolve multiple IDs per update.
