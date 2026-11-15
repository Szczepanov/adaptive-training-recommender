# Compact morning update (Phase 2) Implementation Plan

**Goal:** A morning ledger export small enough to paste into one long-lived AI chat every day. It is today-first, shows the next 7 days of planned sessions, and abbreviates user context that has not changed since the last export.

**Architecture:**
- Additive `ledger-export-v1` schema fields add the upcoming-session content and a forward placement bound.
- A new pure compact Markdown renderer produces the morning text, with a stable per-item hash for user-context change detection.
- `ContextBriefService` uses the compact renderer in ledger mode. The brief screen keeps a confirmed checkpoint (item hashes plus a format version and per-collection scope and completeness) per user, chat and purpose on the device.
- The verbose renderer stays as a diagnostic view.

**Tech Stack:** React + TypeScript, Vitest (golden files via `toMatchFileSnapshot`), Playwright with Firebase emulators.

**Spec:** `docs/plans/2026-11-14-ledger-export-ai-content.md`, Phase 2. The spec is on PR #1257 (branch `docs/ledger-export-ai-content`) and is not on `main` until that PR merges.

**Status:** Implemented on branch `feat/ledger-export-morning-update` (Tasks 1-6). Not yet merged; the `docs/plans/README.md` row is added by #1258, so it is deliberately not edited here.

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

## Outcomes

### Task 1: Upcoming placements carry session content (schema + builder + service)

Shipped. `PLACEMENT_FIELDS` gained `title`, `priority`, `summary`, `stepNotes` and `fallback`;
`PlanRevisionInput.sessions` is filled by `ledgerExportService` `readPlans` from the verified
revision (v1 `prescription`, v2+ `definition` and `scaling.fallback`). `PLACEMENT_FORWARD_DAYS`
bounds placements to `morning` +7, `planning` +14, `diagnostic` 0; `droppedOutOfWindow` counts dated
rows dropped by the bounds. Content states: a revision not exported is `invalid` when its source is
invalid and `unavailable` otherwise; a session absent from a readable revision or a blank leaf is
`not_recorded`. The verbose golden changed only by the new placement rows.

### Task 2: Compact renderer core

Shipped as `ledger/export/compact/renderLedgerExportCompact.ts` plus `compactLines.ts`; the escaping
helper moved to `ledger/export/markdownText.ts` with the verbose output byte-identical. Review rounds
fixed flag date ranges (runs split on calendar gaps and on an interleaved active evaluation) and made
flag labels show the real state. Fixture size: morning about 9.3k characters, planning about 11k.

### Task 3: Today-first sections

Shipped as `todaySections.ts`, `yesterdaySection.ts`, `placementBlocks.ts` and `baselineLines.ts`.
Ruling: `totalSteps` is labelled `(D-1)` by field name, since the fields carry no semantic date (I3).
Review rounds kept `statusHistory` on consumed placements, listed every flag evaluated today, and
moved the `droppedOutOfWindow` count out of Upcoming into the collection metadata. Only today's
check-in/recovery, placements and joined planned-to-performed links are consumed (skipped later);
performed occurrences and responses still appear in Facts.

### Task 4: Abbreviate unchanged user context

Shipped as `compact/previousContext.ts` (`userContextItemHashes`, `contextDelta`, `unchangedLines`).
Measured on the fixture: morning 6,834 characters with a matching previous context (target 8,145)
and about 10.0k without (target 13,032); planning 8,499 and 11,708. The output without a previous
context is unchanged, so the goldens did not move.

### Task 5: Brief screen wiring

Shipped. In ledger mode `ContextBriefService.build` renders the compact text and returns
`contextItemHashes`; engine mode is untouched. `components/briefPreviousContext.ts` validates on read
and swallows storage errors; Following revised spec 2c, copying or downloading never advances the
checkpoint: `components/useBriefCheckpoint.ts` holds the exported snapshot in memory and the explicit
**Added to this chat** action (`BriefChatCheckpoint`) stores it under the user, chat and purpose key.
The **Chat** label is local and never exported, and the **Include full context** checkbox
(`BriefFullContextToggle`) ignores the checkpoint. Copy and Download Markdown are disabled while the
brief on screen does not match the chat or toggle.

### Task 6: E2E and docs

Shipped. `app/tests/e2e/brief-compact-morning.pw.ts` seeds a ledger-mode athlete (today's check-in, a
performed occurrence yesterday, a placement at +3 days) and asserts `Today`, `Yesterday`, `Upcoming`
and the upcoming session title on the first copy; no `unchanged since` after an unconfirmed copy and
reload, `unchanged since` after **Added to this chat** and reload, and none for a different chat or
with **Include full context**; the full-context part runs after an in-test switch to a
390 px viewport. The contract and user-flows docs now describe the compact renderer, and the stale
"Entry points" paragraph (legacy Copy/Download, OD5 reservation) was corrected. The README row is left
to #1258.

### Task 9: Versioned, scope-aware checkpoint (spec 2c alignment)

Shipped, then revised by the final-review fix wave (below). `compact/contextCheckpoint.ts` holds
`CHECKPOINT_FORMAT_VERSION`, per-collection `{ scope, complete }` plus each windowed item's selection
date, `userContextCheckpoint` and `mergeCheckpoint`; the item hash includes the record's `observedOn`.
`ContextBriefService` returns `contextCheckpoint` and `exportedAt` (replacing `contextItemHashes`).
The pending confirmation is bound to the captured user, chat and purpose, and `confirmSnapshot`
re-reads storage and refuses an older export. Stored values with another or no `formatVersion` give
full context.

### Final-review fix wave (checkpoint v2)

`CHECKPOINT_FORMAT_VERSION` is 2. Under a complete read, an absent item is `removed:` when its
stored selection date is still within the current bound (or it has none), and `out of scope now:`
once, then dropped, when its date fell before the new window start; this lets daily morning exports
report real deletions. An incomplete read prints `not readable now:`, keeps prior hashes only for
absent items and takes current hashes for present ones. Fully unchanged user-context collections
print `N unchanged (listed above)`. Compact `missing:` lines group field names by state
(`a, b (not_recorded); c (missing)`). Fixture morning size with a matching checkpoint: 7,671
characters (target ≤ 8,145); without: 10,371 (target ≤ 13,032).

## Remaining / follow-ups

- The spec's Phase 2c checkpoint sentence carries an agent ruling for the owner to confirm in PR
  review.
- Injury context ids are positional (`injury-NNN`, pre-existing), so a deleted injury can renumber
  the rest and `removed:` may name the wrong injury; follow-up.
- An older revision placed only through the legacy overlay without an activation hash marks the
  whole `external_plan_revisions` source `invalid`; follow-up.
- Deferred review minors: `contextDelta` does not guard a malformed `previous.itemHashes` by itself
  (the stored value is validated on read); `plannedToPerformed` ids are not consumed on the Yesterday
  line; derived metrics are not collapsed and `activeFlagLines` omits `evaluatedAt`/`definitionVersion`
  (documented in the contract; the JSON carries them); `DataView.tsx` is over the file-size guideline.
- The checkpoint is per device, user, chat and purpose; a reader that lost the earlier export must
  tick **Include full context** or use a new chat name.
