# Prospective immutable decision-context provenance

| Field | Value |
|---|---|
| Status | Draft |
| Trigger | Issue [#872](https://github.com/Szczepanov/adaptive-training-recommender/issues/872) cannot reconstruct historical Home inputs from mutable current-state documents |
| Owner | TO4 / recommendation audit |
| Authority impact | None; evidence provenance only |

## Problem

The current daily recommendation stores an audit, but source documents such as goals, training settings, preferences, intent profiles, check-ins, overlays, and fixed activities can change after a recommendation. Current bytes and their `updatedAt` values do not reconstruct every value Home used at date D. TO4 must keep these dates `not_replayable` instead of filling them with current state.

## Smallest useful change

For each normal recommendation, persist one user-scoped, immutable decision-context record containing the exact validated inputs that cross the production composition and Home-to-engine boundaries, plus:

- date, user id, deterministic `evaluatedAt`, current `POLICY_VERSION`, source/schema versions;
- the minimum-safety gate outcome and exact `evaluateTrainingWithIntent` arguments, excluding broad completed-training history;
- the narrow descriptor-scoped performed-training facts and explicit mechanical check-in history;
- references and hashes for any immutable plan/intent revisions used.

The recommendation audit binds the record by path and content hash. The record is created atomically with the recommendation where the existing write path permits it; otherwise the audit remains non-replayable until the record is durably written. Never update a record in place or backfill it from current documents.

## Acceptance checks

- The normal Home path and offline replay consume the same pure composed context and evaluator argument builder.
- Editing a source document after date D does not change D's stored context or replay digest.
- Missing, malformed, cross-user, or hash-mismatched context fails closed.
- A date that failed the minimum-safety gate stores enough evidence to report `not_applicable` without invoking the normal evaluator.
- Export remains user-scoped, bounded, private, and read-only; raw health inputs stay out of sanitized reports.
- Tests cover write-once identity, source mutation after capture, parity with Home arguments, and deterministic replay from the stored record.

After this lands, resume #872 at offline hydration and same-day replay. Historical dates without immutable context remain `not_replayable`; this change only enables prospective evidence.
