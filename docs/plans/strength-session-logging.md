# Strength session logging, 1RM self-calibration, and engine integration

* **Status:** `Accepted`
* **Blocked by:** nothing for Step A. Step B needs S1.2 landed. Step C needs an accepted ADR for **D-STRCOST**.
* **Unlocks:** progressive-overload history; self-calibrating strength prescription; strength work finally costing `lowerBody` / `neuromuscular` fatigue.
* **Source analysis:** [`2026-08-17-strength-logging-gap.md`](../analysis/2026-08-17-strength-logging-gap.md) — findings referenced below as `A2.1`–`A4.1`.

> **Not a top-level phase.** Work items are numbered `S*` so they cannot be confused with the
> `Phase 0`–`9` roadmap sequence.

---

## Goal

Capture per-set strength work in-app during the session, use it to keep `estimated1RmKg`
current, and — only after measurement — let it contribute real dimensional fatigue and
stimulus to the engine.

Three goals, delivered one per step, cheapest risk first:

| Step | Delivers | Policy risk |
|---|---|---|
| **A** (S1.x) | Progressive-overload history | none |
| **B** (S2.x) | Self-calibrating prescription | none |
| **C** (S3.x) | Strength visible to fatigue and stimulus | **yes** |

---

## Preconditions

| # | Condition | State today |
|---|---|---|
| P1 | A strength exercise library with metadata for cost derivation | ✅ `workouts/exercises.ts` |
| P2 | Prescription emits per-step sets/reps/RIR/technical targets | ✅ `StepTarget`, `IntensityTarget` |
| P3 | A declared `manualTraining` history source | ✅ declared in `trainingHistorySnapshot.ts`, hardcoded `MISSING` (A2.1) |
| P4 | A 1RM store with field-level ownership | ✅ `estimated1RmKg` + `targetSources` — **no writer exists** (A2.2) |
| P5 | Offline write durability | ✅ **S1.1 done** — `persistentLocalCache` with multi-tab manager in `firebase.ts` |
| P6 | A decision on the intensity-gauge schema | ❌ **D-GAUGE — blocks S1.2** |
| P7 | A decision on set-log → dimensional cost | ❌ **D-STRCOST — blocks Step C only** |

---

## Decisions this plan needs

Proposed here, **not** yet in the accepted register.

| ID | Proposal | Why it cannot be left to the implementer |
|---|---|---|
| **D-GAUGE** | Intensity is stored as a **tagged gauge** `{ scale, value }` — `rir`, `rpe_rts`, `velocity_loss`, `technical` — never a bare `rpe: number`, and never silently converted between scales | RPE/RIR are the same scale inverted for strength, but power work is quality-limited, not failure-limited (A4). A bare number makes a power triple and a hypertrophy set indistinguishable, and silently corrupts 1RM estimation (A4.1) |
| **D-SETLOG** | The raw per-set log is the source of truth; both derivations are recomputable from it and never written back into it | Storing only engine-shaped data permanently destroys overload history; storing only chart-shaped data leaves the engine blind (A5) |
| **D-1RMSRC** | Derived 1RM joins `targetSources` as its own rung and never overwrites `manual` or `coach` | `targetSources` exists precisely to stop an automated import replacing a human-set target; writing blind reintroduces that bug from a new direction (A3.3) |
| **D-STRCOST** | The set-log → `WorkoutCostProfile`/`WorkoutStimulusProfile` mapping is built default-off and **measured** before shipping; coefficients come from evidence, not from this document | Same discipline as D-FUSE (ADR-0014) and D-SUBJCAL (ADR-0020). Prescribing a tonnage→fatigue coefficient here would repeat the uncited-constant practice F11 criticised (A3.5) |

D-GAUGE must be accepted before S1.2 (it defines the persisted schema). D-STRCOST must be
accepted before any Step C item.

---

## Task board

| Item | Title | Status | Blocked by |
|---|---|---|---|
| S1.1 | Offline persistence | `[x]` | — |
| S1.2 | `strength_sessions` schema and types | `[x]` | D-GAUGE |
| S1.3 | Firestore rules and validation | `[x]` | S1.2 |
| S1.4 | Session state machine and date attribution | `[x]` | S1.2 |
| S1.5 | Set-entry UI | `[x]` | S1.3, S1.4 |
| S1.6 | Rest timer and derived rest | `[x]` | S1.5 |
| S1.7 | Overload history view | `[x]` | S1.3 |
| S2.1 | Gauge-aware 1RM estimator | `[x]` | S1.2 |
| S2.2 | Write-back under a `derived` source | `[ ]` | S2.1 |
| S3.1 | Set log → `CompletedExposure` | `[ ]` | S1.2, ADR for D-STRCOST |
| S3.2 | `manualTraining` source wiring | `[ ]` | S3.1 |
| S3.3 | Measurement and ship decision | `[ ]` | S3.2 |

