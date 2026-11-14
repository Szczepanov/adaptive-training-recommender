# Ledger export content for a long-lived external-AI chat

- **Status:** Approved (owner, 2026-11-14: "proceed with recommendations e2e"). The open
  questions were not answered explicitly, so they take the agent's recommended defaults below;
  the owner can override either before the affected phase merges.
- **Decision source:** [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md) (D-EXPORT, D-COACHLOG), [ledger export contract](../architecture/ledger-export-contract.md), [#1145 plan](./2026-10-25-issue-1145-ledger-export-v1.md).
- **Tracking:** #962 (Lane 0). Issues are filed per phase after approval.

## Why

The owner plans training in **one long-lived external AI chat**. Exports go in twice a day:
in the **morning** (plan today) and **after a session** (review what was done). Under
ADR-0052 that chat is the planning authority, so what it can see is what it can plan from.

A 2026-11-14 analysis, rendered from the export fixtures and checked against the code,
found that the export serves this badly.

1. **The morning export is mostly noise.** The fixture morning Markdown is 32.6 KB
   (~8K tokens). Only ~2.7 KB of it is values. 142 of 251 table rows are `Not recorded`.
   Every field is a six-column row repeating unit, source, state and date. User context
   repeats in full each time (37% of the file). Inactive and unavailable flags are listed
   for every date (40% of the planning file). In a long chat, the repeated copies pile up
   and contradict each other.
2. **A finished session is close to invisible in the ledger export.** The History card's
   per-workout **Copy JSON** (`completed_workout_v1`) has the detail, but it is JSON-only,
   lacks choice reasons, tempo, notes and later-window responses, and is not offered right
   after a session (see the Phase 1 correction). In the ledger export,
   `performedTraining.structuredEntries` is
   `{ exerciseCount, setCount }` only (`services/ledgerExportService.ts`); `setCount`
   includes warm-ups. Not exported:
   - per-set reps, load, RIR/RPE gauge, side and corrections;
   - the prescription (dose, load, effort target, rest, tempo);
   - rest events;
   - swaps, alternatives, omitted and added steps (`choice` entries are filtered out);
   - the execution's own `state`, `notes` and `sessionRpe`;
   - the session↔Garmin link (`sourceRefs`);
   - Garmin training effect, HR zones and laps.
3. **The coaching history has holes.**
   - Future placements are cut off: `resolveWindow` ends every morning/planning window at
     `asOfDate`, so tomorrow's session is never exported.
   - Skipped sessions stay `planned`.
   - Override `reason` is hard-coded `notYetSupported`.
   - Session-level plan notes are dropped.

## Goals

- **G1 — Session report:** after a session, one export gives the AI a complete,
  planned-vs-performed account of that session (built on `completed_workout_v1`).
- **G2 — Morning update:** a morning export small enough to paste every day without
  flooding the chat. It shows today, yesterday and the next 7 days.
- **G3 — Coaching continuity:** the export shows missed sessions, swaps and omissions, and
  why.
- **G4 — Refresh export:** a compact full export for starting a fresh chat.

## Non-goals

- In-app LLM calls or API integration (deferred by the owner, 2026-11-14).
- An app-generated "coach pack" replacing the chat's project files (possible later work).
- Any engine change. The engine is frozen (ADR-0052); nothing here may touch `engine/`
  decision paths or `POLICY_VERSION`.
- New data capture beyond an optional override reason (G3).

## Anti-goals

- **Hiding missingness.** ADR-0052 requires explicit missingness. Compact output may group
  missing fields into one line per item, but must never drop them silently or render them
  as zero/false.
- **Engine opinions leaking into facts.** The existing forbidden-opinion-key tests still
  hold.
- **Non-determinism in the pure builder/renderer.** "Since last export" comes from an
  explicit input, never from a clock or a store read inside the builder.
- **A second export pipeline.** Every new output is rendered from `LedgerExport` (D-EXPORT:
  one canonical schema, Markdown rendered from it).

## Constraints

- The JSON stays the canonical, full-fidelity artifact. New fields are **additive**, inside
  `ledger-export-v1`, with JSON Schema (`ledger/export/ledgerExport.schema.json`) and contract
  tests updated in the same PR. A field rename or removal would need `ledger-export-v2`;
  this design needs none.
- Every leaf keeps `value`/`source`/`state` (+ `unit` for numbers), as today.
- No identity in output: the existing redaction and identity tests apply to new fields,
  including free-text notes.
- The ledger module boundary test forbids engine imports (Phases 2–4).
- Warsaw dates (I2): every date uses `getLocalDateString`/`addDaysToLocalDateString`.
- **D-EVAL timing:** export content is an input to the planning AI. Changing it during the
  qualifying block changes what is being evaluated. Phases 1 and 2 should ship before the
  block starts (see open question Q1).

## Approaches considered

**Correction (2026-11-14, during implementation planning).** The original analysis missed
that the History card's **Copy JSON** already exports a planned-vs-performed session
(`training-occurrence/completedWorkoutJsonExport.ts`, schema `completed_workout_v1`). It
covers:

- each exercise with its prescribed target (sets, reps/seconds/meters, load, RPE/RIR target,
  rest);
- every logged set (reps, kg, duration, distance, effort gauge, warm-up flag, swapped
  exercise) with the performed rest after it;
- added (unplanned) exercises;
- the execution's state, `executedDefinition`, sRPE, completed fraction, fatigue and note;
- the full linked Garmin activity.

Approach 3 was rejected for having "no prescription join", which is wrong. With the
corrected facts, Phase 1 takes approach 3.

1. **New `session` purpose inside the ledger export.** This would duplicate an existing,
   tested planned-vs-performed export and a second hydration path. It is no longer chosen.
2. **A separate Markdown renderer built from raw session data.** Rejected: it would be a
   third path.
3. **Extend `completed_workout_v1` and add a Markdown rendering of it (chosen for Phase 1).**
   It reuses the History read model (`getCompletedWorkoutsInRange`), which already joins the
   prescription, sets, rest and Garmin data. It adds only the missing fields and a compact
   Markdown view.

Phases 2–4 still change the ledger export itself, as designed.

## Design

### Phase 1 — Session report (G1)

**Scope.** One completed workout (a `CompletedWorkoutView`). Abandoned executions and
completions whose reconciliation failed have no performed occurrence, so they are out of
scope for Phase 1; the morning export still reports them. This limitation is named in the UI
copy only if an export is attempted without a view.

**Additive fields in `completed_workout_v1`.** No field is renamed or removed, so the schema
id stays.

- `exercises[].prescribed.tempo` and `exercises[].prescribed.notes`, from the authored
  `SessionStep`.
- `exercises[].choices[]`: the athlete's `ChoiceEntryPayload`s for that step, each with
  `choiceId`, `optionId`, the option's label when resolvable, and `reason`.
- `session.techniqueNote`, and `responses[]`: every `SessionResponse` linked to this
  occurrence (`window`, `sessionRpe`, `completedFraction`, `unexpectedFatigue`,
  `techniqueNote`, `note`). This covers the later-day and next-morning windows.
- `providerActivity` stays as is. The Markdown view selects fields, so raw ids never appear
  in the Markdown.

**Markdown view** (`formatCompletedWorkoutMarkdown(view, exportedAt)`, pure). It is a
session sheet, not field tables:

```
# Session: Heavy Squat Day — 2026-11-14 (authored, completed)
duration: 62 min (app) · sRPE 7 · completed 100% · fatigue: no
note: …

## Back Squat — planned 3×5 @ 100 kg, RIR 2, rest 180 s
warm-up: 8 @ 40 kg, 5 @ 70 kg
1: 5 @ 100 kg, RIR 2 · rest 200 s
2: 5 @ 100 kg, RIR 1 · rest 240 s
3: 4 @ 100 kg, RIR 0
## Romanian Deadlift — swapped to Hip Thrust (reason: back tight)
…
## Added: Face Pull (unplanned)
…
## Not performed: Nordic Curl (planned 3×6)

Garmin: 64 min · avg HR 128 · max 171 · load 95 · TE 3.1/1.2 · zones …
responses: next_morning: soreness note …
missing: performed rest (not_recorded)
```

Rules:

- Missing values are named, never shown as zero.
- A prescribed step with no performed sets renders as **Not performed**.
- Units are always shown.
- The header carries no ids. One trailing `ref:` line holds the occurrence id, so the AI can
  correlate it with the morning export.

**Entry points:**

- **Copy for AI** (Markdown) beside the existing **Copy JSON** on the History card.
- After a session is completed, the runner's post-completion state offers the same action
  for the just-finished workout, once its view is readable. While the occurrence is not yet
  readable, it says "available in History".

### Phase 2 — Morning update (G2)

**2a. Compact Markdown rendering** for every purpose; the JSON is unchanged.

- One line per field: `key: value unit`.
- Source and state are shown only when they are not `measured`.
- Each item ends with one `missing:` line listing absent fields and their states.
- Collections that are entirely missing render as one line.
- The `Sources` section lists only sources that are not `measured`.
- **Flags:** active flags in full. Inactive and unavailable flags become one summary line
  per flag id (for example `illness_risk_symptom: inactive 2026-11-19…20`).
- The existing golden test gets a compact counterpart.
- **Size target:** at most 25% of today's 32,581 characters (at least a 75% reduction). It is
  measured on the existing fixture rendered as `morning`, with 2b content included and
  `previousContext` matching every user-context item.
- Without `previousContext`, the target is at most 40%.

The verbose table rendering stays available behind a renderer option, as a diagnostic view.
It is not exposed in the UI by default.

**2b. Today-first morning content.**

- Check-in and recovery values are shown with their 28-day baseline and the delta. Both
  already exist in `derived`; the renderer joins them.
- Yesterday's sessions get one summary line each: title, done vs planned sets, sRPE. A
  pointer says the session report has the detail.
- **Upcoming sessions.** Placements get a forward bound: `asOfDate + 7` for `morning` and
  `asOfDate + 14` for `planning`. The bounds change is in `buildPlacements` only; past-facts
  windows are unchanged. Each upcoming placement carries, from the stored plan revision's
  `ExternalPlanSession`:
  - `title` and `priority`;
  - `prescription.summary`;
  - per-step `notes`;
  - `scaling.fallback`.

  These are existing authored fields; no plan-schema change is needed. Out-of-window drops
  are counted, as undated drops already are.

  _Agent's call (builder check): there is no session-level `notes` field, so "session-level
  plan notes" means these existing fields. A new authored field would need a new
  external-plan schema version and is out of scope._

**2c. User context since the last export.** Change detection is by **content hash**, not
by date.

- Almost no user-context item has a recorded change date (`revisions` is
  `not_yet_supported`, and `updatedAt` is deliberately not trusted), so date-based change
  detection would save nothing.
- The renderer takes an optional `previousContext: { exportedOn: LocalDate; itemHashes:
  Record<string, string> }`. Item keys are collection + item id.
- It computes a stable hash of each user-context item's exported content.
- Items whose hash matches print as one line: `userContext: <n> items unchanged since
  <exportedOn>`, followed by their ids.
- New, changed and removed items print in full; a removed item gets a `removed:` line.
- Without `previousContext`, everything prints in full.
- The JSON always carries the full user context. Only the Markdown is abbreviated.
- After a successful copy or download, the UI stores the last export's date and item
  hashes per purpose on the device (local storage). A visible "include full context" toggle
  ignores them.
  - Losing that store only means the next export is full. Nothing is written to Firestore,
    so there is no rules impact.
  - The builder and renderer stay pure: the hashes are an explicit input.

_Agent's call (builder check): a content hash works with the data that exists today; dates
would need new change tracking in Firestore._

### Phase 3 — Coaching continuity (G3)

- **Outcome of past placements.** Each placement dated before `asOfDate` gets a derived
  `outcome` in the export only; nothing is written back. Today is never classified. Rules,
  first match wins:
  1. Placement status `dropped`, `moved` or `superseded` → that status.
  2. A planned→performed link exists → `performed`.
  3. Placements, executions or links are not `measured`, or a link was discarded for a hash
     mismatch → `unknown`.
  4. An execution of that plan session exists that is abandoned or has no performed
     occurrence → `started_not_completed`.
  5. Placement status `completed` with no link → `done_unlinked`.
  6. Otherwise → `missed`.

  `missed` is only asserted when every source was read and nothing points to the session
  having been done.

  _Agent's call (builder check): a wrong `missed` would be a fabricated fact, so every
  uncertain case resolves to a weaker state._
- **Swaps and omissions** from Phase 1 choice data also appear in `coachingHistory.overrides`
  as `swapped` / `omitted`, with the step, the replacement and the existing
  `ChoiceEntryPayload.reason`. That reason is already captured by the session runner.
- **Override reason capture** is new only for **dropping or moving a placement**: an optional
  reason on the placement overlay.
  - It touches the external-plans rules (`03-external-plans`) and validator. Check it
    against the compiled-rules budget (ADR-0053; headroom 21%).
  - Until it is recorded, the reason stays `not_yet_supported`, as today.
- Session-level plan text is covered by 2b.

### Phase 4 — Refresh export (G4)

- The `planning` purpose rendered with Phase 2 compact rules.
- It always includes full user context and the next 14 days of placements.
- It is labelled in the UI as the export to use when starting a new chat.
- No new schema.

## Verification

- **Unit:** builder and renderer tests per new field, including missing, invalid, corrected
  entry, tombstone, swap, omit, added step, reduced definition, no Garmin link, abandoned
  execution, and the Warsaw midnight boundary.
- **Contract:** JSON Schema and contract tests updated. Redaction tests run on notes and
  free text. The forbidden-opinion-key inventory is unchanged.
- **Goldens:**
  - existing verbose goldens, which stay byte-identical where the content did not change;
  - new compact goldens for morning, planning and session;
  - a size assertion for the compact morning export.
- **Browser E2E:** session export from the completion sheet and from History, and the
  morning export with upcoming sessions, at mobile and desktop widths.
- **Repository:** `make verify`. No `POLICY_VERSION` change, and the policy-drift check
  stays clean.

## Documentation

Update `docs/architecture/ledger-export-contract.md` for the new purpose, fields, forward
placement bound and compact rendering. Its "Entry points" paragraph is already stale: it
still says Copy/Download use the legacy brief, but since #1249 and #1254 ledger mode renders
`renderLedgerExport`. Fix that in Phase 2. Also update `docs/architecture/user-flows.md` §9
and `docs/plans/README.md`.

## Owner questions (defaults applied 2026-11-14)

1. **Q1 — D-EVAL timing.** Default: the qualifying D-EVAL block starts only after Phases 1–2
   ship, because export content is an input to the planning AI. If the block is already
   running when a phase is ready, hold that phase's merge until the block ends.
2. **Q2 — Drop/move reasons (Phase 3).** Default: a fixed list (`time`, `fatigue`, `pain`,
   `equipment`, `travel`, `other`) plus optional free text, because a fixed list is easier
   for the AI to aggregate across weeks.

## Left to the builder

- Exact TypeScript type names and file split; keep files under 400 lines.
- How the UI stores the last export date, within existing preference patterns.
- Exact compact line formats, as long as they meet the rules and size target above.
- Whether Phase 1 lands as one PR or as a builder PR followed by a UI PR.
