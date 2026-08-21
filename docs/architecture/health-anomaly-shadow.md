# Health anomaly shadow assessment architecture

This document describes the implemented HA-B through HA-D evidence path from
`docs/plans/health-anomaly-and-illness-risk-alerting.md`.

## Runtime boundary

The health-anomaly evaluator is separate from readiness and recommendation selection.
`HealthAnomalyService` gathers canonical recovery/check-in/travel/history inputs, maps HA2
features, calls the pure evaluator, and persists a revision only for an explicit non-`off`
policy. No recommendation, fatigue, optimizer or weekly-allocation path consumes the result.

HA-D adds an intentionally narrower runtime selector than the future-facing policy enum. The
app evaluates and persists health-anomaly evidence only when:

```text
VITE_HEALTH_ANOMALY_POLICY=shadow-v1
```

Missing/invalid configuration and even the reserved `visible-v1` / `tighten-v1` values resolve
to runtime `off` in this slice. Those later modes remain blocked on their separate evidence and
release decisions. With runtime `off`, the app shell does not call the HA service and the shadow
Data screen renders nothing and performs no assessment read.

Shadow collection is fire-and-forget relative to normal decision composition. Its result is
never fed back into the same recommendation.

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

## Shadow diagnostics

When `shadow-v1` is explicitly enabled, the Detailed Data screen appends a developer-only
**Health anomaly (shadow)** trace. It shows:

- state, evidence level, episode/persistence and policy/revision provenance;
- current RHR/respiration/HRV, baseline, measured scale and standardized deviation;
- selected estimator/baseline version and signal data-quality coverage;
- recent hard-session, sleep, Garmin stress and subjective stress context;
- optional check-in context such as alcohol/travel/heat/dehydration/vaccination/medication;
- structured explanation coverage, residual evidence and supporting Garmin composites.

The panel explicitly states that the trace is evidence only, is not a diagnosis, and does not
alter the recommendation. There is no Home alert in HA-D.

## Historical replay / evidence report

`app/src/engine/healthAnomalyReplay.ts` reuses the real HA2 feature mapper and HA3 evaluator.
For each replay day it supplies only that day's inputs plus prior recovery history. After all
assessments have been computed it joins future 24/48/72-hour symptom reports as retrospective
labels, so future information can never influence the live state machine.

Input is a JSON object containing a `days` array. Each day contains `date`, a canonical
`recoverySnapshot` (or `null`), an optional canonical `subjectiveCheckin`, and optional
`authoredTravelActive` context.

Run the report from `app/`:

```text
npm run evidence:health-anomaly -- \
  --input path/to/replay.json \
  --json-out artifacts/health-anomaly-reports/latest/report.json \
  --markdown-out artifacts/health-anomaly-reports/latest/report.md
```

The CLI uses Vite SSR to execute the repository's actual TypeScript evaluator rather than a
parallel implementation. The JSON retains all candidate estimator traces and structured
context. The Markdown file provides a compact day-by-day table with core evidence, hard-load,
sleep/stress, state, same-day symptoms and 24/48/72-hour labels.

## Still not enabled

HA-D does not add a Home alert, notification, illness probability, prospective outcome capture,
or training gate. The next planned slice is HA-E / HA6 prospective follow-up labels. Visible
wording still requires the HA7 evidence decision, and `tighten-v1` remains a later separate
release decision.