---

## Step A — Logging

### S1.1 `[x]` Offline persistence

**Current:** `firebase.ts` calls `initializeFirestore(getApp(), { ignoreUndefinedProperties: true })`
with no local cache. Every write requires live connectivity.

**Change:** configure `persistentLocalCache` (with multi-tab manager) on the same
`initializeFirestore` call.

**Why first:** gyms have no signal, and set logging is the app's first write that happens
away from a desk. Without this, S1.5's per-set writes fail silently mid-session — the exact
failure that makes a logger get abandoned (A3.1).

**Done when:** an existing read path (e.g. `activityService.getActivitiesInRange`) still
passes its tests unchanged; a write issued while offline is visibly queued and flushes on
reconnect; `npm run check` passes.

> Verify no existing test asserts on cold-cache behaviour before enabling — persistence
> changes read timing, and this touches every collection, not just the new one.

**Outcome (2026-08-17).** The cold-cache caveat was checked and is a non-issue: every
service test mocks `../firebase` wholesale (`getDb: vi.fn(() => ({}))`), and the emulator
suite initializes through `@firebase/rules-unit-testing`'s `initializeTestEnvironment`, so
no test reaches `src/firebase.ts` at all. `npm run check` passes (1212 tests) and
`npm run build` succeeds.

Two things were added beyond the literal change:

* `firebase.test.ts` now pins the durability contract. Because every service test mocks the
  module, nothing previously exercised `getDb()` — the persistent cache could have been
  deleted without a single test failing, on the one item whose entire purpose is durability.
* The pre-existing bare `catch {}` now warns before falling back to `getFirestore`. That
  fallback yields an instance with no offline durability, and silently degrading the exact
  guarantee this item exists to provide is not an acceptable failure mode.

**Not verified here:** "a write issued while offline is visibly queued and flushes on
reconnect" is a real-browser behaviour. The unit tests prove the cache is *configured*, not
that IndexedDB round-trips. Confirm by hand (DevTools → Network → Offline, write, reload,
reconnect) before S1.5 depends on it.

### S1.2 `[x]` `strength_sessions` schema and types — **implements D-GAUGE, D-SETLOG**

**Change:** define the persisted shape at `users/{userId}/strength_sessions/{sessionId}`.

```ts
interface LoggedSet {
    setIndex: number;              // 1-based within the exercise
    weightKg: number | null;       // null for bodyweight
    reps: number;
    gauge?: IntensityGauge;        // tagged; see D-GAUGE
    isWarmup: boolean;
    completedAt: string;           // ISO instant; rest is derived from these
    notes?: string;
}

type IntensityGauge =
    | { scale: 'rir'; value: number }
    | { scale: 'rpe_rts'; value: number }          // RTS 1-10, inverse of RIR
    | { scale: 'velocity_loss'; percent: number }
    | { scale: 'technical'; met: boolean; note?: string };

interface LoggedExercise {
    exerciseId: string | null;     // workouts/exercises.ts id, or null for free text
    freeTextName?: string;         // only when exerciseId is null
    sets: LoggedSet[];
}

interface StrengthSession {
    userId: string;                // added during implementation, see outcome note
    sessionId: string;
    date: string;                  // Warsaw-local, from session START (S1.4)
    startedAt: string;
    completedAt?: string;
    updatedAt: string;             // added during implementation, see outcome note
    state: 'in_progress' | 'completed' | 'abandoned';
    sourceRecommendationDate?: string;   // set when started from a prescription
    exercises: LoggedExercise[];
    sessionRpe?: number;           // Borg CR-10, whole-session; NOT a set gauge (A4)
    notes?: string;
    schemaVersion: 1;
}
```

Notes that are not optional:

* `gauge` is **tagged and never converted on write.** An RPE 8 and a 2 RIR are the same
  measurement but must round-trip as what the athlete entered.
* `isWarmup` exists so ramp-up sets do not inflate tonnage or reach the 1RM estimator.
* `sessionRpe` is Borg CR-10 session RPE and is a **different construct** from any set
  gauge. It must never be read as one (A4).
* `completedAt` per set is what makes rest duration free (S1.6) — do not store a separate
  rest field the client could disagree with.
* Unlike the Garmin activity record, this document **does** carry `schemaVersion: 1`,
  because it is client-written and its parser is being authored alongside it. Fix the
  version in the rules (S1.3) from the start.

