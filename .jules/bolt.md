## 2025-02-12 - [Redundant array filtering in React renders]
**Learning:** React components containing inline `.filter()` calls on arrays inside render methods (like `activeSettings.filter(s => s.kind === 'guardrail')`) can be optimized by extracting the filtered result into a `useMemo` hook, avoiding O(N) redundant operations on every render, especially when the filtered result is used multiple times.
**Action:** Always memoize derived array computations (like filtering and mapping) that rely on props or state, especially if they are used more than once in the JSX.
