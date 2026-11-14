# Session report for AI (Phase 1) Implementation Plan

**Status:** Phase 1 implemented on branch `feat/ledger-export-session-report` (PR pending). Phases 2–4 are planned separately.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a session, one tap copies a compact, planned-vs-performed Markdown session report for the external AI chat.

**Architecture:** Extend the existing per-workout export (`completed_workout_v1`, built from the History read model `CompletedWorkoutView`) with the missing fields. Add a pure Markdown view of the same export. Wire a **Copy for AI** action on the History card and in the runner's post-completion state. No ledger-export or engine change.

**Tech Stack:** React + TypeScript, Vitest, Playwright (browser E2E, Firebase emulators).

**Spec:** [`docs/plans/2026-11-14-ledger-export-ai-content.md`](./2026-11-14-ledger-export-ai-content.md), Phase 1 (corrected).

## Global Constraints

- Additive only. `COMPLETED_WORKOUT_EXPORT_SCHEMA` stays `'completed_workout_v1'`; no existing field is renamed or removed, and existing `completedWorkoutJsonExport.test.ts` expectations still pass.
- No `engine/` decision-path change, and no `POLICY_VERSION` change.
- Missing values are named, never rendered as `0`, `false` or empty.
- No user id, e-mail or provider account id in the Markdown. Provider fields are selected explicitly, never dumped.
- Dates use the Warsaw helpers (`getLocalDateString`); no `toISOString().split('T')[0]` (I2).
- Files stay under 400 lines; split a new module if needed.
- Run `cd app && npm test` while iterating, and `make verify` before the PR.

## Review Focus

1. **A choice entry with no `stepId`.** It must still attach to its step, via the definition's `optionSets[].appliesAtStepId` matched by `choiceId`.
2. **A tombstoned entry** (`deletedAt` set). It never appears as a set in JSON or Markdown.
3. **A prescribed step with zero performed sets.** It renders as **Not performed** with its prescription, and is not omitted.
4. **A Garmin-only workout** (no `structured`). The Markdown renders the provider summary and says that no structured log exists, without throwing.
5. **A response read that fails.** The copy still succeeds, with a `responses: unavailable` line; responses are never silently dropped.

---

### Task 1: Prescription tempo/notes and step choices in the step detail

**Files:**
- Modify: `app/src/training-occurrence/structuredSetDetail.ts`
- Test: `app/src/training-occurrence/structuredSetDetail.test.ts`

**Interfaces:**
- Produces:
  - `PrescribedStepTarget` gains `tempo?: string; notes?: string`, copied from `SessionStep.tempo` / `SessionStep.notes`.
  - `StructuredStepDetail` gains `choices?: StepChoiceDetail[]`.
  - `export interface StepChoiceDetail { choiceId: string; optionId: string; optionLabel?: string; reason?: string; completedAt: string }`.
  - Choices attach to `entry.stepId` when set; otherwise to the `SessionChoice.appliesAtStepId` whose `id === payload.choiceId` in any block's `optionSets`. A choice that resolves to no step is dropped from steps. `optionLabel` is the matching `SessionOption.label`.
  - Entries with `deletedAt` are excluded from sets and choices.

- [ ] **Step 1: Write failing tests** in `structuredSetDetail.test.ts`:
  - `copies tempo and notes into the prescribed target`: a step with `tempo: '31X0'`, `notes: 'brace'` gives `prescribed.tempo === '31X0'` and `prescribed.notes === 'brace'`.
  - `attaches a choice entry to its step with label and reason`: given a definition block with `optionSets: [{ id: 'c1', appliesAtStepId: 'squat', options: [{ id: 'o2', label: 'Goblet squat', actions: [] }], trigger: {...} }]` and a choice entry `{ stepId: undefined, payload: { kind: 'choice', choiceId: 'c1', optionId: 'o2', reason: 'knee' } }`, the `squat` detail has `choices` equal to `[{ choiceId: 'c1', optionId: 'o2', optionLabel: 'Goblet squat', reason: 'knee', completedAt }]`.
  - `excludes tombstoned entries from sets and choices`: an entry with `deletedAt: '2026-11-14T10:00:00Z'` produces no set row and no choice.
- [ ] **Step 2: Run them and confirm they fail.** Run `cd app && npx vitest run src/training-occurrence/structuredSetDetail.test.ts`; expect 3 failures.
- [ ] **Step 3: Implement** in `structuredSetDetail.ts` per the Interfaces block.
- [ ] **Step 4: Rerun the test file.** Expect all tests to pass, including the existing ones.
- [ ] **Step 5: Commit** with `feat(history): carry tempo, notes and choices in structured step detail`.

### Task 2: Additive `completed_workout_v1` fields

**Files:**
- Modify: `app/src/training-occurrence/completedWorkoutJsonExport.ts`
- Test: `app/src/training-occurrence/completedWorkoutJsonExport.test.ts`