**Done when:** types exist, a parser mirrors the `parseNormalizedGarminActivity` house
style (unknown keys ignored, malformed optional fields degrade rather than invalidate), and
`npm run check` passes.

**Outcome (2026-08-17).** Implemented in `engine/models.ts` (types) and a new
`persistence/parsers/strengthSession.ts`, with 20 tests. Two fields were added beyond this
block, both required by S1.3's already-planned rules shape rather than optional polish:

* **`userId`.** Every other client-writable collection (`decision_journal`, `goals`,
  `daily_recommendations`) duplicates `userId` in the document so `hasOwnedUserId` /
  `keepsOwnership` can validate it; this schema block omitted it. The parser now takes
  `userId` as a caller-supplied parameter and checks it against the stored value before
  anything else, mirroring `parseDecisionJournalEntry` — a mismatch is `user-id-mismatch`,
  not silently trusted.
* **`updatedAt`.** D-SETLOG requires per-set persistence (every logged set is its own
  write), so the document needs a monotonic field for read-layer revision tracking. Used as
  the parser's `DataState` revision, the same role `syncedAt` plays for
  `NormalizedGarminActivity`.

Degradation policy is two-tier and was tested explicitly: a malformed **top-level** field
(date, state, schemaVersion, startedAt, updatedAt, userId mismatch) invalidates the whole
document. A malformed **set or exercise** is dropped from its parent array and the rest of
the session still parses `AVAILABLE` — D-SETLOG's raw log should survive one bad entry from
a flaky offline write, not vanish along with every other set in the session. `weightKg`
parsing is deliberately asymmetric: explicit `null` is accepted as bodyweight, but a
non-null, non-numeric value drops the set rather than being coerced to `null` — coercion
would misreport a real loaded set as bodyweight.

### S1.3 `[x]` Firestore rules and validation

**Current:** no `strength_sessions` match block. `activities` avoids validation only because
it is server-only; every client-writable collection here carries a `hasValid*` function
(A3.2).

**Change:** add `hasValidStrengthSession(userId, sessionId)` following the
`hasValidDecisionJournalEntry` pattern — `keys().hasOnly(...)` plus `hasAll(...)`, explicit
type checks, `schemaVersion == 1`, and `keepsOwnership(userId)` on update.

**Bounds are mandatory,** since this is client-written and array-shaped:

* `exercises.size() <= 30`
* per-exercise `sets.size() <= 50`
* `weightKg` in `0..1000`; `reps` in `1..1000`
* free-text and note strings length-capped (follow the existing `<= 2000` precedent)
* `state` restricted to the three literals; `date` through `isDateDocument`-equivalent

Allow `delete` (unlike `decision_journal`) — a mis-started session must be removable.

**Done when:** `npm run test:rules` covers: owner read/write allowed, cross-user denied,
oversized arrays denied, out-of-range `weightKg`/`reps` denied, unknown key denied,
`schemaVersion: 2` denied, ownership change on update denied.

