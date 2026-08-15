# ADR-0020: Subjective Baselines in Readiness Mode

* **Status:** Proposed
* **Date:** 2026-08-15
* **Deciders:** Repository owner
* **Related:** [ADR-0006](./0006-reconciled-strain-telemetry.md) (acute vs drift decomposition), [ADR-0010](./0010-decision-provenance-and-audit-replay.md) (replay), **D-FUSE** ([Phase 4](../plans/phase-4-objective-credit-v2.md)) — measure before choosing

## Context

`rules.ts` `evaluateReadinessAndSafetyEnvelope` applies two different philosophies to the two halves of the same readiness question.

**Objective metrics are self-normalised.** `metricStrain` z-scores HRV, RHR, and sleep against the athlete's own trailing 7-day and 28-day baselines, divided by their own 28-day stdev, floored (HRV 3 ms, RHR 1.5 bpm, sleep 4 pts) and capped at ±2.0 per term. ADR-0006 argues this at length: fixed absolute thresholds cannot express "this person is drifting away from their own normal."

**Subjective scores are used raw**, against fixed absolute cutoffs:

```text
overallFatigueScore = (fatigue + soreness + (10−readiness) + (10−sleepQuality) + (10−motivation)) / 5
  > 7 → recover        > 5 → modify        soreness > 6 → modify        fatigue > 8 → extremeFatigue
```

Nothing anywhere baselines subjective data. The argument that justified self-normalising HRV stops at the sensor boundary with no stated reason.

The consequence is a personal-scale error in both directions. An athlete who habitually reports 4 on readiness sits permanently in `modify`; one who never reports below 7 never leaves `train`. Neither is getting the decision their own history supports. And a readiness average that has slid from 8 to 6 over three weeks — a real signal, and exactly the multi-day pattern ADR-0006 says predicts overreaching better than one noisy reading — is structurally invisible.

### What makes subjective data different

Three properties distinguish it from wearable data and constrain any fix.

**It is ordinal, not interval.** The distance from 7 to 6 is not reliably the distance from 3 to 2. Mean and stdev are shakier here than on HRV in milliseconds.

**It can be contaminated by seeing its own history.** HRV cannot be gamed; a self-report shifts once the athlete is told what "normal" looks like. This repository already treats that as live: `DailySubjectiveCheckin` carries `initialSubmittedAt` and `editedAfterWearableReveal` specifically to record whether a check-in was revised after wearable data was shown.

**Its missingness is not random.** Wearable data exists for every night the watch was worn; check-ins exist only for days the athlete completed one, and they are skipped disproportionately on disrupted days — which are disproportionately bad days. A baseline computed from a sparse record is therefore **biased optimistic by construction**, which would make a genuine decline read as normal. Objective baselines have no equivalent failure mode, and `dataQuality.baseline28dReady` is a maturity flag, not a selection-bias guard.

### The decisive constraint

Normalisation cannot be allowed to *loosen* a decision. If an athlete's baseline soreness is 7 because they are chronically beaten up, a purely relative reading makes soreness 7 "normal, proceed" — the exact inversion of what a safety gate is for.

This is not a new invariant to invent. `metricStrain` already clamps both its terms with `clamp(-z, 0, STRAIN_Z_CAP)`: a *better-than-baseline* HRV day contributes **zero** strain, never negative strain. Adverse-only accumulation is already how the objective side works. Extending it to subjective data is consistency with an existing invariant, not a special case carved out for it.

## Decision

### D-SUBJDRIFT — the subjective term measures drift only, never today

The subjective contribution is computed from the **7-day average versus the 28-day average**. It does not include an acute today-versus-7-day term.

Today's reading already enters the decision at full weight and unnormalised through `overallFatigueScore` and the absolute triggers. Adding an acute normalised term would count the same reading twice and amplify exactly the noisiest input — one bad night, an argument, a late meal. The gap that absolute thresholds cannot see is the multi-day slide, so that is the only gap this term fills.

### D-SUBJADD — a separate additive term, floored at zero

The result is a distinct `subjectiveDrift` score, not a modification of `objectiveStrain`, and it is floored at zero per metric exactly as `metricStrain` floors its own terms. A better-than-baseline trend contributes zero, never a discount.

Keeping it separate preserves `DecisionScoreTelemetry`'s existing decomposition — objective strain, contextual penalties, and now subjective drift remain independently readable and must still reconcile arithmetically to the total.

### D-SUBJFLOOR — absolute thresholds remain hard floors

Every existing absolute trigger stays exactly as it is: `overallFatigueScore > 7`, `> 5`, `soreness > 6`, `fatigue > 8`, `soreness > 8`, `painFlag`. The subjective drift term may only **escalate** `train → modify → recover`. No value of it may ever de-escalate a mode that an absolute trigger has already set.

This must be structural — the drift term contributes to an accumulating score that is compared against thresholds, with no subtraction path — not merely a tested behaviour.

### D-SUBJCOV — below a coverage floor the term is exactly zero

The subjective baseline is computed only when at least **10 of the trailing 28 days** carry a recorded check-in, counted as distinct dates. Below that, `subjectiveDrift` is `0` and the decision is identical to today's.

The failure direction matters: an absent baseline falls back to current behaviour, which is safe and already shipped. A sparse baseline would be confidently optimistic, which is not.

