# Issue #953 — Implementation plan: rejected `daily_recommendations` writes

**Status:** Implemented
**Reviewed:** 1 October 2026
**Repository baseline reviewed:** `main` at `8a6d193b`. Re-checked at `eb6ad221` (after #954 and #948 merged): `firestore.rules`, `recommendationService.ts`, the binding model and validators, the budget harness and `daily-decision.pw.ts` are unchanged, so §0 still holds
**Issue:** https://github.com/Szczepanov/adaptive-training-recommender/issues/953
**Related:** #893 (PR-E #954 and its `test.fixme` regressions #949–#952), #435 (earlier audit-budget work), #881 (FIT workout fingerprint)

> **Read §0 first.** The issue body describes this as one expression-budget problem. The
> investigation found **three independent defects** (resolved by this implementation). The emulator labelled all three as
> "maximum of 1000 expressions", so its message was not a diagnosis. Corrective record was posted to
> the issue with the §0 findings (WP0.1).

---

## 0. Verified diagnosis

All of this evidence came from synthetic emulator athletes. The real rejected payloads were
captured from E2E runs and replayed against the `app/firestore.rules` file at `8a6d193b`. The
harness and payloads are in the untracked `.issue-953-evidence/` folder at the repo root; its
`README.txt` explains how to rerun each piece.

### D1 — Catalog bindings carry fields the rules forbid (fails every catalog-bound create) [RESOLVED]

- #881 (2026-09-28) added the optional pair `fitWorkoutFingerprint` / `fitWorkoutFingerprintKind`
  to `SessionReferenceBinding` (`app/src/sessions/models.ts`).
- `prepareCatalogSessionLaunch` (`sessionAuthoringService.ts`, through `computeCatalogFitIdentity`)
  fills that pair on every catalog binding.
- The TypeScript side accepts the pair: `app/src/sessions/validation.ts` validates its format and
  pairing, and the parser in `persistence/parsers/trainingHistory.ts` reads it.
- ~~`firestore.rules` `hasValidSessionReferenceBinding` still allows only
  `['sessionSource', 'occurrenceId', 'prescriptionHash']`.~~ *Resolved: `firestore.rules` now admits
  the optional `fitWorkoutFingerprint` and `fitWorkoutFingerprintKind` pair.*
- ~~Result: any `daily_recommendations` write whose top-level `primarySession` is a catalog binding
  is rejected.~~ *Resolved: catalog bindings carrying the optional pair are now accepted by the rules.*
- Proof: the exact captured create, decision-context batch included, was denied prior to the fix. Removing only the
  two fingerprint keys made it pass. Now fully accepted by the updated rules.
- `additionalSessions` elements are not checked per element by the rules (size ≤ 4 only), so they
  were unaffected. The nested audit copies are not rule-validated either.

### D2 — The update path costs more than Firestore's per-document budget [RESOLVED]

The headroom numbers came from padding the rule with N `(1 == 1)` terms, through a 50-term helper
function, and binary-searching the largest N that still passed (prior to restructuring):

| Rule under test (realistic doc, payload `#4`) | Pad terms consumed | Note |
|---|---|---|
| trivial `true` | ~0 (the budget is ~198 terms) | One term ≈ 5 expressions |
| `hasValidRecommendation` (create path) | ~179 | **~19 terms of headroom left** |
| …`hasValidRecommendationAudit` alone | ~99 | ≈ half the budget; unchanged by list sizes |
| …`hasValidSessionReferenceBinding(primarySession)` | ~27 | four-branch `hasValidSessionSource` |
| …`hasValidAdherence` | ~15 | |
| update: `isValidAdherenceOnlyUpdate(...) \|\|` prefix | ~13 | Computes its own `diff()` |
| update: `decisionFieldsUnchanged()` | ~10 | Second `diff()` |
| update: `canUpdateRecommendation` | **over budget** | Prior to restructuring |

*Resolved: Rules restructured to evaluate `request.resource.data.diff(resource.data).affectedKeys()` once,
dispatch adherence-only via ternary, validate only changed sections, and use ternary branching in `canUpdateRecommendation`.
All real-shape fixtures and scenarios now pass with ≥ 40 pad terms (~20% headroom).*

Other facts the fix design depended on:
- **The budget is per document write, not per batch.** The recommendation costs the same alone or
  batched with its `decision_contexts` and `revisions` documents.
- **On an update, only the `update` allow statement is charged.** Setting `allow create: if false`
  changes nothing.
- **List lengths do not matter.** Rules do not iterate `knowledgeLineage` or `candidateScores`.
  Field count and branch count drive the cost.
- **The overrun is additive.** A minimal document updates fine. Adding back `engineVerdict`,
  `primarySession` and the audit's `decisionContext` (which every captured revision carries)
  tipped it over. No single field was the culprit.

### D3 — `set(..., { merge: true })` deep-merges the audit, so stale provenance survives [RESOLVED]

`recommendationService.ts` (`saveRecommendationInternal` → its inner `persist`) previously wrote the recommendation
with `{ merge: true }`. Firestore deep-merges nested maps, so a new decision's
`recommendationAudit` kept the previous revision's sub-fields when the new audit omitted them.

*Resolved: Replaced `{ merge: true }` with `{ mergeFields: Object.keys(writeData) }` across batch and single doc writes.
Audits are now replaced wholesale, eliminating cross-revision provenance corruption and unblocking the no-context fallback.*

### Historical measured impact on tests (prior to fix)

| Surface | Defect | Historical effect (resolved) |
|---|---|---|
| `daily-decision.pw.ts` check-in (catalog) | D1 | Recommendation was rejected; now verified with authenticated readback & console trap |
| PR-E V7 skip day (`rest_01`, catalog binding) | D1 | #950: un-fixme'd and passing |
| Happy path / V12 / V6 post-check-in rev 1→2 | D2 (+ D3 on fallback) | Overrun eliminated; wholesale audit replacement verified |
| PR-E V8 / V9 / V4 updates | D2 (+ D3) | Rules budget unblocked |
| `intraday_bundle_placements` best-effort write | Non-fatal | Rules update unblocks standard paths |

**Production:** both rules and hosting deploy manually (`deploy-frontend.yml`
`workflow_dispatch`, `deploy_rules`). Production drift was checked before starting (clean). Deploy rules first, then hosting.

---

## 1. Goal and scope

**Goal:** every recommendation write the app legitimately makes persists, at the maximum
supported shape, with measured headroom. Audits must never mix two decisions.

In scope:
- `app/firestore.rules` (`daily_recommendations` and the shared binding helper);
- `app/src/services/recommendationService.ts` write semantics;
- rules-emulator tests, a budget harness, and E2E persistence guards;
- docs.

**Not in scope:**
- engine/policy changes (no `POLICY_VERSION` bump; I5 is not triggered, because recommendations
  do not change);
- #949's Home `scale` gating;
- #951/#952's replacement and secondary-launch logic beyond re-evaluating them (WP6);
- the `intraday_bundle_placements` failure, which only gets triage (WP6.3).

## 2. Constraints (must hold; stop and escalate if a change needs to break one)

- **ADR-0002 owner scoping:** no relaxation of `isOwner` / `hasOwnedUserId` / `keepsOwnership`.
- **ADR-0010 decision provenance:** keep these rule-enforced:
  - audit write-once per decision (`auditWriteOnce`);
  - the immutable `decision_contexts` binding (path / revision / contentHash, plus
    `existsAfter` / `getAfter` agreement);
  - archive-on-decision-change (`archivesPriorRevision`);
  - revision ratchet rules.
- **ADR-0035:** keep the authored-rest binding (`externalRest` ⇒ `templateId == 'rest_01'`
  unless overridden) and the `externalPlan` / `externalRest` exclusivity.
- **The rules stay a structural backstop.** Per-reference/semantic validation lives at the TS
  boundary (`validateRecommendation`, `sessions/validation.ts`), as the existing comments on
  `hasValidKnowledgeLineage`, `hasValidAdditionalSessions` and the ADR-0041 note already say.
  Removing a check from the rules is allowed **only** when:
  1. the TS boundary enforces it, with a test that names it; and
  2. it is not one of the integrity invariants above.
  Record each removal in the WP3 table.
- **No line-number references** in docs or commit messages (CLAUDE.md §5).
- **A security reviewer must review rules changes** (`security-reviewer` agent; user's global
  rules) before the PR is marked ready.

## 3. Work packages

Order: WP0 → WP1 → WP2 → (WP3 only if WP2's targets are missed) → WP4 → WP5 → WP6. WP1 is
small, independently correct, and unblocks #950. If time pressure demands it, ship it as its own
PR first.

### WP0 — Reproduce, correct the record, and commit a real-shape budget harness

1. **Correct #953.** Add a comment summarising D1/D2/D3 and pointing to this plan. The current
   body's "remaining candidates from #435" framing is wrong for D1 and D3.
2. **Check production (maintainer, read-only).** From `app/`, run
   `npm run firestore:rules:drift` to compare the deployed rules with the repo. Note which
   hosting build is live, and whether it includes #881. Record the answer in the PR. Do not
   deploy anything from this step.
3. **Extend `app/src/emulator/recommendationAuditBudget.emulator.test.ts`.** Do not add a new
   file; this is the #435 harness. It needs:
   - **Real-shape fixtures.** Build them from the app's own types and run them through
     `validateRecommendation` before writing, so a fixture the app would reject fails at
     fixture time. Cover at least:
     - **F-catalog:** a catalog `primarySession` with the fingerprint pair, a prescription,
       `engineVerdict`, `adjustment`, and an audit with `decisionContext`, `plannedDose`,
       `executionDose`, `primarySession` copy, `droppedContributorObjectives`, 64 lineage
       refs and 64 candidate scores;
     - **F-external:** an `external_plan` binding plus `audit.externalPlan` +
       `authoredOccurrence`;
     - **F-rest:** `rest_01` + `audit.externalRest` (with no candidates);
     - **F-maximal:** F-catalog + 4 `additionalSessions` + `subjectiveDrift` +
       `identityDecision`. Seed the `health_identity_assessments` /
       `health_identity_review_events` docs its `get()` calls read; this is the costliest
       legitimate shape and was **not measured** in this investigation.
   - **Write scenarios** that mirror `recommendationService` exactly:
     - **S1:** create + `decision_contexts/1` batch;
     - **S2:** unchanged re-save (only `updatedAt` changes);
     - **S3:** decision change, rev+1, with a `revisions/{prior}` archive and
       `decision_contexts/{n}` batch;
     - **S4:** S3 without a context (fallback);
     - **S5:** an adherence-only update (`updateDoc` of `adherence`);
     - **S6:** a decision change that *drops* `primarySession` (`deleteField`).
   - **A headroom assertion.** Port the padding probe from `.issue-953-evidence/zz953i`, using a
     helper-function pad (a long inline chain hits "Expression is too complex"). Assert that
     every fixture × scenario passes with at least **40 pad terms** (~20 % of the budget) of
     padding. Keep the probe cheap: one padded rules variant per scenario at the threshold, not
     a binary search in CI. Put the binary search behind an env flag (`AUDIT_BUDGET_MEASURE=1`)
     that prints exact headroom for the PR description. Keep `AUDIT_BUDGET_BASE` working for
     baseline-vs-candidate comparisons.
   - Run it at baseline first. **Expected red:** S1 for F-catalog (D1), and S2/S3/S4/S6 for
     every fixture (D2/D3). Record the baseline in the PR.

### WP1 — Fingerprint pair on top-level bindings (fixes D1)

In `hasValidSessionReferenceBinding`:
- add `'fitWorkoutFingerprint', 'fitWorkoutFingerprintKind'` to `hasOnly`;
- enforce the pair: `('fitWorkoutFingerprint' in binding) == ('fitWorkoutFingerprintKind' in binding)`;
- enforce the kind enum (`in ['semantic_definition', 'index_fallback']`), matching the
  `session_executions` rule.

For the fingerprint's **format** regex, measure first: `matches()` is not free. The
`session_executions` / performed-occurrence rules already validate it. If headroom allows,
mirror them. Otherwise rely on `sessions/validation.ts` and record that in WP3.

Tests (`firestoreRules.emulator.test.ts`, near the existing binding tests):
- accepts a catalog binding with a valid pair;
- rejects only one half of the pair;
- rejects an unknown kind;
- rejects an extra unknown key.

Add a **TS↔rules parity test** at the vitest level: assert that the key set the rules allow on
`hasValidSessionReferenceBinding` equals the optional + required keys of
`SessionReferenceBinding`. Follow the existing rules-text parity precedent in
`app/src/observations/firestoreRulesParity.test.ts`. This is the regression that would have
caught #881.

### WP2 — Restructure the update path (fixes D2 for most writes)

Target: every WP0 scenario passes with ≥ 40 pad terms of headroom. Steps:

1. **Compute `affectedKeys()` once.** The update statement passes
   `request.resource.data.diff(resource.data).affectedKeys()` down as `changed`.
   `isValidAdherenceOnlyUpdate`, `decisionFieldsUnchanged` and `auditWriteOnce` take `changed`
   and must not call `diff()` again. The prototype in `zz953.candidate.rules` shows the
   mechanics.
2. **Dispatch instead of `||`.**
   `changed.hasOnly(['adherence']) ? isValidAdherenceOnlyUpdate(...) : canUpdateRecommendation(...)`.
   Equivalence argument, to pin with tests:
   - when only `adherence` changed, `canUpdateRecommendation` implies the adherence-only
     conditions (ownership, date, `hasValidAdherence`), so the old `||` and the new ternary
     agree;
   - when anything else changed, the adherence-only branch was always false.
   - Include the empty-diff (no-op write) case explicitly.
3. **Revalidate only what changed on update.** Introduce an update-specific validator, or
   parameterise `hasValidRecommendation` with `changed`. On create, pass all keys:
   `request.resource.data.keys().toSet()`, or keep a create-only wrapper. On update, each
   section's validator runs only if its key is in `changed`:
   - **scalars:** `templateId`, `templateTitle`, `category`, `modality`, `mode`, `rationale`,
     `engineVerdict`, `schemaVersion`, `revision`, `createdAt`, `updatedAt`;
   - `adherence`;
   - `primarySession`;
   - `additionalSessions`;
   - `recommendationAudit`.

   **Keep unconditional:**
   - `hasOwnedUserId`, `isDateDocument`, and `keys().hasOnly(...)` on the whole document;
   - the ADR-0035 rest binding: it reads `templateId` *and* the audit, so evaluate it whenever
     either is in `changed`;
   - audit validation whenever `recommendationAudit`, `schemaVersion` or `revision` is in
     `changed`, because the audit check depends on `version` and `revision`.

   Soundness argument, to put in a rules comment: an unchanged section is byte-identical to what
   a previous allowed write stored, and that write validated it. Legacy documents written before
   a rule existed are the exception. Accept that explicitly: such a section is only revalidated
   when the client rewrites it, which matches how the TS read boundary already treats legacy
   documents.
4. Re-measure with the WP0 harness. Expectations from the investigation:
   - S2 (unchanged re-save) drops by ~half the budget, because the audit is skipped;
   - S3/S4 still pay for the full audit (it changes with every decision), plus the archive check
     and the overhead.

   If S3/S4 miss the 40-term target for any fixture, F-maximal especially, do WP3.

### WP3 — Reduce audit validation cost (only if WP2 misses the target)

Build a classification table in the PR, one row per conjunct of `hasValidRecommendationAudit`:

| Check | Class | TS enforcement (test name) | Decision |
|---|---|---|---|
| e.g. `audit.decisionContext` binding + `existsAfter`/`getAfter` | Integrity (ADR-0010) | — | **Keep** |
| e.g. `externalRest` ⇒ `rest_01`, `externalPlan` ⊕ `externalRest` | Integrity (ADR-0035) | — | **Keep** |
| e.g. `history.sourceStatuses` value enum | Shape | `validateRecommendation` … | Candidate to drop |

- Use the emulator coverage report (`/emulator/v1/projects/<id>:ruleCoverage.html`) to see which
  conjuncts actually run per scenario.
- Drop shape-only checks in cost order until every scenario has ≥ 40 pad terms of headroom.
- Prefer, in this order:
  1. a dropped duplicate `hasAll` where `hasOnly` plus field reads already imply presence;
  2. merged type checks;
  3. moving identity-provenance `get()` comparisons out of the hot path, which needs a separate
     ADR-0010 discussion if they are integrity checks.
- **Do not** move the audit into a separate document in this issue. That changes readers and
  replay, and it needs its own plan.

### WP3 implementation record — audit validation split and security review

The implementation did require WP3 for F-maximal headroom. The rule/TypeScript split is
intentional and was re-reviewed against ADR-0010, ADR-0028, ADR-0035 and Firebase's
per-operation Rules budget model.

| Check / audit area | Class | TypeScript enforcement | Rules decision |
|---|---|---|---|
| `decisionContext` user/date/revision/path/hash binding and paired context write | **Integrity (ADR-0010)** | `validateRecommendation` context-path test + `validateDecisionContext` tamper tests | **Keep.** Recommendation checks the canonical path/revision and `getAfter` hash; the immutable `decision_contexts/{revision}` write independently checks full context shape and `existsAfter`/reverse binding. |
| identity assessment/review binding | **Integrity (ADR-0028)** | `validateRecommendation` identity-shape cases; `identityDecisionProvenanceReplayErrors` | **Keep.** Assessment id/status/policy/feature schema/passport/shared bundle/anchor bundles and review/effective-state binding remain cross-document checks. Non-`USER` shared evidence cannot be selected as effective. |
| `externalPlan` XOR `externalRest`, protected-rest candidate semantics and `rest_01` binding | **Integrity (ADR-0035)** | `validateRecommendation` external-plan/external-rest cases | **Keep** the cross-field semantics in Rules; move deep provenance shape to TypeScript. |
| prior-revision archive + revision ratchet | **Integrity (ADR-0010)** | service revision/archive tests | **Keep.** The archive must match the prior scalar decision identity; revision documents remain append-only. |
| history counts/statuses and envelope | Shape/semantic range | `validateRecommendation` exact nested-shape validation | Rules retain bounded container / the hot-path status backstop only. |
| planned/execution dose | Shape/range | `validateRecommendation` `validDose` + malformed-provenance test | Move deep shape/range to TypeScript; Rules require map containers. |
| candidate scores / dropped contributor objectives | Shape/bounds | `validateRecommendation` exact candidate/objective validation | Rules retain list bounds needed to prevent unbounded audit storage. |
| `externalPlan` provenance fields | Shape | `validateRecommendation` exact external-plan validation | Move deep shape to TypeScript. |
| `externalRest` provenance fields | Shape | `validateRecommendation` exact required/optional fields, revision/date/type checks | Move deep shape to TypeScript; keep protected-rest semantics in Rules. |
| authored occurrence provenance | Shape + decision enum | `validateRecommendation` exact occurrence binding | Rules keep the decision enum; TypeScript validates the full pair. |
| subjective-drift provenance | Shape/range | `validateRecommendation` exact estimator/metric validation | Rules keep bounded map containers; deep validation is TypeScript-owned. |
| top-level / audit session bindings | Executable integrity at top level; replay-copy shape in audit | `validateRecommendation` binding validation, including FIT fingerprint pair/kind | Rules fully validate executable top-level bindings; nested audit copies stay replay evidence. |
| knowledge lineage | Shape/bounds | `validateRecommendation` exact refs + duplicate-ID rejection | Rules keep the 64-entry bound; TypeScript validates each reference. |
| athlete-evidence lineage | Shape/bounds (SKR4) | `validateRecommendation` exact refs + duplicate record-ID rejection; provenance snapshots max 16 | Rules admit the field and keep the 16-entry bound; TypeScript validates each reference. A TS↔Rules audit-key parity test prevents future allowlist drift. |

Security-review conclusion: do **not** buy expression headroom by deleting cross-document
provenance guarantees. Firebase documents a 1,000-expression ceiling and per-operation document
access-call limits even inside a batch; `getAfter()` is the mechanism for requiring atomic related
writes. The context document therefore carries its full reverse-binding validation on its own
write budget, while the recommendation hot path keeps the minimum forward integrity binding.
Identity assessment comparisons likewise remain in Rules; only deep object shape moved to the
trusted validation boundary.

The TypeScript validator consumes identity reason-code enums through the neutral
`src/contracts/identityReasonCodes.ts` contract rather than `observations/identityModels.ts`, so
selection/optimizer modules do not gain a transitive dependency on evidence-only observation
modules (OV1.4 architecture boundary).

### WP4 — Stop deep-merging the audit (fixes D3)

In `recommendationService.ts` `persist`, any write that sets `recommendationAudit` must
**replace it wholesale**, never deep-merge it into the stored map.

Options, in order of preference:
- **(a)** keep `{ merge: true }` for the document, but write the audit as a whole field value;
- **(b)** write the full document without merge.

Before choosing:
- Check `mergeFields` semantics for a map-valued field path against the installed `firebase`
  version, using Context7 or the official docs (CLAUDE.md §2.5). Then **prove** the behaviour
  with an emulator test; do not rely on the docs alone.
- If you choose (b), handle the documented adherence race. `adherence` is already copied from
  `existing`, so merge does not protect it today either. State this in the PR.

Also:
- **The fallback path.** When a write drops the binding, `decisionContext` must disappear from
  the stored audit (wholesale replacement achieves this).
- **Deletes.** Keep `deleteField()` behaviour for `prescription` / `primarySession` /
  `additionalSessions`.

Tests:
- a `recommendationService` unit test asserting the exact write call shape;
- an **emulator** test, under rules, in which a decision change from an `externalPlan` audit to
  an `externalRest` / `authoredOccurrence` audit stores exactly the new audit (no stale keys);
- the S4 fallback persisting.

Also fix the misleading warning in `saveRecommendationInternal`'s permission-denied branch. It claims the
cause is "usually" a cache/server disagreement. Name the possible causes (rules shape or budget,
stale merge), or keep it neutral. Keep it free of personal data (I6).

### WP5 — Guardrails so a green E2E can no longer hide this

1. **`daily-decision.pw.ts`:** after check-in, read `daily_recommendations/{today}` back as the
   authenticated athlete (use the authenticated-read pattern in `app/tests/e2e/support/`). Assert
   it parses AVAILABLE through `parseDailyRecommendation`, with the expected revision.
2. **A console trap fixture** in `app/tests/e2e/support/`. It fails the test on browser console
   messages matching `Permission denied saving recommendation` or
   `maximum of 1000 expressions`.
   - Apply it in the recommendation-bearing specs: `daily-decision`, `external-verdict` (desktop
     and mobile), `external-coach-round-trip`, `external-plan-execution-states`,
     `external-plan-revisions`.
   - Opt-in per spec, not global: some specs legitimately exercise denials.
   - The trap must listen to page console events; the WebServer log is not reachable from tests.
3. Make the budget harness from WP0 part of `npm run test:rules`. It already lives under
   `src/emulator`, so confirm it is not skipped in CI (`emulatorDescribe` requires
   `FIRESTORE_EMULATOR_HOST`).

### WP6 — Re-evaluate downstream issues and update docs

1. On the fix branch, temporarily un-fixme PR-E's V4, V7, V8 and bundle V9 in
   `app/tests/e2e/external-plan-execution-states.pw.ts` (on `main` since #954).
   Record per variant: passes, fails with the same symptom, or fails differently.
   - Expected: **V7 passes** (D1 was its entire cause), so close #950 with that evidence and
     flip V7 to an active test.
   - Comment on #949/#951/#952 with what remains.
   - Re-fixme whatever still fails, and keep it out of scope.
2. Update the #893 plan's ledger (`docs/plans/2026-09-29-issue-893-external-coach-round-trip.md`,
   H2 row) and `docs/external-plan-schema.md` (the #953 sentence) to match the outcome.
3. Triage the `intraday_bundle_placements` permission-denied seen in V9
   (`recordIntradayBundlePlacementAudit`). Capture its payload with the same instrumentation
   technique. File a separate issue if it is unrelated to D1–D3.
4. Add this plan to `docs/plans/README.md` (status board). When implemented, strike the §0
   present-tense problem statements (CLAUDE.md §5).

---

## 4. Verification matrix

| Gate | Command (from `app/` unless noted) | Required |
|---|---|---|
| Budget harness, baseline vs candidate | `npm run emulators:exec:rules -- "npx vitest run src/emulator/recommendationAuditBudget.emulator.test.ts"` (with `AUDIT_BUDGET_BASE=8a6d193b` for the baseline, and `AUDIT_BUDGET_MEASURE=1` for numbers) | Yes; report both tables in the PR |
| Rules suite | `npm run test:rules` | Yes (rules change) |
| Frontend gate | `npm run check` | Yes |
| Recommendation-bearing E2E | `npm run emulators:exec:e2e -- "npx playwright test --config=playwright.e2e.config.ts daily-decision external-"` | Yes, and **zero** `maximum of 1000` / `Permission denied saving recommendation` lines in the output (`grep -c` = 0) |
| Full E2E | `npm run test:e2e` | Yes |
| Handoff | `make verify` (repo root) | Yes |
| Policy drift / simulate / judge | — | Not required: no engine/policy change. State this in the PR |

Report each command, its working directory and its exit code (user's global rule: a validator
reproduces any subagent's "passed").

### Post-review verification correction — 1 October 2026

Independent PR review found that CI run 4783 failed five of the advertised 40-term
headroom cases (`F-rest × S3` and `F-maximal × S1/S3/S4/S6`) after later integrity
hardening commits had increased rule cost. The review also found that
`droppedContributorObjectives` had lost its documented 64-entry Rules bound.

Follow-up changes on this PR:

- group stable update scalars behind one `affectedKeys()` membership test, preserving full
  validation whenever one of those scalars actually changes;
- remove only duplicate audit-shape checks that `validateRecommendation` already enforces,
  while retaining decision-context and identity cross-document provenance checks;
- restore the 64-entry `droppedContributorObjectives` Rules bound and add an emulator
  regression test;
- amend ADR-0010 to record the TypeScript-shape / Rules-integrity validation split.

Verification closed on code head `765a8ae5` by CI run 4790: both Firestore Rules shards passed,
including the ≥40-padding real-shape budget harness; both Browser E2E shards passed with the
recommendation console trap enabled; the aggregate frontend/rules/E2E gate and final CI gate
also passed. #950 was closed from this evidence; #949/#951/#952 remain open as separate defects.
## 5. Acceptance checklist

- [x] #953 is corrected with D1/D2/D3, and the production rules/hosting state is recorded.
- [x] Every real-shape fixture × scenario in the budget harness passes with ≥ 40 pad terms of
      headroom on code head `765a8ae5` (CI run 4790); the baseline and candidate tables are in the PR.
- [x] A catalog binding with a fingerprint pair is accepted; half-pairs, unknown kinds and
      extra keys are rejected; the TS↔rules binding key parity test exists.
- [x] The update path computes `affectedKeys()` once, dispatches adherence-only by ternary, and
      revalidates only changed sections. The integrity checks in §2 are still enforced, with an
      emulator test for each.
- [x] A decision change never leaves stale audit sub-fields (emulator proof), and the
      no-context fallback persists.
- [x] `daily-decision.pw.ts` reads back the persisted recommendation, and the console trap is
      active in the recommendation-bearing specs. E2E output has no budget or denial lines.
- [x] V7 / #950 is resolved with current-head E2E evidence and #950 is closed; #949/#951/#952
      carry explicit re-evaluation comments and remain open for their independent acceptance criteria.
- [x] Any WP3 removals are tabulated with their TS enforcement; the security review is done.
- [x] No `POLICY_VERSION` change; CI run 4790 is fully green (both Rules shards, both Browser E2E
      shards, frontend unit/static gates, Python, simulations, Docker smoke, and final CI gate).

## 6. Risks and rollback

- **Weakening integrity checks to buy headroom.** Mitigated by the §2 list, the WP3 table and
  the security review. When in doubt, keep the check and find headroom elsewhere.
- **The update-only revalidation lets legacy invalid sections persist.** This is accepted and
  documented (WP2.3). It cannot introduce new invalid data, because every changed section is
  validated.
- **The emulator does not match production expression accounting.** Keep ≥ 20 % headroom rather
  than tuning to the edge. After deploy, watch client logs for the denial warning.
- **Deploy ordering.** The new rules are a superset for creates (the fingerprint keys) and are
  equivalent-or-looser for updates, so deploy **rules first, then hosting**. This uses the
  manual `deploy-frontend.yml` with `deploy_rules`, after the drift check. Old clients keep
  working.
- **Rollback.** Revert the rules and service commits. Rejected writes then resume, and no data
  migration is needed. Recommendations that were never persisted cannot be backfilled, because
  they were computed at render time. Say so in the PR.

## 7. Notes for the implementing agent

- **Don't diagnose from the emulator's error text.** It reports "maximum of 1000 expressions"
  for D1, D2 and D3 alike. Use the replay harness and the coverage report instead.
- **Vitest swallows `console.log` in this repo's emulator runs.** The evidence harness appends to
  a file instead.
- **Inline pad chains above a few hundred terms fail to compile.** Use helper functions.
- **Start from `.issue-953-evidence/zz953.candidate.rules`.** It is a partial prototype (it fixes
  creates, not updates). Reuse the mechanics and replace the rest.
