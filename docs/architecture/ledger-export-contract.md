# Structured ledger export contract (D-EXPORT v1)

The canonical structured ledger export is `ledger-export-v1`, defined by
`app/src/ledger/export/schema.ts` and `ledgerExport.schema.json`. Its approved design and
owner decisions are in [the #1145 plan](../plans/2026-10-25-issue-1145-ledger-export-v1.md);
[D-EVAL criteria](../analysis/2026-10-25-adr-0052-d-eval-criteria.md) merged alongside that
design. This reference describes the shipped exporter, rather than Phase 2 behavior.

## Entry points and authority

On the canonical Context Brief screen, **Export ledger (JSON)** lazily calls
`services/ledgerExportService.ts` `LedgerExportService.build` for the authenticated account,
selected Warsaw date and purpose. The filename is
`ledger_<purpose>_<startDate>_to_<endDate>.json`. Exporting is read-only and never reconciles
occurrences, migrates settings, uploads data, or evaluates engine recommendations. Pending
downloads are discarded when their account/date/preset component unmounts. Failure leaves a
retryable status beside the action. A source failure is represented in the file itself.

`buildLedgerExport` accepts already-read records and an injected `exportedAt` without IO.
`renderLedgerExport` is a deterministic Markdown view of that same `LedgerExport`; it
renders all five layers, provenance, units, missingness, semantic dates, context-history
gaps, and omission counts. It escapes embedded text so values cannot inject Markdown rows
or headings. The ledger module boundary test forbids direct or transitive engine imports.

During this transition, the existing Copy, Download Markdown and Download JSON actions
retain the [Context Brief v10 contract](./context-brief-contract.md). They still include the
legacy brief's engine opinions. **OD5 explicitly reserves switching that Markdown path to
the ledger renderer for Phase 2.** The additive ledger JSON has a separate schema version;
it is not `context_brief_export_v2` and does not embed the legacy Markdown. No brief-contract
or policy-version bump is required for this additive path.

## Five layers

| Layer | Contents | Authority and gaps |
| --- | --- | --- |
| `facts` | Recovery, check-ins, canonical performed occurrences, session responses, current assessment observation heads, body mass, nutrition, bounded activity detail, competition outcomes | Recorded facts only; provider activity rows are provenance and never added to canonical totals |
| `derived` | Named baseline, D−1 step normalization and performed-load slots, each with definition/window/inputs | `not_yet_supported` until independently extracted under #1144; no engine derivations are called |
| `flags` | The closed four D-FLAGS ids with persisted evaluation metadata and inputs | Service emits `not_yet_supported` while historical evaluation persistence is absent; builder can preserve supplied persisted evaluations without recomputation |
| `userContext` | Current active goals/constraints, settings/injuries/equipment, preferences, travel, venue restrictions, availability and intent-block events | Unsupported effective dates and revision history stay explicit; `updatedAt` does not establish field-level history |
| `coachingHistory` | Immutable external-plan revision headers/rationale, current placements, moved/dropped overrides, canonical planned→performed links | Missing override reasons and mutable placement history remain `not_yet_supported` |

`legacyEngine` is null in the user-facing export. The pure builder supports an explicitly
supplied legacy layer; the production service never supplies it. No engine opinion belongs
in facts or derived metrics. Tests assert the forbidden opinion-key inventory.

Every leaf carries `value`, `source` and `state`; numeric observations also carry their
explicit unit. Missing values are state-bearing nulls, never invented zeroes or an implicit
"none". States are `measured`, `missing`, `unavailable`, `invalid`, `not_collected`,
`not_applicable`, `stale`, `not_recorded`, and `not_yet_supported`. A measured zero/false stays
measured. Collections carry source/state/items plus undated omission counts; activity detail
also carries truncation and total-in-window counts. Stale observations retain `observedOn`.

## Read paths and completeness

The assembly reuses existing user-scoped readers under `users/{uid}`; it does not issue a
second copy of the legacy brief build. In particular, settings use
`peekTrainingSettingsState`, schedule availability uses authoritative
`schedule_window_manifests` through `getWindowsForDateState` (the export's compatibility
source key remains `schedule_windows`), and performed occurrences use the canonical
repository. Each performed-training fact includes `executedDefinitions` for its linked executions,
with the `authored` or `reduced` choice recorded at an external-plan launch, and `unknown` when
no choice was recorded (older executions, and launches that offer no such choice). The value is
never inferred from the session source. Missing or unreadable linked executions leave the field unavailable.
Validated execution entries supply a bounded occurrence-level exercise/set
summary, excluding deleted entries and choice events. Missing entry evidence is not a zero
summary. A linked provider activity does not create a second performed row.

Response reads use recorded response dates, including later-day/next-morning records.
Assessment loading reuses the brief's bounded goal/completed-attempt discovery and current
head validation, with at most twelve bindings and one hundred attempts per protocol. It
exports recorded observations, not benchmark verdicts. Competition outcomes use a validated,
ID-ordered scan of at most 200 records plus a truncation sentinel and filter by Warsaw date;
a scan limit reports `unavailable`, not completeness. Invalid bounded rows report `invalid`.

External-plan reads reuse the plan list, header, activation, immutable revision and current
placement readers. Each exported revision is content-hash verified. Latest revision import
times come from the header; older activation records preserve the same import instant
written by the import transaction. Revisions referenced by performed work are read alongside
activation history. Authored links require the execution content hash and session id to
match that verified revision. A missing referenced execution makes linkage unavailable;
it never becomes measured absence. The link keeps the recorded execution session date,
not a date subsequently moved in the mutable overlay. The builder retains revisions referenced
by in-window placements or performed links plus the latest revision per plan, even when a
current placement has moved outside the window. Placements are current overlays, never
claimed as immutable history.

All source reads produce `SourceState` entries. Rejected reads report `unavailable`;
validated corrupt sources report `invalid`; genuine absent documents report `missing`.
Partial bounded discovery never becomes measured emptiness. Nutrition adherence inherits a
failed or invalid check-in read state rather than claiming no adherence was recorded.
`readAt` is an export/read provenance instant; `newestObservedOn` stays null when the reader supplies no trusted
source-level metadata. Errors or source document paths never enter the exported file.

## Dates, information bounds and determinism

Calendar dates use Europe/Warsaw helpers. The morning window is today and D−1; planning is
at most fourteen inclusive days; diagnostic accepts the selected range. A caller can narrow
morning/planning but cannot widen their historical windows. Forward-looking travel,
fixed-activity and schedule-window reads reach at most seven days including the as-of date.
Provider detail caps stay six morning activities (segment detail only on D−1), twelve
planning activities with at most twenty segments each, and thirty diagnostic activities
with at most one hundred segments each. Current active goals/constraints remain context.

`totalSteps` retains its D−1 semantic date; unknown duration is not summed as zero. The
builder orders rows by date and stable id and allow-lists every exported field. It strips
account identity keys and redacts known identity values in free text. There is no user id,
e-mail or provider account id in the output. Export remains an explicit user action.

Identical persisted inputs and explicit date/purpose/window produce the same semantic
output; only `exportedAt` and source `readAt` may vary between reads. The pure renderer adds
no clock-dependent content. Contract, JSON Schema, bounds, identity and golden-render tests
run in the normal frontend unit-test CI job; service and button tests cover failed reads,
immutable hashes, deduplication, cancellation and download cleanup. Browser coverage exercises
the actual user action and verifies the downloaded schema on desktop and mobile widths.

## Remaining phase gates

This export does not turn off engine adjudication or close #1144. Phase 2 still needs the
ADR-0052 extraction and device evidence gates. Historical flag evaluation persistence,
placement/status successor history, and the owner-completed protocol retest-interval table
remain prerequisites for a qualifying D-EVAL block; explicit gaps are not passing evidence.
