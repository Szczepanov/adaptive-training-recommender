## 2025-02-12 - [Redundant array filtering in React renders]
**Learning:** React components containing inline `.filter()` calls on arrays inside render methods (like `activeSettings.filter(s => s.kind === 'guardrail')`) can be optimized by extracting the filtered result into a `useMemo` hook, avoiding O(N) redundant operations on every render, especially when the filtered result is used multiple times.
**Action:** Always memoize derived array computations (like filtering and mapping) that rely on props or state, especially if they are used more than once in the JSX.

## 2024-05-18 - Use Map for O(1) template lookup by ID
**Learning:** Creating a Map for template lookups by ID avoids repeated O(N) array scans for the 655 templates in `ENRICHED_TEMPLATES`. Using `.find(t => t.id === ...)` on a 655-element array is an anti-pattern when it's done repeatedly inside loops or frequently called engine functions like `enrichedCostProfile`. A simple dictionary/Map speeds up lookups by 40x.
**Action:** When performing repeated lookups by ID in static data like templates or workouts, always build a Map on initialization and use `.get()` rather than iterating arrays.
## 2026-08-20 - O(1) Map lookups for Planning & Packing

**Learning:** When performing repeated lookups by ID in static data collections like templates or workouts, iterating arrays with `.find()` creates O(N) performance bottlenecks, especially in core algorithms like dose packing or scheduling that run many times per session generation.

**Action:** Build a Map on initialization and use `.get()` rather than iterating arrays with `.find()` for performance critical areas where we iterate collections.
