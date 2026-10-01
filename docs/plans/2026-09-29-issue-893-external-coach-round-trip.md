# Issue #893 — Adjusted implementation plan: external-coach structured round trip

**Status:** In progress
**Reviewed:** 29 September 2026
**Repository baseline reviewed:** `main` at `8f788a5d61421c8da15e355ac124f6f622adbcc4`
**Issue:** https://github.com/Szczepanov/adaptive-training-recommender/issues/893

**Delivery update (30 September 2026, PR-E):** PR-A through PR-D delivered the product
boundaries and the initial browser happy path. PR-E supplies integrated variant proofs and WP8
closeout documentation. The criterion ledger in §5 records four integrated product gaps tracked by #949–#952.
Their desired browser regressions are `test.fixme`; active proofs and final verification do not
close those gaps, so #893 stays open. §2/§4/§7 are delivery records rather than implementation
instructions; §3 preserves the design decisions.

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

# 2. Delivery record — baseline review resolved

The 29 September review identified the old v5 scale limitation, latest-header-only authority,
shared placement history, v4-only launch checks and incomplete brief reporting. PR-A through
PR-D delivered the corresponding boundaries:

- v6 inherited v5 and added exact reduced executable definitions; v1–v5 stayed readable.
- Immutable activations became date-to-revision authority; future revisions retained predecessors.
- Placement writes became revision-scoped, with a matching-revision legacy read fallback.
- The existing import diff gained effective-date and conflict review, and the prompt became v6.
- Home and replay shared definition-bearing capability/authoring guards.
- `projectPlannedExecutionStatus` supplied exact multidimensional state below Context Brief.
- PR-D reconciled the semantic export contract to `2026-09-context-brief-contract-v4`.

Those service/domain boundaries were delivered. Browser verification subsequently exposed the
four integration gaps in §5; their desired behavior is not recorded as shipped.

---

# 3. Recorded architecture decisions

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

The projection dimensions are recorded below; `plannedExecutionStatus.ts` remains the source
of truth for its current type:

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
- explicit no-performance evidence;
- authored rest;
- unplanned observed work;
- unknown.

Important rules:

- explicit no-performance status requires trustworthy evidence, not "no Garmin activity";
- source-unavailable/read-failure becomes `unknown`;
- a recently scheduled session with no execution has unknown performance;
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

PR-D advanced the semantic contract to `2026-09-context-brief-contract-v4` after PR-C changed
the meaning of existing labels under v3. The JSON transport wrapper did not change.
The recorded rationale lives in `docs/architecture/context-brief-contract.md`.

---

# 4. Work-package delivery

