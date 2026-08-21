# Health anomaly shadow assessment architecture

This document describes the implemented HA-B through HA-E evidence path from
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
revision; they live in a separate mutable document (see "Prospective outcome capture" below).

Firestore permits owner reads and create-only revisions after structural validation. Updates
and deletes are denied.

## Episode semantics

A non-normal assessment starts an episode. The next observed calendar day continues the prior
episode when the immediately previous assessment is non-normal. Residual persistence is
carried forward only from a prior assessment that still had unexplained core evidence. The
live evaluator never backdates an episode from future information.

## Prospective outcome capture (HA6.1–HA6.3)

Once a shadow episode exists, the athlete can later record what actually explained it. This is
a distinct mutable record from the immutable assessment revision:

`users/{userId}/health_anomaly_outcomes/{episodeId}`

* `sourceAssessment` (`{date, revisionId}`) references the assessment revision that opened the
  episode; Firestore requires the referenced revision to exist and its `assessment.episodeId`
  to match the outcome document before any write is accepted.
* `explanation` is one of a bounded retrospective vocabulary (illness symptoms, hard
  training/recovery, poor sleep, alcohol, travel/jet lag, stress, heat/dehydration,
  vaccination/medication, nothing obvious, other/not sure) and may change on a later update —
  "nothing obvious" today can become "illness symptoms" tomorrow.
* `symptomOnset` is an optional Warsaw-local day-precision date; absence remains unknown, never
  "no symptoms".
* `respiratoryTest` is an optional explicit positive/negative result plus test date, stored with
  `source: 'user_reported'`; absence remains unknown, never a negative result.
* `episodeId`, `sourceAssessment`, `createdAt` and `schemaVersion` are immutable after creation;
  only `explanation`, `symptomOnset`, `respiratoryTest` and `note` may change on update.
  Deletion is denied.

Eligibility is deliberately not immediate: the app never prompts on the first day of a brand
new episode. `findRecentHealthAnomalyFollowupCandidate` in
`app/src/services/healthAnomalyOutcomeService.ts` offers a candidate only once a continuing
episode reaches its second day, or — for a one-day episode — on a later day via a bounded
prior-day lookback over already-persisted assessment revisions. No future data is fed back
into the original assessment; only the separate outcome document is written or revised.

The follow-up form (`HealthAnomalyFollowupCard`) is mounted only beside the existing shadow
trace on the Detailed Data screen. It carries the same "evidence only, does not change your
recommendation" framing as the shadow trace itself, and never renders the
`possible illness or systemic stress` alert wording — that remains gated on the HA7 evidence
decision.

HA6.4 (a personal expected-response model built from these labels) is deliberately not part of
this slice; it requires enough labelled real episodes per athlete before it can be evaluated
without fitting sparse noise.

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

`healthAnomalyReplay.ts` `runHealthAnomalyReplay` reuses the real HA2 feature mapper and HA3 evaluator.
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
context. `healthAnomalyReplay.ts` `renderHealthAnomalyReplayMarkdown` renders the Markdown
file as a compact day-by-day table with core evidence, hard-load, sleep/stress, state,
same-day symptoms and 24/48/72-hour labels.

## Still not enabled

HA-E adds prospective outcome capture (HA6.1–HA6.3) but no Home alert, notification, illness
probability, readiness weight, optimizer input, or training gate. HA6.4 personal
expected-response modelling is deliberately deferred pending enough labelled real episodes.
Visible wording still requires the HA7 evidence decision, and `tighten-v1` remains a later
separate release decision.
