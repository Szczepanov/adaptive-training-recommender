# H4: external-plan execution-binding pipeline — PR-1/PR-2 implementation and follow-up roadmap

**Status:** PR 1 implemented in [PR #440](https://github.com/Szczepanov/adaptive-training-recommender/pull/440); PR 2 implemented in [PR #445](https://github.com/Szczepanov/adaptive-training-recommender/pull/445).
PR 3 is delivered through Phase 6; the cumulative H4 policy transition completes the live release.
This document records the original gap, the invariants established by the first two PRs, and the
remaining follow-up work.

**Tracks:** [GitHub issue #434](https://github.com/Szczepanov/adaptive-training-recommender/issues/434).

**Origin:** the gap was discovered while wiring ADR-0036 (H4) D-PLACEMENT into the decision
path in [PR #432](https://github.com/Szczepanov/adaptive-training-recommender/pull/432).

## Original gap

Before PR 1, `SessionSourceRef` declared `kind: 'external_plan'`, but production code never
constructed that source for a recommendation. External-plan sessions therefore stayed on the
older display/adjudication contract:

```text
externalPrescription + externalVerdict + decisionTrace.externalPlan
```

while executable catalog/manual sessions used the source-neutral path:

```text
SessionReferenceBinding -> ExecutionPrescription -> SessionRunner
```

That meant even a structured `external-plan@4` primary session could be displayed and
adjudicated but not launched through the immutable prescription boundary used by
`SessionRunner`.

PR 1 closes that gap for the existing **single primary v4 session**. It deliberately does not
yet create external-plan occurrences or make secondary intraday-bundle members independently
launchable.

## Why PR 1 is v4-only

`external-plan@2`, `@3`, and `@4` all carry a normalized `SessionDefinition`, but v4 is the
schema that introduces ADR-0036 intraday bundles and therefore the first schema that needs the
new execution-binding pipeline for H4 continuity.

`ExternalPlanSessionV4.definition` is already validated at import time. The v4 validator strips
the v4-only `intraday` field and delegates the shared session envelope/definition checks to the
v2 validator, which calls `validateSessionDefinition`. The launch helper still re-runs
`validateSessionDefinition` defensively, matching the other launch paths.

Legacy v1-v3 behavior is intentionally unchanged in PR 1. Broader enablement can be considered
separately once the v4 path has proven stable.

## PR-1 design

### 1. Prescription-only binding; no occurrence record

`prepareExternalPlanSessionLaunch` in
`app/src/services/sessionAuthoringService.ts` freezes an immutable execution prescription and
returns a `SessionReferenceBinding` with:

```typescript
{
  sessionSource: {
    kind: 'external_plan',
    planId,
    revision,
    sessionId,
    contentHash,
  },
  prescriptionHash,
}
```

The immutable authored source is identified by `(planId, revision, sessionId, contentHash)`.
The recommendation/execution carries the calendar date separately; date is not part of
`SessionSourceRef`.

This mirrors the catalog launch model: the recommendation already owns selection authority, so
starting it does not need to fabricate a separate `session_occurrences` record.

### 2. Content-addressed execution snapshot

The helper:

1. rejects non-executable external target events;
2. defensively validates the `SessionDefinition`;
3. hashes the definition;
4. constructs the `external_plan` source identity;
5. snapshots blocks plus display metadata;
6. hashes the execution prescription;
7. persists it through `executionPrescriptionService.savePrescription`;
8. returns the binding for `SessionRunner`.

`displayMetadata` is included so stored prescriptions satisfy the resolver/service validation
contract and retain the historical title/summary/intent/modality/duration context.

`createdAt` remains persisted provenance but is intentionally excluded from
`canonicalExecutionPrescriptionJson`. Re-preparing the same source and executable content
therefore yields the same `prescriptionHash` even when invocation timestamps differ.

### 3. Caller-side wiring keeps the engine pure

`Home.tsx` prepares the binding only after `evaluateTrainingWithIntent` has returned. Binding
creation is asynchronous and persists a prescription, so it does not belong in the pure
recommendation engine.

This is the same architectural boundary already used for catalog/manual launch preparation.

## Safety and correctness gates

PR 1 uses a deliberately narrow launch policy.

### Runtime schema gate

A binding is created only when the active plan passes the real v4 schema discriminator:

```typescript
activeExternal && isV4Plan(activeExternal.plan)
```

The mere presence of `session.definition` is not sufficient because v2/v3 sessions also have
structured definitions.

### Verdict gate: `proceed` only

A v4 external session receives `primarySession` only when:

```typescript
recommendationWithPrescription.externalVerdict?.decision === 'proceed'
```

`skip`, `defer`, and `scale` do not receive an executable binding.

### Why `scale` is excluded

External-plan adjudication can return reduction guidance, but PR 1 does not contain a
block-level transformer that turns the authored `SessionDefinition.blocks` into the reduced
execution the verdict describes. Launching the original blocks on a `scale` verdict would be
unsafe and semantically wrong.

Until an explicit external-definition scaling path exists, the UI may display the scaling
advice but must not offer the authored full session as the executable prescription.

### Rest gate

Canonical Rest (`rest_01`) never receives an external launch binding.

### External target events are advisory, not executable sessions

Imported sessions with `isEvent: true` have a distinct engine role: `rules.ts` reconciles them
as fixed-activity/advisory inputs while the normal planner may still recommend another
session. An `externalVerdict` can therefore exist even when the external event is **not** the
recommended executable session.

`prepareExternalPlanSessionLaunch` rejects `isEvent` sessions as defense in depth. This prevents
an advisory event from becoming `primarySession` if a caller ever invokes the helper from an
ambiguous recommendation state.

This event guard is important because launch eligibility must be based on the executable
recommendation, not merely on the presence of `externalVerdict` metadata.

## Coexistence with the existing external-plan UI/audit contract

PR 1 keeps these fields:

- `externalPrescription`;
- `externalVerdict`;
- `decisionTrace.externalPlan`.

They remain useful for the plan-week UI, verdict messaging, provenance, and replay. The new
`primarySession` binding is additive: it gives an eligible v4 primary recommendation an
immutable structured launch path without forcing a larger UI/audit migration in the same PR.

`MorningDecisionCard` already knows how to expose the start action when `primarySession` and
`onStartSession` are present, so no new visual launch component is required.

## Persistence and resolver behavior

On launch, `App.tsx` resolves the stored binding through `resolveSessionDefinition` using both
`sessionSource` and `prescriptionHash`.

For an external-plan source, the resolver:

1. reloads the stored immutable plan revision;
2. verifies its content hash;
3. locates `sessionId`;
4. reconstructs the normalized definition;
5. verifies the stored prescription source and definition hash;
6. applies the snapshotted executable blocks.

This keeps launch/replay tied to the exact imported plan revision rather than re-deriving a
session from unrelated live state.

## Tests added/maintained in PR 1

`sessionAuthoringService.test.ts` covers:

- correct `external_plan` binding identity;
- no `session_occurrences` write in PR 1;
- persisted blocks and display metadata;
- deterministic `prescriptionHash` across different `createdAt` values;
- write-once/idempotency behavior of the test persistence fake;
- summary override participation in the stored snapshot;
- defensive rejection of an invalid `SessionDefinition`;
- defensive rejection of `isEvent` sessions before persistence.

The existing full CI/rules/scenario suites remain the integration backstop for catalog/manual
launch behavior, recommendation persistence, and Firestore validation.

## Firestore rules and current main

The `external_plan` source shape is already accepted by Firestore recommendation/prescription
validation. PR 1 does not need a new source schema in rules.

The original analysis identified rule-expression-budget risk when both `externalPlan` audit
metadata and `primarySession` are present. [PR #441](https://github.com/Szczepanov/adaptive-training-recommender/pull/441)
was subsequently merged to `main` to deduplicate `primarySession`/`additionalSessions`
validation in `hasValidRecommendationAudit`. [PR #468](https://github.com/Szczepanov/adaptive-training-recommender/pull/468)
later reduced recommendation-audit evaluation cost further and closed issue #435, so the
earlier expression-budget blocker for persisting `decisionTrace.externalPlan.intradayBundle`
is no longer current. The placement-display field is still unimplemented and still requires
its own reviewed schema/rules/replay change; it is simply no longer blocked on rule headroom.

## Deliberately out of scope for PR 1

### Occurrence tracking

`OccurrenceAuthority` still has no external-plan authority, and `SessionOccurrence` does not
yet carry external plan/session identity. PR 1 therefore does not create an external-plan
occurrence lifecycle.

Occurrence tracking is needed once execution state must be queried independently of the daily
recommendation — especially predecessor completion for D-REASSESS and multiple launchable
bundle members on one date.

### Secondary intraday-bundle members

PR 1 only makes the already-selected primary v4 session executable. It does not surface a
bundle's second/third member as `additionalSessions`.

### D-REASSESS

Before a later bundle session can be re-assessed immediately before launch, that later session
must first exist as an independently launchable, trackable entity. That depends on the
occurrence/bundle work below.

### Block-level external scaling

A future implementation may transform external `SessionDefinition.blocks` according to an
accepted scale verdict, then hash and persist the transformed execution snapshot. Until that
exists, `scale` remains display/advice only and cannot launch.

## PR-2 lifecycle boundary (historical)

PR 2 introduced source-appropriate external-plan occurrence identity and the
`claimOccurrenceLaunch` transaction primitive, but deliberately did **not** wire the H4
ledger/reassessment claim into every live occurrence-backed start. Existing M3.3 manual
occurrences and the new external-plan occurrence path could therefore still be in `scheduled`
when their execution completed or was abandoned.

Before PR 3 Phase 4, `scheduled -> completed` and `scheduled -> abandoned` remained valid
transitions in both service policy and Firestore rules. The runner commits the athlete's
execution first and performs occurrence completion/abandonment as non-blocking bookkeeping
afterward; an occurrence-sync failure must not prevent the athlete from finishing a recorded
session. That compatibility rule still matters for launch paths that do not use the H4 claim.

PR 3 Phase 4 now routes **eligible non-primary intraday bundle-member starts** through
`claimIntradayMemberLaunch`/`claimOccurrenceLaunch`, so that path normally follows
`scheduled -> active -> completed/abandoned` and has an `active -> scheduled` rollback when
execution start fails. It did **not** make the claim unconditional for the v4 primary session
or every other occurrence-backed launch path. Consequently the direct
`scheduled -> completed/abandoned` transitions remain valid after #465 and were not tightened
there. Reconsider them only after every live occurrence-backed launch path that needs the
stronger lifecycle has an equivalent atomic claim/rollback contract; tightening them earlier
would regress compatibility paths rather than strengthen H4.

PR 2 also treats an explicitly supplied occurrence id as evidence, not as a trusted string:
`prepareExternalPlanSessionLaunch` resolves it and verifies user/date (when supplied) plus the
full `(planId, revision, sessionId, contentHash)` source identity before binding it to a
prescription.

## Follow-up roadmap

1. **PR 1 — implemented in PR #440:** prescription-only v4 primary-session launch binding, no
   occurrence record.
2. **PR 2 — implemented in PR #445:** introduce source-appropriate `SessionOccurrence`
   tracking for `external_plan`, including a statically discriminated `externalPlanRef` branch,
   `'external_plan'` authority, `'skipped'` state, deterministic/idempotent occurrence identity,
   replay validation, lifecycle transitions, and the atomic `claimOccurrenceLaunch` primitive.
   Live claim/ledger wiring was intentionally deferred as described above.
3. **PR 3 — delivered through Phase 6:** use resolved intraday placement to
   adjudicate and surface non-primary v4 members as independently launchable
   `additionalSessions` entries, wiring eligible launch through the occurrence claim/ledger
   boundary. Phase 5 captures post-AM `SessionResponse` evidence and Phase 6 activates the
   H4 policy transition.
4. **Phase 6 — delivered:** archived the then-current
   `2026-09-simulation-sequence-occupational-context-v2` policy and activated
   `2026-09-h4-intraday-bundle-member-launch-v1`.
5. **Optional later work — block scaling:** add a deterministic, testable external-definition
   scaling transform before allowing `scale` verdicts to produce launch bindings.

## Governing invariants for follow-up PRs

- Keep recommendation selection/adjudication pure; persistence belongs in caller/services.
- Never infer v4 from the presence of `definition`; use the schema discriminator.
- Never create a launch binding for `skip`, `defer`, or untransformed `scale` verdicts.
- Never turn imported target-event advisory metadata into an executable primary session.
- Preserve `contentHash`/`prescriptionHash` verification boundaries during replay.
- Do not silently extend v1-v3 execution behavior while implementing H4 v4 bundle features.
- Do not create occurrence records merely to mirror another source type; add them when an
  independent lifecycle/evidence identity is actually required.
- Keep Firestore expression-budget tests in the required validation set whenever recommendation
  binding/audit fields change.
