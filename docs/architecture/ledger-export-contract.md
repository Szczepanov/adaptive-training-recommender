# Structured ledger export contract (D-EXPORT v1)

The canonical structured ledger export is `ledger-export-v1`, defined by
`app/src/ledger/export/schema.ts` and `ledgerExport.schema.json`. Its approved design and
owner decisions are in [the #1145 plan](../plans/2026-10-25-issue-1145-ledger-export-v1.md);
[D-EVAL criteria](../analysis/2026-10-25-adr-0052-d-eval-criteria.md) merged alongside that
design. This reference describes the shipped exporter, including the Phase 2 compact Markdown renderer.

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

In ledger mode (the default since #1254) the same screen's Copy, Download Markdown and
Download JSON actions use the ledger as well: `ContextBriefService.build` renders
`renderLedgerExportCompact` (below) instead of the legacy brief text, and the Markdown copy and
download carry that compact text. **Download JSON** and **Export ledger (JSON)** stay the full,
canonical `ledger-export-v1` document. Engine mode (the default-off `engineRecommendationsEnabled`
rollback) still produces the legacy brief under the [Context Brief contract](./context-brief-contract.md),
including its engine opinions. The additive ledger JSON has a separate schema version; it is not
`context_brief_export_v2` and does not embed the Markdown. No brief-contract or policy-version
bump is required.

## Compact Markdown renderer

`ledger/export/compact/renderLedgerExportCompact.ts` is a pure Markdown view of the same
`LedgerExport`, sized for pasting into one long-lived AI chat. Every
leaf that is missing, stale or unavailable stays visible, grouped into one `missing:` line per item
rather than printed as zero or false; names sharing a state are listed once before it
(`missing: stepNotes, fallback (not_recorded); statusHistory (not_yet_supported)`). Some recorded detail is summarised, with the full record in the
JSON: a placement's status history is a count and the latest change date, a performed occurrence's
set counts are one `<work>/<planned> work sets (+<warmup> warm-up)` phrase, a consumed placement or link row is printed once
(under Today, Yesterday or Upcoming; its collection then prints `<name>: <n> shown above`). A
user-context collection whose items are all abbreviated prints `<name>: <n> unchanged (listed above)`
instead, since those items are only named on the `unchanged since` line. An
inactive or unavailable flag is a summary line; an active flag prints in full, with its
`definitionVersion` and `evaluatedAt` when persisted. Placement headers and the planned
part of a yesterday line carry the record ids (`plan-1@2:s4`, `plan-1@2:s1 → occ-1`).

Provenance (spec 2a): the header declares `states: measured unless noted; source shown per group`,
so `measured` is never printed per field. Source is provenance, not a state: each record group line
carries `(<collection>; <field source>)` once, for example `### recovery (daily_recovery_snapshots; garmin)`
(a singleton prints just `(<field source>)`; the group source is the most common field source). A field prints its
source only as an exception, `(source X)`, or `(X, stale, <observed date>)` alongside a non-measured
state; semantic dates (`D-1` steps, stale observation dates) and units stay on the line. A
non-measured collection state prints as `state: <state>` under the group line, and an unreadable empty
collection is one line ending in its collection name.

Source and omission handling: `## Sources` abbreviates successful sources (`sources: all measured`
or only the non-measured ones, each with `newestObservedOn` and `reason`). Every omission count
(`droppedUndated`, `<name> outside window`) and the activities truncation warning
(`truncated: <bool>; totalInWindow: <n>; exported: <n>`, also on an empty activities collection)
stay on the collection's own line.

Flag ranges: inactive/unavailable evaluations of one id collapse only when calendar-consecutive
and identical in label (`inactive`, `unknown (<state>)`, `inactive (<state>)`), `definitionVersion`
and `sessionRef`; a version or session change breaks the range and each line names its
`(definition <v>; session <ref>)`. Two evaluations of the same id on one date are never merged:
each prints on its own line with `evaluated <evaluatedAt>`. Unavailable dates never fold into inactive.

Size targets on the fixture morning export (asserted in `previousContext.test.ts`): at most 8,145
characters with a matching `previousContext`, 13,032 without. `renderLedgerExport` remains the verbose diagnostic view.
`renderLedgerExport` remains the verbose diagnostic view.
Output starts with `# Ledger update — <asOfDate> (<purpose>)`, then:

1. `## Today (<date>)` (`todaySections.ts` `renderTodaySections`): today's check-in and recovery
   values with their 28-day baselines and the exported `<field>_delta28d` leaves (a missing
   baseline prints its state; a delta that is not measured prints `delta: <state>`; the renderer
   never subtracts), today's evaluated flags, and today's placements in full.
2. `## Yesterday (<date>)` (`yesterdaySection.ts`): one line per performed occurrence, with the
   validated `workSets`/`plannedSets`/`warmupSets` (an absent count prints its state, never 0),
   session RPE from the responses named in `linkedResponseIds`, the executed definition, and the
   planned session title joined through `plannedToPerformed`.
3. `## Upcoming (<from>…<to>)`: placements after the as-of date in date order, each with title,
   priority, status, summary, step notes and fallback. The section is omitted when the purpose
   has no forward window (diagnostic).
4. `## Sources` (non-measured only), `## Flags`, `## Facts`, `## Derived`, `## User context`
   and `## Coaching history`. Records already shown under Today, Yesterday or Upcoming are
   skipped by id so nothing prints twice.

### Upcoming placements and the forward bound

Each placement in `coachingHistory.placements` carries the authored session content joined from
the verified plan revision by plan id, revision and session id: `title`, `priority`, `summary`,
`stepNotes` and `fallback`. A revision that is not exported makes those leaves `invalid` when the
`external_plan_revisions` source is invalid and `unavailable` otherwise; a session absent from a
readable revision, or a blank field, is `not_recorded`.

Placement rows are bounded by `window.startDate` through `window.endDate` plus
`PLACEMENT_FORWARD_DAYS` (`window.ts`): `morning` 7 days, `planning` 14, `diagnostic` 0. Past-facts
windows and the `overrides` bounds are unchanged. Dated placements outside that range are counted in
the additive `droppedOutOfWindow` field of the placements `LedgerCollection`, in the
same way `droppedUndated` counts undated rows; the compact renderer prints it as
`placements outside window: <n>`. Placement events stay cut off at `asOfDate`: a status change
recorded after the export date is neither applied nor listed in `statusHistory`, even for a
future placement.

The same extended bound decides which revision headers `planRevisions` keeps, so a future
placement on an older revision exports both its content and that revision's header. The service
reads such a revision even when it is referenced only by a placement: besides the header, the
activation history and performed links, it reads the plan's legacy (unscoped) placement overlay
and adds its revision when an assignment falls inside the placement bounds. That revision is
hash-verified like any other; when no attesting hash can be read, its placement content stays
`unavailable` and no header is exported. An unreadable legacy overlay degrades the placement
source.

### Abbreviating unchanged user context

`compact/contextCheckpoint.ts` `userContextCheckpoint` describes one export's user context as a
checkpoint: `formatVersion` (`CHECKPOINT_FORMAT_VERSION`), `itemHashes`, `selectionDates` and, per
user-context name, `collections[name] = { scope, complete, from? }`. It stores only hashes and
comparison metadata, never context text.

- **Hashes.** `userContextItemHashes` hashes each item (key `<collection>/<id>`, `<name>` for single
  records and `trainingDislikes`) with a stable 32-bit FNV-1a over its sorted-key JSON: the leaves
  with their state and source, `since`, `revisions` and the record's `observedOn`. `observedOn` is
  the item's own semantic date (an availability or travel date, a goal's target date), not an export
  artifact, so it is hashed. Only `readAt` and `exportedAt` are excluded, wherever they appear.
  Residual risk: a 32-bit hash collides with probability about 2⁻³² per changed item, in which
  case a changed item would read as unchanged. The hash is for change detection, not security.
- **Scope.** Mirrors `buildUserContext`: `from:<window start>` for `travel`, `venueRestrictions`,
  `availability` and `events`; `active+resolved-from:<window start>` for `injuries`; `all-active`
  for `goals` and `constraints`; `current` for the single records and `trainingDislikes`. The
  date-windowed collections also store their lower bound, `from` (the window start).
- **Selection dates.** `selectionDates[key]` is the date the collection's bound compares against in
  `buildUserContext`: `travel` and `events` by end date (an intent block's `dateRange.endDate`; a goal
  event's end date is its `targetDate`), `availability` and `venueRestrictions` by `date`, a resolved
  injury by `resolvedAt`. An active injury, goals, constraints and single records have none: they are
  not selected by date.
- **Complete.** A collection is complete only when its state is `measured`, `droppedUndated` is 0 and
  it is not truncated. A single record is complete when its settings source (`training_settings` or
  `preferences`) was read `measured`. `trainingDislikes` has no source to read: `measured` or
  `not_yet_supported` (a schema-fixed state) counts as complete.
- **Version.** `CHECKPOINT_FORMAT_VERSION` is bumped whenever the hash contract or these rules change.
  Version 1 added `observedOn` to the hash and the metadata; version 2 added `selectionDates` and
  `from`, which decide removal on a moved window. Both the renderer and the store reader
  treat another or no `formatVersion` (a legacy stored value) as no checkpoint: full context.

Given a `PreviousContext` (a checkpoint plus `exportedOn`, which is the confirmed export's
`asOfDate`, so `unchanged since` names that as-of date), the renderer collapses items whose key and
hash both match into `unchanged since <exportedOn>: <n> items (<keys>)`, except items of a collection
whose read failed (`unavailable`), which are never abbreviated. Changed and new items print in full.
A key that disappeared prints:

- `removed: <key>` only when the current read of its collection is complete, the checkpoint's entry
  for that collection is complete, and the key is still within the current selection: the same
  scope, or, for a date-windowed collection whose window moved, a stored selection date on or after
  the new `from` (or no selection date, as for an active injury);
- `not readable now: <key> (<state>)` when the current read is incomplete (`incomplete` when the state
  is `measured` but rows were omitted or truncated);
- `out of scope now: <key>` when the read is complete but the key left the selection by date: its
  selection date fell before the new window start, as when the morning window moves forward a day
  past it.

The renderer takes the checkpoint as an explicit input and reads no store or clock.

`mergeCheckpoint` builds the checkpoint stored on confirmation. A complete read replaces its
collection's hashes, selection dates and metadata. An incomplete read keeps the prior checkpoint's
metadata and the prior entries of items absent now, and overwrites the entries of items present now
with their current hash and date (they were printed in full, so the chat holds that version); with no
prior it stores nothing for the collection. An unreadable item is therefore never later abbreviated
as unchanged. A complete read in a moved window advances the checkpoint to it: out-of-scope keys are
reported once as `out of scope now` and not carried, since carrying them would accumulate stale keys;
an item that reappears prints in full. This follows the Phase 2c spec as amended by an agent ruling that the owner
is to confirm in PR review.

The brief screen (`DataView`, `components/useBriefCheckpoint.ts`) advances nothing on copy or
download. In ledger mode `ContextBriefService.build` returns the export's `contextCheckpoint` and
`exportedAt`. A successful Markdown copy or download captures a snapshot in memory: the user id, chat,
purpose, `asOfDate`, `exportedAt` and the checkpoint, never recomputed. **Added to this chat** then
stores it in `localStorage` under
`adaptive-training:context-brief:previous-context:<uid>:<encodeURIComponent(chat)>:<purpose>` for the
captured user, chat and purpose only (`components/briefPreviousContext.ts` `confirmSnapshot`).

- **Binding.** If the account or the chat changes before confirmation, the pending snapshot is
  dropped (`pendingSnapshot`) and the button is disabled; the screen then reads only the new
  user's or chat's key.
- **Ordering.** The stored value carries `exportedAt`. `confirmSnapshot` re-reads the key right before
  writing and refuses a snapshot older than the stored one, so a late click or another tab never
  overwrites a newer checkpoint. The `role="status"` line then reads "A newer checkpoint is already
  saved for this chat." A failed write reads "Could not save the checkpoint on this device." and may
  be retried.
- **Disabled states.** The button is disabled again whenever a new brief is built and until the next
  export, and while no chat is named. `components/briefCheckpointHint.ts` maps the reason to a hint:
  no chat → "Name the chat to save a checkpoint."; engine mode (no checkpoint) → "Checkpoints are
  available in ledger mode."; brief rebuilding → "Wait for the brief to finish updating."; pending
  snapshot dropped by an account or chat switch → "Copy again for this chat."; nothing exported yet →
  "Copy or download the Markdown first."

The **Chat** input is a local label (max 40 characters, trimmed, remembered per user under
`adaptive-training:context-brief:chat:<uid>`); it and the user id are never part of an export. An
empty chat, another chat, another user, an unreadable, malformed or legacy store all yield a full
export, and the old purpose-only keys are no longer read and are removed on load. The **Include full
context** checkbox ignores the stored checkpoint for that view.
Copy and Download Markdown are disabled while the brief on screen is not the one the current chat and
toggle describe, so a copy can never carry the wrong variant.

## Five layers

| Layer | Contents | Authority and gaps |
| --- | --- | --- |
| `facts` | Recovery, check-ins, canonical performed occurrences, session responses, current assessment observation heads, body mass, nutrition, bounded activity detail, competition outcomes | Recorded facts only; provider activity rows are provenance and never added to canonical totals |
| `derived` | Biometric and subjective baseline metrics with units, readiness and source states | D−1 step normalization and performed-load slots remain `not_yet_supported` pending #1166; no engine derivations are called |
| `flags` | The closed four D-FLAGS ids with immutable evaluation metadata and inputs | Persisted versions pass through in deterministic date/session/time order; uncaptured dates remain `not_recorded`; illness/anomaly remains withheld by HA7 |
| `userContext` | Current active goals/constraints, settings/equipment, active injuries and resolved injury periods overlapping the window, preferences, travel, venue restrictions, availability and intent-block events | Injury `since` and `resolvedAt` use recorded dates; legacy onset stays unknown. Other unsupported effective dates and revision history stay explicit; `updatedAt` does not establish field-level history |
| `coachingHistory` | Immutable external-plan revision headers/rationale, as-of placements, immutable placement events, moved/dropped overrides, canonical planned→performed links | Missing override reasons and unrecorded legacy history remain `not_yet_supported` |

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

Phase 2b adds four additive performed-training fields. `plannedSets`, `workSets` and
`warmupSets` (unit `sets`) are separate state-bearing counts built by
`services/ledgerStructuredWork.ts`. `plannedSets` sums the block-aware target
(`targetEntriesForGroupStep`) of every exercise step of each linked execution's pinned
definition, resolved through `resolveSessionDefinition` from its `prescriptionHash` (or the
source's own definition). Step alternatives and rest/transition steps are never summed. Optional
steps count as prescribed, as in `comparePlannedVsPerformed`. A `reduced` execution with no
`prescriptionHash` has no pinned reduced definition, so `plannedSets` is `unavailable` rather than
the authored count. A missing, invalid or unreadable definition leaves `plannedSets`
`missing`/`invalid`/`unavailable`, never 0. One prescription is one denominator: an occurrence
linked to more than one structured execution (for example an abandoned run and a re-run) is
unresolved, as `canonicalBroadHistory.ts` treats multiple structured sources, so `plannedSets` is
`unavailable` while `workSets` and `warmupSets` still sum the real performed sets of every run, and
the compact line then prints no ratio (`9 work sets (+1 warm-up) (planned: unavailable)`).
`workSets` counts live, non-choice, non-warm-up entries with the runner's set rule (a left/right
hold is one set once both sides are logged); `warmupSets` counts live entries flagged
`isWarmup`. A warm-up *block* is not a warm-up set: its exercise steps count toward
`plannedSets`, and sets logged on them without the flag count as work. Linked provider work is
never added. An
unreadable or missing linked execution leaves all three `unavailable`; an occurrence with no
structured execution reports them `not_applicable`. `linkedResponseIds` lists, ordered by date
then id, the session responses whose `sourceSession` is `{ kind: 'execution', id }` for one of the
occurrence's `structured_execution` refs. `SessionResponse.occurrenceId` is a planning identity
and is never used as this link. The field is `unavailable` when responses or the execution refs
could not be read and `not_applicable` without structured work.

Response reads use recorded response dates, including later-day/next-morning records.
Assessment loading reuses the brief's bounded goal/completed-attempt discovery and current
head validation, with at most twelve bindings and one hundred attempts per protocol. It
exports recorded observations, not benchmark verdicts. Competition outcomes use a validated,
ID-ordered scan of at most 200 records plus a truncation sentinel and filter by Warsaw date;
a scan limit reports `unavailable`, not completeness. Invalid bounded rows report `invalid`.

External-plan reads reuse the plan list, header, activation, immutable revision and current
placement and placement-history readers. Each exported revision is content-hash verified. Latest revision import
times come from the header; older activation records preserve the same import instant
written by the import transaction. Revisions referenced by performed work are read alongside
activation history. Authored links require the execution content hash and session id to
match that verified revision. A missing referenced execution makes linkage unavailable;
it never becomes measured absence. The link keeps the recorded execution session date,
not a date subsequently moved in the mutable overlay. The builder retains revisions referenced
by in-window placements or performed links plus the latest revision per plan, even when a
current placement has moved outside the window. Placements with recorded history are reconstructed as of the export date; their
`statusHistory` contains the dated before/after events and explicit successor links. Successor
links are written when a revision that declares `replacesSessionId` is imported: the replaced
session's placement in the previous revision becomes `superseded`, and its event names the
replacing revision and session (`docs/external-plan-schema.md`, #1172). An export
date before the first recorded event uses that event's previous snapshot, with `statusHistory`
left `not_yet_supported`.
A save over a corrupt current overlay, or a corrupt legacy fallback, still writes the new overlay.
Its event records `previous: []` with `previousState: 'invalid'` and a `previousStateReason`
code (`current-schema-invalid`, `current-identity-mismatch`, `legacy-schema-invalid` or
`legacy-identity-mismatch`). It never fabricates previous assignments, and it retains no
successor from the corrupt overlay. An overlay that claims another owner is never overwritten.
Each `statusHistory` entry carries `previousState` (`recorded` or `invalid`) and
`previousStateReason`. An invalid-prior event appears in the history of every placement of
that revision, with a null `previous`. It never reads as "no assignment before". Sessions in
the last recorded snapshot but absent after the repair save are exported as removed. An export
date before a first event whose prior state is invalid cannot be reconstructed. That
revision's placements are omitted, and the placement and override collections report `invalid`.
Each revision's placement history is read in document-id-ordered pages of 200
(`PLACEMENT_HISTORY_PAGE_SIZE`), up to a hard bound of 2,000 events
(`PLACEMENT_HISTORY_MAX_SCANNED_EVENTS`) plus one truncation sentinel. A revision beyond that
bound degrades alone. Its placements fall back to the current overlay, and their
`statusHistory` is `unavailable`, never partial history. Other revisions, and the placement
source state, are unaffected. The current overlay stands for the as-of state only if its
`updatedAt` falls, as a Warsaw date, on or before the export date. A later or unreadable
`updatedAt` omits that revision's placements, and the placement and override collections report
`unavailable`. A failed history read still reports the whole placement source `unavailable`. A repair event is recorded after the corrupt overlay's own canonical
`updatedAt`, so it cannot sort before the last recorded change.
Earlier legacy history and successors absent from legacy superseded assignments remain unknown; titles are never used to infer successors. Placements
without history remain current overlays and are never claimed as immutable history.

All source reads produce `SourceState` entries. Rejected reads report `unavailable`;
validated corrupt sources report `invalid`; genuine absent documents report `missing`.
Partial bounded discovery never becomes measured emptiness. Nutrition adherence inherits a
failed or invalid check-in read state rather than claiming no adherence was recorded.
`readAt` is an export/read provenance instant; `newestObservedOn` stays null when the reader supplies no trusted
source-level metadata. Errors or source document paths never enter the exported file.

## Dates, information bounds and determinism

### Recorded advisory flags (#1153, #1165)

The authenticated app captures only the current Warsaw date at initialization, daily
refresh, and check-in/plan/settings/occurrence changes. Capture is independent of
recommendation composition and non-blocking. It does not run in Python sync: days the app
is not opened or refreshed have explicit gaps. Export never writes or retrospectively
evaluates flags against today's mutable inputs.

`flagCaptureService` reads validated recovery, check-in, structured injuries, external
placements (including fixed-activity occupancy), scheduled/active/completed occurrences,
and pinned execution definitions. Injury flags use
`external_plan:<planId>@<revision>:<sessionId>` or `occurrence:<occurrenceId>`;
matching external occurrences are deduplicated and their pinned dose is used when present.
A readable day with zero planned sessions records `false / not_applicable` and
`no_planned_session`, rather than treating rest as a missing session. Failed/corrupt
sources remain `unavailable`/`invalid`, not user non-entry.

Each `users/{uid}/flag_evaluations/{revisionId}` document preserves the evaluator's
definition version, original evaluation instant, inputs and human-readable `threshold`
rule. Its SHA-256 identity excludes the evaluation instant but includes the dated
evaluation, source-evidence digests and optional session scope. Identical retries retain
the original document; changed evidence creates a new immutable revision. Rules permit
owner reads/creates only and deny updates/deletes; the parser validates nested values.

The export reads date-ordered pages of 200 with a 2,000-record bound plus one sentinel.
Corrupt history reports `invalid`; failed/truncated reads report `unavailable` and
discard partial results. The source inventory includes `flag_evaluations` and an
optional failure reason. Every date and flag id in the export window is represented;
uncaptured pairs are `null / not_recorded`, with no synthetic inactive history.
Recorded versions retain input transitions. HA7 is not released: `illness_anomaly`
is always clamped to `null / not_yet_supported`, with reason
`ha7_release_gate_unmet`; no raw shadow-assessment result is exposed.

### Derived baseline leaves

`DerivedMetric.metrics` carries individually state-bearing numeric leaves. The
container's scalar `value` is null/`not_applicable` when readable because there
is no single aggregate value. Missing/corrupt/unavailable sources retain their states.
Biometric leaves use the as-of snapshot's 7d/28d readiness and stored averages,
variability and units. Source-specific multisource/identity pipelines are not activated.

Phase 2b adds `<field>_delta28d` leaves (`baselineDeltas.ts` `BASELINE_DELTA_KEYS`):
`biometric_baselines` carries `sleepScore_delta28d` (vs `sleepScore28dAvg`),
`restingHr_delta28d` (`restingHr28dAvg`), `hrvOvernightAvg_delta28d` (`hrv28dAvg`) and
`respirationAvg_delta28d` (`respiration28dAvg`); `subjective_baselines` carries
`<field>_delta28d` for the six check-in scores against `<field>_longAvg`. Each is the as-of day's
value minus its baseline, in the value's unit, rounded to thousandths. It is `measured` only when
the value and the baseline are both measured and describe the same semantic date. Otherwise the
value is null with the worst contributing state (`stale` when a measured value describes an
earlier date). Metrics with no matching baseline, including D−1 `totalSteps`, get no delta.

Subjective baseline computation uses the extracted estimator over the 28 days strictly
before the as-of date. The six dimensions are readiness, sleep quality, fatigue,
soreness, mental stress and motivation on their recorded 1–10 scale; leaves expose
recent/long averages, variability and complete distinct-day counts. Insufficient coverage
leaves averages missing. The service reads enough prior check-ins even for a morning
export, while `facts.checkins` remains bounded to the requested export window.

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
ADR-0052 extraction and device evidence gates. Client capture cannot fill earlier missed
dates; a qualifying D-EVAL block still requires sufficient recorded flag coverage,
legacy placement history before event recording, and the owner-completed protocol
retest-interval table. Explicit gaps are not passing evidence.
