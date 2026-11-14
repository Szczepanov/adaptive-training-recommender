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
2. **A finished session is close to invisible.** `performedTraining.structuredEntries` is
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
  planned-vs-performed account of that session.
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
- The ledger module boundary test forbids engine imports. Planned-vs-performed matching uses
  `sessions/` data, not `engine/`.
- Warsaw dates (I2): every date uses `getLocalDateString`/`addDaysToLocalDateString`.
- **D-EVAL timing:** export content is an input to the planning AI. Changing it during the
  qualifying block changes what is being evaluated. Phases 1 and 2 should ship before the
  block starts (see open question Q1).

## Approaches considered

1. **New `session` purpose inside the ledger export (chosen).** It reuses the schema,
   provenance, missingness, redaction, contract tests and the Markdown renderer. It is one
   canonical source, as D-EXPORT intends. Cost: schema and test additions.
2. **A separate Markdown renderer built from session data.** Faster to build, but it is a
   second export path that drifts from the ledger and skips its missingness and redaction
   guarantees. Rejected.
3. **Making the existing per-workout "Copy JSON" richer.** Raw documents, no provenance or
   prescription join, no Markdown. Rejected as the main path. It may stay as a debug aid.

Recommended by the agent; the owner said "proceed" on 2026-11-14.

## Design

### Phase 1 — Session report (G1)

**Purpose and scope.** Add a `session` purpose. Its scope is **one structured execution**,
not a date window:

- `BuildLedgerExportInput` takes a `focus: { executionId }`.
- The canonical performed occurrence (`SessionExecution.performedOccurrenceId`) is joined
  when it exists.
- When it does not exist (an abandoned execution, or a completion whose reconciliation
  failed), the report still renders from the execution. The occurrence is shown with an
  explicit `not_recorded` state, never omitted.
- A Garmin-only activity with no structured execution is out of scope for `session`; it
  appears in the morning/planning exports as today.
- `window` is the execution's local date, and the header names the execution and session.

_Agent's call (builder check): keyed on the execution, because performed occurrences exist
only for completed executions whose reconciliation succeeded._

The five layers stay. Facts carry only that session plus same-day context (check-in,
recovery, flags). User context includes **all** active injuries, constraints, guardrails and
equipment, unfiltered.

_Agent's call: unfiltered. Filtering by region would need body-region mapping data that lives
in `engine/`, which the ledger boundary forbids, and too narrow a filter would hide a safety
constraint._

**New fact: `sessionDetail`.** It is attached to the performed occurrence, in `facts`:

- `executions[]`: `state`, `startedAt`, `completedAt`, `executedDefinition`, `notes`,
  execution `sessionRpe`.
- `steps[]`, in prescription order, one per prescribed step plus added steps:
  - **Prescribed** (from `ExecutionPrescription`/`SessionDefinition`): exercise name,
    dose (sets × reps / duration / distance), load target, effort target (RIR/RPE),
    rest seconds, tempo.
  - **Performed:** ordered entries, each with set index, reps / duration / distance,
    `weightKg`, gauge (scale + value), `isWarmup`, `side`, and whether it was corrected.
    Tombstoned entries are excluded and counted.
  - **Choice:** `select_alternative` (with the alternative's name), `omit_step`,
    `reduce_*`, or `added`.
  - **Rest:** prescribed vs actual seconds per rest event, with `endReason`.
- `provider`: the Garmin activity linked through `sourceRefs`, if any. It carries
  duration, average/max HR, training load, training effect (aerobic/anaerobic), time in HR
  zones, and laps/segments (uncapped for this one activity). If no link exists yet, state
  `not_recorded` with reason `awaiting_provider_sync`.

`sessionResponses` for the occurrence are included in full, as today.

**Markdown rendering for `session`** is a readable session sheet, not field tables:

```
## Back Squat — planned 3×5 @ 100 kg, RIR 2, rest 180 s
warm-up: 8 @ 40, 5 @ 70
1: 5 @ 100, RIR 2 · rest 200 s
2: 5 @ 100, RIR 1 · rest 240 s
3: 4 @ 100, RIR 0
## Romanian Deadlift — swapped to: Hip Thrust (select_alternative)
...
missing: tempo (not_recorded)
```

**Entry points:**

- an **Export session for AI** action on the completion sheet, after the session response
  is saved (Copy Markdown, Download JSON);
- the same action on a completed session in History, so the report can be re-exported
  once Garmin data arrives.

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
