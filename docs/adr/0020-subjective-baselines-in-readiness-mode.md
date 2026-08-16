# ADR-0020: Subjective Baselines in Readiness Mode

* **Status:** Accepted
* **Date:** 2026-08-16
* **Proposed:** 2026-08-15
* **Deciders:** Repository owner
* **Related:** [ADR-0006](./0006-reconciled-strain-telemetry.md) (acute vs drift decomposition), [ADR-0010](./0010-decision-provenance-and-audit-replay.md) (replay), **D-FUSE** ([Phase 4](../plans/phase-4-objective-credit-v2.md)) — measure before choosing

> **Acceptance boundary.** Accepting this ADR approves the architecture and safety invariants for *measuring* an optional subjective-drift term. It does **not** approve enabling that term in production. Production activation remains a separate Phase 9 go/no-go decision requiring both regression/simulation evidence and prospective real-athlete evidence under D-SUBJCAL.

## Context

`rules.ts` `evaluateReadinessAndSafetyEnvelope` applies two different philosophies to the two halves of the same readiness question.

**Objective metrics are self-normalised.** `metricStrain` compares HRV, RHR, and sleep with the athlete's own recent and longer baselines, scales adverse deviation by within-athlete variability, and only accumulates adverse movement. ADR-0006 established the architectural reason: fixed absolute thresholds cannot express "this person is moving away from their own normal."

**Subjective scores are used raw**, against fixed absolute cutoffs:

```text
overallFatigueScore = (fatigue + soreness + (10-readiness) + (10-sleepQuality) + (10-motivation)) / 5
  > 7 -> recover        > 5 -> modify        soreness > 6 -> modify        fatigue > 8 -> extremeFatigue
```

Nothing currently baselines subjective data for decision use. A persistent decline that stays on the same side of every absolute threshold is therefore invisible to the mode gate.

The personal-scale problem exists in both directions. An athlete who habitually reports low values can be over-restricted by absolute thresholds; an athlete who habitually reports high values can deteriorate materially before crossing them. **This ADR only permits the relative signal to act in the conservative direction.** It may detect adverse within-athlete drift earlier, but it may never use "normal for this athlete" to cancel an absolute warning.

That asymmetry is deliberate. Correcting habitual-low reporting by relaxing an absolute trigger would use the same mechanism that could normalize chronic soreness or fatigue. If scale-use calibration later proves necessary, it needs a different instrument and a separate decision.

### Evidence posture

Subjective monitoring is useful enough to measure, but the evidence does not justify freezing one estimator as physiological law.

* Thorpe et al. found perceived fatigue sensitive to recent training-load fluctuations in elite soccer, while soreness and sleep quality were not consistently sensitive in the same cohort (PMID 27918668, DOI 10.1123/ijspp.2016-0433).
* Fitzpatrick et al. found poor reliability for several subjective wellness items in elite youth soccer (PMID 31498220).
* Pexa et al. found good/excellent test-retest reliability for short daily health surveys in collegiate athletes, but convergent validity differed by item and readiness related only weakly to the comparison measure (PMID 39947188, DOI 10.1123/jsr.2024-0321).
* Marques-Jimenez et al. found individualized wellness z-scores more informative than raw/team-normalized scores for some professional-soccer match outputs, but explained external-load variance remained limited and the clearest signal was DOMS (PMID 39662485, DOI 10.1123/ijspp.2024-0249).

The evidence supports **individualized interpretation as a hypothesis worth testing**, not a claim that 7-day/28-day z-scores, a particular coverage floor, or a fixed set of questionnaire items are established biological thresholds.

### What makes subjective data different

Three properties constrain any fix.

**It is ordinal or at best approximately interval.** A one-point change does not have a guaranteed constant physiological meaning across the 1–10 scale or across athletes. Means and standard deviations can be useful engineering summaries, but they are modelling assumptions, not natural units like milliseconds or beats per minute.

**It can be contaminated by context shown before reporting.** The repository already treats this as live: `DailySubjectiveCheckin` carries `initialSubmittedAt` and `editedAfterWearableReveal`. Showing the athlete their own baseline immediately before asking the same question can anchor the response in the same way.

**Missingness may be informative.** Check-ins are voluntary observations and missing days cannot be assumed representative of observed days. The direction of that bias is not known a priori, so sparse history must not be treated as a confidently representative baseline.

### The decisive constraint

Normalisation cannot be allowed to *loosen* a decision. If an athlete's soreness is chronically 7, a purely relative interpretation must not turn soreness 7 into "normal, proceed".

This is consistent with the existing objective-side philosophy: favourable relative movement contributes no negative strain. Subjective drift therefore remains an **adverse-only additional signal** on top of the current absolute thresholds.

