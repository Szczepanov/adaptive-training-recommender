## $(date +%Y-%m-%d) - Optimize Exercise Catalog Lookups
**Learning:** React components and engine functions were scanning the `EXERCISES` catalog (a large array) using `.find()` inside `map` and loops (`O(N)` per lookup), creating `O(M*N)` performance bottlenecks on heavily rendered or iterated paths.
**Action:** Replace all `.find()` calls on static datasets like `EXERCISES` with `EXERCISES_BY_ID.get()` (an `O(1)` Map lookup) across all components and engine files.
