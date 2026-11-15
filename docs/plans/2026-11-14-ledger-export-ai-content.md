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
- New training-data capture beyond an optional override reason (G3). Device-local chat
  selection and delivery confirmation are export preferences, covered by Phase 2c.

## Anti-goals

- **Hiding missingness.** ADR-0052 requires explicit missingness. Compact output may group
  missing fields into one line per item, but must never drop them silently or render them
  as zero/false.
- **Engine opinions leaking into facts.** The existing forbidden-opinion-key tests still
  hold.
- **Non-determinism in the pure builder/renderer.** "Since confirmed delivery" comes from an
  explicit input, never from a clock or a store read inside the builder.
- **A second export pipeline.** Phases 2–4 render every new output from `LedgerExport`
  (D-EXPORT: one canonical ledger schema, Markdown rendered from it). Phase 1 is the
  scoped exception chosen in the corrected design below: extend the existing
  `completed_workout_v1` session export from `CompletedWorkoutView` and render its Markdown
  view, reusing its hydration path rather than creating another pipeline.

## Constraints

- For Phases 2–4, JSON stays the canonical, full-fidelity artifact. New fields are **additive**, inside
  `ledger-export-v1`, with JSON Schema (`ledger/export/ledgerExport.schema.json`) and contract
  tests updated in the same PR. A field rename or removal would need `ledger-export-v2`;
  this design needs none.
- Ledger leaves keep `value`/`source`/`state` (+ `unit` for numbers), as today. Phase 1
  retains the existing `completed_workout_v1` shape; it does not wrap existing fields in
  ledger leaves. New availability metadata must distinguish missing from failed reads.
- Ledger JSON and both AI-facing Markdown views exclude account identity; reuse the
  existing redaction helpers and test free-text notes, titles and provider fields. Phase 1's
  existing raw-provider JSON remains a separate local diagnostic artifact, not a promise
  of identity-free AI output. Opaque occurrence references used for correlation are allowed;
  user ids, email addresses and provider account ids are not.
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

**Scope.** One completed workout (a `CompletedWorkoutView`). Executions without a reconciled
performed occurrence, including abandoned or failed-reconciliation cases, are out of scope
for Phase 1. The current morning export does not expose standalone executions;
Phase 3 adds bounded evidence for their placement outcomes. This limitation is named in the UI
copy only if an export is attempted without a view.

**Additive fields in `completed_workout_v1`.** No field is renamed or removed, so the schema
id stays.

- `exercises[].prescribed.tempo` and `exercises[].prescribed.notes`, from the authored
  `SessionStep`.
- `exercises[].choices[]`: the athlete's `ChoiceEntryPayload`s for that step, each with
  `choiceId`, `optionId`, the option's label when resolvable, and `reason`. Preserve choice
  entry ids, supersession and governing-choice references so a later correction cannot
  relabel earlier performed work. Include session-level choices without inventing a step.
- Per-set `side`, when recorded, so left/right sets remain distinguishable. Reuse the
  existing corrected-entry/tombstone handling; deleted sets are not performed work.
- `session.techniqueNote`, and `responses[]`: every `SessionResponse` linked to this
  occurrence (`window`, recorded `date`, `sessionRpe`, `completedFraction`,
  `unexpectedFatigue`, `techniqueNote`, `note`). Join via the occurrence's structured source
  refs and each response's `sourceSession`; `SessionResponse.occurrenceId` is a planning
  identity and must not be equated with `performedOccurrenceId`. Read later windows when
  exporting a historical workout, preserving source-session and response dates separately.
- `providerActivity` stays as is in JSON. Markdown uses an allow-list and redaction, with
  only the opaque trailing occurrence reference retained.

**Markdown view** (`formatCompletedWorkoutMarkdown(view, exportedAt)`, pure). Reuse
`exportCompletedWorkoutToJson` for the projection, then render that payload; do not build
a second prescription/set join. Hydrate choices, responses and their read states outside
the renderer through the existing completed-workout read path. It is a session sheet:

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
- A prescribed step with no performed sets renders as **Not performed** only when the
  structured entries were read completely. Failed or partial reads render **Unknown**;
  a completed checkoff or timed/distance entry is performed evidence even without reps.
- Escape Markdown metacharacters and embedded newlines in authored/provider text. Preserve
  read failures and missing response windows explicitly, rather than empty success lists.
- Units are always shown.
- The header carries no ids. One trailing `ref:` line holds the occurrence id, so the AI can
  correlate it with the morning export.

**Entry points:**

- **Copy for AI** (Markdown) beside the existing **Copy JSON** on the History card.
- **Copy session for AI** on each completed session row of Home's `LedgerTodayCard`
  (`LedgerSessionAiCopyButton`). While the workout is not yet readable, it says it will be
  available in History.

  _Ruling during implementation: the action is not in `SessionRunner`, because the runner
  closes right after completion unless the session has companion sessions. Home is where the
  athlete lands._

