# Issue #893 — Adjusted implementation plan: external-coach structured round trip

**Status:** In progress
**Reviewed:** 29 September 2026
**Repository baseline reviewed:** `main` at `8f788a5d61421c8da15e355ac124f6f622adbcc4`
**Issue:** https://github.com/Szczepanov/adaptive-training-recommender/issues/893

**Delivery update (30 September 2026):** WP1.1 and WP1.2 are implemented. WP7.1 now has an
integrated browser happy path from an initial planning brief through v6 import, logged structured
execution, and exact next-brief provenance. WP7.2 remains partial: provider enrichment, partial /
abandoned execution, and the listed revision, replacement, rest, multi-session, retry, and
cross-user variants still need integrated coverage. Keep #893 open until those proofs land.

## 1. Goal

Make the external-coach workflow a first-class, exact, replayable loop:

```text
planning Context Brief
→ external structured authored intent
→ human review/import
→ deterministic plan/revision authority
→ app safety/readiness/feasibility adjudication
→ canonical SessionRunner execution
→ canonical performed occurrence + provider enrichment
→ exact planned-vs-performed state in the next planning brief
```

The external coach owns **selection intent**. The application continues to own validation,
calendar authority, readiness/safety/feasibility adjudication, executable-dose authority,
execution identity, persistence, reconciliation and provenance.

The implementation must preserve:

- ADR-0019 selection/adjudication separation;
- ADR-0023 source-neutral session definition / immutable execution-prescription architecture;
- ADR-0034 separation of planned `SessionOccurrence`, `SessionExecution`, provider evidence and
  `PerformedTrainingOccurrence`;
- Europe/Warsaw local-date semantics;
- immutable external-plan revision bytes;
- historical recommendation/audit/execution evidence;
- one actionable planning authority per date.

---

# 2. Review summary — material changes to the supplied draft

The supplied plan is directionally correct, but current `main` changes several implementation
decisions.

## 2.1 Do not make `external-plan@5` the final #893 write contract

`external-plan@5` is the newest accepted schema, but it inherits v4's session contract unchanged.
Its `scaling` block can carry `reducedSummary` / `reducedDurationMin`, not a second executable
`SessionDefinition`.

Current production behavior correctly refuses to bind the original full structured definition
under a `scale` verdict. That means v5 cannot fully satisfy #893's round-trip requirement for:

- **performed with dose modification from app adjudication**, while
- still executing the exact accepted structured prescription through `SessionRunner`.

**Decision:** introduce `external-plan@6` as the canonical emitted/write contract for #893.
Keep v1–v5 readable and importable without migration.

v6 should inherit v5 and add only the missing executable scale representation, rather than
forking scheduling, rest, intraday, intent-block or session-definition semantics.

Recommended shape:

```ts
scaling?: {
  reducible: boolean;
  reducedSummary?: string;
  reducedDurationMin?: number;
  minimumUsefulDurationMin?: number;
  fallback?: string;

  // v6: optional exact reduced executable form.
  reducedDefinition?: SessionDefinition;
}
```

Rules:

- `reducedDefinition` is a **same-session reduced-dose form**, not an alternative modality.
- it must pass normal `SessionDefinition` validation;
- it remains subject to the parent session's gating/readiness/safety/feasibility authority;
- it is covered by the plan content hash;
- the accepted execution is frozen into its own `ExecutionPrescription` and
  `prescriptionHash`;
- free-text `fallback` remains advisory only;
- an alternative modality/session remains a separate structured candidate and must pass its own
  gates;
- if a `scale` verdict has no structured `reducedDefinition`, structured Start remains withheld.

This is a schema change, not a reason to reinterpret v1–v5.

## 2.2 Fix revision-effective history before exposing a selectable effective date

The current storage model has a correctness hole that the supplied draft did not identify.

`externalPlanService.import` stores all immutable plan revisions, but
`external_plans/{planId}` is a **single mutable latest header**. The header contains
`revision` and `supersededFrom`.

`activeExternalPlanService.getActivePlanState` reads only that latest header and filters it by
`supersededFrom`.

Therefore:

1. revision 1 is active;
2. revision 2 is imported today but selected to become effective next Monday;
3. the latest header immediately points to revision 2;
4. dates before next Monday reject revision 2 because its effective boundary is in the future;
5. the resolver no longer has revision 1's header/effective record to fall back to.

The result is `MISSING`, not revision 1.

A UI date picker on top of the current persistence model would therefore make the authority bug
more visible rather than solve it.

**Decision:** add immutable per-revision activation metadata and make it the authority for
date-to-revision resolution.

Recommended model:

```ts
interface ExternalPlanRevisionActivation {
  userId: string;
  planId: string;
  revision: number;
  contentHash: string;
  activatedAt: string;
  effectiveFrom: LocalDateString;
}
```

Recommended path:

```text
users/{uid}/external_plans/{planId}/activations/{revision}
```

The existing latest header may remain as a latest-plan index/compatibility record, but it must no
longer be the only source of revision-effective history.

