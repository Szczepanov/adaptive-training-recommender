## 2026-08-08 - [Preventing Unnecessary Re-renders]
**Learning:** In a complex React dashboard component (`Home.tsx`) with multiple independent interactive sections (e.g., Week Ahead Strip, Detailed Plan, Adherence Prompts), state updates in one section (like changing `selectedNextDayTier` or toggling `showWorkoutDetails`) cause the entire dashboard to re-render, including expensive sub-components like `DetailedTodayPlan`.
**Action:** Use `React.memo` for pure presentation components that receive complex props but shouldn't re-render unless those specific props change. This isolates rendering costs in data-heavy views.

## 2026-08-08 - [Preventing Unnecessary Re-renders via useCallback]
**Learning:** Even when a component is memoized using `React.memo` (e.g., `AdherencePrompt`, `WeekAheadStrip`), passing down inline functions (like `onResolved={() => setPendingAdherence(null)}`) creates a new function reference on every render of the parent component (`Home.tsx`), breaking the memoization and causing the child to re-render.
**Action:** Use `useCallback` in the parent component to memoize the function reference passed as a prop, ensuring `React.memo` correctly prevents unnecessary re-renders.
## 2023-10-27 - [Sequential Promises in React components]
**Learning:** `loadDashboardData` originally awaited independent backend services sequentially, leading to an unnecessary dashboard load waterfall constraint.
**Action:** Always scan for uncoupled `await` calls that can be grouped into a single `Promise.all` block. Especially when loading diverse domains of user data (like daily recommendations, fixed activities, and plan blocks) concurrently speeds up hydration without risking correctness.
