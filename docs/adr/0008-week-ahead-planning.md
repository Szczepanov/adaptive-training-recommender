# ADR-0008: Rolling 7-Day Week-Ahead Planning

* **Status:** Accepted
* **Date:** 2026-08-07
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

Before this change, the dashboard only ever showed a decision horizon of "today" (fully
computed from real Garmin + check-in data) and "tomorrow" (a 3-branch green/yellow/red
preview keyed to hypothetical morning readiness, `rules.ts` `evaluateNextDayPlan`). Users
planning around work travel, an upcoming event, or simply wanting a sense of the week's
shape had no forward visibility past tomorrow.

The 6-tier engine introduced in [ADR-0007](./0007-adaptive-multisport-engine-architecture.md)
(schedule availability, periodization phase, microcycle objectives, 6D fatigue decay, and
utility optimization) already carries everything a multi-day forecast needs *except* a
real readiness signal for days that haven't happened yet -- so extending it into a
week-ahead view is an honesty problem as much as an engineering one: the further out a
day sits, the less confidence its pick deserves, and the UI has to say so rather than
imply a locked prescription.

Two open design questions:
1. Should weekly training objectives (Zone 2, threshold, surge, strength exposures)
   reset on a fixed calendar week, or roll continuously from today?
2. Should any part of a 2+ day-out projection be persisted?

---

## Decision Outcome

A new pure engine function, [`generateWeekAheadPlan`](../../app/src/engine/planner.ts),
projects a rolling plan forward from today:

1. **Three confidence tiers, not one flat forecast**:
   * **Confirmed** (day 0): today's actual recommendation, unchanged, from `rules.ts`.
   * **Provisional** (day 1): tomorrow's already-computed green/yellow/red preview branch
     (whichever the user has selected), reused as-is.
   * **Projected** (days 2+): no real readiness signal exists this far out, so the pick
     comes from chaining the ADR-0007 optimizer forward -- assuming each earlier
     projected day's pick gets followed at an average recovery rate. This tier is
     presented as *likely session type*, not a locked prescription.

2. **Rolling window, not calendar week**: microcycle objectives
   (`generateWeeklyObjectives`) reset relative to *today* rather than the nearest
   Monday. A fixed calendar week would show a visible seam mid-strip where day 6's
   objective ledger resets just because a new week started -- a rolling window keeps the
   7-day strip internally consistent regardless of what day of the week "today" is.

3. **Nothing beyond today is persisted**. The plan is recomputed on every dashboard load
   from whatever `DailyDecisionInput` currently holds (goals, constraints, preferences,
   today's check-in) -- so editing a goal or constraint reshapes the rest of the strip
   immediately, with no migration or cache-invalidation step. Only day 0 continues to be
   persisted via `recommendationService` for adherence tracking, unchanged from before.

4. **Fatigue chaining separates two signals with different lifespans**: today's real
   subjective/objective reading seeds an "internal strain" vector that decays via the
   same half-lives as ADR-0007's dimensional fatigue, so it fades rather than acting as a
   permanent ceiling on the rest of the week; a separate "external load" vector
   accumulates and decays the cost of each day's *picked* session (real or projected),
   consistent with how `fatigue.ts` already models completed sessions.

5. **Known gap, deliberately not solved here**: `UserEvent` and `FixedActivity` (ADR-0007)
   have no Firestore-backed persistence or UI yet, so `generateWeekAheadPlan` defaults to
   an empty event list and the generic weekly schedule. Periodization therefore stays in
   a flat `Base` phase until that persistence layer exists -- a caller can already pass
   `events`/`fixedActivities` through `WeekAheadOptions` once it does.

---

## Code References

* [`app/src/engine/planner.ts`](../../app/src/engine/planner.ts) — `generateWeekAheadPlan` and supporting fatigue/objective chaining.
* [`app/src/engine/planner.test.ts`](../../app/src/engine/planner.test.ts) — confidence-tier, safety-gate, and determinism tests.
* [`app/src/components/WeekAheadStrip.tsx`](../../app/src/components/WeekAheadStrip.tsx) — dashboard UI, recomputed (never cached) on each `Home` render.
* [`app/src/utils/localDate.ts`](../../app/src/utils/localDate.ts) — `addDaysToLocalDateString`, the Warsaw-local calendar arithmetic the planner walks forward on.

---

## Consequences

### Positive
* Users get week-shaped visibility (e.g. "when's the next hard day") without any new
  data entry.
* Confidence tiers keep the projection honest instead of implying false precision about
  days 6+ out.
* A goal/constraint/preference edit reshapes the whole strip on the next load, with no
  stale cached state to invalidate.

### Negative
* Days 2+ are read as "session type", not exact duration/intensity -- the UI must keep
  surfacing that caveat, or the projection will be over-trusted.
* Periodization for the projected tail stays flat (`Base` phase) until event/fixed-activity
  persistence exists (see gap above); the projected days will feel less "aware" of an
  upcoming race than day 0/1 are today.
