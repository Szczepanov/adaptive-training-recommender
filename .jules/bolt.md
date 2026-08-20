## 2025-02-12 - [Redundant array filtering in React renders]
**Learning:** React components containing inline `.filter()` calls on arrays inside render methods (like `activeSettings.filter(s => s.kind === 'guardrail')`) can be optimized by extracting the filtered result into a `useMemo` hook, avoiding O(N) redundant operations on every render, especially when the filtered result is used multiple times.
**Action:** Always memoize derived array computations (like filtering and mapping) that rely on props or state, especially if they are used more than once in the JSX.

## 2024-05-18 - Use Map for O(1) template lookup by ID
**Learning:** Creating a Map for template lookups by ID avoids repeated O(N) array scans for the 655 templates in `ENRICHED_TEMPLATES`. Using `.find(t => t.id === ...)` on a 655-element array is an anti-pattern when it's done repeatedly inside loops or frequently called engine functions like `enrichedCostProfile`. A simple dictionary/Map speeds up lookups by 40x.
**Action:** When performing repeated lookups by ID in static data like templates or workouts, always build a Map on initialization and use `.get()` rather than iterating arrays.

## 2024-05-18 - [N+1 Firestore Writes in _archive_activities]
**Learning:** Looping over records to write documents sequentially to Firestore using individual network requests causes severe N+1 latency problems.
**Action:** Use Firestore batched writes (`db.batch()`) combined with chunking (max 500 documents per batch) when writing multiple documents to greatly reduce network latency. Always update mock tests properly, as batched methods take `call_args` as single large data structures.

## 2024-05-18 - Concurrent Fetching for Garmin API during Backfill
**Learning:** Sequential API calls within loops (like `fetch_detail(activity.activity_id)` over many activities) create substantial bottlenecks, especially in historical data backfills. Using `concurrent.futures.ThreadPoolExecutor` along with `as_completed` allows concurrent processing while avoiding shared state issues by collecting results in the main thread loop.
**Action:** When implementing any data backfill logic hitting external APIs in the Python backend, default to `concurrent.futures.ThreadPoolExecutor` if the rate limits allow it. Always make sure to properly cancel futures when a `GarminConnectTooManyRequestsError` or equivalent is encountered to avoid further requests when limits are already hit.
