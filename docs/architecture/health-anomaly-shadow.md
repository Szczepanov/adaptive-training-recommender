# Health anomaly shadow assessment architecture

This document describes the implemented HA-B/HA-C evidence path from
`docs/plans/health-anomaly-and-illness-risk-alerting.md`.

## Runtime boundary

The health-anomaly evaluator is separate from readiness and recommendation selection.
`HealthAnomalyService` gathers canonical recovery/check-in/travel/history inputs, maps HA2
features, calls the pure evaluator, and persists a revision only for an explicit non-`off`
policy. No recommendation path calls this service yet.

## Candidate shadow policy

`shadow-v1` uses versioned candidate thresholds. They are replay/calibration parameters, not
physiological truths and not authorization for user-visible illness wording. RHR and
respiration use high-side adverse evidence; HRV uses low-side adverse evidence while retaining
unusually high HRV as two-sided out-of-range telemetry. Supporting Garmin composites never
satisfy the core multi-signal escalation rule.

Context explanations remain structured. A strong explanation can cover a core signal for the
purpose of residual evidence, but the original signal remains present in the assessment trace.
Symptoms have semantic priority over wearable appearance.

## Persistence

Assessments are immutable nested revisions at:

`users/{userId}/health_anomaly_assessments/{date}/revisions/{revisionId}`

The identity fingerprints the effective date, mode, evaluator/threshold versions, exact
canonical recovery/check-in/history content, and travel/persistence provenance. An exact retry
reuses the same revision; a corrected/rebuilt source produces a different revision even when
its external timestamp is unchanged. Outcome labels are intentionally not part of this
revision and remain future HA6 work.

Firestore permits owner reads and create-only revisions after structural validation. Updates
and deletes are denied.

## Episode semantics

A non-normal assessment starts an episode. The next observed calendar day continues the prior
episode when the immediately previous assessment is non-normal. Residual persistence is
carried forward only from a prior assessment that still had unexplained core evidence. The
live evaluator never backdates an episode from future information.

## Still not enabled

HA-C does not enable a runtime feature flag, Home alert, notification, illness probability, or
training gate. The next planned slice is HA-D: shadow observability and replay/evidence tooling.
