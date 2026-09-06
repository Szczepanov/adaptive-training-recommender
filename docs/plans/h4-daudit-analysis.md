# H4: D-AUDIT analysis and PR-1 handoff

**Status:** Analysis only. No code changes in this doc's commit.
**Tracks:** [GitHub issue #437](https://github.com/Szczepanov/adaptive-training-recommender/issues/437).
**Related:** [PR #440](https://github.com/Szczepanov/adaptive-training-recommender/pull/440)
(external-plan execution-binding pipeline, issue #434) and
[PR #442](https://github.com/Szczepanov/adaptive-training-recommender/pull/442) (D-REASSESS,
issue #436) -- **this document's single biggest finding changes both of their sequencing
assumptions**, see "Revised understanding" below.

## What ADR-0036 D-AUDIT requires

Quoting the ADR (`docs/adr/0036-intraday-training-windows-and-reassessment.md`):

> Version affected schedule, placement, occurrence and decision persistence explicitly.
> Keep user-scoped paths and backward-compatible readers; exact storage layout is an
> implementation detail, but a daily document must not overwrite AM evidence with PM.
> Record decision id/as-of instant, policy version, plan id/revision/hash, occurrence and
> prescription identities, requested/resolved window and offsets, bundle/order/dependency,
> availability revision, completed-fact revision and source ids, response/check-in
> snapshot identity, daily ledger ceilings/inputs/reservations/reconciled actuals,
> elapsed-separation evidence, result/reasons, and any override or superseded decision id.
> Retain immutable replay inputs, not only pointers to mutable latest records.
>
> Replay verifies all identity bindings and recomputes against those saved inputs.
> Missing inputs or any identity/hash/date/window mismatch is unreplayable, never repaired
> with today's plan, clock or wearable sync. Runtime activation requires a policy bump and
> matching schema, import, Firestore rules, replay and UI coverage.

## Revised understanding: this is not a green field

The original issue text (and the framing in the H4 plan docs) treated D-AUDIT as
"implement persistence/replay snapshots" -- language that reads like building a new
capability from scratch. **It is not.** `app/src/engine/replay.ts` already implements a
substantial, real replay-verification framework, already wired to a CLI
(`npm run replay:recommendation -- <audit.json>`, `CLAUDE.md`'s own documented command):

- `replayRecommendationAudit(recommendation, externalRevision, sessionEvidence)` already
  checks: policy version match against the current build (and distinguishes "historical,
  intentionally unreplayable" from "genuinely broken"), safety status, decision-context
  revision format, event-count consistency, subjective-drift replay errors
  (`subjectiveDriftAuditReplayErrors`), identity-decision replay errors
  (`identityDecisionProvenanceReplayErrors`), session-binding consistency and evidence
  errors, and -- most relevantly for H4 -- **external-plan decision replay** via
  `externalDecisionErrors`: it already re-derives the plan's content hash from supplied
  evidence and compares it byte-for-byte against what the audit recorded, rejecting
  replay if the plan changed under the same revision number, if the referenced session no
  longer exists, etc. `externalRestErrors` does the equivalent for ADR-0035 rest
  decisions.
- This is exactly the shape D-AUDIT's "replay verifies all identity bindings and
  recomputes against those saved inputs... any identity/hash/date/window mismatch is
  unreplayable" describes -- **for the provenance types that already exist**. D-AUDIT's
  actual job is narrower than it first appears: **add a new evidence/error-checking
  branch to this existing framework for D-PLACEMENT's bundle/window/ledger data**, the
  same way `externalDecisionErrors` was added for plan decisions and
  `subjectiveDriftAuditReplayErrors`/`identityDecisionProvenanceReplayErrors` were added
  for their respective domains. It is not a parallel system to build.

## What's still genuinely missing

The replay *verification* framework exists; the *persistence* of the specific new inputs
D-PLACEMENT introduces does not, and this is the real remaining gap:

1. **No `intradayBundle`/window/ledger data is persisted anywhere yet.** [PR #432](https://github.com/Szczepanov/adaptive-training-recommender/pull/432)
   attempted to add a resolved-bundle-placement trace to `recommendationAudit.externalPlan`
   and had to revert it -- [issue #435](https://github.com/Szczepanov/adaptive-training-recommender/issues/435)
   /[PR #441](https://github.com/Szczepanov/adaptive-training-recommender/pull/441)
   confirmed `hasValidRecommendationAudit` is at Firestore's per-request rule-evaluation
   ceiling even after a real, verified cost reduction. **D-AUDIT's persisted shape for
   H4-specific data should not be nested inside `recommendationAudit` at all** -- it
   needs its own top-level collection with its own validation function, sidestepping the
   ceiling entirely rather than fighting it. This also better matches the ADR's own
   phrase "exact storage layout is an implementation detail" -- nothing requires this to
   live inside the existing audit document.
2. **No revision/hash concept for a day's *ledger and availability* state as a whole**
   (only per-entry revisions in `dailyLedger.ts`, and `ExternalPlanPlacement.revision` for
   the plan overlay). [PR #442](https://github.com/Szczepanov/adaptive-training-recommender/pull/442)'s
   `ReassessmentInputRevision` sketch is exactly this gap, independently arrived at from
   the D-REASSESS side. **These are the same missing piece, not two separate ones.**
3. **No concept of a "pending" vs. "confirmed" decision distinct from the existing
   `recommendationAudit`'s always-already-decided shape.** The existing recommendation
   document model has no state machine for "provisional AM verdict, not yet claimed for
   PM" -- everything currently persisted already represents a completed decision.
4. **No superseded-decision linkage.** The ADR requires "any override or superseded
   decision id" -- nothing today models one decision explicitly replacing an earlier one
   for the same date/session (as opposed to the existing revision-bump-on-recommendation-
   document pattern, which overwrites rather than chains).

## The real coupling: D-AUDIT's minimal slice *is* D-REASSESS's prerequisite

[PR #442](https://github.com/Szczepanov/adaptive-training-recommender/pull/442) (D-REASSESS analysis)
independently found it needs "somewhere to persist a provisional decision + its input-
revision snapshot between AM composition and PM claim" before its own gate logic can be
built. That "somewhere" is precisely items 2 and 3 above. **This confirms (from the other
direction) that D-AUDIT and D-REASSESS cannot be sequenced as two fully independent
follow-ups** -- a minimal slice of D-AUDIT (revision tracking + pending-decision
persistence, items 2-3, *not* the full scope below) is a hard prerequisite for
D-REASSESS's first PR, not just a nice-to-have ordering.

**The full D-AUDIT scope (bundle/window/ledger persistence, full replay branch, superseded-
decision chains, UI states) is separable from that minimal slice** and can follow once
D-REASSESS's gate logic exists and there's real reassessment behavior worth auditing in
full.

## Recommended slicing (supersedes this issue's original single-PR framing)

1. **D-AUDIT minimal slice** (blocks D-REASSESS's first PR): a new top-level collection
   (e.g. `users/{userId}/intraday_decisions/{decisionId}` -- exact path TBD) storing, per
   pending decision: decision id/as-of instant, the bundle placement outcome
   (`BundlePlacementProposal`, already the exact shape `intradayBundlePlacement.ts`
   produces), and the `ReassessmentInputRevision`-shaped snapshot from PR #442's sketch.
   Own Firestore rules validation function, deliberately outside
   `hasValidRecommendationAudit`. No replay-framework changes yet (nothing to replay
   until D-REASSESS produces real decisions against this).
2. **D-REASSESS's PR(s)** (per PR #442), reading/writing into slice 1's persisted shape.
3. **D-AUDIT full slice**: extend `replay.ts` with a new evidence/error-checking branch
   for the persisted intraday-decision shape (mirroring `externalDecisionErrors`'s
   pattern exactly: re-derive expected values from supplied evidence, compare against
   what was recorded, report mismatches as unreplayable rather than silently repairing).
   Add superseded-decision linkage. Add UI surfacing for provisional/pending/dropped
   states. Extend `scripts/replay-recommendation-audit.mjs`'s CLI to accept the new
   evidence type, mirroring how it presumably already accepts `ExternalRevisionEvidence`/
   `SessionPrescriptionEvidence` (verify exact CLI argument shape at implementation time
   -- not fully read for this analysis).

## Open questions for the implementing agent

- Exact Firestore path/collection name for the new persisted shape (slice 1) -- pick
  something that reads naturally alongside `daily_recommendations`,
  `schedule_windows` (D-WINDOW), etc.
- Whether `ReassessmentInputRevision` (PR #442's sketch) and D-AUDIT's "availability
  revision, completed-fact revision" fields (ADR's own list) should literally be the same
  struct, or two structs that happen to overlap -- resolve when both are implemented
  together, not before.
- Re-verify `scripts/replay-recommendation-audit.mjs`'s current CLI argument shape before
  extending it -- not read in depth for this analysis.
- Confirm whether `hasValidRecommendationAudit`'s ceiling (issue #435) is relevant to the
  *new* top-level collection's rules function at all -- it shouldn't be, since it's a
  separate function/collection, but verify the new function doesn't itself grow into a
  similar problem once bundle/window/ledger fields are added (this data is more complex
  than the reverted `intradayBundle` trace was).

## Suggested PR description for D-AUDIT's minimal slice (PR 1)

> ## Summary
> Minimal persistence slice for ADR-0036 D-AUDIT (issue #437), scoped specifically to
> unblock D-REASSESS (issue #436, analysis in PR #442) -- not the full D-AUDIT scope.
>
> New top-level collection persisting a pending intraday decision's bundle-placement
> outcome and input-revision snapshot, with its own Firestore rules validation function
> deliberately kept outside `hasValidRecommendationAudit` (which is already at Firestore's
> per-request rule-evaluation ceiling -- issue #435).
>
> ## Not in scope here
> - Extending `replay.ts` with a bundle/window/ledger evidence branch (full D-AUDIT slice,
>   separate follow-up once D-REASSESS produces real decisions to replay).
> - Superseded-decision linkage, UI surfacing.
>
> (standard verification checklist)