### Phase 2 — Morning update (G2)

**2a. Compact Markdown rendering** for every purpose; the JSON is unchanged.

- One line per field: `key: value unit`.
- Omit the `measured` state label only where the compact format declares it the default.
  Source is provenance, not a state: retain it once per group and on field-level exceptions.
  Keep semantic dates, units and stale observation dates visible.
- Each item ends with one `missing:` line listing absent fields and their states.
- Collections that are entirely missing render as one line.
- The `Sources` section may abbreviate successful sources already identified in groups;
  retain every failed/partial source state, omission count and truncation warning.
- **Flags:** active flags in full. Inactive and unavailable flags become one summary line
  per flag id and exact state (for example `illness_risk_symptom: inactive 2026-11-19…20`).
  Collapse only contiguous dates with the same state and compatible session scope/version;
  preserve within-day transitions. Never merge unavailable or uncaptured dates into inactive.
- The existing golden test gets a compact counterpart.
- **Size target:** at most 25% of today's 32,581 characters (at least a 75% reduction). It is
  measured on the existing fixture rendered as `morning`, with 2b content included and
  `previousContext` matching every user-context item.
- Without `previousContext`, the target is at most 40%.

The verbose table rendering stays available behind a renderer option, as a diagnostic view.
It is not exposed in the UI by default.

**2b. Today-first morning content.**

- Check-in and recovery values are shown with an available matching 28-day baseline and
  an arithmetic delta (`value - baseline`) in the same unit. Baselines exist in `derived`;
  deltas are a new projection, not an existing field. Do not invent baselines for unsupported
  metrics. Preserve readiness/missingness, and compare only matching metric/source/semantic
  dates (including D−1 steps). Add state-bearing deltas to ledger JSON before rendering them.
- Yesterday's sessions get one summary line each: title, done vs planned sets, sRPE. A
  pointer says the session report has the detail. Extend the service's current
  `{ exerciseCount, setCount }` projection with validated planned/work/warm-up counts and
  the linked session response; it cannot supply planned sets or sRPE today. Separate warm-ups
  and missing denominators, and do not sum alternatives or double-count linked provider work.
- **Upcoming sessions.** Placements get a forward bound: `asOfDate + 7` for `morning` and
  `asOfDate + 14` for `planning`, inclusive (today plus 7/14 future dates). Keep historical
  fact windows and the as-of cutoff for placement events unchanged. Extend placement bounds,
  referenced-revision retention and service hydration together; changing `buildPlacements`
  alone can drop an older revision referenced only by a future placement. Each upcoming
  placement carries, from the hash-verified stored plan revision's
  `ExternalPlanSession`:
  - `title` and `priority`;
  - `prescription.summary`;
  - per-step `notes`;
  - `scaling.fallback`.

  These are existing authored fields; no plan-schema change is needed. Add their projection
  to export inputs/schema; the current revision summary does not retain full sessions.
  Failed revision reads keep these fields unavailable. Out-of-window drops
  are counted, as undated drops already are.

  _Agent's call (builder check): there is no session-level `notes` field, so "session-level
  plan notes" means these existing fields. A new authored field would need a new
  external-plan schema version and is out of scope._

**2c. User context since the last confirmed chat delivery.** Change detection is by
**content hash**, not by date.

- Almost no user-context item has a recorded change date (`revisions` is
  `not_yet_supported`, and `updatedAt` is deliberately not trusted), so date-based change
  detection would save nothing.
- The renderer takes optional `previousContext` with `exportedOn: LocalDate`,
  `itemHashes: Record<string, string>`, a format version and per-collection selection scope
  and completeness metadata. Item keys are collection + item id. Store only hashes and
  comparison metadata, not raw context text.
- It computes a stable hash of each item's redacted semantic content, including state,
  source and meaningful dates; exclude export/read timestamps. Version the checkpoint
  format so a renderer/hash-contract change falls back to full context.
- Items whose hash matches print as one line: `userContext: <n> items unchanged since
  <exportedOn>`, followed by their ids.
- New and changed items print in full. A failed or truncated read means unknown, not
  deletion: it keeps the prior hashes for that collection and renders its missingness. An item
  absent under a complete read is `removed` when its selection date is still within the
  current selection bound. It is `out of scope now`, reported once and then dropped from the
  checkpoint, when its date fell before the new window start. Do not abbreviate unreadable
  items as unchanged.
  _Agent ruling during Phase 2 implementation (2026-11-14); owner to confirm in PR review._