For a date D, resolve the plan revision whose activation is the deterministic latest applicable
activation with `effectiveFrom <= D` and whose own plan coverage includes D.

A future-effective revision must leave the previous revision active before its boundary.

## 2.3 Preserve placement by revision

The current mutable placement overlay is stored only at:

```text
users/{uid}/external_plans/{planId}/placement/current
```

and contains a `revision`.

That is sufficient for the current revision but not for #893's historical/moved-session
round trip. Once a later revision receives a new current placement overlay, the previous
revision's placement history is no longer available through the current path.

**Decision:** make placement revision-scoped.

Recommended new documents:

```text
users/{uid}/external_plans/{planId}/revisions/{revision}/placement/current
```

with the existing `ExternalPlanPlacement` payload.

Compatibility:

- read `revisions/{revision}/placement/current` first;
- if absent, accept legacy `placement/current` only when its `revision` matches;
- new writes go to `revisions/{revision}/placement/current`;
- historical revisions never consume another revision's overlay.

This is necessary to distinguish an intentionally moved session from a false miss after later
plan revisions.

## 2.4 Do not put historical planned-vs-performed reconciliation in `briefPlanAuthority`

`briefPlanAuthority` is already the pure **current-date actionable-authority** resolver created
for #810. It should stay that way.

Historical execution reconciliation is a different domain:

```text
authored plan occurrence
≠ daily adjudication
≠ structured execution
≠ canonical performed occurrence
≠ provider evidence
```

Issue #815 already identifies this separation.

**Decision:** add a reusable source-neutral round-trip projection at the
session/training-occurrence boundary, then let Context Brief render it.

Suggested module:

```text
app/src/training-occurrence/plannedExecutionStatus.ts
```

or an equivalently named source-neutral module.

Do not create a second plan-authority resolver in the brief.

## 2.5 Reuse the existing import diff instead of rebuilding review UX

`ExternalPlanImport` already has:

- strict shared validation;
- a preview phase;
- `diffPlans`;
- added/removed/changed session rows;
- fine-grained `SessionDefinition` diffs;
- explicit acknowledgement of behavior-changing changes;
- v5 intent-block preview.

The gap is narrower:

- the copy/paste prompt and placeholder still emit v4;
- effective-from is hard-coded to Warsaw-local today;
- the existing diff has no explicit retained count / revision-scope summary;
- it does not preflight cross-plan/calendar conflicts before activation.

Extend this surface rather than replacing it.

## 2.6 Launch structured sessions by capability, not `isV4Plan`

`Home.tsx` currently protects the external launch with `isV4Plan(activeExternal.plan)`.
That excludes v5 even though v5 sessions are v4 sessions structurally, and also makes future
schema versions fragile.

`sessionDefinitionResolver` already resolves definition-bearing external sessions using the
session capability (`isV2Session`), which naturally covers v2–v5.

**Decision:** use one definition-bearing external-session predicate/type for v2+ executable
schemas, including v6. Do not add another schema-literal Home branch.

## 2.7 Keep adjacent issue ownership explicit

#893 should integrate with, but not absorb, these tickets:

- **#909** — athlete-facing external verdict/source/hard-gate rendering on Home.
  #893 should use that surface in final E2E, not redesign a parallel verdict UI.
- **#894** — Context Brief versioning, golden fixtures, missingness/budget/integrity contract.
  #893 adds one semantic round-trip section and participates in the version discipline.
- **#815** — general recommendation-feedback vs execution-reconciliation separation.
  The #893 status primitive should be reusable by #815; #893 need not redesign every existing
  adherence surface.
- **#895** — offline/reload/correction durability of the structured execution diary.
  #893 proves correct identity/linkage through the runner, but does not take ownership of the
  offline outbox, correction audit trail or resume implementation.

---

# 3. Architecture decisions to lock before implementation

## D1 — canonical external write schema is v6

- New copy/paste prompt emits `adaptive-training-recommender/external-plan@6`.
- v1–v5 remain accepted by `validateAnyExternalTrainingPlan`.
- Stored historical revisions are never migrated.
- v6 = v5 + exact structured reduced executable definition; do not redesign unrelated fields.
- Firestore rules add v6 to the bounded accepted-schema allow-list.
- TypeScript validation remains authoritative for deep cross-field/session-definition invariants.

## D2 — revision activation is immutable history

A stored plan revision and its activation record are separate immutable concepts:

```text
revision bytes:        what the coach authored
activation metadata:   from what local date those bytes govern
placement overlay:     where sessions in that revision were moved
```

Import of a new revision atomically writes:

1. immutable revision bytes;
2. immutable activation record;
3. latest header/index.

The transaction must validate the predecessor/current header so concurrent imports cannot both
win from stale reads.

Same-revision + same-content + same activation is idempotent success.

Same-revision + same-content + different already-persisted activation date is a conflict, not a
silent activation mutation.

## D3 — revision-scoped placement is the move-history source

