# ADR-0025: Physiological anomaly and possible-illness signals

* **Status:** Accepted
* **Date:** 2026-08-21
* **Deciders:** Core Engineering Team

---

## Context

The application already combines subjective readiness with Garmin-derived sleep, RHR, HRV,
respiration, activity/load and recovery metrics. It also collects an explicit
`illnessSymptoms` flag. That flag protects a user who already feels ill, but the application
currently has no user-facing capability for a **pre-symptomatic physiological anomaly**.

Wearable research supports the possibility of detecting infection-associated physiological
changes before symptoms in some users. The same literature also shows a substantial
specificity problem: hard training, poor sleep, psychological stress, alcohol, travel and
other disruptions can create the same RHR/HRV/respiration pattern.

ADR-0006/ADR-0024 deliberately keep the current respiration strain path default-off because a
respiration weight inside the training-strain score has not been calibrated. That remains the
correct decision. This ADR does not enable that path. It defines a separate health-anomaly
capability whose output can be evaluated, explained and calibrated independently from the
training-readiness score.

Evidence review and repository audit:

* [`../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md`](../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md)
* ADR-0006 — reconciled strain telemetry
* ADR-0010 — decision provenance and replay
* ADR-0014 — evidence before live policy cutover
* ADR-0020 — subjective-baseline evidence discipline
* ADR-0024 — metric-specific biometric baseline policy

---

## Decision

### 1. Build a separate physiological-anomaly evaluator

The engine will gain a pure, deterministic evaluator conceptually named
`evaluatePhysiologicalAnomaly`.

It is **not** part of `metricStrain` and does not initially change recommendation mode.

The evaluator produces a versioned, explainable assessment with at least:

```ts
interface PhysiologicalAnomalyAssessment {
  state:
    | 'normal'
    | 'explained_recovery_strain'
    | 'watch_unexplained'
    | 'possible_illness_or_systemic_stress'
    | 'symptoms_reported';
  evidenceLevel: 'none' | 'low' | 'moderate' | 'high';
  coreSignals: CoreSignalEvidence[];
  supportingSignals: SupportingSignalEvidence[];
  explanations: ContextExplanation[];
  unexplainedEvidence: string[];
  persistenceDays: number;
  dataQuality: AssessmentDataQuality;
  policyVersion: string;
}
```

Exact TypeScript names may change during implementation. The semantic separation may not.

### 2. Core physiological channels are RHR, respiration and HRV

The initial independent anomaly channels are:

1. resting heart rate;
2. respiration rate;
3. HRV.

Each is interpreted relative to the athlete's own baseline and only when data coverage is
sufficient.

Estimator details remain governed by ADR-0024. In particular:

* respiration may use the median/MAD candidate when its version/coverage requirements hold;
* RHR must compare appropriate robust/mean/EWMA candidates rather than assuming one estimator;
* HRV must compare current raw-domain behavior with a log-domain candidate and must not assume
  that raw-domain median/MAD is automatically correct.

Thresholds, weights and persistence windows are versioned policy, not physiological facts.

### 3. Garmin composite metrics are supporting/context signals, not independent votes

Sleep Score, Body Battery, Garmin stress, HRV Status and Training Readiness share upstream
information. The evaluator must not add them as if each were an independent sensor channel.

They may be used to:

* describe recovery state;
* corroborate a broad systemic-stress pattern;
* explain why the existing readiness engine is conservative;
* improve user-facing rationale.

They must not manufacture high illness confidence by double-counting shared HRV/sleep/stress
inputs.

### 4. Known alternative explanations are first-class structured inputs

The evaluator explicitly represents plausible non-infectious explanations rather than
subtracting undocumented points from an illness score.

#### Automatically derived context

Use existing data wherever possible:

* recent hard/very-hard training and completed-session cost;
* sleep duration/score and existing subjective sleep quality;
* Garmin/subjective stress;
* structured authored travel context;
* activity/steps change.

Do not ask the user to re-enter facts the app already knows.

#### Compact optional check-in context

Extend the daily check-in with structured fields for the most important remaining
confounders/priors:

* alcohol in the previous 24 h (`0`, `1`, `2`, `3+` drinks);
* unplanned travel / jet lag / unusually late arrival;
* unusual heat/sauna exposure;
* dehydration / significant fluid loss;
* recent vaccination or medication change;
* known close sick contact / household illness;
* optional `other disruption` note.

The exact UX may collapse these behind an "Anything unusual since yesterday?" row. Absence of
an answer means **unknown**, not `false`, unless the user explicitly submits `none`.

### 5. Explicit symptoms stay authoritative and tighten-only

`illnessSymptoms` remains a direct safety input. A user reporting illness symptoms must not
be made more permissive because wearables look normal.

The anomaly capability may eventually add detail to symptom reporting (symptom type, severity,
onset), but it must preserve the existing conservative semantics.

### 6. No disease diagnosis and no pseudo-probability

Before calibration, user-visible output must not say:

* "you have an infection";
* "you are getting COVID/flu";
* "72% chance you are sick" or any other unvalidated percentage.

Approved semantics are:

* **normal** — no meaningful anomaly;
* **explained recovery strain** — physiology is altered but known training/recovery context is
  a plausible explanation;
* **unusual physiology — watch** — one or more signals are unusual and no strong explanation
  is present;
* **possible illness or systemic stress** — a persistent/multi-signal pattern remains
  unexplained and resembles patterns seen around illness in wearable studies;
* **symptoms reported** — the athlete has explicitly reported illness symptoms.

`possible illness` is a hypothesis label, never a diagnosis.

### 7. Confounders change explanation, not truth

Hard training, alcohol, travel or poor sleep do not make an observed RHR/HRV/respiration
change disappear. The assessment records both:

1. the physiological anomaly evidence; and
2. how much of that pattern is plausibly explained by known context.

For example, RHR up + HRV down after a very hard session with normal respiration can be
classified as `explained_recovery_strain`. The same pattern plus persistent elevated
respiration on a subsequent easy/rest day can escalate because the original explanation no
longer covers the whole observation.

This avoids the false precision of arbitrary "-2 illness points for hard training" logic.

### 8. Persistence is a separate evidence dimension

A single anomalous night and a multi-night pattern are not equivalent.

The evaluator records episode/persistence state explicitly. Candidate policies may use
persistence to escalate `watch_unexplained` to `possible_illness_or_systemic_stress`, but the
exact duration/threshold must be calibrated in replay/prospective data.

### 9. Rollout is staged and default-off

Add a policy selector with semantics equivalent to:

```ts
type HealthAnomalyPolicy =
  | 'off'
  | 'shadow-v1'
  | 'visible-v1'
  | 'tighten-v1';
```

* `off` — no evaluator/output.
* `shadow-v1` — compute/persist/debug only; no user-facing alert and no training change.
* `visible-v1` — show evidence-backed anomaly/explanation information; no training-mode change.
* `tighten-v1` — a validated alert may tighten training decisions, never loosen them.

Production begins at `off`; implementation/replay explicitly opts into `shadow-v1`.

### 10. Training integration, when eventually enabled, is tighten-only

A future validated high-confidence state may suppress/defer hard or maximal work.

It must never:

* turn `recover` into `modify/train`;
* relax pain/injury restrictions;
* override explicit illness symptoms in a permissive direction;
* add intensity because the anomaly score is low.

The existing readiness/safety envelope remains the training authority. Health anomaly is an
additional conservative gate only after evidence authorizes `tighten-v1`.

### 11. Every assessment is replayable and attributable

Persist enough provenance to reconstruct why an assessment occurred:

* date/time and policy version;
* baseline computation versions;
* raw/current values used;
* standardized/personal-baseline deviations;
* data coverage/quality;
* automatically derived hard-training/sleep/stress/travel context;
* user-entered context;
* symptoms;
* persistence/episode state;
* state transitions;
* eventual follow-up label when available.

Same-day recomputation must follow the append-only revision principles from ADR-0010 rather
than overwriting the history that produced an earlier alert.

### 12. Prospectively learn the athlete's alternative explanations and outcomes

After an anomaly episode, the product may ask a low-friction follow-up such as:

* symptoms developed;
* no illness developed;
* hard training likely explained it;
* alcohol;
* travel/jet lag;
* poor sleep/stress;
* heat/dehydration;
* unknown/other.

This label is evidence, not ground truth unless supported by a test/diagnosis. It enables
later personal calibration and activity/context-matched expected-response models.

No personalised ML model is approved by this ADR. Deterministic versioned rules come first;
ML becomes a separate decision when enough labelled history exists.

---

## User-facing severity semantics

| Surface | State | Example message | Training effect at first release |
|---|---|---|---|
| none | `normal` | No health alert. | none |
| info | `explained_recovery_strain` | "Your recovery signals are off baseline, but yesterday's hard training / short sleep is a plausible explanation." | none beyond existing readiness logic |
| caution | `watch_unexplained` | "Your physiology is unusual today and we don't have a clear explanation yet. Watch for symptoms and re-check tomorrow." | none in `visible-v1` |
| warning | `possible_illness_or_systemic_stress` | "Several recovery signals are unusually stressed and the pattern is persisting without a clear training/sleep/travel explanation. Possible illness or other systemic stress." | only after `tighten-v1` validation |
| safety | `symptoms_reported` | "You reported illness symptoms. Keep today conservative and prioritize recovery." | preserve existing conservative handling |

The detail view should show **why**: for example `RHR +6 bpm vs baseline`, `respiration +1.8
br/min`, `HRV below normal range`, `2nd night`, `no hard session`, while separately showing
known explanations such as `short sleep` or `2 drinks`.

---

## Evidence required before each cutover

### `off` -> `shadow-v1`

Requires only implementation correctness, data-quality gates, tests and no production
behavior change.

### `shadow-v1` -> `visible-v1`

Requires a recorded replay/prospective report demonstrating that the user-facing category is
truthful and not excessively noisy. At minimum report:

* alerts per 30 observed days;
* per-signal and multi-signal alert counts;
* persistence distribution;
* context-explained fraction;
* false-alert causes;
* symptom follow-up within 24/48/72 h when available;
* alert lead time around illness episodes;
* missing-data behavior;
* duplicate/repeated-alert burden.

A generic `unusual physiology` message can be released on weaker evidence than a `possible
illness` interpretation because it makes a narrower claim.

### `visible-v1` -> `tighten-v1`

Requires evidence that the new gate improves safety/decision quality without causing an
unacceptable rate of unnecessary hard-session suppression. Report actual recommendation
flips and athlete outcomes. Synthetic scenarios alone cannot authorize this cutover.

---

## Consequences

### Positive

* Adds the pre-symptomatic capability the product currently lacks without pretending a
  consumer wearable is a diagnostic device.
* Uses the repository's rich training context to address the strongest known false-positive
  source rather than ignoring it.
* Adds alcohol/travel/other context only where the app cannot infer it itself.
* Keeps correlated Garmin composites from multiplying confidence.
* Produces an explainable assessment that can be replayed and personally calibrated.
* Preserves existing conservative symptom/injury behavior.

### Negative

* Requires another versioned policy/evidence pipeline instead of a simple respiration weight.
* Optional check-in context increases schema and UX complexity.
* Prospective validation takes time because true illness episodes are sparse.
* A single-athlete model may never support a well-calibrated disease probability; categorical
  anomaly messaging may remain the correct long-term product.

---

## Rejected alternatives

### Enable `RespirationStrainPolicy='median-mad-v1'` in production

Rejected. It changes training strain without solving illness attribution and without the
replay evidence ADR-0024 requires.

### One aggregate "illness score" from every Garmin metric

Rejected. It double-counts overlapping Garmin composites and hides why the score changed.

### Treat hard training/alcohol/travel as simple negative points

Rejected. Those factors explain specific signal patterns with different strengths and time
courses. A traceable explanation model is preferable to undocumented score subtraction.

### Train a classifier immediately

Rejected. The repository does not yet have enough prospective, personally labelled illness
and confounder episodes to justify model complexity or calibrated probabilities.

---

## References

Research synthesis and direct links are maintained in:

[`../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md`](../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md)