- Without `previousContext`, everything prints in full.
- The JSON always carries the full user context. Only the Markdown is abbreviated.
- Copying or downloading alone never advances the checkpoint. After pasting into the
  intended chat, the user explicitly confirms "Added to this chat" for that export. Only
  then does the UI store that export's date and item hashes on the device (local storage),
  scoped by authenticated user, selected chat and purpose. Confirm the exported snapshot,
  not content recomputed after copying. Chat selection is a local label, not an integration
  with the external AI service; it and the user id are never included in the export.
  - No selected chat or no confirmed checkpoint means full context. Starting or switching
    to a new chat must not reuse another chat's checkpoint; another user's checkpoint is
    never read. A visible "include full context" toggle ignores prior checkpoints.
  - Losing that store only means the next export is full. Nothing is written to Firestore,
    so there is no rules impact.
  - Bind confirmation to the captured user/chat/purpose and snapshot. Account/chat changes
    invalidate pending confirmation; an older export must not overwrite a newer checkpoint.
  - The builder and renderer stay pure: the hashes are an explicit input.

_Agent's call (builder check): a content hash works with the data that exists today; dates
would need new change tracking in Firestore._

### Phase 3 — Coaching continuity (G3)

- **Outcome of past placements.** Each placement dated before `asOfDate` gets a derived
  `outcome` in the export only; nothing is written back. Today is never classified. Rules,
  first match wins:
  1. A valid, hash-verified planned→performed link exists → `performed`.
  2. Placements, executions or links are not complete and readable, a placement was removed,
     or a relevant link was discarded for a hash mismatch → `unknown`.
  3. Placement status `completed` or a completed execution with no link → `done_unlinked`.
  4. An execution of that plan session exists that is started or abandoned →
     `started_not_completed`.
  5. Placement status `dropped` or `superseded` → that status.
  6. Otherwise → `missed`.

  `missed` is only asserted when every source was read and nothing points to the session
  having been done. Preserve placement status separately from outcome: a moved session is
  evaluated on its as-of assigned date, and a later drop must not hide performed evidence.
  Match executions by plan id, revision, session id and verified content hash, not title.
  Add bounded execution evidence and read-completeness state to the pure builder inputs;
  the service currently reads executions but exports only occurrence-linked summaries.
  If the read window cannot establish absence for a placement, its outcome is `unknown`.

  _Agent's call (builder check): a wrong `missed` would be a fabricated fact, so every
  uncertain case resolves to a weaker state._
- **Swaps and omissions** from Phase 1 choice data also appear in `coachingHistory.overrides`
  as `swapped` / `omitted`, with the step, the replacement and the existing
  `ChoiceEntryPayload.reason`. Resolve the choice against its pinned definition before
  classifying it; not every option selection is a swap or omission. Unresolved options keep
  explicit missingness. Use stable entry identities so corrections are not duplicate overrides.
- **Override reason capture** is new only for **dropping or moving a placement**: an optional
  reason on the placement overlay and its immutable placement event, saved atomically.
  Historical exports read the reason as of the event, never a later overlay value.
  - It touches the external-plans rules (`03-external-plans`), write validators, event
    readers and export projection. Check the current compiled-rules budget (ADR-0053).
  - Legacy records stay `not_yet_supported`; a supported optional reason left blank is
    `not_recorded`. Preserve this distinction in the JSON and Markdown.
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
- **Checkpoint:** copy/download without confirmation leaves dates and hashes unchanged;
  confirmation records the exported snapshot for only the selected user/chat/purpose;
  missing checkpoints, a new user/chat and "include full context" render full context.
  Cover failed/truncated collection reads, moving windows, hash-version changes, account
  switches and out-of-order confirmations; none may fabricate removal or advance stale state.
- **Evidence boundaries:** unreadable sets versus unperformed steps; response linkage via
  source refs; same-day corrected choices and left/right sets; moved-then-performed and
  completed-but-unreconciled placements; future placements referencing older revisions;
  incomplete execution windows; semantic-date baseline joins and flag state transitions.
- **Goldens:**
  - existing verbose goldens, which stay byte-identical where the content did not change;
  - new compact goldens for morning, planning and session;
  - a size assertion for the compact morning export.
- **Browser E2E:** session export from the Home completed-session row and from History, and the
  morning export with upcoming sessions, at mobile and desktop widths.
- **Repository:** `make verify`. No `POLICY_VERSION` change, and the policy-drift check
  stays clean.

## Documentation

Update `docs/architecture/ledger-export-contract.md` for the new fields, forward placement
bound and compact rendering; no new ledger purpose is introduced. Document the separate
Phase 1 session format and its privacy boundary. Its "Entry points" paragraph is already stale: it
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
- How the UI stores the confirmed chat checkpoint, within existing preference patterns
  and the user/chat/purpose scoping required by Phase 2c.
- Exact compact line formats, as long as they meet the rules and size target above.
- Whether Phase 1 lands as one PR or as a builder PR followed by a UI PR.