Placement is mutable only within its own revision. A later plan revision never overwrites the
placement overlay required to interpret an earlier revision.

## D4 — tactical changes are still revisions, not implicit patches

A revision is replacement authored content for the horizon it declares.

**Omission means removal.**

Therefore, if an external coach changes only today but the same long-running `planId` remains in
force afterwards, the returned revision must carry the unchanged future intent that is still
supposed to exist.

Do **not** interpret a one-session revision as "patch this session and retain everything else"
unless the plan's real intended horizon contains only that session.

This avoids introducing a second implicit patch language whose merge semantics would be difficult
to replay.

If a genuinely minimal tactical-override artifact is wanted later, define it explicitly as a
separate versioned contract/authority rather than smuggling patch behavior into full revisions.

## D5 — planning/execution status is multidimensional

Do not force all round-trip truth into one flat enum.

Recommended projection:

```ts
interface PlannedExecutionStatus {
  authored:
    | { kind: 'session'; source: ExternalPlanOccurrenceRef }
    | { kind: 'rest'; planId: string; revision: number; restDirectiveId: string }
    | { kind: 'none' }
    | { kind: 'unknown'; reason: string };

  placement:
    | 'as_authored'
    | 'intentionally_moved'
    | 'unknown';

  adjudication:
    | 'as_authored'
    | 'app_dose_modified'
    | 'gate_replaced'
    | 'not_adjudicated'
    | 'unknown';

  athleteDisposition:
    | 'accepted'
    | 'manually_replaced'
    | 'explicitly_skipped'
    | 'none'
    | 'unknown';

  performance:
    | 'completed'
    | 'partial_or_abandoned'
    | 'none_observed'
    | 'not_applicable'
    | 'unknown';

  performedOccurrenceId?: string;
  executionId?: string;
  prescriptionHash?: string;
  evidence: string[];
}
```

The renderer can derive issue-facing labels such as:

- performed as authored;
- performed with app dose modification;
- intentionally moved;
- gate-replaced;
- manually replaced;
- partially performed;
- explicitly skipped;
- missed;
- authored rest;
- no authored session;
- unknown.

Important rules:

- `missed` requires explicit trustworthy evidence, not "no Garmin activity";
- source-unavailable/read-failure becomes `unknown`;
- a recently scheduled session with no execution is not automatically `missed`;
- authored rest + performed work is represented as authored rest **plus** observed unexpected
  work, not transformed into "no plan";
- movement and completion can coexist;
- same-day sessions remain separate by exact occurrence/source identity.

## D6 — exact identity only

The round-trip join may use:

- `ExternalPlanOccurrenceRef(planId, revision, sessionId, contentHash)`;
- `SessionOccurrence.occurrenceId`;
- `SessionExecution.occurrenceId`;
- `SessionExecution.sessionSource`;
- `SessionExecution.prescriptionHash`;
- `PerformedTrainingOccurrence.sourceRefs`;
- persisted recommendation/adjudication provenance.

It may **not** use activity-title similarity as an identity rule.

## D7 — Context Brief consumes the projection

The planning Context Brief renders a bounded historical round-trip section.

It does not:

- re-match provider records;
- re-run historical readiness policy;
- infer plan intent from telemetry;
- create another authority resolver;
- duplicate the canonical completed-training table.

Because this adds new semantic output, make an explicit Context Brief contract-version decision.
Expected outcome: advance the semantic contract from current v2 to v3 in the same change unless
#894 lands another version first.

---

# 4. Work packages

## WP0 — Contract and migration decisions

### WP0.1 Add `external-plan@6`

**Primary files**

- `app/src/sessions/externalPlanV6.ts`
- `app/src/sessions/externalPlanValidation.ts`
- external-plan validator tests
- `app/firestore.rules`
- `docs/external-plan-schema.md`

**Work**

1. Extend v5, preserving:
   - v4 `SessionDefinition` sessions;
   - v3 authored rest;
   - v4 intraday bundles;
   - v5 intent blocks.
2. Add optional exact structured `scaling.reducedDefinition`.
3. Reject unknown fields and malformed reduced definitions with exact field paths.
4. Reject impossible combinations, including:
   - reduced definition when `reducible === false`;
   - an executable reduced form that attempts to change the parent session's gate identity in
     an unsupported way.
5. Continue rejecting model-supplied hidden engine quantities.
6. Preserve unresolved exercise text through existing `ExerciseRef.unresolved_free_text`.
7. Keep free-text fallback advisory.

**Done when**

- v6 example validates;
- malformed nested reduced definitions fail with precise field paths;
- v1–v5 compatibility tests remain green;
- rules accept valid v6 storage and reject unsupported schemas/shapes.

**Risk:** Medium.
The safest implementation is additive inheritance, not another independent session schema.

---

### WP0.2 Define revision activation and placement migration

**Primary files**

- `app/src/engine/models.ts`
- `app/src/services/externalPlanService.ts`
- `app/src/services/activeExternalPlanService.ts`
- external plan persistence tests
- `app/firestore.rules`