## Decision

### D-SUBJHIST — today's check-in is never part of today's baseline

For a decision on local date `D`, subjective history is bounded by:

```text
throughDateExclusive = D
```

Only check-ins dated strictly before `D` may contribute to the baseline used for `D`.

Today's subjective values already enter `overallFatigueScore` and the existing absolute triggers at full weight. Including today's observation in a recent or long baseline would partially count the same measurement twice while claiming to measure prior-state drift. The composition boundary and tests must enforce this exclusion explicitly.

### D-SUBJDRIFT — measure persistent adverse within-athlete change, not an acute second copy of today

The optional subjective term represents **persistent adverse movement in recent prior history relative to a longer prior reference**. It does not include a today-versus-baseline acute term.

The architecture fixes that semantic shape; it does **not** freeze one statistical estimator. A 7-day recent mean versus 28-day reference mean, normalized by within-athlete variability, is the first reference candidate because it mirrors the existing objective-side decomposition and is easy to audit. Window lengths, scaling method, variance floor, cap, and metric participation remain experimental policy parameters under D-SUBJCAL.

### D-SUBJADD — a separate adverse-only term

The result is a distinct `subjectiveDrift` contribution, not a modification of `objectiveStrain`. Each participating component is floored at zero before aggregation: favourable relative movement cannot subtract from strain.

Keeping it separate preserves `DecisionScoreTelemetry`'s decomposition — objective strain, contextual penalties, and subjective drift remain independently readable and must reconcile arithmetically to the total decision score.

### D-SUBJFLOOR — absolute thresholds remain hard floors

Every existing absolute subjective trigger stays authoritative: `overallFatigueScore > 7`, `> 5`, `soreness > 6`, `fatigue > 8`, `soreness > 8`, and `painFlag`.

Subjective drift may only escalate:

```text
train -> modify -> recover
```

No baseline, estimator, coefficient, or favourable trend may de-escalate a mode already selected by an absolute trigger. This must be structural — no subtraction path exists — and covered by a property test.

### D-SUBJCOV — both recent-state and long-reference coverage must be adequate

A single count such as "10 of 28" is insufficient. Ten observations concentrated at the beginning of a 28-day window can satisfy a long-window count while providing no evidence about the recent state the term is supposed to measure.

Baseline eligibility therefore records and evaluates at least:

```text
recentRecordedDays
longRecordedDays
lastObservationDate
```

and may additionally record a bounded gap diagnostic such as `maxGapDays` if Phase 9 measurement shows it is useful.

If either the recent-state estimate or the long-reference estimate lacks sufficient valid observations, `subjectiveDrift` is exactly `0` and production behaviour is unchanged. The exact recent/long window lengths and minimum counts are calibration parameters, not architectural constants.

Only distinct, complete scored check-in dates count. Partial safety-only check-ins still carry their safety meaning but are not observations of the full subjective score vector.

### D-SUBJEST — estimator details are versioned policy, not ADR invariants

Phase 9 starts with a transparent **reference estimator** for measurement:

* recent window: 7 prior calendar days;
* long window: 28 prior calendar days;
* compare recent and long location per metric;
* normalize adverse movement by a bounded within-athlete variability estimate;
* floor favourable movement at zero;
* cap individual contributions before weighting.

The initial implementation may use mean / population standard deviation with a 1-point variability floor and `STRAIN_Z_CAP = 2.0`, but those numbers are **candidate policy**, not accepted physiological constants.

Before a production ship decision, Phase 9 must report sensitivity to estimator choices that can materially change decisions: recent/long window length, coverage requirements, variability floor/cap, included metrics, and weighting. If observed data show strong outlier or discreteness sensitivity, the comparison must include a robust alternative (for example a median/rank-based variant) rather than assuming z-score arithmetic is uniquely correct.

### D-SUBJPURE — baselines arrive precomputed; the evaluator stays pure

`evaluateReadinessAndSafetyEnvelope` remains pure and synchronous. Subjective baseline data are computed at the composition boundary and passed on `DailyReadiness`, just as objective baseline facts already arrive precomputed.

The evaluator must not gain a history provider, async signature, or Firestore read. The composition boundary performs one bounded, validated date-range read ending at `D - 1`.

A read failure or invalid range degrades to **no subjective drift**, not fabricated neutral observations. Existing absolute safety logic still evaluates today's check-in normally.

### D-SUBJANCHOR — never show the baseline before the check-in is submitted

Subjective baselines may be surfaced retrospectively — Data view, context brief, trend charts — but must not appear in the check-in flow before submission. The form must not show the athlete their prior values for the same questions while they are answering them.

This is a measurement-integrity rule. If the athlete sees historical context first, the resulting response may be anchored by the system that later interprets it.

