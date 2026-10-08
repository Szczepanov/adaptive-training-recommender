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
It never substitutes current fixture/catalog/plan content for missing pinned bytes. The broader
diagnostic and navigation surfaces remain follow-up work under #895/#723.

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
