# Session report for AI (Phase 1) Implementation Plan

**Status:** Phase 1 implemented on branch `feat/ledger-export-session-report` (PR #1258). Phases 2–4 are planned separately.

**Goal:** After a session, one tap copies a compact, planned-vs-performed Markdown session report for the external AI chat.

**Architecture:** Extend the existing per-workout export (`completed_workout_v1`, built from the History read model `CompletedWorkoutView`) with the missing fields. Add a pure Markdown view of the same export. Wire a **Copy for AI** action on the History card and on Home's `LedgerTodayCard` (`LedgerSessionAiCopyButton`). No ledger-export or engine change.

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

## Outcome by task

### Task 1: Prescription tempo/notes and step choices in the step detail (shipped)

`buildStructuredStepDetails` copies `tempo` and `notes` into `PrescribedStepTarget` and attaches the effective choices to their step as `StepChoiceDetail` (matched by `entry.stepId`, else by the option set's `appliesAtStepId`). Tombstoned entries never appear as sets or choices. Superseded choices are resolved with `resolveEffectiveChoiceEntries`, so only the effective one is reported.
- Ruling (review fix): a non-exercise step kept only because a choice was recorded carries `choiceOnly: true` and `prescribed.sets === 0`, so it never reads as missed work.
- Files: `app/src/training-occurrence/structuredSetDetail.ts` and its test.

### Task 2: Additive `completed_workout_v1` fields (shipped)

`ExportedPrescription` gained `tempo` and `notes`, `ExportedExercise` gained `choices` (and `choiceOnly`), and the export gained `responses` (`ExportedSessionResponse[]` in window order, or `'unavailable'`). `exportCompletedWorkoutToJson` and `formatCompletedWorkoutJson` take an optional `responses` argument; the key is omitted when it is not supplied. The schema id is unchanged.
- Files: `app/src/training-occurrence/completedWorkoutJsonExport.ts` and its test.

### Task 3: Markdown session report (shipped)

`formatCompletedWorkoutMarkdown` renders the JSON export, so the two cannot disagree. Swapped, added, not-performed, warm-up-only and choice-only steps have their own headings; missing values are named, never `0`.
- Ruling (review fix): with no exercise steps, the `structured log:` line follows `view.sourceReads.structured`: `none (provider recording only)` only when the structured source is confirmed not linked and a provider recording exists; `unavailable (<status>)` when the execution or its definition or entries could not be read; `no exercise steps recorded` when structured data is available but empty.
- Files: `app/src/training-occurrence/completedWorkoutMarkdown.ts`, its test and golden file.

### Task 4: Copy for AI on the History card (shipped)

A **Copy for AI** button beside **Copy JSON** on the History card; Copy JSON now also carries responses. A rejected response read becomes `responses: unavailable`. A failed copy shows **Copy failed**.
- Ruling: `copyDeferredText` hands a promise to `ClipboardItem` inside the click, so the user gesture survives the Firestore reads (Safari/iOS). On the `writeText` fallback a newer request supersedes an older one: the older call rejects with `StaleCopyError`, which callers treat as a silent no-op.
- Files: `app/src/components/CompletedWorkoutList.tsx`, `app/src/components/completedWorkoutCopy.ts`, `app/src/utils/copyDeferredText.ts` and their tests.

### Task 5: Copy for AI after finishing a session (shipped, different entry point)

- Ruling: the action is **not** in `SessionRunner`, which closes right after completion unless companion sessions exist. It is a **Copy session for AI** button (`LedgerSessionAiCopyButton`) on completed session rows of Home's `LedgerTodayCard`. Until the workout is readable it says it is not ready yet.
- Ruling (review fix): the accessible name is `Copy session for AI: <title>` (it contains the visible text), and one always-mounted `role="status"` region announces `Copied for AI`, the not-ready message and the failure message.
- Files: `app/src/components/LedgerSessionAiCopyButton.tsx`, `app/src/components/LedgerTodayCard.tsx` and `.css`.

### Task 6: Browser E2E and docs (shipped)

`app/tests/e2e/history-copy-for-ai.pw.ts` covers Home and History (390 px and 1440 px) and checks the clipboard contents and the status announcement (Chromium only). `docs/architecture/user-flows.md`, the spec's Phase 1 status line and `docs/plans/README.md` were updated.

## Remaining / follow-ups

- Manual check of the copy on a real iPhone (Safari), from History and from Home. E2E runs Chromium only.
- The History "Copied" and "Copy failed" labels have no live region (the existing pattern has the same gap).
- No test yet for choice order at one step, or for a tombstoned correction reverting to the earlier choice.
- `CompletedWorkoutList.tsx` is over the 400-line guideline and should be split.
