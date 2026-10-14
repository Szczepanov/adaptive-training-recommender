# Session execution and saved-template lifecycle

Cross-cutting accessibility, mobile touch-target, modal focus, and UI verification requirements
come from [`docs/standards/ui-ux.md`](../standards/ui-ux.md) (including the active-workout
**focused and capable** experience contract). Design rationale lives in
[ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md); this document
describes the current application behavior for source-neutral session execution.

## Content and persistence boundary

`SessionDefinition` is executable content only. A custom definition revision is stored at
`users/{userId}/session_definitions/{definitionId}/revisions/{revision}` as a flat document
whose envelope adds `userId`, `definitionId`, `contentHash`, and `createdAt`.

`parseSessionDefinitionRevisionDocument` validates that envelope against the requested path,
selects the closed `SESSION_DEFINITION_KEYS` content set, and then runs
`validateSessionDefinition`. `SessionDefinitionService.getDefinitionRevision` recomputes the
canonical `hashSessionDefinition` before returning the definition. Invalid identity, envelope,
schema, or hash data returns `INVALID`; executable content is never silently repaired.

This one verified service read is used by preview, starting a saved template, manual-source
resolution, and active-session restoration. Existing correctly written revisions need no
migration: their storage shape is decoded as an envelope rather than mistaken for domain
content.

## Imported-plan scale verdicts and structured Start

Manual replacement first records a scheduled `replace_recommendation` intent. Home applies
the existing authored-session gates and freezes its accepted prescription before
`RecommendationService.saveRecommendation` transfers authority. That transaction archives
the prior recommendation, saves the exact `authoredOccurrence` and primary binding, supersedes
only the prior scheduled primary, and releases its owned window. Home exposes the replacement
Start only after the commit succeeds. A started primary cannot be displaced: its execution
lock also blocks transfer while occurrence lifecycle updates are catching up, and execution
creation rules reject a stale launch of an already-superseded occurrence.

A completed or abandoned replacement retains its committed recommendation and frozen
prescription; a later Home recompute does not re-adjudicate it or erase replacement provenance.
Intraday v4/v5/v6 primaries seal their resolved order/window while still scheduled, before
Start. Started members require that persisted binding; replay never reconstructs it.

An external-plan `proceed` verdict may bind the imported v2+ `SessionDefinition` as written,
and Start launches that binding only while no time-crunch alternative or load adjustment is
applied: either one keeps the binding but changes the displayed dose, so `MorningDecisionCard`
withholds Start, Resume and Redo for any imported-plan binding until the adjustment is reset.
A `scale` verdict is different: executing the original blocks would silently run the full
authored dose, while deriving replacement steps from free text `reducedSummary`/
`reducedDurationMin` would violate ADR-0019's no-parse/candidate boundary. The only executable
scaled form is an `external-plan@6` session's explicit `scaling.reducedDefinition`.