**Work**

1. Add `ExternalPlanRevisionActivation`.
2. Add user-scoped immutable `activations/{revision}` persistence.
3. Change new imports from read-then-batch to an atomic transaction covering revision,
   activation and latest header/index.
4. Add revision-scoped placement documents.
5. Make reads:
   - revision-scoped first;
   - legacy `placement/current` fallback only for matching revision.
6. Migration compatibility:
   - for the current legacy header/revision, its effective date can be materialized from
     `header.supersededFrom ?? revision.startDate` when a migration/first-write path can prove
     those are the current stored bytes;
   - do not fabricate exact activation dates for older revisions whose metadata was never
     persisted;
   - historical persisted recommendations/audits remain authoritative where activation history
     cannot be reconstructed.
7. Keep the latest header as a bounded index/compatibility record, not historical authority.

**Done when**

- revision 1 remains active before revision 2's future `effectiveFrom`;
- revision 2 becomes active exactly on the boundary;
- a later revision does not erase revision 1/2 placement history;
- same revision/content/activation retry is idempotent;
- conflicting replay of the same revision with a different effective date fails closed;
- concurrent imports cannot publish two conflicting latest states.

**Risk:** High.
This is the most important correctness work in #893.

---

## WP1 — Canonical import/prompt and explicit activation review

### WP1.1 Make v6 the copy/paste output contract

**Primary files**

- `app/src/components/ExternalPlanImport.tsx`
- `docs/external-plan-schema.md`
- copy/paste fixture/test data

**Work**

1. Replace the v4 prompt and placeholder with v6.
2. Publish a complete v6 fixture containing:
   - multiple sessions on one date;
   - authored rest;
   - structured strength with canonical exercise IDs;
   - at least one `unresolved_free_text` exercise;
   - optional vs required work;
   - intraday placement;
   - an intent block;
   - executable structured reduced dose;
   - advisory fallback;
   - a tactical revision example.
3. Add a compatibility table:
   - v1 readable legacy flat prescription;
   - v2 structured definition;
   - v3 rest;
   - v4 intraday;
   - v5 intent blocks;
   - v6 executable reduced definition.
4. State that v6 is the emitted contract, not the only readable one.

**Done when**

the published fixture passes the same v6 validator used by import.

---

### WP1.2 Extend the existing preview with effective date and conflict preflight

**Primary files**

- `app/src/components/ExternalPlanImport.tsx`
- `app/src/components/externalPlanDiff.ts`
- new focused import-preview service/projector if needed
- fixed-activity / plan-block / active-plan readers already present in the repository

**Work**

1. Add an explicit Europe/Warsaw `effectiveFrom` control.
2. Default to `getLocalDateString()`.
3. Reject malformed dates and dates earlier than today for normal interactive import.
4. Preserve the existing detailed diff.
5. Add explicit counts:
   - added;
   - changed;
   - removed;
   - retained.
6. State revision semantics prominently:
   - this revision replaces the same plan from `effectiveFrom`;
   - dates before the boundary remain on the prior revision;
   - omitted sessions in the new full revision are removed from the new revision's horizon.
7. Preflight, without inventing new authority policy:
   - overlap with another external plan that would change which plan wins;
   - fixed activities / occupied dates;
   - travel/plan-block constraints;
   - existing authority-bearing authored occurrences where a current API can prove them;
   - placement consequences such as moves/drops produced by existing placement rules.
8. Treat unavailable authority-affecting reads as unknown. Do not render "no conflict".
9. Require acknowledgement of behavior-changing diffs/conflicts before activation.

**Done when**

a user can see **what changes, from what date, and which existing constraints/authority are
affected** before any plan bytes become active.

**Risk:** Medium–High.
Do not create a second placement/authority engine solely for preview.

---

## WP2 — Correct date-to-revision authority resolution

### WP2.1 Resolve exact active revision by date

**Primary files**

- `app/src/services/activeExternalPlanService.ts`
- `app/src/services/externalPlanService.ts`
- activation/placement tests

**Work**

For each `planId`:

1. read applicable activation metadata;
2. choose the deterministic revision applicable to D;
3. load that exact immutable revision;
4. load that revision's placement overlay;
5. resolve placement against current fixed-activity inputs;
6. preserve existing deterministic cross-plan winner semantics, but base them on the actual
   revision active on D rather than the latest mutable header only.

Explicit tests:

- first revision;
- future-effective second revision;
- third revision after second;
- date before/at/after each boundary;
- overlapping different plan IDs;
- revision whose own plan coverage does not contain D;
- unreadable activation metadata;
- legacy current-header fallback/migration behavior;
- DST/Warsaw local-date boundary where applicable.

**Done when**

historical and future date authority can be reproduced without mutating old revisions or silently
dropping the predecessor.

### POLICY_VERSION

This work **can change which recommendation governs a date** compared with current behavior.
Under repository rules that is decision-affecting.

Therefore this WP should include:

