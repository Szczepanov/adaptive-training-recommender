# Issue #1145: D-EXPORT v1, the structured ledger export

- **Status:** Draft. Design for owner review; the owner decisions are listed below.
- **Blocked by:** #1144 PR0 (#1148, `app/src/ledger/models.ts`) for implementation; nothing blocks this design.
- **Unlocks:** ADR-0052 Phase 2 (switch-off), which requires D-EXPORT v1 *shipped and contract-tested*.
- **Companion:** [`../analysis/2026-10-25-adr-0052-d-eval-criteria.md`](../analysis/2026-10-25-adr-0052-d-eval-criteria.md). ADR-0052 requires it to merge together with this design.
- **Decision source:** [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md): D-EXPORT, D-USER, D-COACHLOG, D-FLAGS, D-TRAVEL.

## Goal

Replace "Markdown is canonical, JSON wraps it" (`utils/contextBriefExport.ts`
`buildContextBriefJsonExport`) with a **canonical structured export** of what the ledger
records. The Markdown brief is then *rendered from* that structure. Engine opinions leave the
default export.

## Preconditions

- #1148 merged, so the exporter and its types live outside `engine/` and import only from
  `ledger/` (enforced by `ledger/models.architecture.test.ts`).
- Owner decisions OD1–OD4 answered; OD5 can wait until work item 4.

## Design

### Envelope

```jsonc
{
  "schemaVersion": "ledger-export-v1",
  "exportedAt": "2026-11-20T06:12:03Z",       // ephemeral, like `Generated at` today
  "asOfDate": "2026-11-20",                    // Europe/Warsaw calendar date (ADR-0003, I2)
  "window": { "startDate": "2026-11-07", "endDate": "2026-11-20", "days": 14 },
  "purpose": "planning",                       // morning | planning | diagnostic (same presets)
  "sources": [ /* SourceState, one per source read: see "Source state" */ ],
  "facts": { /* layer 1 */ },
  "derived": [ /* layer 2 */ ],
  "flags": [ /* layer 3 */ ],
  "userContext": { /* layer 4 */ },
  "coachingHistory": { /* layer 5 */ },
  "legacyEngine": null                         // opt-in only, until Phase 3; see "Legacy layer"
}
```

There is no user id, e-mail or provider account id anywhere in the export. It is
user-initiated and contains personal health data (I6), so it carries the minimum identity
needed to be read, which is none.

### Value and source vocabulary

Every leaf fact is a `LedgerValue`:

```ts
interface LedgerValue<T> {
  value: T | null;            // null only when state is not "measured"
  unit?: string;              // SI or the provider's documented unit, never implied
  source: string;             // provider/transport, e.g. "garmin", "eight_sleep_direct", "athlete"
  state: LedgerState;
  observedOn?: string;        // semantic Warsaw date the value describes
}
type LedgerState =
  | 'measured'                // a real value, a measured zero included
  | 'missing'                 // expected for this date, not present
  | 'unavailable'             // the source could not be read
  | 'invalid'                 // present but failed validation
  | 'not_collected'           // the source does not collect this metric
  | 'not_applicable'
  | 'stale'                   // present but older than the expected date
  | 'not_recorded'            // athlete-stated field the athlete has never filled
  | 'not_yet_supported';      // the export promises the field; no backing record exists yet (ADR-0052 D-EXPORT)
```

The first seven states are the Context Brief's existing source-state vocabulary
(`docs/architecture/context-brief-contract.md` "Contract identity block"). The last two are new
and come from ADR-0052. **No field is ever an empty value that reads as "none".**

`SourceState` (one per source read) reuses the same states plus `{ source, readAt,
newestObservedOn }`. Transport timestamps are provenance only, as today.

### Layer 1: `facts` (as recorded)

| Key | Backing record (collection under `users/{uid}/`) | v1 |
|---|---|---|
| `recovery[]` | `daily_recovery_snapshots` (`DailyRecoverySnapshot`), `health_observation_days` | backed |
| `checkins[]` | `daily_subjective_checkins` (`DailySubjectiveCheckin`) | backed |
| `performedTraining[]` | `performedTrainingOccurrences` (`PerformedTrainingOccurrence`, ADR-0034), with structured entries summarised from `session_executions` | backed |
| `sessionResponses[]` | `session_responses` (`SessionResponse`) | backed |
| `assessments[]` | `assessment_attempts`, `metric_observations` (ADR-0046/0047) | backed |
| `bodyComposition[]`, `nutrition[]` | `anthropometry_entries`, `nutrition_days` (ADR-0039/0042) | backed |
| `activities[]` (provider detail) | `activities` (`NormalizedGarminActivity`) | backed, bounded per purpose |
| `events[]` (outcomes) | `competition_outcomes` | backed |