### D-SUBJCAL — simulation proves mechanics; prospective evidence is required to ship

This ADR fixes **structure and safety rules**. It does not prescribe final per-metric weights, participating metrics, window lengths, coverage thresholds, variability floor/cap, drift multiplier, or final estimator.

Phase 9 comparison has two distinct jobs:

1. **Synthetic/regression gate:** prove tighten-only behaviour, boundedness, stability under noisy/stationary fixtures, no production policy drift while disabled, and acceptable effects on mode distribution, recovery share, objective misses, and constraints.
2. **Estimator sensitivity:** show whether reasonable estimator/parameter choices materially change the conclusion.

Synthetic scenarios can reject an unsafe or pathological design, but **they cannot establish real-world predictive usefulness**. A production switch to subjective drift additionally requires prospective evidence from Phase 9.0's real check-in/shadow record (or an equivalent later prospective corpus). If that evidence is not yet adequate, Phase 9 may keep the feature off or defer the decision; it may not call a synthetic-only result sufficient evidence to ship.

Candidate questions include:

* Which metrics contribute useful signal? `fatigue`, `soreness`, `sleepQuality`, `readiness`, `motivation`, and `stress` need not share weights or even all participate.
* Does a slow drift term add information beyond today's absolute score and objective strain?
* How sensitive are decisions to the reference estimator, window length, coverage floor, variability floor/cap, and any chronic multiplier?
* Do disagreements in the Phase 9.0 shadow log concentrate on days where prior subjective history had already moved adversely?

A result showing no useful signal, excessive conservatism, or unstable estimator sensitivity is a valid outcome that leaves the feature off.

### D-SUBJAUDIT — persist normalized drift provenance only when it can affect a decision

If subjective drift is enabled for a deciding path, `RecommendationAudit` records compact normalized provenance sufficient to explain which policy produced the contribution without copying raw health history:

```text
estimatorId / estimatorPolicyVersion
historyThroughDateExclusive
recentRecordedDays
longRecordedDays
subjectiveDriftContribution
perMetricContributions (normalized, optional but bounded)
decisionRelevant
```

Raw historical subjective scores and free-text notes are not duplicated into the recommendation audit.

A default-off implementation does **not** bump `POLICY_VERSION`, because it cannot alter a persisted decision. The policy version is bumped, and the outgoing value moved to `HISTORICAL_POLICY_VERSIONS`, only when the live/default deciding path changes so subjective drift can affect recommendations. This keeps ADR-0010's policy-version semantics intact.

## Consequences

### Positive

* Persistent subjective deterioration can be tested without weakening today's safety floors.
* The architecture supports individualized interpretation while keeping the statistical estimator replaceable and auditable.
* Today's observation is causally separated from its prior-history baseline.
* Sparse recent history cannot masquerade as a mature baseline.
* Production adoption requires both regression safety and prospective evidence.

### Negative

* The composition boundary gains a validated history read and the system gains another telemetry component.
* Calibration becomes more involved because estimator sensitivity is part of the evidence, not just coefficient tuning.
* Athletes with insufficient recent or long-window coverage get no drift contribution by design.

### Neutral

While the selector is default-off, production decisions remain bit-identical and `POLICY_VERSION` remains unchanged.

### Explicitly accepted modelling risk

The reference estimator may treat ordinal 1–10 responses approximately as interval data. That is acceptable for an experimental, bounded candidate behind a disabled selector; it is not treated as a physiological truth, and production adoption depends on sensitivity plus prospective evidence.

## Alternatives considered

**Fold subjective relative terms into `objectiveStrain`.** Rejected. It destroys decomposition and increases the risk that a future favourable subjective term is accidentally allowed to offset objective strain.

**Replace the absolute thresholds with normalized ones.** Rejected. It creates the chronic-soreness inversion this ADR explicitly forbids.

**Include an acute today-vs-history normalized term.** Rejected. Today's score is already evaluated raw; the history term exists to add prior multi-day context, not count today twice.

**Fix 7d/28d z-scores, 10/28 coverage, and a 1-point SD floor as permanent ADR decisions.** Rejected. Those are plausible reference settings, but the available evidence does not establish them as universal physiological constants and the questionnaire items themselves have heterogeneous reliability/validity.

**Do nothing; keep subjective baselines informational only.** Remains a legitimate Phase 9 go/no-go outcome if the candidate adds no useful prospective signal or materially worsens decision quality.

**Ask the athlete once to define a normal score.** Rejected as the baseline authority: it is a single self-report that can become stale and does not solve day-to-day scale-use drift. A future scale-calibration UX could still be useful for habitual-low reporting, but it is separate from this tighten-only mechanism.