- a `POLICY_VERSION` bump;
- policy drift verification;
- simulation review;
- explicit replay/regression tests for external-plan authority.

Do not classify it as a display-only change.

---

## WP3 — Definition-bearing external launch, including exact scaled execution

### WP3.1 Replace v4-literal execution gating with a capability guard

**Primary files**

- `app/src/components/Home.tsx`
- `app/src/services/sessionAuthoringService.ts`
- `app/src/sessions/sessionDefinitionResolver.ts`
- targeted tests

**Work**

1. Introduce/reuse one type guard for a structured external session with a canonical
   `SessionDefinition`.
2. Allow definition-bearing v2+ sessions, including v5 and v6, through the same adapter.
3. Preserve current exclusions:
   - events are advisory;
   - `skip` and `defer` cannot launch;
   - invalid definitions fail closed.
4. Keep exact external source:
   `(planId, revision, sessionId, contentHash)`.

This removes the brittle `isV4Plan` dependency without adding per-schema Home branches.

**Done when**

a valid v5 `proceed` structured session and a valid v6 `proceed` session both reach the canonical
runner with exact source provenance.

---

### WP3.2 Make v6 scaled execution exact

**Primary files**

- `app/src/engine/externalSession.ts`
- `app/src/services/sessionAuthoringService.ts`
- related adjudication/authoring tests

**Work**

1. Keep today's existing scale verdict/dose policy unless the schema forces a separately reviewed
   policy change.
2. When the adjudicated result is `scale`:
   - if v6 provides a valid `reducedDefinition`, bind that definition;
   - freeze it into an immutable `ExecutionPrescription`;
   - retain the original external source ref;
   - use the new prescription hash to identify the exact accepted executable form.
3. If no exact reduced definition exists:
   - keep scale non-executable;
   - never bind the original full definition;
   - never parse `reducedSummary` into steps.
4. Do not make feasibility fallback executable automatically.

**Done when**

tests prove:

- full authored definition cannot launch under a scaled verdict;
- v6 reduced definition can launch under scale;
- the execution prescription contains the exact reduced blocks shown to the athlete;
- later plan revisions cannot alter that snapshot.

**Risk:** High.
A mistaken implementation here could execute the full dose while displaying a reduced dose.

---

### WP3.3 Keep #909 as the verdict-UI owner

#893 may need small integration changes to consume the #909 surface, but it should not introduce
another verdict banner/card.

Final E2E should verify the active production UI exposes:

- external source/revision;
- proceed/scale/defer/skip/advisory;
- hard-gate reason;
- Start only when an exact executable definition exists.

If #909 has not landed, backend/contract WPs can proceed, but final athlete-facing round-trip
acceptance remains incomplete.

---

## WP4 — Prove exact occurrence/execution/performed linkage

### WP4.1 Reuse the current occurrence identity

The repository already has the right primitives:

- deterministic external `SessionOccurrence` identity;
- exact `ExternalPlanOccurrenceRef`;
- immutable execution-prescription hashes;
- `SessionExecution.occurrenceId`;
- canonical `PerformedTrainingOccurrence.sourceRefs`;
- provider reconciliation.

Do not create a parallel external-workout identity.

**Primary files**

- `app/src/services/sessionOccurrenceService.ts`
- `app/src/services/sessionAuthoringService.ts`
- `app/src/sessions/sessionDefinitionResolver.ts`
- training-occurrence reconciliation tests
- Firestore rules tests

**Verification**

Prove:

- repeated launch preparation is idempotent;
- superseded *scheduled* occurrence behavior remains correct;
- active/completed history is not rewritten by a later plan revision;
- old revision definitions remain resolvable by content hash;
- partial/abandoned execution retains exact occurrence/source identity;
- matched Garmin evidence enriches the same canonical performed occurrence;
- two genuine same-day sessions remain two occurrences;
- cross-user reads/writes are denied.

Change `session_occurrences` rules only if the existing source shape genuinely cannot represent
the v6 identity. v6 should normally reuse the same external source ref.

### #895 boundary

Do not expand this WP into:

- offline SessionEntry outbox;
- reload/resume state;
- correction history;
- rest-close replay;
- durable undo.

Those remain #895. #893 only requires enough execution evidence to prove the round-trip identity
and partial/completed semantics.

---

## WP5 — Source-neutral planned-vs-performed projection

### WP5.1 Add the pure projection below Context Brief

**Suggested location**

```text
app/src/training-occurrence/plannedExecutionStatus.ts
app/src/training-occurrence/plannedExecutionStatus.test.ts
```

**Inputs should be explicit canonical/read-state data, not services**

At minimum:

- authored external plan state for the relevant date/revision;
- revision-scoped placement result;
- exact `SessionOccurrence` records;
- relevant persisted daily recommendation/adjudication provenance;
- structured execution state;
- canonical performed occurrence/source links;
- explicit source availability/unavailability.

**The function must not**