**Interfaces:**
- Consumes: Task 1 `PrescribedStepTarget.tempo/notes` and `StructuredStepDetail.choices`.
- Produces:
  - `ExportedPrescription` gains `tempo?: string; notes?: string`.
  - `ExportedExercise` gains `choices?: StepChoiceDetail[]`.
  - `CompletedWorkoutExport` gains `responses?: ExportedSessionResponse[] | 'unavailable'`.
  - `export interface ExportedSessionResponse { window: SessionResponse['window']; sessionRpe?: number; completedFraction?: number; unexpectedFatigue?: boolean; techniqueNote?: string; note?: string }`.
  - New signature: `exportCompletedWorkoutToJson(view: CompletedWorkoutView, exportedAt: string, responses?: readonly SessionResponse[] | 'unavailable'): CompletedWorkoutExport`. `formatCompletedWorkoutJson` gains the same optional third parameter.
  - `responses` is omitted when the argument is `undefined`, so existing callers and snapshots are unchanged. Responses are ordered `immediate`, `later_day`, `next_morning`, then by `createdAt`.

- [ ] **Step 1: Write failing tests:**
  - `exports prescribed tempo and notes`.
  - `exports step choices`.
  - `includes responses in window order and omits the key when not supplied`.
  - `marks responses unavailable`: the argument `'unavailable'` gives `responses === 'unavailable'`.
- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run src/training-occurrence/completedWorkoutJsonExport.test.ts`.
- [ ] **Step 3: Implement** per the Interfaces block.
- [ ] **Step 4: Rerun the test file.** Expect all to pass, and existing expectations unchanged.
- [ ] **Step 5: Commit** with `feat(history): add choices, tempo, notes and responses to completed_workout_v1`.

### Task 3: Markdown session report

**Files:**
- Create: `app/src/training-occurrence/completedWorkoutMarkdown.ts`
- Test: `app/src/training-occurrence/completedWorkoutMarkdown.test.ts`, with golden file `app/src/training-occurrence/completedWorkoutMarkdown.golden.md`

**Interfaces:**
- Consumes: `exportCompletedWorkoutToJson` from Task 2. Render from its output, so JSON and Markdown cannot disagree.
- Produces: `formatCompletedWorkoutMarkdown(view: CompletedWorkoutView, exportedAt: string, responses?: readonly SessionResponse[] | 'unavailable'): string`.

**Line format (fixed by the spec):**
- Header: `# Session: <title> — <localDate> (<executedDefinition ?? 'definition unknown'>, <state>)`.
- Summary line: `duration: <min> min (<source>) · sRPE <n> · completed <pct>% · fatigue: yes|no`. Each absent part reads `<name>: not recorded`.
- `note:` line, only when present.
- Per exercise:
  - Heading: `## <name> — planned <sets>×<reps|s|m> @ <load>, RIR|RPE <target>, rest <s> s, tempo <t>`. Only parts present in the prescription are printed.
  - Swapped: `## <plannedName> — swapped to <name>`.
  - Unplanned: `## Added: <name> (unplanned)`.
  - A prescribed step with no sets: `## Not performed: <name> (planned …)`.
  - `notes:` line from the prescription, when present.
  - One `choice:` line per choice: `<optionLabel ?? optionId>` plus ` (reason: <reason>)` when a reason exists.
  - `warm-up:` line listing warm-up sets as `<reps> @ <kg> kg`, comma-separated.
  - Work sets as `<n>: <reps> @ <kg> kg[, RIR x | RPE x][ · rest <actual> s]`. Duration sets use `<s> s` and distance sets `<m> m`, with `@ <kg> kg` when a load exists.
- Garmin line, only when `providerActivity` is present: `Garmin: <durationMin> min · avg HR <n> · max HR <n> · load <n>`, plus `· TE <aerobic>/<anaerobic>` when those fields exist on the activity. Never dump the raw object.
- When there is no structured log: `structured log: none (provider recording only)`.
- `responses:` — one line per response: `<window>: sRPE …, fatigue …, technique: …, note: …`. When unavailable: `responses: unavailable`.
- `missing:` — one final line naming absent sections (for example `performed rest (not_recorded)`), only when something is absent.
- Last line: `ref: <performedOccurrenceId>`.

- [ ] **Step 1: Write a failing golden test.** `renders the session sheet` builds a view with a swapped step, an unplanned step, a not-performed step, warm-ups, rest, a choice with a reason, Garmin data and two responses, then runs `expect(md).toMatchFileSnapshot('./completedWorkoutMarkdown.golden.md')`.
- [ ] **Step 2: Write the remaining failing tests:**
  - `renders a provider-only workout without a structured log`.
  - `prints responses: unavailable`.
  - `never prints zero for missing sRPE`: the output contains `sRPE: not recorded` and does not contain `sRPE 0`.
  - `contains no user id`: a view with `garmin.userId`/`activityId` set does not contain those strings, except the occurrence id on the `ref:` line.
- [ ] **Step 3: Run them and confirm they fail.**
- [ ] **Step 4: Implement** `completedWorkoutMarkdown.ts`.
- [ ] **Step 5: Run with `-u` once to write the golden, review the golden by eye against the format above, then rerun without `-u`.** Expect all to pass.
- [ ] **Step 6: Commit** with `feat(history): add Markdown session report for AI`.

