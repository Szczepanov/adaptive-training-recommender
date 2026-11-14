# Compact morning update (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A morning ledger export small enough to paste into one long-lived AI chat every day. It is today-first, shows the next 7 days of planned sessions, and abbreviates user context that has not changed since the last export.

**Architecture:**
- Additive `ledger-export-v1` schema fields add the upcoming-session content and a forward placement bound.
- A new pure compact Markdown renderer produces the morning text, with a stable per-item hash for user-context change detection.
- `ContextBriefService` uses the compact renderer in ledger mode. The brief screen keeps the last export's item hashes per purpose on the device.
- The verbose renderer stays as a diagnostic view.

**Tech Stack:** React + TypeScript, Vitest (golden files via `toMatchFileSnapshot`), Playwright with Firebase emulators.

**Spec:** `docs/plans/2026-11-14-ledger-export-ai-content.md`, Phase 2 (PR #1257; read it with `git show docs/ledger-export-ai-content:docs/plans/2026-11-14-ledger-export-ai-content.md` until it merges).

## Global Constraints

- **The JSON stays canonical and full-fidelity.** New fields are additive in `ledger-export-v1`. `ledgerExport.schema.json`, `LEDGER_EXPORT_FIELDS`, `LEDGER_RECORD_FIELD_KEYS` and the contract tests are updated in the same task.
- **Every leaf keeps `value`/`source`/`state`** (plus `unit` for numbers).
- **Missingness is never hidden.** Compact output groups missing fields into one `missing:` line per item, and never renders them as zero or false.
- **No engine opinions.** The forbidden-opinion-key tests still pass.
- **Pure builder and renderer.** No clock, store or IO inside them. "Since last export" is an explicit input.
- **No `engine/` import from `ledger/`** (boundary test). No `POLICY_VERSION` change.
- **Warsaw dates only** (`getLocalDateString`, `addDaysToLocalDateString`).
- **No identity** (user id, e-mail, account id) in output. The existing redaction tests apply to new free-text fields.
- **Forward placement bound:** `morning` is `asOfDate + 7`, `planning` is `asOfDate + 14`, `diagnostic` is unchanged. Past-facts windows are unchanged.
- **Size targets (fixture morning export):**
  - compact with `previousContext` matching every user-context item: ≤ 8,145 characters (25% of 32,581);
  - compact without `previousContext`: ≤ 13,032 characters (40%).
- Files stay under 400 lines; split modules by responsibility.

## Review Focus

1. **A user-context item whose hash matches but whose id is new.** It is new, so it prints in full.
2. **A placement dated today.** It appears under Today, not Upcoming, and is never duplicated.
3. **A plan revision with sessions that fail the hash check.** Upcoming placements from it show `state: invalid`, with no session content.
4. **A check-in with no baseline yet.** The value prints with `baseline: missing`, never a delta of the value itself.
5. **The previous-context store unreadable** (localStorage throws). The export is full and the copy still works.

---

### Task 1: Upcoming placements carry session content (schema + builder + service)

**Files:**
- Modify:
  - `app/src/ledger/export/schema.ts` (`PLACEMENT_FIELDS`, `LedgerCollection`);
  - `app/src/ledger/export/ledgerExport.schema.json`;
  - `app/src/ledger/export/inputs.ts` (`PlanRevisionInput`);
  - `app/src/ledger/export/window.ts`;
  - `app/src/ledger/export/buildCoachingHistory.ts` (`buildPlacements`);
  - `app/src/services/ledgerExportService.ts` (`readPlans`).
- Test:
  - `app/src/ledger/export/ledgerExportBounds.test.ts`;
  - `app/src/ledger/export/buildLedgerExport.test.ts`;
  - `app/src/ledger/export/ledgerExportContract.test.ts`;
  - the service test that covers `readPlans`, if present.

**Interfaces (produces):**
- `PLACEMENT_FIELDS` gains `'title', 'priority', 'summary', 'stepNotes', 'fallback'`.
- `PlanRevisionInput` gains `sessions?: { id: string; title: string; priority?: string; summary?: string; stepNotes?: string[]; fallback?: string }[]`. `readPlans` fills it from the verified plan's `sessions` (`ExternalPlanSession`): `title`, `priority`, `prescription.summary`, the non-empty `prescription.steps[].notes`, and `scaling.fallback`. Check the real field names in `engine/models.ts` and the v6 types, and map whatever exists. A missing field gives a `not_recorded` leaf.
- `export const PLACEMENT_FORWARD_DAYS: Readonly<Record<LedgerPurpose, number>> = { morning: 7, planning: 14, diagnostic: 0 }` in `window.ts`.
- `buildPlacements` bounds rows by `[window.startDate, addDays(window.endDate, PLACEMENT_FORWARD_DAYS[purpose])]`.
- Session content fields are joined from the matching `PlanRevisionInput.sessions` row by `planId`, `revision` and `sessionId`.
- If the revision is not in `planRevisions` (unverified or invalid), the content fields are `state: 'invalid'` when `sources.external_plan_revisions` is invalid, and `'unavailable'` otherwise.
- `LedgerCollection` gains optional `droppedOutOfWindow?: number`. It is set only on `coachingHistory.placements` and counts rows dropped by the bounds.
- `overrides` keep their current bounds.

- [ ] **Step 1:** Write the failing tests:
  - `includes a placement dated asOfDate+7 in morning and excludes +8`;
  - `planning reaches asOfDate+14`;
  - `joins title, priority, summary, stepNotes and fallback from the plan revision`;
  - `marks content invalid when the revision failed verification`;
  - `counts out-of-window placements in droppedOutOfWindow`;
  - the contract test, updated for the new field keys.
- [ ] **Step 2:** Run `cd app && npx vitest run src/ledger/export` and confirm the new tests fail.
- [ ] **Step 3:** Implement per the Interfaces above.
- [ ] **Step 4:** Rerun `npx vitest run src/ledger src/services/ledgerExportService` and `npx tsc -b`. The existing verbose golden (`renderLedgerExport.golden.md`) will change only through the new placement fields. Review the diff by eye, then update the golden with `-u`.
- [ ] **Step 5:** Commit `feat(ledger): export upcoming placements with session content`.

### Task 2: Compact renderer core

**Files:**
- Create:
  - `app/src/ledger/export/compact/renderLedgerExportCompact.ts` (entry and section assembly);
  - `app/src/ledger/export/compact/compactLines.ts` (field and missing-line formatting);
  - the goldens `compact/morning.golden.md` and `compact/planning.golden.md`.
- Test: `app/src/ledger/export/compact/renderLedgerExportCompact.test.ts`.

**Interfaces:**
- Consumes: `LedgerExport` (Task 1 shape).
- Produces: `renderLedgerExportCompact(ledger: LedgerExport, options?: CompactRenderOptions): string`.
  - `CompactRenderOptions` is `{ previousContext?: PreviousContext }`. `PreviousContext` is defined in Task 4; for now declare the type as `{ exportedOn: string; itemHashes: Readonly<Record<string, string>> }` in `compact/previousContext.ts` and import it.
- Reuse the escaping in `renderLedgerExport.ts` `text`. Move it to `ledger/export/markdownText.ts` and import it from both renderers, keeping the verbose output byte-identical.

**Rules (fixed by the spec):**
- **Header** (4 lines): `# Ledger update — <asOfDate> (<purpose>)`, `schema: ledger-export-v1 · exportedAt <iso>`, `window: <start>…<end>`.
- **Field lines:** `<key>: <value><space+unit if any>`, with ` (<source>, <state>)` only when the state is not `measured`. Values are escaped with `text`.
- **Missing fields:** each item ends with `missing: <key> (<state>), …` listing every field that is not measured and has a null value. Leave the line out when there are none.
- **Empty collections:** a collection whose state is not `measured`, or that has zero items, renders as one line, `<name>: <state>, no rows`.
- **`Sources`:** only sources whose state is not `measured`, one line each; if all are measured, `sources: all measured`.
- **Flags:**
  - active flags in full: id, observedOn, sessionRef, threshold, and the inputs as compact fields;
  - every other flag id becomes one summary line, `<id>: <inactive|unavailable|…> <firstDate>…<lastDate>`, grouping consecutive dates with the same state.
- Section order: `## Flags`, `## Facts`, `## Derived`, `## User context`, `## Coaching history`. Task 3 adds Today/Yesterday/Upcoming ahead of these and removes duplicates.

- [ ] **Step 1:** Write the failing tests:
  - `renders morning compact golden`;
  - `renders planning compact golden`;
  - `lists missing fields on one line and never prints 0 for null`;
  - `summarises inactive flags per id with date ranges`;
  - `prints only non-measured sources`;
  - `escapes markdown in values` (reuse a hostile-string case from the verbose tests);
  - `keeps the verbose golden byte-identical` (the existing verbose golden test must still pass after the `text` move).
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Generate the goldens with `-u`, review them by eye against the rules, rerun, and run `npx tsc -b`.
- [ ] **Step 5:** Commit `feat(ledger): compact Markdown renderer for the ledger export`.

### Task 3: Today-first sections

**Files:**
- Create: `app/src/ledger/export/compact/todaySections.ts`.
- Modify: `compact/renderLedgerExportCompact.ts`.
- Test: `compact/todaySections.test.ts`, and the updated goldens.

**Interfaces:**
- Produces: `renderTodaySections(ledger: LedgerExport): { lines: string[]; consumedIds: ReadonlySet<string> }`. The ids are record ids already shown, which the later sections skip so nothing is printed twice.

**Content (spec, Phase 2b):**
- **`## Today (<asOfDate>)`:**
  - Today's check-in fields, each with its 28-day baseline and delta, for example `readiness: 6 (28d 7.2, −1.2)`. Use `subjective_baselines.metrics['<field>_longAvg']`.
  - Today's recovery fields, the same way: `sleepScore`, `restingHr`, `hrvOvernightAvg` and `respirationAvg` against `<x>28dAvg`. The mapping is sleepScore→`sleepScore28dAvg`, restingHr→`restingHr28dAvg`, hrvOvernightAvg→`hrv28dAvg`, respirationAvg→`respiration28dAvg`.
  - A missing baseline prints `(28d baseline: <state>)`, with no delta.
  - Active flags for today.
  - Placements dated today: title, status, summary.
- **`## Yesterday (<date>)`:** one line per performed occurrence dated yesterday:
  `<modality> <durationMin> min · <exerciseCount> exercises / <setCount> sets · sRPE <n> · <executedDefinition>`.
  Join the sRPE from `sessionResponses` by `occurrenceId`, and the planned session title from `plannedToPerformed` + `placements`. Add `detail: copy the session report from History` when structured entries exist. Absent parts print `<name>: not recorded`.
- **`## Upcoming (<asOfDate+1>…<end>)`:** one block per placement after today, in date order:
  - `<date> <title> [<priority>] (<status>)`;
  - `summary:` when present;
  - one `note:` line per step note;
  - `fallback:` when present;
  - invalid or unavailable content prints `content: <state>`.

- [ ] **Step 1:** Write the failing tests:
  - `prints check-in value with 28d baseline and delta`;
  - `prints missing baseline state without a delta`;
  - `renders yesterday's session line with sRPE from responses`;
  - `lists upcoming placements in date order with notes and fallback`;
  - `today's placement appears under Today only`;
  - `records consumed ids so later sections do not repeat them`.
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3:** Implement. Extend the fixture in `ledgerExportFixtures.testSupport.ts` only additively, with a future placement plus session content, so existing goldens change only where Task 1 already changed them.
- [ ] **Step 4:** Regenerate the compact goldens and review them.
- [ ] **Step 5:** Commit `feat(ledger): today-first sections in the compact export`.

### Task 4: Abbreviate unchanged user context

**Files:**
- Create: `app/src/ledger/export/compact/previousContext.ts`.
- Modify: `compact/renderLedgerExportCompact.ts`.
- Test: `compact/previousContext.test.ts`.

**Interfaces:**
- `export interface PreviousContext { exportedOn: string; itemHashes: Readonly<Record<string, string>> }`.
- `export function userContextItemHashes(ledger: LedgerExport): Record<string, string>`.
  - Keys are `<collection>/<item id>`. A single-record context (equipment, environment, guardrails, preferences) uses `<name>`; `trainingDislikes` uses `trainingDislikes`.
  - Values are a deterministic hash of the item's exported JSON with sorted keys (a 32-bit FNV-1a hex is enough; no crypto). `observedOn` and `exportedAt`-like volatile fields are excluded.
- Renderer: with `previousContext`, items whose key and hash both match are collected into one line, `unchanged since <exportedOn>: <n> items (<key>, <key>, …)`.
  - New or changed items print in full.
  - Keys present before but absent now print `removed: <key>`.
  - Without `previousContext`, everything prints in full.

- [ ] **Step 1:** Write the failing tests:
  - `hash is stable across key order`;
  - `unchanged items collapse into one line`;
  - `a changed field prints the item in full`;
  - `a new id prints in full even if another item shares its hash`;
  - `removed keys are listed`;
  - `morning compact with matching previousContext is ≤ 8,145 chars and without it ≤ 13,032 chars` (fixture size assertions).
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun the tests and `npx tsc -b`. If a size target fails, tighten the compact formatting rules within the spec; do not drop data. If that still does not meet the target, stop and report the measured sizes.
- [ ] **Step 5:** Commit `feat(ledger): abbreviate user context unchanged since the last export`.

### Task 5: Brief screen wiring

**Files:**
- Modify:
  - `app/src/services/contextBriefService.ts` (ledger-mode branch of `build`);
  - `app/src/components/DataView.tsx` (`renderContextBrief`, `copyBrief`, `downloadBrief`).
- Create:
  - `app/src/components/briefPreviousContext.ts` (local-storage read/write, `try/catch`, key `adaptive-training:context-brief:previous-context:<purpose>`).
- Test: `contextBriefService.ledgerMode.test.ts`, `briefPreviousContext.test.ts`.

**Interfaces:**
- `ContextBriefService.build` options gain `previousContext?: PreviousContext` and `fullContext?: boolean`.
- In ledger mode it returns `text: renderLedgerExportCompact(ledger, { previousContext: fullContext ? undefined : previousContext })` and a new result field, `contextItemHashes: Record<string, string>`, from `userContextItemHashes(ledger)`.
- Engine mode is unchanged.
- `briefPreviousContext.ts` exports:
  - `readPreviousContext(purpose): PreviousContext | undefined` — any storage error or malformed JSON gives `undefined`;
  - `writePreviousContext(purpose, value): void` — errors are swallowed.
- `DataView`:
  - passes `readPreviousContext(purpose)` into `build`;
  - adds an **Include full context** checkbox (default off) next to the preset toggle;
  - after a successful copy or download of the Markdown, writes `{ exportedOn: asOfDate, itemHashes: contextItemHashes }` for that purpose;
  - **Download JSON** and **Export ledger (JSON)** stay full and unchanged.

- [ ] **Step 1:** Write the failing tests:
  - `ledger mode returns compact text and item hashes`;
  - `fullContext ignores previousContext`;
  - `engine mode output unchanged`;
  - `readPreviousContext returns undefined when storage throws or JSON is malformed`;
  - `writePreviousContext swallows errors`.
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/services src/components src/ledger`, `npx tsc -b` and eslint on the changed files.
- [ ] **Step 5:** Commit `feat(brief): compact ledger export with unchanged-context abbreviation`.

### Task 6: E2E and docs

**Files:**
- Modify or create an E2E spec under `app/tests/e2e/`. Use `playwright.e2e.config.ts` with the emulators wrapper, as the existing ledger-mode specs run. Extend the ledger-mode export spec if there is one; otherwise create `brief-compact-morning.pw.ts`.
- Docs:
  - `docs/architecture/ledger-export-contract.md`: the new placement fields and forward bound, `droppedOutOfWindow`, the compact renderer, and the previous-context abbreviation. Also fix the stale "Entry points" paragraph that still says Copy/Download use the legacy brief.
  - `docs/architecture/user-flows.md` §9.
  - The Phase 2 status in this plan's header. Do not edit `docs/plans/README.md` here, because #1258 adds the row; avoid the conflict and note it in the PR.

- [ ] **Step 1:** Write the E2E: seed a ledger-mode user with today's check-in, a completed session yesterday, and a plan placement at +3 days. Copy the morning brief (grant clipboard permissions) and assert it contains `## Today`, `## Yesterday`, `## Upcoming` and the +3-day session title.
  - Copy again (the second export) and assert `unchanged since` appears.
  - Tick **Include full context** and assert it does not appear.
  - Run it at one desktop viewport and one at 390 px.
- [ ] **Step 2:** Run it; on a known Windows infra flake, rerun once and report both runs.
- [ ] **Step 3:** Update the docs (symbols only, no line numbers).
- [ ] **Step 4:** Commit `test(e2e): compact morning brief; docs`.
