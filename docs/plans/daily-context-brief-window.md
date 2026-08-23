# Daily context brief window

* **Status:** Shipped. W1–W6 implemented in one PR.
* **Goal:** Add a short "daily" export window (today + yesterday) alongside the existing
  14-day one, so the daily handoff to an external planning agent stops re-sending two
  weeks of retrospective detail that the agent does not need every morning.
* **Blocked by:** nothing.
* **Touches:** `app/src/engine/contextBrief.ts`, `app/src/engine/contextBriefActivityTelemetry.ts`,
  `app/src/services/contextBriefService.ts`, `app/src/components/DataView.tsx`.
* **Decisions:** none new. This is a presentation/scope change; no engine policy, no
  persisted schema, no Firestore rules.

## Verdict

Worth doing, and the plumbing is already half there — `ContextBriefService.build()` has
accepted a `windowDays` argument since it was written; only `DataView` never passes one.

But **shipping this as "call `build(userId, date, 2)`" would be wrong**, because the brief
is not uniformly window-scaled. Three sections read from the arrays the service fetched over
`windowDays` while rendering a *fixed* horizon of their own. Shrinking the fetch would blank
them out silently, and a blank row in this brief does not read as "not exported" — it reads
as "not recorded". That is exactly the failure mode the rest of this module is written to
avoid ("Blank values mean not measured, not zero").

So: one small structural change (decouple fetch range from render window), one honesty
change (label a 2-day window as a point reading, not a trend), then the toggle.

## What actually costs tokens

Measured by structure, not by guesswork — here is what scales with `windowDays` and what
does not.

**O(windowDays) — shrinks with a short window:**

| Section | Growth |
|---|---|
| §3 completed-training table | 1 row per activity |
| **Detailed activity telemetry** | per activity: up to ~14 zone lines **plus one table row per lap, uncapped** |
| §3 rolling 7-day buckets | `ceil(windowDays / 7)` lines |
| §4 flag day lists + per-day notes | 1 line per flagged day, 1 line per note |
| §5 adherence deviations | 1 line per deviation |

**O(1) — identical at 2 days and at 14:**

§0 planning handoff · §1 constraints · §2 objective recovery (every 7d/28d mean, median and
MAD is read off the *latest snapshot's* `derived.*`, computed at ingestion — not from the
exported window) · the 7-day recovery timeline · §4 latest check-in, window averages and the
28-day subjective baseline · §6 goals & intent · §7 the 7-day commitment horizon · §8 the
handoff instructions.

The dominant variable cost is **detailed activity telemetry** (`contextBriefActivityTelemetry.ts`).
A long ride with auto-lap produces a table row per lap with no cap; a fortnight of cycling
can be several thousand tokens of lap rows alone. Everything the planner actually reasons
with — baselines, deltas, drift, constraints, commitments — is in the fixed half.

That is the argument for the change: a 2-day window drops the bulk and keeps essentially all
of the decision-relevant context.

**Do not promise a specific percentage before measuring.** W4 adds a size readout to the UI
so the real before/after is visible on real data rather than estimated here.

## The three sections that would break

`contextBriefService.ts` fetches snapshots for exactly `windowDays` dates and activities from
`startDate`. Consumers that render a fixed horizon from those arrays:

1. **`renderRecoveryTimeline`** (`contextBriefPlanningHandoff.ts`) always emits
   `RECOVERY_TIMELINE_DAYS = 7` calendar rows. At `windowDays = 2` it would print five rows
   of `—` for days that have real sleep, HRV, RHR and check-in data. This is the serious one:
   the timeline is the highest-value-per-token block in the whole brief, and it would be
   silently falsified.
2. **`injectActivityTelemetryIntoContextBrief`** (call site in the service) receives the raw
   fetched array and does **not** slice to the window. Today that happens to be correct
   because fetch range == window; after W1 widens the fetch it would silently widen telemetry
   too.
3. **`renderSubjectiveBaseline`** (`contextBrief.ts`) gates on *baseline* coverage only, never
   on window coverage. At `windowDays = 2` it would compare a one- or two-day average against
   the 28-day baseline under a heading that invites reading it as a trend. One bad night would
   render as "worse than baseline".

Check-ins are already fetched over the full 28-day baseline range, so they need no change.

## Design

Two named presets, one shared code path:

| Preset | Retrospective detail window | Recovery timeline | Subjective baseline | Commitments horizon |
|---|---|---|---|---|
| `daily` | 2 days (today + D-1) | 7 days | 28 days | 7 days |
| `full` | 14 days | 7 days | 28 days | 7 days |

Only the first column changes. The trend context a planning agent needs survives at both
settings, because it never came from the exported window in the first place.

---

## Work items

### W1 — Decouple the fetch range from the render window

`app/src/services/contextBriefService.ts`