- read Firestore;
- use `Date.now()`;
- call a model;
- infer identity by title;
- rerun historical readiness against current data;
- convert missing provider evidence into a skip.

### WP5.2 Required state coverage

Fixtures must distinguish:

1. authored session + exact completed execution, unchanged;
2. authored session + v6 scaled prescription completed;
3. intentionally moved, not falsely missed on original date;
4. gate replaced;
5. athlete manual replacement/override;
6. abandoned/partial structured execution;
7. explicit skip;
8. explicit miss/drop when persisted state proves it;
9. scheduled/pending session with no completion yet;
10. authored rest with no training;
11. authored rest + unexpected performed workout;
12. no authored session + unplanned performed workout;
13. no authored session + no observed workout;
14. unavailable plan state;
15. unavailable canonical performed state;
16. multiple same-day authored sessions;
17. revision boundary;
18. exact provider enrichment of a structured execution.

`unknown` is a real output, not a test failure.

### WP5.3 Coordinate with #815, do not duplicate it

#815 should be able to reuse this projection for the broader separation between:

- recommendation feedback completion; and
- observed execution reconciliation.

#893 does not need to rewrite every morning/adherence surface in the same PR.

---

## WP6 — Integrate exact round-trip state into the planning Context Brief

### WP6.1 Render a bounded planning-only section

**Primary files**

- `app/src/services/contextBriefService.ts`
- `app/src/engine/contextBriefPlanningHandoff.ts` or a focused renderer consumed by it
- `docs/architecture/context-brief-contract.md`
- service/render tests

**Work**

1. Hydrate the WP5 canonical status inputs at the service boundary.
2. Add a bounded `planning` section for the selected retrospective window.
3. Include exact plan/revision/session/occurrence provenance where useful but do not dump raw
   telemetry.
4. Reuse the canonical completed-training authority already live in planning/diagnostic.
5. Keep current-date `briefPlanAuthority` unchanged except for data needed to link to the new
   projection.
6. Do not add the section to morning by default. Morning D-1 migration should coordinate with
   #815/#894.
7. Preserve:
   - unavailable vs absent;
   - rest vs no authored session;
   - moved vs missed;
   - gate replacement vs athlete non-adherence.

### WP6.2 Contract version

Current architecture documents semantic contract v2.

The new planned-vs-performed section changes the planning API meaning, so make a deliberate
contract version decision in the same PR.

Expected:

```text
2026-09-context-brief-contract-v3
```

unless #894 has advanced the version first.

Update:

- contract metadata tests;
- semantic deterministic fixtures;
- docs wording;
- JSON transport only if its wrapper shape changes. Do **not** bump the transport schema merely
  because the semantic contract version changes.

### #894 boundary

Reuse #894's:

- version discipline;
- missingness vocabulary;
- deterministic fixture conventions;
- boundedness rules.

Do not absorb the remaining general #894 backlog for every section/source.

---

## WP7 — End-to-end round trip

### WP7.1 Main happy-path fixture

Use the existing external-plan / runner / reconciliation harnesses.

End-to-end sequence:

1. build a real `planning` Context Brief fixture;
2. use a validator-backed v6 structured plan fixture representing the external response;
3. import and review it;
4. choose an explicit effective date;
5. activate it;
6. resolve today's exact revision/placement;
7. adjudicate it through the normal external-session gates;
8. launch the exact structured definition through `SessionRunner`;
9. log enough execution to create:
   - one completed case; and
   - one partial/abandoned case in focused variants;
10. reconcile matching Garmin/provider evidence to the same physical occurrence;
11. build the next planning brief;
12. assert exact revision/session/occurrence linkage and the correct round-trip status.

### WP7.2 Required integrated variants

Keep exhaustive state logic at unit level; E2E should cover the highest-risk boundaries:

- duplicate import/idempotent retry;
- future-effective revision:
  - predecessor remains active before boundary;
  - successor wins on/after boundary;
- revision-scoped moved session;
- v6 scaled structured execution;
- skip/defer cannot launch;
- authored rest vs no authored session;
- gate replacement;
- manual replacement;
- two same-day sessions;
- Garmin enrichment creates no second completed workout;
- cross-user isolation.

### WP7.3 E2E scope boundary

Do not make #893's E2E depend on solving #895's entire offline/reload matrix. Add only a small
cross-check if #895 has already landed the needed durability behavior.

---

## WP8 — Documentation and status reconciliation

**Primary files**

- `docs/external-plan-schema.md`
- `docs/architecture/context-brief-contract.md`
- relevant external-plan/session architecture docs
- `docs/plans/README.md`
- this implementation-plan file

**Work**

1. Publish the complete copy/paste v6 contract.
2. Add a full round-trip fixture:
   Context Brief assumptions → external v6 response → imported revision/activation →
   adjudication → exact execution → canonical performed identity → next-brief status.
3. Document:
   - full-revision semantics;
   - tactical revision limitation;
   - effective-from behavior;
   - activation timeline;
   - revision-scoped placement;
   - scale execution boundary;
   - provider-enrichment provenance;
   - unsupported/incomplete evidence as unknown.