`10` is a starting value, subject to **D-SUBJCAL** like every other coefficient here.

### D-SUBJSD — stdev floor of one scale point

Normalisation divides by the athlete's own 28-day stdev of that metric, floored at **1.0 point**. An athlete who reports the same value every day has zero variance; without a floor, a single one-point move produces an unbounded z-score. One point is the smallest movement the scale can express, which makes it the natural floor. Terms are capped at `STRAIN_Z_CAP` (2.0), matching the objective side.

### D-SUBJPURE — baselines arrive precomputed; the evaluator stays pure

`evaluateReadinessAndSafetyEnvelope` remains pure and synchronous. Subjective baselines are computed at the composition boundary and passed in as data on `DailyReadiness`, exactly as objective baselines already arrive precomputed on `DailyRecoverySnapshot.derived`.

The evaluator must not gain a history provider, an async signature, or a Firestore read. `composer.ts` gains one bounded range query alongside its existing `Promise.allSettled` fan-out.

The read must use a **date-range** query. `checkinService.getRecentCheckins` applies `limit(days)` to a date-ordered query and therefore returns the most recent N *documents*, not N *days* — with gaps it silently spans a longer period, which would make the D-SUBJCOV coverage count read as complete whenever it is not. This defect was found and fixed in the context brief; the same trap applies here.

### D-SUBJANCHOR — never show the baseline before the check-in is submitted

Subjective baselines may be surfaced retrospectively — the Data view, the context brief, a trend chart. They must **not** appear anywhere in the check-in flow before submission, and the check-in form must not display the athlete's own prior scores for the fields being answered.

Telling someone what their normal is immediately before asking them to self-report corrupts the measurement. The existing `initialSubmittedAt` / `editedAfterWearableReveal` fields exist because this repository already decided that pre-submission context contaminates a check-in; this decision extends that to the athlete's own history.

### D-SUBJCAL — coefficients are an output of calibration, not an input to this ADR

This ADR fixes the **structure and the safety rules**. It deliberately does not prescribe the per-metric weights, whether `motivation` and `mentalStress` participate at all, the drift multiplier, or the final value of the coverage floor.

Those are set by running the change through `simulate:calibrate` and the scenario corpus and comparing mode-distribution shifts, recovery share, and constraint violations against the committed baseline — the same evidence discipline **D-FUSE** established when it refused to prescribe a fatigue-fusion formula in advance. A result showing the term changes nothing useful, or degrades recovery share, is a valid outcome that closes this ADR as `Rejected`.

Two candidate questions the calibration should answer explicitly:

* Does `motivation` belong? It is already in `overallFatigueScore`, but it plausibly tracks life stress more than training tolerance, and a baselined motivation drift may add noise rather than signal.
* Does the drift term need `CHRONIC_STRAIN_MULTIPLIER`'s ×1.5 treatment, or is subjective drift already slower-moving than its objective counterpart?

### D-SUBJAUDIT — coverage is persisted for replay

`RecommendationAudit` gains the subjective baseline's coverage count and the resulting drift contribution. A decision that depended on a 28-day subjective window is not reproducible from an audit that does not record how many days that window actually held.

`POLICY_VERSION` is bumped and the outgoing value moves to `HISTORICAL_POLICY_VERSIONS`; `check-policy-drift.mjs` enforces this.

## Consequences

**Positive.** The personal-scale error is corrected in the only direction that is safe to correct it. Multi-day subjective slides become visible to the mode gate for the first time. The engine applies one philosophy to both halves of readiness instead of two. Telemetry gains a third independently readable component, and the existing rationale annotation for decision-relevant objective drift extends naturally to subjective drift.

**Negative.** A third term in a score that is already a sum of six contributions makes the mode decision harder to explain in one sentence, and the athlete-facing rationale will need care to avoid becoming a list. The composition boundary gains a query. Athletes with sparse check-in histories get no benefit at all — by design, but it means the feature is invisible until the habit is established.

**Neutral.** Behaviour is unchanged for any athlete below the coverage floor, so rollout is naturally gradual and the blast radius on day one is zero.

**Explicitly accepted risk.** Ordinal data is being treated as interval for the purpose of a z-score. The stdev floor and the ±2.0 cap bound the damage, and the tighten-only rule bounds the direction of it, but this is a real modelling compromise and is recorded as such rather than argued away.

## Alternatives considered

**Fold subjective z-scores into `objectiveStrain`.** Simplest to implement and rejected on two grounds: a single combined score allows a favourable subjective trend to offset an adverse objective one, which is the loosening D-SUBJFLOOR forbids; and it destroys the telemetry decomposition that ADR-0006 built deliberately.

**Replace the absolute thresholds with normalised ones.** The pure version of the idea, and the dangerous one — it is precisely the chronically-sore-athlete inversion. Rejected outright.

**Include an acute today-vs-7d subjective term.** Rejected under D-SUBJDRIFT: double-counts today's reading and amplifies the noisiest input.

**Do nothing; keep subjective baselines in the brief and the Data view only.** A legitimate outcome, and the one D-SUBJCAL selects if the calibration shows no useful signal. It is not chosen up front because the personal-scale error is real and currently uncorrected.

**Ask the athlete to self-calibrate** ("what is a normal readiness day for you?"). Rejected: it is the same contaminated self-report the baseline exists to replace, gathered once and then stale.