### Task 4: Copy for AI on the History card

**Files:**
- Modify: `app/src/components/CompletedWorkoutList.tsx` (the copy handler near `handleCopy` and the button group with `btn-copy-activity-json`).
- Test: the existing `CompletedWorkoutList` test file, if there is one; otherwise pure-function tests of a new helper `app/src/components/completedWorkoutCopy.ts`. There is no DOM harness for every component, so follow the existing pattern.

**Interfaces:**
- Consumes: `formatCompletedWorkoutMarkdown` (Task 3) and `sessionResponseService.getResponsesForSource(userId, { kind: 'execution', id: executionId })`.
- Produces: `buildWorkoutAiCopy(view: CompletedWorkoutView, exportedAt: string, loadResponses: (executionId: string) => Promise<SessionResponse[]>): Promise<string>`, in `completedWorkoutCopy.ts`. A rejected load maps to `'unavailable'`; a view with no execution passes `undefined`.
- **UI:**
  - A **Copy for AI** button beside **Copy JSON**, with the same visibility condition and the same copied-state pattern (`✓ Copied for AI`).
  - The **Copy JSON** button also passes the responses, so both outputs carry them.
  - Errors use the list's existing copy-error handling.

- [ ] **Step 1: Write failing tests** for `buildWorkoutAiCopy`:
  - `passes responses to the markdown`.
  - `maps a rejected response read to responses: unavailable`.
  - `skips the response read when the view has no execution`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the helper and the button.** The component receives `userId` the way it already receives it for other actions; if it does not, thread `loadResponses` in as a prop from the parent that owns `userId`.
- [ ] **Step 4: Run the tests, then `npx tsc -b` and `npx eslint` on the changed files.** Expect them clean.
- [ ] **Step 5: Commit** with `feat(history): copy a session report for AI from the History card`.

### Task 5: Copy for AI after finishing a session

> **Entry-point ruling (as built):** the post-session action is not in `SessionRunner`, which closes right after completion unless companions exist. It is a **Copy session for AI** button (`LedgerSessionAiCopyButton`) on completed session rows of Home's `LedgerTodayCard`; the History card keeps **Copy for AI**. The runner-based text below is superseded.

**Files:**
- Modify: `app/src/components/session/SessionRunner.tsx`, in the post-completion state where `companionPrompt` is handled and the no-active-session view renders.
- Test: a pure helper `app/src/components/session/postCompletionAiCopy.ts` with `.test.ts`.

**Interfaces:**
- Consumes: `getCompletedWorkoutsInRange` and `buildWorkoutAiCopy` (Task 4).
- Produces: `findCompletedWorkoutForExecution(views: readonly CompletedWorkoutView[], executionId: string): CompletedWorkoutView | undefined`. It matches `view.structured?.execution?.executionId`.
- **UI:**
  - After the runner completes an execution (state `completed`; not abandoned), the post-completion view shows **Copy session for AI**.
  - On click, it reads `getCompletedWorkoutsInRange(userId, date, nextDate)` for the execution's local date, finds the view and copies.
  - If no view is found yet, it shows: `Not ready yet — it will be available in History once the session is saved.`
  - The button must not block or replace the companion prompt; it renders alongside it.

- [ ] **Step 1: Write failing tests** for `findCompletedWorkoutForExecution`: `finds the view by executionId` and `returns undefined when absent`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the helper and the button.** Compute the next date with `addDaysToLocalDateString`.
- [ ] **Step 4: Run the tests, `npx tsc -b` and eslint.** Expect them clean.
- [ ] **Step 5: Commit** with `feat(session): offer the AI session report right after finishing`.

### Task 6: Browser E2E and docs

**Files:**
- Modify or create: an E2E spec under `app/tests/e2e/`. Extend the spec that already covers History completed-workout cards (search for `btn-copy-activity-json` or `Copy JSON`); otherwise add `history-copy-for-ai.pw.ts` following the existing emulator-seeded pattern.
- Modify:
  - `docs/architecture/user-flows.md` §9 (Data and AI export): add **Copy for AI** and the post-completion action.
  - `docs/plans/2026-11-14-ledger-export-ai-content.md`: Phase 1 status line.
  - `docs/plans/README.md`: add a row for the export-content plan.

- [ ] **Step 1: Write the E2E.** Seed one completed structured workout, open History, and click **Copy for AI**. Read the clipboard with the pattern existing specs use (grant `clipboard-read`) and assert it contains `# Session:`, a `## ` exercise heading and `ref:`. Run it at the mobile and desktop projects the suite already defines.
- [ ] **Step 2: Run it.** Use `cd app && npx playwright test <spec>`; expect a pass. If the local Windows E2E flakes on login/network (known), rerun once and report.
- [ ] **Step 3: Update the docs** listed above.
- [ ] **Step 4: Run `make verify`** from the repo root, in the background (about 7 minutes). Expect exit 0. Report any skipped suite.
- [ ] **Step 5: Commit** with `test(e2e): cover Copy for AI on History; docs`.