* Import `RECOVERY_TIMELINE_DAYS` from `contextBriefPlanningHandoff`.
* Add `const contextDays = Math.max(windowDays, RECOVERY_TIMELINE_DAYS)` and a matching
  `contextStart = briefWindowStart(targetDate, contextDays)`.
* Use `contextDays` / `contextStart` for `snapshotDates` and for the
  `activityService.getActivitiesInRange` call. Keep `startDate` (the `windowDays` start) as
  the **render** window; it is still what `ContextBriefResult.startDate` reports.
* `buildContextBrief` slices its inputs itself via `inWindow`, so handing it the wider arrays
  is safe and needs no change there.
* `enhanceContextBriefForPlanning` slices to its own 7-day horizon, so the timeline now gets
  real data at any window.
* **Slice explicitly for telemetry:** pass `activities.filter(a => a.date >= startDate)` to
  `injectActivityTelemetryIntoContextBrief`, with a comment saying why — the fetch range and
  the render window are no longer the same thing.
* Recommendations stay at `windowDays`: only §5 and the current-day row consume them.
* The snapshot `unavailableSources` count now counts unreadable days out of `contextDays`.

Leave `baselineDays = Math.max(SUBJECTIVE_BASELINE_DAYS, windowDays * 2)` alone — at
`windowDays = 2` it is 28, which is what we want.

### W2 — Say what the short window is, and is not

`app/src/engine/contextBrief.ts`

* **Header scope note.** A 2-day window can legitimately print "No recorded sessions in this
  window", which a fresh planner chat could read as "this athlete does not train". Add one
  line to the header block in `buildContextBrief` stating that retrospective detail is scoped
  to the last `windowDays` days while the recovery timeline and the 28-day baselines below
  cover longer history.
* **`renderSubjectiveBaseline` wording.** When the window is too short to be a trend
  (`windowDays <= 3`), keep the comparison — "today vs this athlete's own normal" is exactly
  what a daily agent wants — but replace the trend framing ("read the direction, not the
  magnitude") with point-reading framing: this is one or two days against a 28-day baseline
  and a single disrupted night moves it.
* Check `renderObjective` / `renderSubjective` "Window averages (n of N days have data)"
  still reads sensibly at N = 2; adjust to singular phrasing if not.
* `renderTraining`'s bucket loop already clamps to the window start and labels short buckets
  `(2 days)` — verify with a test, no change expected.

### W3 — Name the presets

`app/src/engine/contextBrief.ts`

```ts
export type BriefWindowPreset = 'daily' | 'full';
export const DAILY_BRIEF_WINDOW_DAYS = 2;
export function briefWindowDaysFor(preset: BriefWindowPreset): number;
```

`defaultBriefWindowDays()` keeps returning 14 (it is the `full` preset). Add `preset` to
`ContextBriefResult` so the UI can render the active choice without re-deriving it from a
day count.

### W4 — Toggle in the Data view

`app/src/components/DataView.tsx`

* `briefPreset` state, persisted in `localStorage`, **default `'daily'`** — that is the
  stated everyday use, and `full` stays one click away for block planning.
* The build effect currently caches on `brief?.asOfDate === briefDate`. That guard must also
  compare the window, or flipping the toggle would be a no-op. Add the preset to the deps.
* Segmented control above `.brief-actions`, matching the existing tab-button styling in
  `DataView.css`.
* Fix the intro copy — it hardcodes `{brief?.windowDays ?? 14} days`.
* **Size readout** next to `.brief-range`: character count and an approximate token count
  (`Math.ceil(text.length / 4)`). Cheap, and it is how the saving actually gets verified.

### W5 — Tests

* `contextBriefService.test.ts` — at `windowDays = 2`: snapshots are read for 7 dates, not 2;
  activities are fetched from D-6; an activity dated D-5 appears in the recovery timeline row
  **and is absent from the detailed telemetry section**; recommendations are still fetched
  over 2 days; the check-in range is unchanged at 28 days.
* `contextBrief.test.ts` — short-window baseline wording is point-reading, not trend; the
  header scope note is present; a 2-day training bucket is labelled `(2 days)`.
* `DataView` — toggling the preset rebuilds the brief; the persisted preset is honoured on
  mount.

### W6 — Docs

* `AGENTS.md` — the one-line description of `contextBrief.ts`.
* This file's status line, once shipped.

## Risks

* **Silent blanking** is the whole risk of the feature, and W1 + W2 exist to close it. Any
  future consumer added to `enhanceContextBriefForPlanning` that renders a fixed horizon must
  respect `contextDays`, not `windowDays`. The W5 telemetry/timeline test is the guard.
* **Default flip.** Making `daily` the default changes what an existing user sees on the tab.
  It is one click to reverse and the range is printed on screen; acceptable.
* **Not a schema change.** Nothing persisted, nothing user-scoped, no rules change.

## Verification

```bash
cd app && npm run check
```
