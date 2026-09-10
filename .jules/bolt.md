## 2025-02-12 - Frontend Engine ID Lookups
**Learning:** React component and engine components should use Maps for lookups where possible instead of linear `.find()` scans to avoid O(N) penalties, especially for frequently accessed or rendered content. `ENRICHED_TEMPLATES_BY_ID` and `TEMPLATES_BY_ID` are exported alongside their base arrays specifically for this purpose.
**Action:** When working on engine files like `app/src/engine/*.ts`, refactor `.find()` array operations to Map `.get()` lookups for ID-based queries.