4. Add #893 to `docs/plans/README.md` while in progress.
5. When complete, remove present-tense problem statements from the plan rather than merely marking
   a checkbox as Implemented.
6. Cross-reference #909, #894, #815 and #895 rather than copying their work lists.

---

# 5. Revised acceptance criteria

## Contract/import

- [ ] Built-in external-agent prompt emits `external-plan@6`.
- [ ] v1–v5 remain readable/importable.
- [ ] Invalid enum/date/session-definition/reduced-definition fields fail closed with exact paths.
- [ ] Hidden engine values such as calibrated `systemicCost` are not accepted as model authority.
- [ ] Import preview shows effective-from, replacement scope, added/changed/removed/retained
      sessions and known authority/calendar conflicts.
- [ ] Authority-affecting conflict reads that fail are shown as unknown rather than no conflict.

## Revision/history

- [ ] Revision bytes remain immutable.
- [ ] Every new revision has immutable activation metadata.
- [ ] A future-effective revision does not hide the currently active predecessor.
- [ ] Date D resolves deterministically to the correct revision after later imports.
- [ ] Placement overlays are revision-scoped.
- [ ] A later revision does not erase earlier move/drop placement evidence.
- [ ] Identical same-revision import is idempotent.
- [ ] Attempting to mutate an existing revision's effective date fails closed.
- [ ] Historical recommendation/audit/execution records are never rewritten.

## Execution

- [ ] Definition-bearing external sessions use one source-neutral launch adapter rather than
      a v4-only Home branch.
- [ ] A v5/v6 `proceed` session launches through canonical `SessionRunner`.
- [ ] A v6 `scale` session launches only from its exact structured reduced definition.
- [ ] A v1–v5 scale without exact reduced definition cannot accidentally launch the full dose.
- [ ] `skip`, `defer` and advisory event states cannot expose an executable Start path.
- [ ] Exact authored source and prescription hash are persisted with the execution.
- [ ] Partial/abandoned executions retain their actual evidence.

## Canonical performed identity

- [ ] Completed execution links to the exact external plan/revision/session occurrence.
- [ ] Matching Garmin/provider evidence enriches the same `PerformedTrainingOccurrence`.
- [ ] One physical workout renders once in normal planning history.
- [ ] Two genuine same-day workouts remain separate.
- [ ] Later revision/provider updates do not rewrite structured execution semantics.

## Planned versus performed

- [ ] Per-session status uses exact persisted identities, never title similarity.
- [ ] Performed-as-authored is distinguishable from app-dose-modified.
- [ ] Moved is distinguishable from missed.
- [ ] Gate replacement is distinguishable from athlete replacement/non-adherence.
- [ ] Partial/abandoned is distinguishable from completed.
- [ ] Explicit skip/miss is distinguishable from missing/unavailable evidence.
- [ ] Authored rest is distinguishable from no authored session.
- [ ] Authored rest + unexpected training is represented truthfully.
- [ ] Unavailable plan/performed evidence yields unknown.

## Context Brief

- [ ] Planning Context Brief includes a bounded exact-identity round-trip section.
- [ ] It consumes, rather than reimplements, current-date plan authority and canonical performed
      authority.
- [ ] It does not duplicate raw provider telemetry.
- [ ] Semantic contract version is explicitly advanced/reconciled.
- [ ] Output is deterministic for the same persisted inputs and explicit `asOfDate`.
- [ ] #894 fixture/boundedness conventions are preserved.

## Security/reliability

- [ ] New activation and revision-scoped-placement documents are user-scoped in Firestore rules.
- [ ] Cross-user emulator tests deny reads/writes.
- [ ] Immutable activation/revision records cannot be updated/deleted by the client.
- [ ] Concurrent import tests prove one deterministic latest state.
- [ ] No external model receives direct Firestore write authority.

---

# 6. Verification matrix

## Focused unit/component tests

- `externalPlanV6.test.ts`
- `externalPlanValidation.test.ts`
- `ExternalPlanImport.test.tsx`
- `externalPlanDiff.test.ts`
- `externalPlanService.test.ts`
- `activeExternalPlanService.test.ts`
- `sessionAuthoringService.test.ts`
- `sessionOccurrenceService.test.ts`
- `externalSession.test.ts`
- `sessionDefinitionResolver.test.ts`
- new `plannedExecutionStatus.test.ts`
- `contextBriefPlanningHandoff.test.ts`
- `contextBriefService.test.ts`

## Rules/emulator

Run:

```bash
cd app
npm run test:rules
```

Cover:

- v6 revision create/read;
- activation create/read + update/delete denial;
- revision-scoped placement ownership/shape;
- cross-user denial;
- existing occurrence/prescription isolation.

## Frontend gate

```bash
cd app
npm run check
```

## Browser E2E

Use the existing external-plan runner harness and focused round-trip fixture, then:

```bash
cd app
npm run test:e2e
```