Under `scale`, Home composes the launch binding through `sessionAuthoringService`
`prepareExternalPlanSessionLaunch` with `useReducedDefinition`, which freezes that exact reduced
definition (its own `definitionHash`, distinct from the full definition's) within the adjudicated
duration ceiling, and fails closed when the session has no reduced form. `MorningDecisionCard`
offers **Start** for a `scale` verdict only when `sessionLaunch` `isPreparedReducedExternalBinding`
holds. Home records runtime-only launch evidence after preparation: the requested variant must be
`reduced`, its adapter-returned content-addressed `prescriptionHash` must exactly equal
`primarySession.prescriptionHash`, and that binding must name the same external plan, revision and
session. The imported session must also be `reducible: true` with a structured
`reducedDefinition`. This extra proof is required by ADR-0023 D-MSNAP because full and reduced
snapshots deliberately share source identity; plan/revision/session alone cannot prove which
immutable bytes will run. The runtime evidence is not persisted separately because the durable
recommendation/audit already pins the exact primary binding and prescription hash. A time-crunch
alternative or load adjustment still withholds Start, Resume and Redo until reset because it changes
the displayed dose without freezing another imported snapshot. A scale without a reduced form
(pre-v6 plans, or v6 sessions that omit it) presents the reduced summary and dose with no Start, and
`skip`/`defer` never start regardless of any binding.
`ExternalVerdictBanner` never shows the original detailed step list as if it were the reduced
workout, and its launch note states which of those cases applies. This is an execution-snapshot
boundary, not a new recommendation rule, so it does not change `POLICY_VERSION`.

## Catalog warm-ups and execution logging

Catalog strength prescriptions begin with an explicit `warmup` block. The catalog adapter preserves
that role, step dose/rest, and any bounded structured load into the content-addressed execution
prescription. The runner shows the load instruction as stored; it does not derive a kilogram target
from a percentage or profile during rendering.

The source-neutral session contract owns a bounded movement-family vocabulary used by
`compositionPatterns`, for example `unilateral_lower_body`. Catalog exercises are one producer
of this metadata, but the vocabulary is not owned by the workout evaluator. An authored workout
can declare composition requirements against step identities, and variants that intentionally omit
a required family carry an explicit relaxation reason. The catalog adapter snapshots both the
requirement state and each step's structured patterns into `SessionDefinition` and the execution
prescription hash. Manual and imported sessions may provide the same structured step evidence; a
missing tag remains unknown and titles/notes are never parsed for movement intent.

Persisted prescription metadata is shape-validated on read. Catalog replay then verifies the
definition hash and re-validates the reconstructed `SessionDefinition`, including requirement-to-
step evidence, so a self-consistent but semantically malformed composition snapshot fails closed.
Completed entries are joined by step identity: a completed required component is reported with its
catalog exercise identity when known, while a completed session with no performed component is
reported as omitted. This composition evidence does not create another weekly strength occurrence
or change exact-role coverage.

For a repetition step, `SessionRunner` passes the active block role into `RepetitionInputCard`.
Entries from a prescribed `warmup` block default to `isWarmup: true`; other blocks default to false.
The athlete can correct the checkbox before logging, and the recorded value remains the historical
fact used by downstream strength-volume and estimated-1RM exclusion filters. Stored execution
prescriptions carry their blocks and display metadata, so a later catalog warm-up revision cannot
rewrite an already-started or historical session.

Repetition submission is single-flight at the input surface: while one set is being persisted, a
second Enter/click is ignored and the log button is disabled. This prevents rapid duplicate submits
from deriving the same ordinal `setIndex` from one rendered entry snapshot. Rest timing is deliberately
separate from persistence timing: the countdown starts when the set is optimistically accepted into
the execution UI, before the asynchronous write. A delayed write completion therefore cannot restart
a timer that the athlete has already skipped or adjusted. The timer remains advisory and does not lock
the set form. The live elapsed and rest displays are re-derived from wall-clock timestamps on every
repaint -- the one-second interval is only a repaint trigger, and a visibility/focus return resyncs
immediately -- so a backgrounded tab that missed callbacks shows the correct value instead of a
callback count that drifted low. A rest deadline that passed while hidden completes exactly once with
its real elapsed time; reloading never resumes an in-flight rest.

Rest omission is block-aware. Authored rest is always preserved. Outside warm-up blocks, a step with
no authored rest retains the runner's legacy 60-second advisory fallback. Inside a structured warm-up,
omission means no countdown is invented: simple preparation drills flow directly into the next drill,
while lift-specific rehearsal that needs recovery must carry an explicit authored rest value.

The active exercise and its logging controls lead the runner; the authored step navigator follows
them and remains available for manual navigation. Automatic progression follows required
prescription only: untouched optional steps remain available from the navigator but are never made
required merely by auto-selection. In sequential blocks, completing the prescribed required work
selects the next required step. In rotating blocks, each completed turn selects the next required
movement from persisted group progress; an all-optional rotating block is entered only by explicit
manual selection. Completing the final required movement opens the existing completion sheet, where
the athlete still reviews and saves the session. The runner and performed-vs-planned completion
summary share the same prescribed-target resolver: when a block declares `rounds`, that block-level
round count is authoritative over an individual step's set count.

For a duration step with `laterality: 'per_side'`, each hold is a separate `SessionEntry` carrying
`side: 'left'` or `side: 'right'`. The runner reconstructs the next side from those entries after a
resume. A lone side is retained but does not complete a prescribed set, start its rest, or advance
the runner; the matching side completes one set. Older duration entries without a side remain one
completed set.

## Durable diary writes and correction history

`SessionExecutionService` is the diary write authority. Entry logs, corrections, deletion,
restoration and closed rests batch the materialized target, an immutable `diaryMutations`
record, and the execution's `updatedAt` touch. Firebase's persistent local cache is the
only replay queue; there is no component retry queue. Successful execution claims seed the
full readable execution cache before returning, because transaction writes alone do not
populate that cache and a later offline timestamp merge could otherwise leave a partial
parent document.

Entry ids are minted once by the runner. The initial log marker is deterministic from that
id; replaying a log never overwrites a later correction. Rest markers retain the caller's
deterministic closed-rest identity. Corrections preserve full prior and updated values in
the audit record. Rules require the prior values to match the current entry, rejecting a
stale competing correction instead of silently losing either tab's intent. Same-entry
read/mutate/accept operations are serialized within the service, including rapid delete/undo.

Deletion writes `deletedAt` on the existing entry, retaining identity and performed values.
Normal entry reads and the TO4 evidence preparation exclude tombstones. Undo restores the
retained entry through a new audited mutation; the latest tombstone is discoverable after
reload. Legacy records without diary metadata remain readable and can enter the new write
discipline without backfill. Audited entries cannot be physically deleted or rewritten
without their matching audit record.

The runner separates local acceptance from backend acknowledgement. A mutation-marker
snapshot confirms the atomic batch entered the SDK's local queue, releasing the form while
offline. The status is `pending` before local acceptance, `queued` while local writes await
the server, `synced` after acknowledgement, and `unavailable` for failure. Live entry
snapshots refresh the displayed state after reconciliation with the server.

Owner/execution/mutation-scoped local storage receipts retain accepted intent until matching
server audit bytes confirm it. These receipts never replay writes. They are necessary because
the SDK restores queued writes after reload without restoring their original rejection
callbacks. A missing audit after a server-confirmed, drained queue retains a `failed` receipt
and the attempted values, exposed by `getDiaryReceipts`, rather than reporting `synced`.
The dedicated diagnostic/export surface remains WP5 of #895. Browser storage errors prevent
local acknowledgement. If Firebase's persistent cache is unavailable, its existing warning
still applies: receipts preserve intent, but the memory-cache fallback cannot guarantee
automatic replay after reload.

Deploy the additive diary/tombstone rules before a frontend using this contract. No historical
migration is required. Keep audit records and tombstones on rollback; older clients may be
unable to edit audited entries under the integrity rules, so a forward fix is preferred.

## Terminal lifecycle and exact resume

`SessionExecutionService.transitionExecutionTerminal` waits for queued writes, reads persisted
state and admits one atomic terminal winner. Completion evidence and deterministic 1RM updates
commit with that winner. A racing loser rereads the execution and returns its proven terminal
state; an unrelated failure is rethrown. Rules deny reopening or deleting terminal executions.
Explicit redo advances the slot lock to one new successor and retains its predecessor; competing
redo clients resume the same successor. Abandonment retains the diary.

`convergeCompletedExecution` repairs the immediate response, occurrence and reconciliation from
durable `completionEvidence`, independently retrying each projection. Existing response corrections
are preserved. The runner retries terminal history on mount and reconnect, including prior dates
and predecessors with an active successor. Daily tissue feedback remains a check-in write before
completion; it is not copied into terminal response evidence.

Reconciliation retries refresh supplied source metadata through
`PerformedTrainingOccurrenceRepository.createOrGetForSource`. The transaction rereads the
source claim and follows merged records before updating its current owner. The source key,
canonical occurrence identity and reconciliation decisions remain unchanged; absent metadata
does not erase known fields, and provider updates do not overwrite a structured timeline.
Identical retries do not write. `reconcileDateRangeForUser` refreshes linked sources before
its existing duplicate repair, so late detail can make a `single_source` pair matchable.
Persisted `ambiguous` records still require manual resolution, including when later detail
would otherwise support a match. Manual links and bilateral unlink/keep-separate exclusions
remain sticky through refresh and repeated sweeps.

New fixture, manual, external-plan and catalog launches store a self-contained
`definitionSnapshot` in their immutable prescription. The snapshot covers executable metadata
and blocks; source identity is reconstructed from the pinned `SessionSourceRef`. Launch reads
the committed prescription into the persistent cache before returning. Historical prescriptions
retain their original hashes and exact-source compatibility checks; no records are rewritten.

Resume reads all materialized entries, including tombstones, and overlays queued receipts only
when their before/after bytes form one causal chain consistent with a persisted chain state.
Timestamp ties do not define causality. Failed receipts retain attempted intent but never count
as performed work. Live watchers reproject after local acceptance, acknowledgement and rejection,
so a rollback arriving before receipt classification cannot leave rejected values displayed.

`projectSessionProgress` shares prescribed-set and group accounting with the live runner:
warm-ups and choice records do not advance work, block rounds remain authoritative, unpaired
holds stay on their movement, and untouched optional work is skipped. Recorded choices can end
a block or session. Manual navigation is honored while live; an unlogged cursor is not invented
after reload. Rest deadlines are cleared rather than reconstructed.

Missing/invalid prescription bytes or a conflicting diary produce degraded resume. The runner
retains the execution and entry evidence, pauses logging and new starts, and offers Retry recovery.
It never substitutes current fixture/catalog/plan content for missing pinned bytes. Navigation and
discoverability remain follow-up work under #723; failure diagnostics are described next.

## Failure observability for canonical workouts (#895 WP5)

An incomplete workout in the canonical Activities view names *which* of the eight #895 §10
failure states holds instead of rendering "no data". Policy effect: none (display and export
only; `POLICY_VERSION` is unchanged).

**Layers.** `activitiesReadModelService.getCompletedWorkoutsInRange` records what each source
read actually returned in `CompletedWorkoutView.sourceReads` (structured read, provider read,
device-local outbox snapshot, reconciliation sweep outcome) instead of collapsing absent,
unreadable and unresolved into `undefined`. The pure `training-occurrence/workoutSourceDiagnostics.ts`
`projectWorkoutSourceDiagnostics` turns a view into one assessment per state;
`workoutSourceDiagnosticsExport.ts` builds the bounded export; `WorkoutSourceDiagnostics.tsx`
renders it. Every assessment is a closed union: `holds`, `clear`, `not_applicable` or
`not_observable`. **`not_observable` is never rendered as empty, zero, healthy or synced.**
States are independent, so co-occurring failures are all reported.

| # | State | Derived from | Notes |
|---|---|---|---|
| 1 | `session_execution_absent` | `sourceReads.structured` | `no_execution_linked` (Garmin-only) or `execution_document_missing`; an unreadable/invalid execution is `not_observable`, never "absent" |
| 2 | `entry_write_unsettled` | `sourceReads.outbox` (`sessionDiaryReceipts`) | `queued_writes` / `failed_writes`, both reported when both exist. **Receipts are per device**: zero receipts is `not_observable` (`receipts_are_device_local`), not "synced"; an unreadable store is `receipts_unreadable` |
| 3 | `garmin_activity_absent` | `sourceReads.provider` | `no_provider_linked`; `activity_not_in_read_window` (the read window is bounded, so this is deliberately not "deleted"; also reported when one of several attached Garmin refs is missing); unreadable activities are `not_observable` |
| 4 | `garmin_detail_unavailable` | `NormalizedGarminActivity.exerciseSets` | `exerciseSets` is written only when the detail endpoint succeeded. Present means `clear`. An omitted key on a strength activity is `not_observable` (`detail_fetch_outcome_not_persisted`): failed, rate-limited and never-attempted are not distinguishable because Python only logs fetch failures (follow-up #1051) |
| 5 | `garmin_detail_empty` | `exerciseSets` | `[]` is durable proof of a successful fetch with zero sets, so it `holds`; absent detail cannot be called empty (`detail_not_stored`) |
| 6 | `reconciliation_no_candidate` | `reconciliation.state` + sweep outcome | `single_source` after a *completed* sweep, or `manually_separated` from sticky exclusions. A failed, incomplete (unreadable Activities or a swallowed per-source error) or skipped sweep is `not_observable`, as is the unmarked other half of a persisted ambiguity (`counterpart_ambiguous`: ambiguous provenance marks only the side that was created and stores no candidate ids, so an opposite-kind single-source row within a day of an `ambiguous` one is never told "no candidate"; the two local days just outside the displayed window are read too, and an unreadable edge marks edge-day rows as possible counterparts). An unevaluated source is not "no candidate" |
| 7 | `reconciliation_ambiguous` | persisted `ambiguous` | Distinct from 6; persisted ambiguity stays manual-only (WP4) |
| 8 | `read_model_projection_failed` | `sourceReads` + window error | Per-workout reasons (`execution_unavailable`, `execution_invalid`, `definition_unresolved`, `entries_unavailable`, `provider_activities_unreadable`); a whole-window rejection renders a named alert and a failed export, never an empty list. Individual malformed entry documents are dropped by `getEntries` and are not counted (the `clear` wording says so) |

`sourceCompletenessFor` maps the reads onto the existing planning-side `sourceCompleteness`
shape of `TrainingResponseSessionEvidence` (#914/#916) and the export carries it, so the two
stay comparable (several attached provider sources are `ambiguous`, as there); the per-state
reasons refine that vocabulary rather than fork it.

`ReconciliationOutcome` is a return value, not persisted. The persisted `single_source`,
`matched` and `ambiguous` provenance maps to `created_single_source`, `attached_auto_link`
and `ambiguous`; any manual decision (link, unlink, keep-separate) is `not_observable` as a
matcher outcome. `error` is observable only in aggregate: `reconcileDateRangeForUser` now
reports `activitiesReadable` and `sourceErrors` (additive; reconciliation behaviour is
unchanged), and `loadCanonicalActivitiesWindow` turns a thrown, partial or errored sweep into
`failed` / `incomplete`. `already_linked` is not observable per workout. An empty window is
worded as "nothing recorded" only after a `completed` sweep, and its export header carries the
sweep status. `permission-denied` reads still fail the whole window rather than one row; other
entries-read failures are confined to their row.

`computeHistoryShadowDiffForUser` returns `null` when a structured source is *transiently*
unreadable (`execution_unavailable`, `entries_unavailable`, definition `UNAVAILABLE`), rather
than logging a false evidence-tier regression. Persistent states (`execution_missing`,
`execution_invalid`, definition `MISSING`/`INVALID`) keep diffing so one such row cannot silence
the shadow diff for every window that contains it.

`loadCanonicalActivitiesWindow` resolves to `available` or `projection_failed`; both carry the
sweep outcome, so the failed-window export reports what actually happened. An export whose
caller never observed the sweep says `unknown`, which is not the same as `not_run`.

**Surface.** Real gaps and unreadable dependencies show a visible "Some data is missing or
unknown" notice per card. Expected single-source facts (a structured session without a watch
recording, a Garmin ride without a plan) stay in the collapsed "Source diagnostics" list, which
always shows all eight checks with their issue numbers. Status is spelled out in text.

**Export.** "Copy source diagnostics" is user-initiated and bounded (newest 100 workouts,
20 source keys each, deterministic ordering). It contains ids, source keys, states, reasons and
timestamps only: no telemetry, exercise data, titles, actors, free text or credentials. A failed
window exports `projection: "failed"` with `null` counts, never `0`.

## Per-consumer double-count closure (#895 WP6)

One physical workout (a structured execution plus a matched Garmin recording) must be counted or rendered once by every consumer that already reads canonical authority. `engine/tests/perConsumerDoubleCountInventory.test.ts` pushes one shared fixture through each migrated consumer; the suites in the last column prove arrival order, ambiguity and pending reconciliation.

| Consumer | Authority | Counts once because | Deeper proof |
|---|---|---|---|
| Weekly coverage credit (`coverage.ts` `resolveCoverageHistory`) | canonical when `performedTrainingFacts` is supplied, even empty; legacy only when null/undefined | credits are keyed by performed occurrence, not by source | `engine/tests/canonicalCoverageCreditCutover.test.ts` |
| Planning/diagnostic brief table (`contextBrief.ts` `renderCanonicalTrainingTable`) | canonical, with raw-provenance fallback | one row per canonical fact; raw provider rows are provenance, never added to totals | `engine/contextBriefTrainingDedupe.test.ts` |
| Response summary (`contextBriefResponseSummary.ts` `deriveKeySessionSummaries`) | canonical occurrence evidence | a loaded Garmin source suppresses the structured-only duplicate; a missing row falls back to one structured-only summary | `engine/contextBriefResponseFeatures.test.ts`, `engine/contextBriefResponseArchitecture.test.ts` |
| Daily ledger (`dailyLedger.ts` `computeDailyLedger`) | authored session occurrence (planner and Home ledgers also key fixed activities by `fixedActivityOccurrenceKey`) | keyed by `occurrenceId` with highest-`revision` wins; the input mapper (`intradayLedgerInputs.ts`) takes session occurrences plus optional linked execution facts and no provider activity, so structured+Garmin cannot double-spend through it | `engine/dailyLedger.test.ts`, `engine/intradayLedgerInputs.test.ts` |
| Morning-brief D-1 section (`contextBriefPlanningHandoff.ts` `morningAdherenceEvidence`) | canonical facts for yesterday | linked Garmin rows are labeled observational evidence for the canonical session; an unmatched activity is isolated | `engine/contextBriefContract.test.ts` ("links Garmin evidence to one canonical D-1 session and isolates an unmatched activity") |
| Completed-training history and fatigue (`completedTraining.ts`, `fatigue.ts`) | **legacy**, not migrated | out of scope: TO-owned, gated by #872 | completed-training history dual authority is measured by the opt-in `training-occurrence/historyShadowDiff.ts` diagnostic (fatigue is not covered by it); the inventory test pins that these files do not import canonical occurrence authority |

Unmigrated consumers are labeled, not asserted canonical. Moving one onto canonical facts is a separate change that must re-run this inventory.

Residual not proven by this inventory: the reserved-identity hydration path hardened under #917 has no dedicated row (not a known defect). The inventory test proves that independently rebuilt coverage snapshots before and after provider enrichment each give one credit; it does not exercise an incremental update to retained credit state.

## Diary authority guards and arrival-order guarantees (#895 WP7)

**Write authority.** In the app (`app/src`), `services/sessionExecutionService.ts` is the only production module that builds Firestore references into `session_executions`, `session_execution_locks` or `diaryMutations`. `manualRecommendationReplacementService.ts` is the single audited exception and may only `get` the deterministic execution lock. `sessionDiaryWrite.ts` and `sessionDiaryReceipts.ts` are imported only by the execution service. Engine, response, observation, outcome and knowledge modules never import the diary-write path directly; their import graph cannot reach it (lazy `import()` counts, except from the three orchestration entry points `rules.ts`, `trainingIntent.ts` and `replay.ts`), except the engine's `firestoreTrainingHistory.ts` read adapter, which is allowlisted by name; both the adapter and `strengthHistoryReadService.ts` are checked to reference only the audited `getSessionsInRange` / `getExecutionsInRange` methods. `sessions/diaryAuthority.architecture.test.ts` enforces all of this, including stale-allowlist checks.

**Structured identity.** When a structured execution exists, its session identity, modality, cost semantics and weekly-role credit are not changed by provider recognition or a provider modality override (`training-occurrence/structuredIdentityAuthority.test.ts`, session level). Provider exercise sets are diagnostic only (`garminExerciseSetsAreDiagnosticOnly`; `components/CompletedWorkoutList.test.tsx`).

**Planning payloads.** The persisted response-telemetry types are pinned to normalized summary fields (no raw 1 Hz trace fields) by `engine/contextBriefResponseArchitecture.test.ts`.

**Arrival order and manual decisions.** Execution-first, provider-first, late provider detail, late offline execution, same-source device updates, concurrent enrichment, two genuine same-day workouts and persisted ambiguity converge to the same stable occurrence identity (`emulator/reconciliationOrdering.emulator.test.ts`). Manual link, unlink and keep-separate decisions survive source enrichment, retry and repeated reconciliation sweeps. That proof drives the reconciliation sweep with decisions seeded through the repository. Python daily `sync` never writes occurrences or source links and the explicit `backfill-training-occurrences` command is create-only (`tests/test_training_occurrence_backfill.py::test_manual_reconciliation_preservation`); the UI link/unlink click wiring is unit-tested (`CompletedWorkoutList.interaction.test.tsx`, `completedWorkoutActions.test.ts`); the `DataView` and `CanonicalActivitiesPanel` glue between them is not. A browser-level click against the emulator, real Garmin arrival timing and real-device behavior remain unproven.

**Limits.** Synthetic and emulator proofs do not establish cold-offline app launch, real-device storage durability, a real network drop mid-write, real Garmin arrival timing, or set-logging latency between sets.

## Custom-template lifecycle

The collection document is a mutable `SessionDefinitionHeader`; definition revisions are
write-once. `saveDefinitionRevision` validates and hashes the definition, then batch-writes the
new revision and latest-revision header atomically.

* **Save** creates a new definition at revision 1 and refreshes the session picker.
  Save is a secondary action inside the completion dialog rather than the active-run top bar,
  so it cannot fire accidentally mid-set. Opening its title editor keeps the completion dialog
  mounted but hidden/inaccessible while the title editor owns the modal layer; existing sRPE,
  completion fraction, unexpected-fatigue, notes, and tissue-feedback draft values therefore
  survive save or cancel. The saved template still derives from the raw working definition.
* **Edit** loads the verified latest revision and saves the same definition ID at revision N+1.
* **Duplicate** loads the verified latest revision, assigns a new definition ID, and saves
  revision 1.
* **Archive** marks the header `archived`; it does not delete revisions or historical
  references. Archived templates can be previewed and restored, but cannot start until
  restored.

Headers written before lifecycle support omit `status`; readers treat them as `active`.
New headers always write `active` or `archived`, with `archivedAt` only for archived headers.

## Reusable content versus one-time execution choices

The runner retains a raw working definition and may expose a choice-resolved effective
definition for the current execution. Saving a custom template derives from the raw working
definition: deliberate exercise substitutions are retained, but a one-time selected choice is
not baked into the template while leaving the same option set available for a later execution.

## Rules and tests

Firestore rules enforce user ownership, immutable revision creation, valid header lifecycle,
and the full allowed definition field set including `companionSessions`. The parser and service
tests cover writer-shaped documents, strict envelope validation, hash mismatch, batched writes,
and archive/restore. Visual coverage exercises custom-template preview and the archived library
at desktop and 390px mobile widths.