| Package | Delivered scope | Closeout state |
|---|---|---|
| WP0 | Additive v6 contract; immutable activation and revision-scoped-placement contracts | Implemented in PR-A. |
| WP1 | v6 prompt; effective date, diff, replacement scope and conflict review | Implemented in PR-A; PR-E prompt/path browser proofs pass (§5). |
| WP2 | Deterministic per-date revision authority, legacy activation compatibility and scoped placement | Implemented in PR-A; PR-E concurrent-import browser proof passes (G1). |
| WP3 | Shared definition-bearing launch and exact reduced-definition freezing; #909 verdict UI integration | Service/adapter implemented in PR-B; Home starts the prepared exact v6 reduced binding under `scale` (#949, V4 active). |
| WP4 | Exact occurrence/execution/source/prescription linkage and historical identity | Identity boundary implemented in PR-B; Home prepares scheduled occurrences before Start (#951). Enrichment and abandon are active V10/V12 proofs. |
| WP5 | Source-neutral multidimensional planned/performed projection | Projector implemented in PR-C; integrated gate/manual replacement attribution remains open in #950/#951. |
| WP6 | Bounded planning-only round-trip rendering under semantic contract v4 | Implemented in PR-D. |
| WP7 | Main browser happy path and integrated variant matrix | Active PR-E cases cover supported paths; V4 (#949) and V7 (#953) are now active. V8 and full V9 bundle completion are `test.fixme` with #951/#952. |
| WP8 | Schema narrative, storage/diff corrections, criterion proof ledger and truthful status board | Documentation updated in PR-E; completion remains conditional on the ledger and verification. |

The [schema reference](../external-plan-schema.md#structured-round-trip-893) describes the current
loop. PR-E changes tests/helpers and Markdown only; product holes require separate tracked fixes.
#895 owns offline/reload/correction durability, beyond the online abandon path in V12.

---

# 5. Revised acceptance criteria and proof ledger

Every original §5 criterion appears below. **Located** means the exact test is present and passed in the
PR-E `make verify` run (§6). **Passed** marks a PR-E browser proof. Initially missing assertions
**G1–G3** now have active test cases. **H1–H4** are demonstrated integration gaps: their desired
regressions are `test.fixme`, not passing proofs. V slots are tracked below.

## Contract/import

| ID | Acceptance criterion | Exact executable proof | State |
|---|---|---|---|
| C1 | Built-in external-agent prompt emits `external-plan@6`. | [round-trip E2E] `a validated v6 coach plan completes and Garmin enriches the same next-brief occurrence (V10)` asserts the built-in rendered prompt includes `adaptive-training-recommender/external-plan@6`. | Passed (G2) |
| C2 | v1–v5 remain readable/importable. | [validation v1] `accepts the round-trip plan expressed against the revised contract`; [v2] `validates a v2 plan whose session definition is the M0.2 fixture vocabulary`; [v3] `validates a well-formed v3 plan with one rest directive`; [v4 service] `dispatches v4 validation on import and persists the immutable v4 bytes`; [v5 service] `dispatches v5 validation on import and persists the immutable v5 bytes, including intentBlocks` | Located |
| C3 | Invalid enum/date/session-definition/reduced-definition fields fail closed with exact paths. | [revision E2E] `invalid enum, date, full and reduced definitions fail at exact contract paths`; [v6] `reports malformed nested reduced definitions using the exact input path`. | Passed (G3) |
| C4 | Hidden engine values such as calibrated `systemicCost` are not accepted as model authority. | [v2] `rejects an author-supplied systemicCost on the definition (D-EXTTIER)` | Located |
| C5 | Import preview shows effective-from, replacement scope, added/changed/removed/retained sessions and known authority/calendar conflicts. | [import UI] `surfaces behavior changes that affect placement, adjudication, credit or event semantics`; `requires acknowledgement of conflicts and blocks activation when preflight is unknown`; [preflight] `checks current authority on empty dates across the entire effective plan horizon`; `acknowledges rest changes from the prior immutable revision and checks rest-day conflicts` | Located; V2 passed |
| C6 | Authority-affecting conflict reads that fail are shown as unknown rather than no conflict. | [preflight] `fails closed when a calendar authority read is unavailable`; [import UI] `requires acknowledgement of conflicts and blocks activation when preflight is unknown` | Located |

## Revision/history

| ID | Acceptance criterion | Exact executable proof | State |
|---|---|---|---|
| R1 | Revision bytes remain immutable. | [import service] `pins the immutable-revision conflict for same-revision content that differs`; [rules] `makes a stored revision create-only, so an audited decision stays verifiable` | Located |
| R2 | Every new revision has immutable activation metadata. | [import service] `writes revision, immutable activation and latest header atomically`; [rules] `makes an activation record create-only, so a stored effective date cannot be rewritten` | Located |
| R3 | A future-effective revision does not hide the currently active predecessor. | [active plan] `falls back to the prior effective revision until the successor horizon begins` | Located; V2 passed |
| R4 | Date D resolves deterministically to the correct revision after later imports. | [active plan] `resolves an R1 → future R2 → R3 chain deterministically per date`; `honors a Warsaw DST-boundary effectiveFrom with calendar-date comparison` | Located; V2 passed |
| R5 | Placement overlays are revision-scoped. | [rules] `accepts v6 reduced-definition revisions, revision-scoped placement and immutable activation records`; [import service] `distinguishes an inapplicable legacy overlay from corrupt revision-scoped placement` | Located; V3 passed |
| R6 | A later revision does not erase earlier move/drop placement evidence. | [active plan] `treats another revision overlay as no overlay, never as this revision placement`; [status] `pins intentionally_moved at the projector so refactors cannot break it silently` | Located; V3 passed |
| R7 | Identical same-revision import is idempotent. | [import service] `treats a byte-identical same-revision retry as idempotent, without new writes` | Located; V1 passed |
| R8 | Attempting to mutate an existing revision's effective date fails closed. | [import service] `fails closed when the same revision content is replayed with a different effective date` | Located |
| R9 | Historical recommendation/audit/execution records are never rewritten. | [import service] `supersedes forward only, touching nothing a previously adjudicated day depends on`; [authoring] `never rewrites a frozen prescription when a later revision is prepared for the same plan`; [rules] `rejects update or delete of an existing revision document in subcollection` | Located |

## Execution

| ID | Acceptance criterion | Exact executable proof | State |
|---|---|---|---|
| E1 | Definition-bearing external sessions use one source-neutral launch adapter rather than a v4-only Home branch. | [v2] `isDefinitionBearingExternalPlan covers every definition-bearing schema and refuses v1/empty plans`; `isDefinitionBearingExternalSession admits v2+ definition sessions and refuses v1 flat prescriptions`; [authoring] `launches a v5-inherited structured session under proceed with exact source provenance` | Located |
| E2 | A v5/v6 `proceed` session launches through canonical `SessionRunner`. | [authoring] `launches a v5-inherited structured session under proceed with exact source provenance`; [round-trip E2E] `a validated v6 coach plan completes and Garmin enriches the same next-brief occurrence (V10)` | Located |
| E3 | A v6 `scale` session launches only from its exact structured reduced definition. | [authoring] `freezes only the exact v6 reduced definition when adjudication requests scale`; [resolver] `resolves the exact v6 reduced definition frozen in a scaled execution prescription`; [state E2E] `V4 scale freezes the exact reduced definition and reports app dose modified` is active: Home starts the prepared reduced binding, whose frozen `definitionHash` is the reduced hash and not the full one. | Located; H1 resolved by [#949] |
| E4 | A v1–v5 scale without exact reduced definition cannot accidentally launch the full dose. | [authoring] `does not allow scale to launch an older plan without an exact reduced definition`; [verdict E2E] `a scaled imported session shows the reduced version without launching the full structured dose` (desktop/mobile). | Located |
| E5 | `skip`, `defer` and advisory event states cannot expose an executable Start path. | [verdict E2E] `a deferred imported session names its verdict and offers no Start path`; `an excluded imported session names its verdict and offers no Start path as written` (desktop/mobile); [authoring] `rejects target-event sessions because they are advisory fixed-activity inputs` | Located; verdict E2E passed. Skip-day recommendation persistence open [#950]/[#953] |
| E6 | Exact authored source and prescription hash are persisted with the execution. | [authoring] `creates and binds an external-plan occurrence when date is provided in options`; [round-trip E2E] `a validated v6 coach plan completes and Garmin enriches the same next-brief occurrence (V10)` | Located |
| E7 | Partial/abandoned executions retain their actual evidence. | [execution] `retains occurrenceId + sessionSource + prescriptionHash when an external execution is abandoned`; [status] `labels an abandoned execution with entries partial_or_abandoned` | Located; V12 passed |

## Canonical performed identity

| ID | Acceptance criterion | Exact executable proof | State |
|---|---|---|---|
| P1 | Completed execution links to the exact external plan/revision/session occurrence. | [status] `joins completed performance through exact occurrence and execution identity`; [round-trip E2E] `a validated v6 coach plan completes and Garmin enriches the same next-brief occurrence (V10)` | Located |
| P2 | Matching Garmin/provider evidence enriches the same `PerformedTrainingOccurrence`. | [reconciliation] `structured-first, Garmin arrives later and clears auto-link -> attaches to the existing structured-only occurrence` | Located; V10 passed |
| P3 | One physical workout renders once in normal planning history. | [training dedupe] `planning renders one deduped row per fact and counts structured-only sessions`; [contract] `links Garmin evidence to one canonical D-1 session and isolates an unmatched activity` | Located; V10 passed |
| P4 | Two genuine same-day workouts remain separate. | [training dedupe] `keeps two legitimate same-day canonical workouts distinct`; [repository transactions] `enforces the one-structured-execution invariant at the repository boundary`; [state E2E] `V9 an intraday bundle retains two session rows and two genuine workouts` is `test.fixme`: after primary completion the secondary launch card is absent. | Unit proof; integrated gap H4 [#952] |
| P5 | Later revision/provider updates do not rewrite structured execution semantics. | [authoring] `never rewrites a frozen prescription when a later revision is prepared for the same plan`; [resolver] `resolves the original revision bytes after a later revision import (content-hash boundary, not latest-header)`; [repository] `never overwrites Adaptive-authoritative fields with Garmin fields on attach`; [rules] `allows execution lifecycle with entry subcollection mutability while in_progress, and terminal immutability` | Located |

## Planned versus performed

| ID | Acceptance criterion | Exact executable proof | State |
|---|---|---|---|
| S1 | Per-session status uses exact persisted identities, never title similarity. | [status] `does not join same-day records with a different immutable plan source`; `does not join an occurrence from another local date`; `refuses to cross-match old-revision bytes after a re-import` | Located |
| S2 | Performed-as-authored is distinguishable from app-dose-modified. | [status] `distinguishes scaled-completed from proceeded-as-authored by audited dose diff`; [state E2E] `V4 scale freezes the exact reduced definition and reports app dose modified` is active and asserts the exact next-brief row labelled app dose modified. | Located; H1 resolved by [#949] |
| S3 | Moved is distinguishable from missed. | [status] `pins intentionally_moved at the projector so refactors cannot break it silently`; `uses only an explicit missed occurrence as evidence of no performance` | Located; V3 passed |
| S4 | Gate replacement is distinguishable from athlete replacement/non-adherence. | [status] `labels a defer-gated day gate_replaced with unknown performance when nothing executed`; `labels a skip-gated day gate_replaced`; `labels a single-session replace day manually_replaced with auditable evidence`; [state E2E] `V7 a gate replacement has exact labels and creates no external occurrence` and `V8 UI manual replacement names its exact replacement occurrence` are `test.fixme`; persisted UI behavior does not reach those projected states. | Unit proof; integrated gaps H2/H3 [#950]/[#951] |
| S5 | Partial/abandoned is distinguishable from completed. | [status] `labels an abandoned execution with entries partial_or_abandoned`; `joins completed performance through exact occurrence and execution identity` | Located; V12 passed |
| S6 | Explicit skip/miss is distinguishable from missing/unavailable evidence. | [status] `labels an explicit skip explicitly_skipped with none_observed`; `uses only an explicit missed occurrence as evidence of no performance`; `does not infer a miss from a recent scheduled occurrence without execution` | Located |
| S7 | Authored rest is distinguishable from no authored session. | [status] `keeps authored rest without work at not_applicable with no observed-work evidence`; `labels unplanned work not_applicable with observed-work evidence`; [active plan] `returns nothing for a day with nothing placed` | Located; V6 passed |
| S8 | Authored rest + unexpected training is represented truthfully. | [status] `keeps authored rest distinct while reporting unexpected performed work` | Located; V6 passed |
| S9 | Unavailable plan/performed evidence yields unknown. | [status] `renders source read failures as unknown`; `renders every dimension unknown when performed reads are unavailable`; `renders every dimension unknown when the authored identity is unknown`; [brief service] `emits the planning round-trip section and preserves unavailable source reads as unknown` | Located |

## Context Brief

| ID | Acceptance criterion | Exact executable proof | State |
|---|---|---|---|
| B1 | Planning Context Brief includes a bounded exact-identity round-trip section. | [brief service] `hydrates round-trip rows from exact external source, occurrence, execution and performed ids`; [status] `keeps the newest 20 rows in chronological order with a directional omission line`; `bounds and sanitizes rendered identifiers and provenance lists` | Located |
| B2 | It consumes, rather than reimplements, current-date plan authority and canonical performed authority. | [brief service] `hydrates round-trip rows from exact external source, occurrence, execution and performed ids`; `pins imported session revision separately for each date in a changed plan`; [training dedupe] `planning renders one deduped row per fact and counts structured-only sessions` | Located |
| B3 | It does not duplicate raw provider telemetry. | [brief service] `exports bounded quality execution detail for planning and the full persisted view for diagnostics`; [training dedupe] `diagnostic keeps raw provider rows as provenance, not additional volume`. Round-trip rows carry ids/statuses, not another telemetry table. | Located |
| B4 | Semantic contract version is explicitly advanced/reconciled. | [brief service] `emits the planning round-trip section and preserves unavailable source reads as unknown` pins `2026-09-context-brief-contract-v4`; [contract] `exposes an explicit contract version and purpose on planning and diagnostic` | Located |
| B5 | Output is deterministic for the same persisted inputs and explicit `asOfDate`. | [contract] `is deterministic for identical inputs ignoring the generation timestamp`; [status] `renders round-trip rows chronologically with deterministic tie-breakers`; `uses full authored identity as a deterministic tie-breaker` | Located |
| B6 | #894 fixture/boundedness conventions are preserved. | [brief service] `golden service artifact: %s-day %s export`; `bounds full planning and diagnostic exports with 30 activities, 100 laps and 100 segments each`; `renders the empty window and unreadable inputs as exact section blocks` | Located |

## Security/reliability

| ID | Acceptance criterion | Exact executable proof | State |
|---|---|---|---|
| A1 | New activation and revision-scoped-placement documents are user-scoped in Firestore rules. | [rules] `accepts v6 reduced-definition revisions, revision-scoped placement and immutable activation records` | Located |
| A2 | Cross-user emulator tests deny reads/writes. | [rules] `rejects cross-user external plan access and forged ownership`; `denies cross-user and revision-mismatched revision-scoped placement writes` | Located; V11 cite |
| A3 | Immutable activation/revision records cannot be updated/deleted by the client. | [rules] `makes an activation record create-only, so a stored effective date cannot be rewritten`; `makes a stored revision create-only, so an audited decision stays verifiable` | Located |
| A4 | Concurrent import tests prove one deterministic latest state. | [revision E2E] `concurrent successor imports converge to one deterministic latest revision` invokes the real service concurrently in the authenticated browser and asserts the latest header/revision/activation. The earlier [import service] `rejects a conflicting same-revision successor replay and covers the transaction contention read-set` remains a serial unit proof only. | Passed (G1) |
| A5 | No external model receives direct Firestore write authority. | [import UI] `renders Import disabled and shows the acknowledgement checkbox when unreviewed behavior changes exist`; [round-trip E2E] `a validated v6 coach plan completes and Garmin enriches the same next-brief occurrence (V10)` requires athlete confirmation; [rules] `rejects cross-user external plan access and forged ownership`. Reviewed JSON enters through the signed-in athlete, not an external model principal. | Located; human/rules boundary |

## Browser variant proof slots

Active cases and skipped desired regressions are distinguished below. Passing active tests cannot
complete a variant whose required behavior is tracked by `test.fixme`.

| Variant | File | Exact test name / verification |
|---|---|---|
| V1 duplicate UI import | [revision E2E] | `V1 non-advancing UI re-import preserves immutable revision and activation`. Active; passed. |
| V2 future-effective boundary | [revision E2E] | `V2 tomorrow-effective successor preserves the revision boundary`; `V2 today-effective successor preserves the revision boundary`. Active; two fresh athletes prove current-day authority because the week strip resolves one revision for today. Passed. |
| V3 moved-session revision history | [revision E2E] | `V3 revision-scoped move onto today survives a future successor import`. Active, validated-overlay fallback: PlanView filters rows to today…today+6, so yesterday's authored row has no rendered move control. Passed. |
| V4 exact reduced execution | [state E2E] | `V4 scale freezes the exact reduced definition and reports app dose modified` is active and passing. Unblocked by [#949] (Home Start for the prepared exact v6 reduced binding). |
| V5 skip/defer cannot launch | [verdict E2E] and [mobile verdict E2E] | `a deferred imported session names its verdict and offers no Start path`; `an excluded imported session names its verdict and offers no Start path as written`. Existing cases; passed. The skip day's recommendation write is rejected ([#953]), which blocks V7, not the no-Start assertion. |
| V6 rest, no session, unexpected work | [state E2E] | `V6 authored rest records unexpected work without inventing an authored session`; `V6 an active plan with no authored session today renders no row for today`. Active; passed. |
| V7 gate replacement | [state E2E] | `V7 a gate replacement has exact labels and creates no external occurrence` is active and passing. Unblocked by [#953] (D1 catalog fingerprint fix). |
| V8 manual replacement | [state E2E] | `V8 UI manual replacement names its exact replacement occurrence` is `test.fixme`, [#951]. UI-imported JSON reaches Save/Schedule/Replace because direct fixture/catalog previews do not expose the destination sheet. A real replacement/manual completion exists, but the authored row retains athlete none. Home also prepares the external occurrence before Start. |
| V9 same-day sessions | [state E2E] | Active `V9 plain fixed same-day sessions retain two distinct next-brief rows` asserts two exact not-adjudicated rows and zero executions. `V9 an intraday bundle retains two session rows and two genuine workouts` is `test.fixme`, [#952]; two-workout integrated completion remains unproved. |
| V10 Garmin enrichment | [round-trip E2E] | `a validated v6 coach plan completes and Garmin enriches the same next-brief occurrence (V10)`. Active; opens Data → Activities, then calls the real `loadCanonicalActivitiesWindow` service because the canonical Activities read-model flag is off by default in E2E. It does not fabricate performed linkage. Passed. |
| V11 user isolation | [rules] | `rejects cross-user external plan access and forged ownership`; `denies cross-user and revision-mismatched revision-scoped placement writes`. Rules gate passed in initial `make verify`. |
| V12 abandoned execution | [round-trip E2E] | `V12 abandoned external execution retains logged evidence and exact next-brief ids`. Active; passed, including 3/3 under `--repeat-each=3`. Unblocked by [#953]. |

## Named proof gaps

Two desired regressions remain open in [state E2E] as `test.fixme` (H1 resolved by #949, H2 by #953).

| Gap | Affected criteria/variant | Demonstrated boundary | Follow-up |
|---|---|---|---|
| H1 | E3, S2 / V4 | Resolved by [#949]: Home offers Start only for the binding it froze to the exact v6 reduced definition; legacy scale and skip/defer stay blocked. V4 is active and passing. | Closed by the #949 PR |
| H2 | S4 / V7, legacy V5 skip reliability | Resolved by [#953] (D1 catalog fingerprint pair accepted by rules). V7 is active and passing. | Closed ([#950]) |
| H3 | S4 / V8, occurrence-at-Start boundary | A real UI manual replacement and completed manual execution exist, but the next brief retains the authored row with athlete none and no replacement attribution. Home eagerly prepares a scheduled external occurrence before Start, so the variant's no-external-occurrence condition is unmet. | [#951] |
| H4 | P4 / full V9 | The initial bundle recommendation parses AVAILABLE with two valid separate windows and short executable definitions. The primary completes and the brief retains both rows, but the secondary Start card is absent. Started-member replay/binding mismatches and rejected recommendation updates accompany the failure. | [#952] |

The initially missing assertions now have active, passing cases:

- **G1 — actual concurrent import (A4):** [revision E2E]
  `concurrent successor imports converge to one deterministic latest revision`.
- **G2 — built-in prompt schema (C1):** [round-trip E2E]
  `a validated v6 coach plan completes and Garmin enriches the same next-brief occurrence (V10)`.
- **G3 — exact validation paths (C3):** [revision E2E]
  `invalid enum, date, full and reduced definitions fail at exact contract paths`.

#893 remains **In progress** even if every active test passes. H1–H4 require product fixes and
passing integrated regressions; skipped tests cannot close an acceptance criterion.
Use `Refs #893`, not closing language, for this tests/docs-only PR.

[#949]: https://github.com/Szczepanov/adaptive-training-recommender/issues/949
[#950]: https://github.com/Szczepanov/adaptive-training-recommender/issues/950
[#951]: https://github.com/Szczepanov/adaptive-training-recommender/issues/951
[#952]: https://github.com/Szczepanov/adaptive-training-recommender/issues/952
[#953]: https://github.com/Szczepanov/adaptive-training-recommender/issues/953

## Proof-file index

[validation v1]: ../../app/src/engine/externalPlanValidation.test.ts
[v2]: ../../app/src/sessions/externalPlanV2.test.ts
[v3]: ../../app/src/sessions/externalPlanV3.test.ts
[v4 service]: ../../app/src/services/externalPlanV4Service.test.ts
[v5 service]: ../../app/src/services/externalPlanV5Service.test.ts
[v6]: ../../app/src/sessions/externalPlanV6.test.ts
[import UI]: ../../app/src/components/ExternalPlanImport.test.tsx
[preflight]: ../../app/src/services/externalPlanImportPreflight.test.ts
[import service]: ../../app/src/services/externalPlanService.test.ts
[active plan]: ../../app/src/services/activeExternalPlanService.test.ts
[authoring]: ../../app/src/services/sessionAuthoringService.test.ts
[resolver]: ../../app/src/sessions/sessionDefinitionResolver.test.ts
[execution]: ../../app/src/services/sessionExecutionService.test.ts
[status]: ../../app/src/training-occurrence/plannedExecutionStatus.test.ts
[reconciliation]: ../../app/src/training-occurrence/reconciliationService.test.ts
[repository]: ../../app/src/training-occurrence/repository.test.ts
[repository transactions]: ../../app/src/training-occurrence/repositoryTransactionHardening.test.ts
[training dedupe]: ../../app/src/engine/contextBriefTrainingDedupe.test.ts
[contract]: ../../app/src/engine/contextBriefContract.test.ts
[brief service]: ../../app/src/services/contextBriefService.test.ts
[rules]: ../../app/src/emulator/firestoreRules.emulator.test.ts
[round-trip E2E]: ../../app/tests/e2e/external-coach-round-trip.pw.ts
[revision E2E]: ../../app/tests/e2e/external-plan-revisions.pw.ts
[state E2E]: ../../app/tests/e2e/external-plan-execution-states.pw.ts
[verdict E2E]: ../../app/tests/e2e/external-verdict.pw.ts
[mobile verdict E2E]: ../../app/tests/e2e/mobile/external-verdict.pw.ts

---

# 6. PR-E verification record

Final verification ran on the PR-E worktree over base `8afef4ff` (2026-09-30). H1–H4 remain
open whatever the status of the active tests.

| Gate | Command | Result |
|---|---|---|
| Focused browser variants | From `app/`: `npm run emulators:exec:e2e -- "npx playwright test --config=playwright.e2e.config.ts external-coach-round-trip external-plan-revisions external-plan-execution-states --project=e2e-chromium"` | 11 passed, 4 skipped (`test.fixme`), 1.1 min |
| Flake check | Same, with `--repeat-each=3` | 33 passed, 12 skipped, 0 failed, 3.2 min |
| Repository handoff | Repository root: `make verify` | PASS (exit 0), including frontend gate, both Firestore rules shards, and browser E2E (desktop + mobile: 40 passed, 4 skipped) |

Per-file wall time (single pass): `external-coach-round-trip.pw.ts` 21.5 s (slowest test 14.1 s),
`external-plan-revisions.pw.ts` 28.8 s, `external-plan-execution-states.pw.ts` 14.5 s. Every test
stays far below the 45 s timeout, so none needs `test.slow()`.

Emulator output from passing specs, including pre-existing `daily-decision.pw.ts` and
`external-verdict.pw.ts`, shows `daily_recommendations` writes rejected at Firestore's
1000-expression rules budget. The active assertions do not depend on the rejected revision.
That product defect is tracked in [#953], and it underlies H2 and contributes to H3/H4.

Java 21 and Chromium are needed for browser/emulator runs. Tests use fresh synthetic athletes
and poll persisted state. No PR-E policy, engine, contract or rules changes are authorized, so
policy drift/judge/simulation work is not an additional PR-E requirement. The earlier WP2 policy
change was verified in its owning PR; this closeout does not repeat that implementation.

---

# 7. Delivered PR slices

| PR | Scope |
|---|---|
| PR-A [#934](https://github.com/Szczepanov/adaptive-training-recommender/pull/934) | v6 contract, activation history, revision-scoped placement and import review. |
| PR-B [#937](https://github.com/Szczepanov/adaptive-training-recommender/pull/937) | Capability-based launch, exact scaled prescription and execution identity. |
| PR-C [#943](https://github.com/Szczepanov/adaptive-training-recommender/pull/943) | Source-neutral planned/performed projection and replacement hydration. |
| PR-D [#946](https://github.com/Szczepanov/adaptive-training-recommender/pull/946) | Bounded round-trip rendering and Context Brief semantic contract v4. |
| PR-E | Active browser proofs, four issue-linked `test.fixme` regressions and documentation; #893 remains open. |

---

# 8. Dependencies and non-goals

## Coordination dependencies

### #909 — external verdict UX
Owns the athlete-facing Home verdict UI consumed by the round-trip browser proofs.

### #894 — Context Brief contract
Supplied the versioning, missingness and golden-fixture conventions retained by the v4 export.

### #815 — execution reconciliation semantics
Can reuse the source-neutral status projection for wider execution reconciliation, with the
same status vocabulary.

### #895 — structured diary durability
Owns offline/reload/correction guarantees beyond #893's basic linkage and online abandon proof.

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
