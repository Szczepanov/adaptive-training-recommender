# Prospective immutable decision-context provenance

| Field | Value |
|---|---|
| Status | In progress |
| Trigger | Issue [#872](https://github.com/Szczepanov/adaptive-training-recommender/issues/872) cannot reconstruct historical Home inputs from mutable current-state documents |
| Owner | TO4 / recommendation audit |
| Authority impact | None; evidence provenance only |

## Problem

The current daily recommendation stores an audit, but source documents such as goals, training settings, preferences, intent profiles, check-ins, overlays, and fixed activities can change after a recommendation. Current bytes and their `updatedAt` values do not reconstruct every value Home used at date D. TO4 must keep these dates `not_replayable` instead of filling them with current state.

## Smallest useful change

For each newly evaluated recommendation revision, persist one user-scoped, immutable capture record containing the validated composition inputs that Home handed to the evaluator, plus:

- date, user id, deterministic `evaluatedAt`, current `POLICY_VERSION`, source/schema versions;
- the minimum-safety gate outcome and the `evaluateTrainingWithIntent` arguments that can be safely retained;
- the narrow descriptor-scoped performed-training facts and explicit mechanical check-in history; canonical facts are preloaded once under the live intent's exact coverage descriptor and the same immutable snapshot is supplied to the evaluator and capture;
- references and hashes for any immutable plan/intent revisions used.

The recommendation audit binds the record by path and content hash. The record is created atomically with the recommendation, and Firestore rules require the record's hash, `policyVersion`, and `evaluatedAt` to match the bound audit. Capture must never cost the athlete the recommendation record: when a record cannot be built or its batch is rejected, the revision is persisted without a binding and stays `not_replayable`. Never update a record in place or backfill it from current documents. The optional bounded `trainingHistoryReplay` field retains normalized operational and provider-response snapshots; records created before that field remain `not_replayable`. Offline hydration verifies the immutable record and its audit binding before using it. Capture and replay remain evidence-only.

## Acceptance checks

- The normal Home path persists its same-day composition inputs with bounded normalized replay history, excluding raw provider documents, event feedback notes and mechanical-check-in notes/source references; decision-affecting user fields stay in the owner-only record.
- Editing a source document after date D does not change D's stored context or replay digest.
- Missing, malformed, cross-user, or hash-mismatched context fails closed.
- A date that failed the minimum-safety gate stores enough evidence to report `not_applicable` without invoking the normal evaluator.
- The capture stays user-scoped and owner-readable; mechanical-check-in notes/source references and broad raw history are not copied into it.
- Tests cover write-once identity, source mutation after capture, context-hash binding, descriptor-scoped performed-fact parity, audit/context policy+instant binding (client and rules), fail-closed record validation, and degradation to an unbound revision when capture fails.

Issue #961 adds bounded replay inputs and offline hydration, with synthetic live-output parity, identical provider requests, repeat-run determinism, mutation isolation and fail-closed checks. Next: accumulate new captures and run the private #872 evidence workflow. Historical dates without replay-capable immutable context remain `not_replayable`; broad-history activation remains a separate decision.