If #909 changes material UI during the same delivery, include its required mobile/desktop visual
review rather than duplicating another visual system in #893.

## Policy/replay gates

Because WP2 changes effective external-plan authority resolution and can alter recommendations:

```bash
cd app
node scripts/check-policy-drift.mjs <base-sha>
npm run simulate:plan-judge
cd ..
make simulate
```

Include the required `POLICY_VERSION` bump with the authority fix.

If later changes are proven display/storage-only, do not add additional policy bumps merely for
schema documentation or rendering.

## Final repository handoff

```bash
make verify
```

Report exactly which suites ran and their results.

---

# 7. Recommended implementation order / PR slicing

The work is safer as several narrow PRs rather than one large branch.

| PR | Scope | Depends on | Why |
|---|---|---|---|
| 1 | v6 contract + validator + rules shape + docs fixture | — | locks the exact interchange contract |
| 2 | revision activations + revision-scoped placement + resolver + migration compatibility | PR1 optional | fixes the correctness boundary before the UI exposes future dates |
| 3 | import effective-date/conflict review + v6 prompt | PR2 | user surface now rests on correct authority semantics |
| 4 | capability-based structured launch + v6 scaled-definition execution | PR1 | isolates execution-risk changes |
| 5 | exact planned-execution status projector | PR2, PR4 | builds source-neutral round-trip semantics below the brief |
| 6 | planning Context Brief integration + contract version + #894 fixture coordination | PR5 | renderer consumes stable domain semantics |
| 7 | end-to-end round trip + docs/status reconciliation | PR3–PR6, #909 UX as applicable | proves the complete athlete workflow |

If repository conventions prefer fewer PRs, PR1+PR2 may be combined, and PR5+PR6 may be combined.
Do not combine the revision-history change with unrelated UI polish merely to reduce PR count.

---

# 8. Dependencies and non-goals

## Coordination dependencies

### #909 — external verdict UX
Needed for the final athlete-facing Home flow. Do not duplicate its UI responsibility.

### #894 — Context Brief contract
Use its versioning/missingness/golden-fixture discipline. #893 does not need to wait for every
remaining #894 item.

### #815 — execution reconciliation semantics
The new source-neutral status projection should become reusable input for #815. Avoid a second
status vocabulary.

### #895 — structured diary durability
Not a blocker for basic #893 exact linkage. Offline/reload/correction guarantees remain there.

## Out of scope

- embedded/in-app LLM provider;
- automatic prose-to-plan parsing;
- model-controlled safety/readiness/feasibility;
- direct model Firestore writes;
- title-similarity identity;
- destructive rewrite of plan/execution/provider history;
- a second canonical performed-workout model;
- a second current-date authority resolver;
- implicit patch semantics for incomplete full revisions;
- full offline SessionRunner durability work owned by #895;
- general #894 missingness/budget cleanup unrelated to the new section.

---

# 9. Principal risks and rollback

## Risk: future revision hides predecessor

**Prevention:** immutable activation timeline; resolver selects by date.

**Rollback:** latest header remains a compatibility/index artifact; disable activation-aware
read path only if necessary without deleting immutable revisions/activations.

## Risk: prior movement history disappears

**Prevention:** revision-scoped placement overlays.

**Rollback:** legacy `placement/current` remains a read fallback for matching revisions.

## Risk: scaled UI launches full authored session

**Prevention:** only bind `reducedDefinition`; otherwise no Start.

**Rollback:** disable scaled external launch while retaining the stored v6 bytes and ordinary
`proceed` execution.

## Risk: Context Brief guesses non-adherence

**Prevention:** exact identity + explicit read-state; absent provider activity is not a miss.

**Rollback:** remove the round-trip renderer while retaining the underlying projection and
canonical records.

## Risk: schema churn strands old plans

**Prevention:** v1–v5 validators/read paths remain intact; v6 is additive.

## Risk: new authority semantics change recommendations unexpectedly

**Prevention:** mandatory policy-version/replay/simulation gates for the resolver fix, plus explicit
revision-boundary fixtures.

---

# 10. Definition of done

#893 is complete only when the repository can prove the complete loop, not merely import JSON:

```text
versioned planning brief
→ v6 structured authored revision
→ reviewed explicit effective date
→ reproducible revision/placement authority
→ normal safety/readiness/feasibility adjudication
→ exact full or explicitly authored reduced SessionDefinition
→ immutable execution prescription
→ exact SessionOccurrence / SessionExecution linkage
→ one canonical performed occurrence with provider enrichment
→ deterministic next planning brief reporting what was intended and what actually happened
```

The proof must survive:

- later plan revisions;
- moved sessions;
- same-day multiple sessions;
- app dose modification;
- partial execution;
- skipped/missed/rest/no-plan distinctions;
- provider enrichment;
- source unavailability;
- duplicate import/retry;
- cross-user access attempts.

Anything that still requires the receiving external coach to infer identity from prose or activity
titles is not a complete #893 round trip.