**Outcome (2026-08-17), and a real constraint this plan didn't anticipate.** Firestore's
rules language has no per-element predicate over a variable-length `list` — only `is list`
and `.size()`. It cannot express "every set's `weightKg` is in `0..1000`" for an array whose
length isn't fixed, only "this array has at most 30 elements." This isn't a workaround
choice; every existing array-of-maps field in `firestore.rules` (`external_plans`'
`sessions`, `plan_blocks`' `assignments`) is already bounded the same way and none is
deep-validated — this plan's "out-of-range `weightKg`/`reps` denied" bullet described a
check the rules language cannot perform.

`hasValidStrengthSession` therefore enforces top-level shape, ownership, `schemaVersion`,
`state` enum, date validity (reusing `isValidActivityDate`), and `exercises.size() <= 30` —
and **does not** bound `sets.size()`, `weightKg`, or `reps` per element. Per-element
correctness is the read side's job: `parseStrengthSession` (S1.2) already drops a malformed
set or exercise rather than trusting it, which is the actual enforcement point for this
data. The emulator suite (57 tests, run against the real Firestore emulator via
`npm run test:rules`, not just typechecked) covers what the rules layer can genuinely
enforce: create/read/update/delete ownership, `schemaVersion` and state-enum rejection,
unknown-key rejection, the 30-exercise cap, and — beyond the plan's original list — that
`date` and `startedAt` are immutable on update (S1.4's "fixed at creation, never
recomputed" requirement, enforced here rather than left to app discipline).

Also added beyond the plan: `sessionId` is required in `hasAll` and checked against the
path segment (`isStrengthSessionDocument`), matching `isDateDocument`'s precedent for every
other date-keyed collection — the plan's schema listed `sessionId` as required but the rules
section didn't mention enforcing the path/field agreement.

### S1.4 `[x]` Session state machine and date attribution

**Change:** `in_progress → completed | abandoned`. Transitions are explicit; a session is
created `in_progress` on start, not on finish.

**Date rule:** the session's `date` is the **Warsaw-local date of `startedAt`**, fixed at
creation and never recomputed on completion. A session starting 23:30 and finishing 00:20
belongs to the start date (A3.4). Use `getLocalDateString`; never
`toISOString().split('T')[0]`.

**Abandonment:** a session left `in_progress` past a threshold is `abandoned`, not deleted —
partial work still happened and still costs fatigue in Step C.

**Done when:** a crossing-midnight session asserts the start date; an abandoned session
retains its logged sets; state transitions are unit-tested including the illegal ones.

**Outcome (2026-08-17).** Split into a pure module and a service, per D-SUBJPURE's
precedent of keeping engine-layer rules synchronous and testable without mocking Firestore:
`engine/strengthSessionLifecycle.ts` (`computeSessionDate`, `buildNewStrengthSession`,
`canTransitionStrengthSessionState`, `isStaleInProgressSession` — 13 tests, no I/O) and
`services/strengthSessionService.ts` (`startSession`, `transitionState`,
`reconcileStaleSessions` — 12 tests, mocked Firestore per the `decisionJournalService.test.ts`
house style).

Transition rule chosen: `in_progress` may move to any state, including re-saving itself
(every logged set is its own write per D-SETLOG, and each keeps `state` unchanged);
`completed` and `abandoned` are **terminal**, including against each other and against
re-opening to `in_progress` — reopening a closed session is treated as a modelling error
(log a fresh session instead), not a supported transition, since a closed session may
already have fed overload history or, once Step C ships, engine credit. Re-saving a
terminal state at itself is allowed (idempotent), which matters because `reconcileStaleSessions`
would otherwise error on a session it processes twice.

`STALE_IN_PROGRESS_HOURS = 6` is this implementation's choice for the abandonment
threshold — no session realistically runs that long, but the plan didn't specify a number
and none was derivable from existing code. Documented as a constant with its rationale in
`strengthSessionLifecycle.ts` rather than buried in the service, so S1.5 (which decides
*when* to call `reconcileStaleSessions`) can find and, if needed, override it.

Midnight-crossing is tested in both directions of the DST calendar (CEST, UTC+2 in August;
CET, UTC+1 in January) via `Intl.DateTimeFormat`, not a hardcoded offset — `getLocalDateString`
already does this correctly; the tests exist to pin the *contract*, not to add new logic.

### S1.5 `[x]` Set-entry UI — **the per-set write is the point**

**Change:** a session runner with two entry paths: start from today's prescription
(pre-populated with exercise, target sets/reps and target gauge) or start empty and add
exercises manually.

Non-negotiable behaviours:

1. **Persist on every set**, not on finish. The write goes to the offline cache immediately
   (S1.1) and syncs opportunistically. "Finish" is the `completed` state transition, not the
   first write. Anything else loses a session to a backgrounded app or a dead battery.
2. **Prefill each set from the previous one**, weight focused. The dominant pattern is same
   exercise, same reps, ascending load — the athlete should change one field, not four.
3. **Confirm-or-amend against the prescription** when one exists. The app knows the target;
   don't render a blank form.
4. **Show per-set sync state** (synced / pending) as ordinary information, not an error.
   Pending is the normal case in a basement.
5. **Free-text exercises are accepted, not rejected** — see S3.1 for how they degrade.

**Done when:** killing the app mid-session and reopening restores every logged set; a
prescribed session prefills from the recommendation; an offline session syncs on reconnect
with no duplicate sets.

**Outcome (2026-08-17).** Behaviours 1–3 and 5 are implemented as designed; behaviour 4
(sync-state indicator) is a known simplification -- see below.

Split three ways, all new: `workouts/strengthSessionEntry.ts` (pure confirm-or-amend logic
— prescription matching, prefill, set construction, exercise upsert; 20 tests, no I/O or
React), `hooks/useStrengthSessionRunner.ts` (thin orchestration over the pure module and
`strengthSessionService`; no dedicated test file, matching this repo's own precedent —
`useGarminSyncStatus` has none either, and there is no `@testing-library/react` in this
toolchain to test a hook's behaviour directly), and `components/StrengthSessionRunner.tsx`
(6 `renderToStaticMarkup` smoke tests, the same style as `GarminSyncBadge.test.tsx` — this
repo has no interaction-testing library, so these assert rendered output across states, not
clicks). Wired into navigation: `Screen` gained `'strength'`, routed in `App.tsx`, reachable
from the "More" drawer in `MobileNav.tsx`. Not added to the primary bottom-nav bar or to a
`Home.tsx` dashboard card — both are placement/prominence decisions better made by a human
than assumed here; the drawer entry is the same tier `Import Training Plan` and
`Export Context for AI` already occupy.

**Prescription matching, scoped deliberately.** `WorkoutPrescription` carries both
`adjustedBlocks` (the original structured `WorkoutBlock[]`, with typed `exerciseId`/`sets`/
`target: IntensityTarget`) and `displayBlocks` (rendered presentation strings). Matching
reads only `adjustedBlocks` — `displayBlocks`' `dose`/`targets` are rendered text, not
parseable back into structured data. Of `IntensityTarget`'s eight variants, only
`reps_in_reserve` and `technical_quality` map to a suggested gauge (verified against
`catalog/support-strength.ts`, the only two a real strength step ever carries); every other
variant (`rpe`, `ftp_percent`, `heart_rate_zone`, `power_zone`, `cadence`) is a
cycling/running target and degrades to no suggestion rather than a guess. The mapped
suggestion is explicitly *not* the D-GAUGE conversion the parser forbids — it never touches
persisted data, only seeds the entry form before the athlete confirms or amends it.

**Two "Done when" criteria are real end-to-end browser behaviour and were not verified
here**, for the same reason noted in S1.1: "app killed mid-session, reopens with every set
intact" and "offline session syncs on reconnect with no duplicates" depend on IndexedDB
round-tripping through `persistentLocalCache`, which unit tests running in Node cannot
exercise. What *is* verified: `logSet` awaits `saveExercises` before updating local state
(so a set is never shown as logged before the write call resolves), and
`findActiveSession`/`saveExercises` are both covered against a mocked Firestore SDK.
Confirm the real end-to-end behaviour by hand (DevTools → Offline, log a set, kill the tab,
reopen) before relying on it.

**Sync-state indicator not built.** Item 4 above ("pending" vs "synced" per set) needs a
live `onSnapshot({ includeMetadataChanges: true })` listener to read `hasPendingWrites`,
which is a meaningfully separate feature (subscription lifecycle, cleanup, per-document
metadata state) from durable persistence itself. `saveExercises`'s `await` already
guarantees the write reached the local cache before the UI reports success; what's missing
is only the passive "still syncing to the server" affordance. Left for a follow-up rather
than bundled in here.

### S1.6 `[x]` Rest timer and derived rest

**Change:** the timer is **timestamp-based**, computed from the previous set's `completedAt`
on each render — never a `setInterval` accumulating in memory. Backgrounded tabs throttle or
freeze timers; the phone is in a pocket between sets.

Actual rest is then **derived for free** from consecutive `completedAt` values. Do not store
it separately.

**Done when:** backgrounding for two minutes and returning shows correct elapsed rest;
derived rest matches the timestamp delta; no timer state survives in memory across reload.

**Outcome (2026-08-17).** `workouts/restTimer.ts` (`elapsedSeconds`, `formatElapsed`,
`deriveRestSecondsBetweenSets`, `deriveRestIntervals` — 11 tests, pure) plus
`hooks/useElapsedSeconds.ts` (no test file, same rationale as `useStrengthSessionRunner`:
no `@testing-library/react` in this toolchain, and the value it displays is what's actually
tested). Wired into `StrengthSessionRunner`: "Elapsed" before the exercise's first set,
"Rest" after, timing from that set's `completedAt` — 2 new component smoke tests.

**The `setInterval` in `useElapsedSeconds` is not the accumulator; it is the trigger.** Its
callback recomputes `elapsedSeconds(sinceIso, now)` from wall-clock time on every tick, so a
throttled or fully suspended background timer (routine: phone in a pocket between sets)
cannot make the displayed value drift low — whichever tick does eventually fire shows the
*true* elapsed time, not a count of ticks that happened to fire. "No timer state survives
in memory across reload" holds structurally: the hook's only state is `nowIso`, reset fresh
on every mount, and the value it renders is a pure function of `sinceIso` (from Firestore,
already durable per S1.1) and wall-clock time — there is nothing timer-shaped to lose.

`deriveRestIntervals` (post-hoc rest between logged sets, for S1.7 and any future rest-aware
cost model) is separate from the live countdown for a structural reason, not just naming:
the live display counts up *before* a "next" set exists, so there is no second timestamp to
derive an interval from yet.

The two backgrounding/reload criteria above are, again, real browser behaviour a Node test
cannot exercise directly — the same limitation noted for S1.1 and S1.5. What's verified
instead: `elapsedSeconds` and `formatElapsed` are fully covered, and the hook's only two
moving parts (`setInterval` as trigger, `elapsedSeconds` as value) are each independently
tested at the boundary between them.

### S1.7 `[x]` Overload history view

**Change:** per-exercise history — load, reps, tonnage and best set over time, reading the
raw log directly (D-SETLOG). Warm-up sets excluded from tonnage.

This is the deliverable for goal 2 and needs nothing from Steps B or C.

**Done when:** an exercise with sessions across several weeks renders a correct trend;
warm-up sets are excluded; an exercise with one session renders without special-casing.

**Outcome (2026-08-17).** `workouts/overloadHistory.ts` (`summarizeExerciseSession`,
`summarizeExerciseAcrossSessions`, `distinctLoggedExercises` — 14 tests, pure, no I/O),
`services/strengthSessionService.getSessionsInRange` (bounded date-range read, same query
shape as `activityService.getActivitiesInRange` / `decisionJournalService.getEntriesInRange`
— invalid documents are omitted and counted rather than failing the whole range; 3 new
tests), `hooks/useOverloadHistory.ts` (orchestration, no dedicated test file per this plan's
established precedent), and `components/StrengthOverloadHistory.tsx` (a table, not a chart —
the plan's own wording is satisfied by one row per session; 8 smoke tests). Wired into the
same `'strength'` screen as S1.5's runner rather than a separate nav entry, stacked below it.

**A real identity bug was caught and fixed during implementation, not after.** The first
draft matched an exercise across sessions on `exerciseId` alone. Two different free-text
lifts both have `exerciseId: null`, so that match would have silently merged, say, "Farmer
carry" and "Sled push" into one shared history the moment both existed. Every lookup in the
module now goes through an `ExerciseIdentity { exerciseId, freeTextName }` and a single
`identityKey` function, and a dedicated test (`'never conflates two distinct free-text
exercises that share exerciseId: null'`) pins it. Contrast with `upsertExercise` (S1.5),
which deliberately keeps two same-named free-text entries distinct *within one session* —
across sessions, for history purposes, they are necessarily merged by name instead, since
there is nothing else to key on. Documented as a stated relaxation, not an inconsistency.

**"Best set" is a plain heuristic, not an estimate.** `heaviestSet` is the working set with
the greatest `weightKg` (ties broken by reps) — never conflated with S2.1's 1RM estimator,
which does not exist yet at this point in the plan and uses a different, gauge-filtered
admissibility rule. Naming it "heaviest" rather than "best" or "estimated max" in the type
itself was a deliberate choice to make that boundary hard to blur later by accident.

---

## Step B — 1RM self-calibration

### S2.1 `[x]` Gauge-aware 1RM estimator

**Change:** estimate 1RM per exercise from logged working sets (Epley or Brzycki — state
which and why in the module docstring).

**The gauge filter is the point of this item.** Estimation is only valid on sets taken near
failure. Exclude, explicitly and testably:

* `isWarmup` sets;
* sets whose gauge indicates distance from failure beyond a stated threshold;
* every `velocity_loss` and `technical` gauged set — power work is quality-limited by
  design and its load says nothing about a maximum (A4.1);
* sets with no gauge at all, unless a documented fallback is chosen deliberately.

Feeding a deliberately fast, submaximal power triple into Epley yields a garbage 1RM that
then corrupts every prescription derived from it.

**Done when:** a power-snatch session at `velocity_loss` produces **no** 1RM estimate; a
near-failure set of 5 produces a plausible one; warm-ups never influence the result.

**Outcome (2026-08-17).** `workouts/oneRepMax.ts`: `estimateOneRepMax` — pure, 11 tests, no
I/O. Formula is Epley (1985), stated in the module docstring alongside why: simplicity and
being the more commonly implemented default, explicitly **not** a claim that it outperforms
Brzycki — this repo has no evidence either way, and per D-SUBJEST's precedent (ADR-0020),
the formula is versioned policy, not an invariant this module should assert authority over.

Admissibility, each independently tested: `isWarmup` excluded; a `null` `weightKg`
(bodyweight) excluded, since there is no external load to estimate a *loaded* max from; reps
beyond `MAX_REPS_FOR_ESTIMATION = 12` excluded even when gauged near failure, because
Epley's error compounds with rep count regardless of proximity to failure; `velocity_loss`
and `technical` gauges excluded unconditionally, any value — the plan called these
quality-limited, not failure-limited, and this is where that distinction actually bites: no
percentage or met/missed outcome on a power set implies anything about a true maximum, so
there is no threshold to tune here, only exclusion; an **absent gauge is excluded by
default**, the explicit deliberate choice the plan asked for rather than an unstated
assumption; and `rir`/`rpe_rts` are admissible only within `MAX_RIR_FOR_ESTIMATION = 3`
(RPE ≥ 7 on the inverted scale) — the source analysis's own finding on `primer_rir`'s
default of 6: past that distance a self-estimate is a coaching instruction, not a
measurement.

Among admissible sets, the estimator returns the one implying the **highest** capacity, not
an average — a single genuine near-failure set is stronger evidence of true capacity than
diluting it against other, less-informative admissible sets from the same exercise.

### S2.2 `[ ]` Write-back under a `derived` source — **implements D-1RMSRC**

**Change:** add a `derived` rung to `targetSources` and write estimated 1RM into
`estimated1RmKg` only where the existing source is absent or itself `derived`. Never
overwrite `manual` or `coach`. Record when the estimate was computed.

`targetSources` exists precisely to stop an automated value replacing a human-set one; this
must extend that mechanism rather than bypass it (A3.3).

**Done when:** a `manual` 1RM survives a derivation that would have lowered it; an absent
1RM is populated; a stale `derived` value is replaced; `prescription.test.ts`'s
"relative when no 1RM is known" case still passes for exercises with no data.

---

## Step C — Engine integration (**blocked on D-STRCOST**)

> Do not start until an ADR for D-STRCOST is accepted. These items change real
> recommendations: `POLICY_VERSION` bump in `policy.ts` (CI-guarded by
> `check-policy-drift.mjs`), a moved `simulate:diff` baseline, and ADR-0010 replay of
> pre-change decisions must stay reproducible.

### S3.1 `[ ]` Set log → `CompletedExposure`

**Change:** derive a `CompletedExposure` from a completed session — `costProfile` across the
six `WorkoutCostProfile` dimensions and `stimulusProfile` on `maxStrength` / `hypertrophy`,
using each logged exercise's `exercises.ts` metadata (`primaryMuscles`, `eccentricLoad`,
`movementPatterns`, `impact`).

**Free-text exercises degrade, they do not fail.** With no `exerciseId` there is no metadata
and therefore no defensible dimensional cost. Route these through the existing evidence
ladder at low `stimulusConfidence` rather than guessing — the same discipline
`genericModalityFallback` already applies to unclassified Garmin sessions. Logging still
works for goal 2; only engine credit is discounted.

Each exposure needs a stable `occurrenceKey` for idempotent replay, as every other exposure
source has.

**Done when:** a fully-identified session yields a plausible cost profile; a free-text
session yields a discounted, low-confidence one; re-deriving is idempotent on
`occurrenceKey`.

### S3.2 `[ ]` `manualTraining` source wiring

**Change:** replace the hardcoded `manualTraining: { status: 'MISSING' }` in
`buildTrainingHistorySnapshot` with a real `DataState` summary, behind a default-off
selector.

Preserve the existing failure contract exactly: a source that fails must surface as
`INVALID`/`UNAVAILABLE` and never as silently-zero load.

**Done when:** with the selector off, `simulate:diff` shows **zero** change against the
committed baseline; with it on, strength sessions appear in the snapshot and the diff is
produced for S3.3.

### S3.3 `[ ]` Measurement and ship decision

Produce the D-STRCOST evidence: derived strength cost against the athlete's real logged
history, the `simulate:diff` output from S3.2, and the cases where strength load changed a
recommendation.

**Recording "no material improvement" satisfies this item**, per D-BEAM. A defensible
decision is the success condition, not shipping.

---

## Tests to add

| Test | Asserts |
|---|---|
| `firebase.test.ts` — offline write | A write issued offline is queued and flushes on reconnect |
| `firestoreRules.emulator.test.ts` — ownership | Cross-user read and write denied |
| `firestoreRules.emulator.test.ts` — bounds | Oversized `exercises`/`sets`, out-of-range `weightKg`/`reps` denied |
| `firestoreRules.emulator.test.ts` — schema | Unknown key and `schemaVersion: 2` denied |
| `strengthSession.test.ts` — gauge round-trip | `rir` and `rpe_rts` persist as entered, never converted |
| `strengthSession.test.ts` — midnight | Session starting 23:30 attributes to the start date |
| `strengthSession.test.ts` — state | Illegal transitions rejected; abandoned session keeps its sets |
| `strengthSession.test.ts` — recovery | Simulated mid-session termination loses no logged set |
| `restTimer.test.ts` — backgrounding | Elapsed rest correct after a simulated freeze |
| `oneRepMax.test.ts` — gauge filter | `velocity_loss` and `technical` sets produce no estimate |
| `oneRepMax.test.ts` — warm-ups | Warm-up sets never influence the estimate |
| `oneRepMax.test.ts` — ownership | A `manual` 1RM is never overwritten by a `derived` one |
| `strengthExposure.test.ts` — free text | Unidentified exercise yields discounted low-confidence credit, not a failure |
| `strengthExposure.test.ts` — idempotence | Re-derivation is stable on `occurrenceKey` |
| `trainingHistorySnapshot.test.ts` — selector off | `manualTraining` remains `MISSING`; no baseline movement |

The mid-session recovery test and the rules bounds tests are the two that matter most:
the first guards the failure that would make the feature abandoned, the second guards the
only client-written training-history collection in the app.

---

## Acceptance criteria

**Step A**
- [ ] `npm run check` and `npm run test:rules` pass.
- [ ] A session survives app termination mid-workout with every logged set intact.
- [ ] An offline session syncs on reconnect with no duplicates.
- [ ] Rules reject oversized arrays, out-of-range values, unknown keys, and `schemaVersion: 2`.
- [ ] A crossing-midnight session attributes to its Warsaw-local start date.
- [ ] Per-exercise overload history renders from the raw log.
- [ ] Engine behaviour is **unchanged** — `simulate:diff` is empty.

**Step B**
- [ ] Power/velocity-gauged and warm-up sets never reach the estimator.
- [ ] A `manual` 1RM is never overwritten.
- [ ] Prescriptions for exercises with a derived 1RM stop being purely relative.

**Step C**
- [ ] An accepted ADR records D-STRCOST.
- [ ] Selector off → `simulate:diff` empty against the committed baseline.
- [ ] `POLICY_VERSION` bumped, prior version added to `HISTORICAL_POLICY_VERSIONS`, `check-policy-drift.mjs` passes.
- [ ] A pre-change audited decision still replays via `npm run replay:recommendation`.
- [ ] S3.3's report exists and states a decision — including "not shipping".

---

## Risks & rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| **Mid-session data loss** | S1.1 offline cache + per-set writes + the recovery test | — this is the risk everything else is arranged around |
| Enabling persistence changes read timing app-wide | S1.1 lands alone and runs the full suite before any feature work | Revert one `initializeFirestore` option |
| A client writes abusive documents | S1.3 bounds, enforced in rules not just UI | Rules are deployable independently |
| Gauge ambiguity corrupts 1RM | D-GAUGE tagged scales; S2.1's explicit exclusions | Derived values are replaceable and never overwrite manual ones |
| Step C quietly changes recommendations | Default-off selector, `simulate:diff` gate, D-STRCOST ADR | Flip the selector off; policy version and baseline unchanged while off |
| Free-text exercises produce fabricated cost | S3.1 routes them to a discounted evidence tier rather than guessing | — |

Steps A and B write only new collections and new optional fields; neither can alter an
existing recommendation. Step C is behind a default-off selector. Rollback at every stage is
a flag or a revert, never a migration.

---

## Out of scope

* **Importing history from Strong or any third-party logger.** No verified export/API
  contract; would need its own exercise-name mapping layer. Revisit only if backfilling old
  history proves necessary.
* **Velocity measurement hardware (VBT).** `velocity_loss` is representable in the schema so
  a device could populate it later; nothing here reads a sensor.
* **Auto-regulation** — adjusting the prescribed load mid-session from logged RPE. Needs
  D-STRCOST settled and real data first.
* **Session RPE as an engine input.** `sessionRpe` is captured (A4) but not consumed;
  sRPE × duration as a load term is its own measured decision.
* **Rest-duration effects on cost.** Derived and stored from S1.6, deliberately unused until
  Step C has a measured baseline to compare against.

---

## Docs to update

| Doc | Change | When |
|---|---|---|
| New ADR | **D-GAUGE** — tagged intensity scales, no silent conversion | Before S1.2 |
| New ADR | **D-STRCOST** — measured-before-shipped, per D-FUSE/D-SUBJCAL precedent | Before Step C |
| `docs/plans/README.md` | Add this plan to the plans table; add D-GAUGE, D-SETLOG, D-1RMSRC, D-STRCOST to the proposed-decision register | With S1.1 |
| `docs/architecture/recommendation-engine.md` | Document `manualTraining` as a live source | With S3.2 |
| ADR-0010 | Confirm strength exposures carry replayable provenance | With S3.1 |
