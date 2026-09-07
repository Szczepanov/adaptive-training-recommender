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

1. **No `intradayBundle`, window, or daily ledger data is persisted anywhere yet.**
   [PR #432](https://github.com/Szczepanov/adaptive-training-recommender/pull/432)
   attempted to add a resolved-bundle-placement trace to `recommendationAudit.externalPlan`
   and had to revert it -- [issue #435](https://github.com/Szczepanov/adaptive-training-recommender/issues/435)
   /[PR #441](https://github.com/Szczepanov/adaptive-training-recommender/pull/441)
   confirmed `hasValidRecommendationAudit` is at Firestore's per-request rule-evaluation
   ceiling even after a real, verified cost reduction. **D-AUDIT's persisted shape for
   H4-specific data should not be nested inside `recommendationAudit` at all** -- it
   needs its own dedicated user-scoped subcollection (`users/{userId}/intraday_decisions/{decisionId}`)
   with its own validation function, sidestepping the ceiling entirely rather than fighting
   it. (Note: this is a user-scoped subcollection under `users/{userId}`, not a root collection,
   preserving Critical System Constraint 1 for tenant isolation).
2. **No persistence or whole-day snapshot concept for ledger and availability state.**
   `dailyLedger.ts` is purely an in-memory calculation: it defines ordering `revision` numbers
   on `LedgerEntry`, but **zero ledger data is persisted in Firestore today** (neither individual
   entries nor whole-day snapshots). What is missing is the decision-level snapshot of the day's
   ledger state (ceilings, reservations, and reconciled actuals) and availability state.
   [PR #442](https://github.com/Szczepanov/adaptive-training-recommender/pull/442)'s
   `ReassessmentInputRevision` sketch independently identifies this exact gap from the
   D-REASSESS side. **These are the same missing piece, not two separate ones.**
3. **No persisted pending/provisional decision record.** The existing `daily_recommendations/{date}`
   document model represents a single, already-decided daily recommendation. It has no
   facility for storing a provisional AM verdict for a dependent PM session awaiting launch-time
   confirmation, nor can it store multiple decisions for the same date without overwriting AM
   evidence with PM evidence (which ADR-0036 explicitly forbids).
4. **No superseded-decision linkage.** ADR-0036 requires *"historical decisions remain
   immutable and are linked by superseding decision identity."* Nothing today models one
   decision explicitly pointing to an earlier decision ID it supersedes (as opposed to the
   existing revision-bump-on-recommendation-document pattern, which mutates/overwrites rather
   than chains).

## The real coupling: D-AUDIT's minimal slice, D-REASSESS (#436), and #434

[PR #442](https://github.com/Szczepanov/adaptive-training-recommender/pull/442) (D-REASSESS analysis)
independently found it needs "somewhere to persist a provisional decision + its input-
revision snapshot between AM composition and PM claim" before its own gate logic can be
built. That "somewhere" is precisely items 1, 2, and 3 above. **D-AUDIT and D-REASSESS cannot
be sequenced as two fully independent follow-ups** -- a minimal slice of D-AUDIT (revision
tracking + pending-decision persistence in a new subcollection) is a hard prerequisite for
D-REASSESS's first PR.

Furthermore, this depends on **Issue #434 PR 2** (occurrence tracking for `external_plan`):
because ADR-0036 requires D-AUDIT to record *"occurrence and prescription identities"*,
external-plan bundle sessions must have stable occurrence identities created by #434 PR 2
before D-AUDIT and D-REASSESS can bind to them.

**The full D-AUDIT scope (full replay branch, CLI extension, UI states) is separable from
that minimal slice** and should follow once D-REASSESS produces real reassessment decisions
worth auditing.

## Recommended slicing & design contracts

### 1. D-AUDIT minimal slice (blocks D-REASSESS's first PR)

Persist intraday decision records in a dedicated user-scoped subcollection:
`users/{userId}/intraday_decisions/{decisionId}`

#### Record Contract (`IntradayDecisionRecord`)
Each decision record binds identity, target window, immutable replay inputs, and outcome:

```typescript
export interface IntradayDecisionRecord {
  /** Unique decision ID (UUID v4), matches Firestore document ID */
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD (Europe/Warsaw local calendar date)
  asOf: string; // ISO 8601 evaluation instant
  policyVersion: number;
  schemaVersion: 1;

  /** Decision status */
  status: 'provisional' | 'confirmed' | 'superseded' | 'dropped';
  /** Points to an earlier decision ID replaced by this evaluation, if any */
  supersededDecisionId: string | null;

  /** Occurrence and window identity bindings */
  occurrenceId: string;
  sessionId: string;
  windowId: string;
  bundleId: string;
  orderInBundle: number;

  /** Immutable Replay Inputs (saved state as-of decision instant) */
  reassessmentInputRevision: {
    availabilityRevision: string;
    completedFactsRevision: string;
    checkinRevision: string;
    ledgerRevision: string;
    placementRevision: string;
  };
  bundlePlacement: BundlePlacementProposal;
  ledgerSnapshot: {
    ceilings: LedgerCeilings;
    entries: readonly LedgerEntry[];
  };

  /** Decision outcome and reasons */
  verdict: {
    decision: 'proceed' | 'scale' | 'defer' | 'skip' | 'pending';
    reasons: readonly string[];
  };
}
```

#### Lifecycle & Replay Invariant: Write-Once Immutability
To satisfy ADR-0036's guarantee (*"historical decisions remain immutable and are linked
by superseding decision identity"*) and avoid complex update-transaction rules:
- **Decision records are write-once append-only documents**: `allow update, delete: if false;`.
- When an athlete reassesses, claims, or drops a session, a **new** `IntradayDecisionRecord`
  is created with its own unique `id`, referencing `supersededDecisionId: previousRecord.id`.
- This ensures previous AM decision evidence is physically never overwritten by PM
  reassessment, and historical replay inputs can never be mutated after creation.

#### Firestore Security Rules Contract
The new validation function `hasValidIntradayDecision(userId, decisionId)` must enforce:
1. **Ownership**: `isOwner(userId)` and `request.resource.data.userId == userId`.
2. **Document ID match**: `request.resource.data.id == decisionId`.
3. **Write-once**: `allow create: if ...; allow update, delete: if false;`.
4. **Budget protection**: Validate top-level keys, type constraints (string lengths, integer
   ranges, status enum), without recursively validating deep nested arrays in CEL to keep
   evaluations well within Firestore's 1000-expression ceiling.

### 2. D-REASSESS PR(s) (per PR #442)
Built against Slice 1 and #434 PR 2: reads the latest active decision record, evaluates gates,
and atomically writes the reassessed/claimed decision record.

### 3. D-AUDIT full slice (Replay & Verification)
1. **Engine Replay (`app/src/engine/replay.ts`)**:
   Add `intradayDecisionErrors(record: IntradayDecisionRecord, externalRevision: ExternalRevisionEvidence | null)`:
   - Re-derives expected placement, separation, and ledger capacity strictly from the saved
     inputs (`bundlePlacement`, `ledgerSnapshot`, `reassessmentInputRevision`).
   - Fails closed as unreplayable if saved inputs are missing or if any hash, date, or
     window identity fails to match. Never queries live Firestore or mutable current state.
2. **Offline CLI Harness (`app/scripts/replay-recommendation-audit.mjs`)**:
   Extend the CLI to accept an intraday decision record:
   `npm run replay:recommendation -- <intraday-decision.json> [external-plan-revision.json]`
   Since `replay-recommendation-audit.mjs` executes offline in Vite SSR without Firestore access,
   the self-contained `IntradayDecisionRecord` provides all necessary inputs directly to the replay runner.
3. **UI Surfacing**: Surface provisional, confirmed, superseded, and dropped statuses in the UI.

---

## Open questions for the implementing agent

- **Discovery query pattern**: Because `daily_recommendations/{date}` must avoid rule bloat,
  the client should query active intraday decisions via `where('date', '==', today)` on the
  `users/{userId}/intraday_decisions` subcollection, resolving the active/latest chain via
  `supersededDecisionId`.
- **Replay CLI signature**: Decide whether `scripts/replay-recommendation-audit.mjs` inspects
  the JSON's schema to route between `replayRecommendationAudit` and `replayIntradayDecisionAudit`,
  or if a distinct flag/script (e.g. `npm run replay:intraday`) is preferable.

---

## Suggested PR description for D-AUDIT's minimal slice (PR 1)

```markdown
## Summary

Minimal persistence slice for ADR-0036 D-AUDIT (issue #437), scoped specifically to
unblock D-REASSESS (issue #436, PR #442) and #434 PR 2 -- not the full D-AUDIT scope.

Adds the user-scoped subcollection `users/{userId}/intraday_decisions/{decisionId}` persisting
immutable, write-once intraday decision records (`IntradayDecisionRecord`) with bundle placement,
ledger snapshot, and reassessment input revisions.

## Major Changes

- Domain Model: define `IntradayDecisionRecord` capturing identity, target window, immutable replay
  inputs (`BundlePlacementProposal`, `LedgerCeilings`, `LedgerEntry[]`, `ReassessmentInputRevision`),
  and outcome.
- Firestore Security Rules: add `hasValidIntradayDecision` for `users/{userId}/intraday_decisions/{decisionId}`
  with strict user ownership, ID binding, and write-once enforcement (`allow update, delete: if false;`),
  isolated from `hasValidRecommendationAudit` to respect expression evaluation budgets (issue #435).
- Service: add `intradayDecisionService.ts` to persist and query decision records by date/occurrence.

## Risk and Reviewer Guidance

Low risk: introduces a new, independent subcollection without modifying existing recommendation
or decision engine logic.
- Verify that decision records are strictly write-once (`allow update, delete: if false;`).
- Verify that `daily_recommendations` and existing recommendation rules remain untouched.

## Domain Invariants

- [x] User isolation preserved: paths are scoped to `users/{userId}/intraday_decisions/{decisionId}`.
- [x] Date logic preserves `Europe/Warsaw` calendar dates.
- [x] Write-once immutability guarantees historical AM evidence is never overwritten by PM evidence.
- [x] No credentials, tokens, or raw health payloads are touched.

## Screenshots or Recordings

Not applicable -- non-visual data persistence infrastructure.

## Validation

- [x] `cd app && npm run check`
- [x] `cd app && npm run test:rules` (local Firestore emulator test suite verifying budget and permissions)
```