Rules carried over unchanged from the brief: one canonical occurrence renders once;
unknown duration is never summed as zero; raw provider rows are never added to canonical
totals; the per-purpose information bounds stay at least as strict as today's caps.

### Layer 2: `derived`

```ts
interface DerivedMetric { id: string; definition: string; window: string; value: LedgerValue<number>; inputs: string[] }
```

v1 includes only derivations that #1144 extracts: biometric baselines (ADR-0024), the D−1
step normalization (I3, ADR-0003), and rolling performed-training load and exposure ledgers
(#813). Until a derivation has been extracted it is exported as `not_yet_supported`. It is
never exported from inside `engine/`.

### Layer 3: `flags` (ADR-0052 D-FLAGS, closed set of four)

```ts
interface LedgerFlag {
  id: 'illness_anomaly' | 'illness_risk_symptom' | 'injury_constraint_touches_session' | 'recovery_beyond_baseline';
  active: boolean | null;          // null = could not evaluate; see state
  state: LedgerState;
  inputs: { name: string; value: LedgerValue<unknown> }[];
  threshold: string;               // human-readable, claim-backed (I4)
  baselineWindow?: string;
}
```

A flag never blocks, modifies or re-doses a session. The anomaly flag's release is gated by
the HA7 report (#641).

### Layer 4: `userContext` (ADR-0052 D-USER)

Each item carries `since` (when the current value took effect) and, where the record keeps
history, `revisions[]`.

| Key | Backing record | v1 |
|---|---|---|
| `injuries[]` | `trainingSettings` → `InjuryConstraint[]` (ADR-0013, as a record) | backed; history `not_yet_supported` |
| `equipment`, `environment`, `guardrails` | `trainingSettings` (`EquipmentKey`, `TrainingEnvironment`, `GuardrailKey`) | backed |
| `travel[]` | `plan_blocks` (`AuthoredPlanBlock`), ADR-0052 D-TRAVEL | backed |
| `venueRestrictions[]` | `fixed_activities` `availabilityContextOverride` | backed |
| `availability[]` | `schedule_windows`, `fixed_activities` | backed |
| `preferences` | `preferences` (`UserPreferences`) | backed |
| `goals[]`, `events[]` | `goals` (`UserGoal`; target events are embedded in goals, ADR-0041/0048–0050), `intent_blocks` | backed |
| `constraints[]` | `constraints` (`UserConstraint`) | backed |
| `trainingDislikes` | none | `not_yet_supported` |

### Layer 5: `coachingHistory` (ADR-0052 D-COACHLOG)

| Key | Backing record | v1 |
|---|---|---|
| `planRevisions[]` | `external_plans/{planId}/revisions/{revision}` (immutable, content-hashed): `planId`, `revision`, `contentHash`, `importedAt`, `schemaVersion` | backed |
| `planRevisions[].authorRationale` | plan-level `notes` in the imported plan | backed when present, otherwise `not_recorded` |
| `placements[]` | `.../placement/current` `assignments[]` (`planned`/`completed`/`moved`/`dropped`/`superseded`) | backed |
| `overrides[]` (skip/swap/modify with reason) | partial: `dropped`/`moved` statuses; no reason field | `not_yet_supported` for reasons |
| `plannedToPerformed[]` | occurrence ↔ placement links (ADR-0034 round trip, today's "External-plan execution round trip" section) | backed |

### Legacy layer

`legacyEngine` is `null` unless the caller explicitly opts in. When included, it holds the
sections ADR-0052 removes from the default: plan authority (`briefPlanAuthority.ts`),
periodization phase, and capability-maintenance and development-authority verdicts. Each is
labelled with the `POLICY_VERSION` that produced it. The layer is deleted in Phase 3.

### Markdown rendering

The Markdown brief becomes a pure renderer over a `LedgerExport` value. Determinism stays
as it is today: identical persisted inputs give identical semantic output, apart from
`exportedAt`. The current `## Requested output` / importable-schedule instructions stay,
because they are the authoring contract for `external-plan@6`. Under D-TRAVEL they must
instead tell the AI to plan around `userContext.travel` and `venueRestrictions`, and that
change ships in Phase 2.

## Work items (Part B, after this design merges)

1. **Types.** Add `app/src/ledger/export/schema.ts` with `LedgerExport`, `LedgerValue`,
   `LedgerState`, `SourceState` and the five layer types above. *Done when:* `tsc -b` passes
   and the ledger boundary test still passes (no `engine/` import).
2. **Pure builder.** Add `app/src/ledger/export/buildLedgerExport.ts`, which takes
   already-read records plus `asOfDate`, window and purpose and returns a `LedgerExport`. It
   does no IO and calls nothing like `Date.now()`; `exportedAt` is injected. *Done when:* the
   builder tests below pass.
3. **Service.** Add `app/src/services/ledgerExportService.ts`, which reads the collections
   in the tables above with user scoping (I1) and Warsaw dates (I2) and records a
   `SourceState` per read. Reuse the read paths `services/contextBriefService.ts` already
   uses; do not duplicate queries.
4. **Renderer and UI.** Render the Markdown from `LedgerExport`. Add
   "Export ledger (JSON)" next to the existing actions in
   `components/ContextBriefExportActions.tsx`. Keep the current Markdown brief path until
   Phase 2 (OD5).
5. **Docs.** Add `docs/architecture/ledger-export-contract.md` (the living contract) and point
   `context-brief-contract.md` at it.

## Tests to add

- `buildLedgerExport.test.ts`:
  - every promised field is present, with `state` set;
  - an unbacked field is `not_yet_supported`, never `null` with `measured`;
  - a measured zero stays `measured` with value `0`;
  - no user id or e-mail appears anywhere (serialize, then search);
  - identical inputs give identical output, apart from `exportedAt`.
- `ledgerExportContract.test.ts`, the contract test:
  - validates against a JSON Schema checked into `app/src/ledger/export/`;
  - every fact carries `source` and `state`;
  - no key from the engine-opinion list appears outside `legacyEngine`.
- `ledgerExportRender.test.ts`: the Markdown rendered from a fixture export matches a golden
  file; the travel and venue facts render in the planning purpose.
- E2E (Phase 2, ADR-0052 D-CI): export → import `external-plan@6` with `reducedDefinition` →
  run offline → re-export shows the performed occurrence linked to its placement.

## Acceptance criteria

- [ ] This design and the D-EVAL criteria document merge in the same PR.
- [ ] OD1–OD4 are answered in this document before Part B starts.
- [ ] Part B: every field in the five tables is present in the export with a `state`.
- [ ] Part B: the contract tests above run in CI (`frontend-unit-tests`).
- [ ] Part B: the export imports nothing from `app/src/engine/`.

## Owner decisions

- **OD1. Window and bounds per purpose.** Proposed: keep today's purposes and caps (morning
  today + D−1, planning 14 days, diagnostic caller-selected).
- **OD2. Provider activity detail in `planning`.** Proposed: the bounded detail rows only
  (newest 12, ≤ 20 segments each, as today). Full detail is diagnostic only.
- **OD3. Override reasons.** Proposed: v1 exports `dropped`/`moved` without a reason
  (`not_yet_supported`). Adding an optional reason when the athlete skips is follow-up work.
- **OD4. Legacy layer default.** Proposed: off. The owner opts in per export until Phase 3.
- **OD5. Markdown brief during the transition.** Proposed: keep both exports until Phase 2;
  Phase 2 switches the Markdown to render from `LedgerExport`.

## Risks and rollback

- **Under-reporting by omission.** A field missing from the builder would look like "none" to
  the AI. Mitigation: the contract test enumerates every promised field.
- **Personal data in transit.** The export leaves the device on user action only. No new
  transport is added (D-NOPARSE; MCP needs its own ADR).
- **Rollback:** the JSON export is additive until Phase 2. Remove the action.

## Out of scope

- MCP or any pull transport (separate ADR).
- New D-USER/D-COACHLOG storage UI (dislikes, override reasons) beyond the fields listed as
  `not_yet_supported`.
- Phase 2 switch-off and the D-TRAVEL prompt change.
- Changing any engine output.

## Docs to update

- New `docs/architecture/ledger-export-contract.md` (Part B).
- `docs/architecture/context-brief-contract.md`: point at the ledger contract.
- `docs/plans/README.md`: board row for this plan.
