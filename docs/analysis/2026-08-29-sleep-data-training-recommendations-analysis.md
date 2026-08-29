# Sleep Data for Training Recommendations — Evidence Review and Architecture Guidance

**Date:** 2026-08-29
**Status:** Analysis / design guidance
**Scope:** Garmin Direct + Eight Sleep sleep telemetry and its appropriate use in `adaptive-training-recommender`
**Repository:** `Szczepanov/adaptive-training-recommender`

> **Provenance:** authored by a separate AI agent (outside this repo's own Claude Code
> session), given the "share as a report, don't judge" factual summary from this session
> as input, then pasted back by the account owner. Spot-checked against the real
> codebase before acting on it: all 12 file/doc paths it cites exist exactly as named,
> and every specific technical claim checked (sleep-score strain weight, identity
> eligibility wiring in `multisourceFusion.ts`, `sleepRevisions.test.ts`'s coverage,
> `dataConfidence.ts`'s freshness handling) was confirmed accurate. Its external
> literature citations (§20) were not independently verified.

---

## 1. Executive summary

Detailed sleep data can improve `adaptive-training-recommender`, but **most of the available sleep detail should not directly control training prescription**.

The strongest current use cases are:

1. **Recovery evidence**
   - total sleep duration / sleep opportunity
   - multi-night sleep-duration deficit
   - subjective sleep quality
   - concordance with HRV, resting HR, respiration, fatigue and other recovery signals

2. **Training planning**
   - protecting future sleep opportunity
   - avoiding optional PM work when it would compromise sleep before a priority session
   - handling early starts, travel, schedule drift and accumulated sleep restriction
   - potentially using naps as a recovery-planning option

3. **Health/anomaly detection**
   - respiration trends
   - sleeping HR
   - SpO₂
   - temperature deviation
   - persistent snoring changes
   - other longitudinal deviations that may indicate illness or impaired recovery

4. **Research, data quality and model validation**
   - sleep stages
   - hypnograms
   - micro-awakenings
   - movement / toss-and-turn data
   - detailed overnight HR/HRV series
   - cross-device disagreement
   - algorithm-version effects
   - identity attribution / wrong-person detection

The available evidence does **not** support making direct training decisions from consumer-device estimates of deep, REM or light sleep.

The most important architectural principle should therefore be:

> **Sleep architecture must not directly prescribe training intensity or modality. Detailed consumer-device sleep metrics remain source-specific observational evidence unless prospective replay/shadow analysis demonstrates incremental decision value beyond sleep duration, subjective recovery and established physiological signals. Sleep data may directly influence scheduling and sleep-protection recommendations where the recommended action operates on sleep opportunity rather than inferred sleep-stage recovery.**

This is also consistent with the current repository direction: sleep stages are already shadow-only in multi-source fusion, proprietary recovery scores are blocked, revised sleep affects data confidence, and the candidate multi-source fusion path is not yet authoritative for production recommendations.

---

## 2. Current data landscape

### 2.1 Garmin currently ingested

The production recovery snapshot already contains:

- `sleepScore`
- `sleepDurationSec`
- `sleepSessionStart`
- `sleepSessionEnd`
- `deepSleepSec`
- `remSleepSec`
- `lightSleepSec`
- `awakeSleepSec`
- `restlessMomentsCount`
- respiration during sleep
- sleep-scoped SpO₂
- skin-temperature deviation

The broader daily snapshot also carries recovery context including:

- resting HR
- overnight HRV
- body battery
- stress
- recovery time
- training readiness/status
- activity/load information

Important coverage finding:

- `sleepSessionStart` / `sleepSessionEnd` are present in archived raw Garmin payloads for all 73/73 sampled dates across the comparison year.
- persisted snapshots have lower coverage because extraction began later and older snapshots were not re-derived.

This means sleep timing can be substantially improved **without depending on a new upstream source**.

### 2.2 Garmin data available but not yet ingested

Potentially available:

- `sleepLevels`
  - ordered stage timeline
  - verified mapping:
    - `0 = deep`
    - `1 = light`
    - `2 = REM`
    - `3 = awake`
  - segment sums reproduce Garmin daily stage totals exactly

- `sleepMovement`
  - roughly one-minute movement samples

- `awakeCount`

- component-level `sleepScores`

- `avgSleepStress`

- `napTimeSeconds`

- `nextSleepNeed`

- `sleepNeed`

- sleep-endpoint `bodyBatteryChange`

Coverage caveat:

- `sleepLevels` / `sleepMovement` are present only from approximately 2026-04-01 onward in the sampled archive.
- `awakeCount` and sleep start/end are available across the full year.
- `restlessMomentsCount` is null in 73/73 sampled nights.

### 2.3 Eight Sleep currently ingested

Eight Sleep currently writes shadow observations including:

- nightly HRV
- sleeping HR
- respiration
- sleep duration
- deep / REM / light duration
- sleep debt
- latency
- timing consistency
- snoring
- toss-and-turn counts
- social jetlag
- chronotype
- baseline timing
- baseline duration/stages
- 7-day averages
- sleep tags

Important semantic caveats already discovered:

- `sleepQualityScore.waso.current` and `performanceWindowStats.wasoBaseline` are fractions, not seconds.
- an earlier derived "awake" metric using `presenceDuration - sleepDuration` was invalid and has correctly been removed.
- `sleep_tags` are mirrored Garmin/Health Connect workout tags rather than Eight-Sleep-native sleep context.

### 2.4 Eight Sleep data available but not yet ingested

The raw API also exposes:

- `sessions[].stages`
  - sequential `light` / `deep` / `rem` / `awake` / `out` segments
  - real clock time is reconstructable using session start + cumulative duration

- `snoring` segments

- `mitigationEvents`

- `stageSummary`

- algorithm-version metadata:
  - `sleepAlgorithmVersion`
  - `presenceAlgorithmVersion`
  - `hrvAlgorithmVersion`

- detailed timeseries:
  - `shortAwakes`
  - `tnt`
  - `heartRate`
  - `hrv`
  - `rmssd`
  - respiratory series
  - room temperature
  - bed temperature
  - heating

Potentially relevant day-level fields also include:

- elevation-related metrics
- hot-flash events
- snoring-reduction events
- theoretical snore percentage

The detailed session/timeseries structure was spot-checked as available on a date from 2025-09-04, suggesting long historical availability, but this has not yet been swept over the full year.

---

## 3. The project's own cross-device data are the strongest warning against stage-based prescription

The existing paired-device comparison provides unusually useful real-world evidence because it evaluates **the exact sensors used by this application on the exact athlete/account**.

Among 56 nights where total sleep duration agreed within 30 minutes:

| Metric | Garmin vs Eight Sleep correlation |
|---|---:|
| Deep sleep | **r = 0.17** |
| REM sleep | **r = 0.44** |
| Light sleep | **r = 0.73** |

Mean stage allocation also differed materially:

| Stage | Garmin | Eight Sleep |
|---|---:|---:|
| Deep | 104 min (~21%) | 78 min (~13%) |
| REM | 97 min (~20%) | 116 min (~19%) |
| Light | 283 min (~57%) | 285 min (~48%) |

This makes a rule such as:

> "Deep sleep was 30% below baseline, therefore reduce VO₂ today"

scientifically and operationally unsafe.

There is no established basis for deciding that one device's deep-sleep estimate represents the true physiological state while the other device's estimate should be ignored.

The correct interpretation is:

> **sleep-stage estimates are device-algorithm outputs, not interchangeable measurements of ground-truth sleep architecture.**

Until the application has PSG validation or strong prospective evidence that a particular stage-derived feature adds decision value, stage metrics should remain source-specific and non-authoritative.

---

## 4. What the external evidence supports

### 4.1 Sleep loss matters

Substantial acute sleep loss can impair:

- aerobic endurance
- explosive performance
- speed
- high-intensity intermittent performance
- skill / psychomotor performance

Recent meta-analytic evidence supports a meaningful adverse effect of acute sleep deprivation, with effect magnitude depending on task and timing.

Athlete consensus literature likewise supports:

- clear performance/recovery harm from severe sleep loss
- individual variation in sleep need
- caution about applying simplistic universal thresholds
- weaker certainty for the common real-world case of modest partial restriction over one or a few nights

### 4.2 Small natural fluctuations are less actionable

Natural night-to-night variation in athlete sleep shows much weaker and more inconsistent relationships with next-day gross motor performance than experimentally imposed severe sleep deprivation.

This is an important product-design implication:

> **A single mildly poor wearable night should usually not create a rest day.**

The app should require stronger evidence such as:

- large magnitude
- persistence across multiple nights
- physiological concordance
- subjective concordance
- meaningful proximity to a key workout or event

### 4.3 Consumer sleep staging is not sufficiently reliable for direct prescription

Consumer sleep devices are useful for detecting sleep and broad sleep timing, but their agreement with PSG is imperfect and sleep-stage classification is generally less robust than total sleep/wake detection.

Therefore the application should avoid converting stage estimates into deterministic training rules.

### 4.4 Sleep extension and naps are more defensible intervention targets

Sleep extension and, in some contexts, napping have evidence as practical interventions to improve recovery/performance.

This supports using sleep data to influence:

- planning
- schedule design
- optional-volume removal
- bedtime protection
- nap suggestions

rather than trying to infer exact recovery state from N3 or REM duration.

---

## 5. Recommended decision role for each sleep signal

| Signal | Recommended role | Decision |
|---|---|---|
| Total sleep duration | Recovery + planning | **Production candidate** |
| Sleep start/end | Planning + coaching | **High priority** |
| Subjective sleep quality | Recovery | **Keep authoritative** |
| Garmin sleep score | Secondary recovery signal | **Bounded use only** |
| Bedtime/wake consistency | Coaching/planning | **Useful, not strong readiness authority** |
| Sleep latency | Coaching | **Useful, weak direct training authority** |
| Awake / WASO | Coaching/research | **Use only after semantics validated** |
| Garmin `awakeCount` | Research/shadow | **Do not equate to Eight shortAwakes** |
| Eight `shortAwakes` | Research/shadow | **Source-specific** |
| Deep / REM / light totals | Research/visualization | **No direct prescription** |
| Garmin `sleepLevels` | Data quality/research | **No direct prescription** |
| Eight hypnogram | Data quality/research | **No direct prescription** |
| Movement / TNT | Research/coaching | **Shadow only** |
| 5-min HR/HRV/RMSSD | Research | **Do not flood daily engine** |
| Respiration | Anomaly + bounded recovery | **High value** |
| SpO₂ | Health awareness/anomaly | **Non-diagnostic only** |
| Snoring | Health awareness/coaching | **Trend-based, non-diagnostic** |
| Skin/bed/room temperature | Context/anomaly | **Potentially useful longitudinally** |
| Garmin sleep need / next sleep need | Coaching/display | **Vendor advisory only** |
| Eight sleep debt / social jetlag | Coaching | **Use with source provenance** |
| Chronotype | Scheduling | **Potentially useful** |
| Algorithm version metadata | Data quality | **Ingest** |
| `restlessMomentsCount` | None | **Ignore while permanently null** |
| Eight `sleep_tags` | None | **Exclude from sleep logic** |

---

## 6. Recommended training-decision model

The engine should not ask:

> "How good was sleep?"

That framing encourages another opaque readiness score.

Instead ask:

> **Is there credible evidence that sleep-related recovery is sufficiently abnormal that today's planned training should change?**

This should be based on four concepts.

### 6.1 Magnitude

How far is the current sleep signal from the athlete's own source-specific baseline?

Examples:

- sleep duration deficit relative to personal 28-day normal
- unusually late sleep onset
- unusually short sleep opportunity
- unusually elevated nocturnal respiration

### 6.2 Persistence

Was this:

- a single mildly short night
- a severe isolated restriction
- a repeated 2–3-night deficit
- a chronic multi-day deterioration

Persistent moderate deficits should matter more than small single-night noise.

### 6.3 Concordance

Do independent domains agree?

Potential supporting evidence:

- objective sleep duration
- subjective sleep quality
- HRV deviation
- RHR deviation
- respiration deviation
- subjective fatigue
- soreness / motivation
- accumulated training load

The app should be much more willing to modify training when multiple domains point in the same direction.

### 6.4 Confidence

Before sleep evidence affects training, verify:

- finalized rather than provisional sleep record
- correct logical date
- identity attribution is acceptable
- baseline is mature enough
- algorithm version is known
- source semantics are understood
- data are physiologically plausible
- no obvious device/session corruption exists

A conceptual result should be categorical rather than falsely precise:

```text
normal
minor_disruption
meaningful_sleep_deficit
persistent_sleep_deficit
uncertain
```

Avoid inventing a value such as:

```text
sleep_recovery_score = 72.4
```

unless it has been prospectively calibrated and validated.

---

## 7. Example training behavior

### Scenario A — noisy stage disagreement, otherwise normal

Eight Sleep:

- sleep duration 6h48
- deep sleep -40% vs baseline
- REM normal
- several shortAwakes

Garmin:

- sleep duration 7h01
- deep sleep normal
- REM lower
- sleep score 69

Other context:

- subjective sleep quality 8/10
- HRV normal
- RHR normal
- respiration normal
- fatigue normal
- priority VO₂ session planned

**Recommended behavior: keep the VO₂ session.**

The devices agree only on modestly short sleep. Their stage estimates disagree and the athlete's broader recovery evidence is stable.

The application may advise:

> Sleep was slightly below your recent norm, but your broader recovery signals are stable. Keep today's planned quality session and protect tonight's sleep.

### Scenario B — meaningful convergent sleep-recovery impairment

Both devices:

- roughly 4h45–5h sleep

Other context:

- prior two nights also short
- subjective sleep quality 3/10
- HRV materially below personal baseline
- RHR elevated
- fatigue increased
- priority VO₂ session planned

**Recommended behavior: modify training.**

Depending on microcycle flexibility:

- move VO₂ to another day
- substitute easy aerobic work
- remove optional second session
- reduce session dose
- protect recovery opportunity
- consider nap / earlier bedtime

The decision is driven by:

> sleep deficit × persistence × physiological response × subjective response

—not by REM or deep-sleep minutes.

---

## 8. Sleep may be more valuable for planning than for readiness

A major product opportunity is using sleep data to protect **future** training quality.

Examples:

### 8.1 Optional PM session removal

If:

- tomorrow contains a priority VO₂ session
- recent sleep duration is already below normal
- an optional PM ride would likely delay bedtime
- sleep opportunity before tomorrow is constrained

the app can recommend:

> Skip the optional PM volume and protect sleep before tomorrow's key session.

This is more defensible than changing today's workout because deep sleep was low.

### 8.2 Early-start / travel handling

Use sleep timing and planning context to detect:

- early travel
- race-day early wake times
- repeated bedtime drift
- schedule compression
- chronotype mismatch
- insufficient sleep opportunity caused by training placement

The planner can then:

- move low-priority work
- shorten optional sessions
- adjust double-days
- suggest earlier sessions where practical
- preserve pre-key-session sleep

### 8.3 Multi-day volume planning

Over weeks, test whether increasing training volume is systematically reducing:

- total sleep opportunity
- bedtime consistency
- total sleep time

If so, the planner can identify that as a load-management constraint rather than simply reacting to next-morning readiness.

---

## 9. Recommended role for detailed sleep architecture

Detailed stage timelines should have three immediate purposes.

### 9.1 Data quality

Use hypnograms to detect:

- truncated sessions
- impossible stage totals
- long `out` intervals
- duplicated segments
- wrong logical date assignment
- inconsistent session sums
- algorithm changes
- malformed records

Garmin has already shown a useful invariant:

> `sleepLevels` segment sums reproduce its nightly stage totals exactly.

The same invariant should be implemented for Eight Sleep.

### 9.2 Research

Keep raw stage data for future experiments such as:

- whether stage-distribution deviations predict workout quality
- whether fragmentation predicts subjective fatigue
- whether within-night HRV dynamics add value
- whether certain patterns precede illness

But these should be evaluated using replay/shadow pipelines before production activation.

### 9.3 Identity attribution

Eight Sleep is a shared physical sensor and can capture the wrong person.

Detailed overnight physiology may provide identity features such as:

- sleeping HR distribution
- HRV distribution
- respiration
- habitual sleep timing
- session overlap with Garmin
- potentially within-night cardiovascular pattern

However:

> **identity attribution must occur before recovery interpretation.**

A high-resolution sleep record belonging to someone else is more dangerous than no data.

This aligns with the repository's existing identity-passport and multi-source eligibility architecture.

---

## 10. Do not double-count Garmin's own derived recovery conclusions

Garmin Training Readiness already incorporates multiple inputs including sleep, recovery, load and HRV-related context.

The application independently uses:

- HRV
- RHR
- sleep score
- respiration
- subjective recovery
- training history

Therefore Garmin Training Readiness should **not** later become another weighted recovery term.

That would create correlated duplication:

```text
sleep -> Garmin readiness
HRV   -> Garmin readiness
load  -> Garmin readiness
stress -> Garmin readiness

AND

sleep -> app score
HRV   -> app score
load  -> app score
...
```

Recommended use:

```text
App decision: TRAIN
Garmin Training Readiness: HIGH
Agreement: yes
```

or:

```text
App decision: MODIFY
Garmin Training Readiness: HIGH
Agreement: no
Reason: persistent sleep deficit + subjective fatigue + elevated RHR
```

This is useful as comparison/telemetry without pretending Garmin's composite is independent evidence.

---

## 11. Revisit whether Garmin sleep score adds incremental value

The current engine uses sleep-score deviation as a relatively weak strain contribution.

That is reasonable as a conservative initial heuristic, but it should not be assumed to be optimal.

The key empirical question is:

> **Does Garmin sleep score add predictive or decision value after the application already knows sleep duration, subjective sleep quality, HRV, RHR, respiration and training context?**

It may not.

A more transparent feature such as:

```text
sleep_duration_deficit_vs_personal_baseline
```

may be:

- easier to explain
- less vendor-dependent
- easier to validate
- more transportable across devices

The correct decision should come from replay/simulation rather than intuition.

---

## 12. Proposed ingestion priorities

### Priority 1 — backfill Garmin sleep start/end

Re-derive historical snapshot documents from archived raw payloads.

Reason:

- 73/73 sampled raw records contain the data
- timing is high-value for planning and consistency
- no need to wait for new history

### Priority 2 — ingest Eight Sleep algorithm versions

Persist:

- `sleepAlgorithmVersion`
- `presenceAlgorithmVersion`
- `hrvAlgorithmVersion`

Reason:

- a vendor algorithm change can create apparent physiological drift
- baselines and anomaly logic need provenance
- stage distributions should not silently cross algorithm regimes

### Priority 3 — source-specific sleep-duration/timing baselines

Maintain Garmin and Eight Sleep baselines independently.

Do not normalize Garmin sleep duration with Eight Sleep's distribution or vice versa.

### Priority 4 — real Eight awake/out semantics in shadow mode

Derive separately:

- awake-in-bed duration
- out-of-bed duration
- perhaps validated sleep-efficiency metrics

Do not use ambiguous WASO fractions until their semantics are documented.

### Priority 5 — ingest Garmin `awakeCount` and Eight `shortAwakes` separately

Do not merge them.

Run paired empirical analysis first.

### Priority 6 — retain stages/hypnograms for research and QA

Persist or archive:

- Garmin `sleepLevels`
- Eight Sleep `sessions[].stages`

Do not expose them to normal training decision logic.

### Priority 7 — keep detailed overnight timeseries out of the daily recommendation payload

5-minute:

- HR
- HRV
- RMSSD
- respiration

should remain raw/research inputs unless derived features prove incremental value.

Avoid turning the recommendation engine into a high-dimensional overnight-signal model without evidence.

### Priority 8 — expose timing/debt/chronotype to coaching/planning

Use these fields to improve:

- schedule quality
- bedtime protection
- optional-session decisions
- travel logic
- nap suggestions

Keep vendor-derived values explicitly labeled with provenance.

### Priority 9 — route respiratory / SpO₂ / temperature / snoring trends into anomaly logic

These fit better in:

- `healthAnomaly`
- health-awareness UI
- recovery caution logic

than in a generic sleep score.

### Priority 10 — explicitly reject low-value fields

Do not ingest or promote data merely because it exists.

Current examples:

- Garmin `restlessMomentsCount` while permanently null
- ambiguous WASO fractions
- Eight `sleep_tags` as sleep evidence
- unsupported stage-fusion weights

---

## 13. Recommended empirical validation program

The most valuable next step is not additional ingestion by itself.

The app now has enough historical data and infrastructure to ask:

> **Does detailed sleep information improve prediction or training decisions beyond coarse sleep duration + subjective recovery + established physiological signals?**

### 13.1 Nested feature sets

Evaluate progressively:

#### Model A — current decision model

Current production inputs only.

#### Model B — add transparent sleep-duration features

Examples:

- current duration vs 28-day source-specific baseline
- 2-day accumulated deficit
- 3-day accumulated deficit
- severe single-night restriction flag

#### Model C — add sleep timing

Examples:

- bedtime deviation
- wake-time deviation
- sleep midpoint
- recent schedule drift
- sleep opportunity before planned key session

#### Model D — add validated fragmentation

Only after event semantics are understood.

Potential features:

- awake-in-bed duration
- consolidated awake bouts
- out-of-bed duration
- source-specific fragmentation index

#### Model E — add stage totals

Source-specific deep / REM / light deviations.

#### Model F — add detailed overnight dynamics

Examples:

- hypnogram-derived patterns
- overnight HR trend
- HRV/RMSSD dynamics
- movement distribution

### 13.2 Evaluation design

Use:

- walk-forward chronological validation
- source-specific baselines
- no random leakage across time
- identity-gated Eight Sleep nights
- algorithm-version-aware segmentation
- provisional/final record handling

### 13.3 Outcomes that actually matter

Predict:

- workout completion
- planned interval target attainment
- realized RPE vs expected RPE
- power/pace degradation
- HR/power decoupling
- premature workout termination
- next-day subjective fatigue
- next-day readiness
- illness onset
- need for unplanned session modification

Do **not** use Garmin Training Readiness as the validation target because it already embeds sleep and related recovery signals.

### 13.4 Stratify by session type

Potential effects may differ between:

- VO₂
- threshold
- sprint / neuromuscular
- strength
- field sport
- easy endurance
- recovery sessions

A sleep feature that has no value for Z2 may still have value for high-intensity work.

---

## 14. Promotion criteria for any detailed sleep metric

A detailed sleep metric should move from `shadow` / `research_only` to training-authoritative only if all of the following are satisfied:

1. **Semantics are validated**
2. **Identity is trustworthy**
3. **Historical coverage is sufficient**
4. **Baseline maturity is sufficient**
5. **Source-specific behavior is characterized**
6. **Algorithm-version changes are handled**
7. **Replay demonstrates incremental predictive value**
8. **Prospective shadow evaluation confirms the effect**
9. **Decision impact is stable and conservative**
10. **The feature improves decisions rather than merely correlations**
11. **The recommendation remains explainable**
12. **No safer/coarser feature captures essentially the same information**

The burden of proof should be higher for:

- stage metrics
- proprietary scores
- opaque vendor-derived features

than for transparent quantities such as sleep duration and timing.

---

## 15. Recommended architecture

The app should treat sleep as four separate product domains.

### 15.1 Sleep → Recovery evidence

Purpose:

- determine whether sleep-related impairment is strong enough to modify training

Primary signals:

- duration
- persistence
- subjective sleep quality
- HRV
- RHR
- respiration
- fatigue

Decision authority:

- bounded
- asymmetric
- primarily allowed to reduce/modify training, not create extra intensity

### 15.2 Sleep → Planning

Purpose:

- protect future recovery opportunity

Examples:

- remove optional PM work
- avoid schedule compression
- manage travel
- protect pre-key-session sleep
- suggest nap opportunities
- identify volume that chronically erodes sleep

This may become the highest-value sleep feature set in the product.

### 15.3 Sleep → Health/anomaly

Purpose:

- identify persistent unusual physiological patterns

Potential inputs:

- respiration
- sleeping HR
- SpO₂
- snoring
- temperature

Language must remain non-diagnostic.

### 15.4 Sleep → Research / data quality

Purpose:

- store and evaluate detailed signals safely

Inputs:

- hypnograms
- movement
- micro-awakenings
- detailed overnight HRV/HR
- algorithm versions
- cross-device disagreements

These should not automatically enter daily recommendation context.

---

## 16. Repository-specific implementation guidance

Relevant current architecture already exists in:

- `app/src/engine/rules.ts`
  - readiness / strain evaluation
  - sleep-score contribution currently bounded

- `app/src/engine/dataConfidence.ts`
  - sleep freshness / availability / plausibility
  - already handles provisional vs finalized sleep

- `app/src/engine/multisourceFusion.ts`
  - candidate multi-source fusion
  - sleep stages currently disabled
  - proprietary scores blocked
  - identity eligibility already integrated

- `app/src/engine/multisourceBaselines.ts`
  - source-specific baseline logic

- `app/src/engine/analytics/signalFidelityEvaluator.ts`
  - appropriate location for empirical signal evaluation

- `app/src/engine/healthAnomaly*.ts`
  - appropriate path for respiration / RHR / HRV / other anomaly signals

- `app/src/engine/identityPassport.ts`
- `app/src/engine/identityAttribution.ts`
- `app/src/engine/identityEligibility.ts`
  - critical for Eight Sleep shared-sensor trust

- `app/src/engine/replay.ts`
- `app/src/engine/simulation/*`
  - correct environment for promotion experiments

- `app/src/engine/tests/failures/sleepRevisions.test.ts`
  - already establishes late/revised sleep as a first-class failure mode

### Recommended schema-level distinction

Introduce an explicit authority classification for observations or derived features:

```ts
type DecisionAuthority =
    | 'training_authoritative'
    | 'planning_authoritative'
    | 'health_anomaly'
    | 'observability_only'
    | 'research_only';
```

Examples:

```text
sleep_duration_seconds
    training_authoritative
    planning_authoritative

sleep_session_start/end
    planning_authoritative

sleep_stage_deep_seconds
    research_only

sleep_stage_rem_seconds
    research_only

short_awakes
    research_only

respiration
    training_authoritative (bounded)
    health_anomaly

sleep_algorithm_version
    observability_only
```

This is preferable to a loose collection of booleans because it encodes intent and reduces accidental future promotion.

---

## 17. Proposed ADR-level policy

Recommended wording:

> ### Consumer sleep data decision policy
>
> The recommendation engine SHALL NOT directly infer training readiness from consumer-device sleep-stage architecture, including deep, REM, light, hypnogram structure, movement-derived fragmentation, or proprietary vendor sleep-stage scores, unless prospective shadow/replay evidence demonstrates incremental decision value beyond transparent sleep duration, subjective recovery and established physiological signals.
>
> Sleep duration and sleep timing MAY influence training modification and planning when compared against source-specific personal baselines and when record identity, freshness and finalization are trustworthy.
>
> Detailed sleep-stage and event-level data SHOULD remain source-specific. The system SHALL NOT assume Garmin and Eight Sleep stage values are interchangeable or fuse them into a synthetic physiological ground truth without external validation.
>
> Sleep data MAY directly influence planning decisions whose mechanism is sleep protection, including optional-session removal, schedule adjustment, nap recommendation and protection of sleep opportunity before key sessions.
>
> Respiratory, SpO₂, sleeping-HR, temperature and snoring signals MAY contribute to bounded health-anomaly or recovery-caution logic when interpreted longitudinally and non-diagnostically.
>
> Shared-sensor sleep observations SHALL pass identity attribution before they can influence athlete-specific baselines or recommendations.

---

## 18. Recommended next implementation / research sequence

### Phase 1 — high-confidence data improvements

- backfill Garmin sleep start/end
- ingest Eight Sleep algorithm versions
- validate Eight stage-sum invariants
- persist real awake/out semantics
- formalize observation authority classes

### Phase 2 — transparent derived sleep features

Build source-specific:

- sleep-duration deviation
- 2-day / 3-day accumulated deficit
- bedtime deviation
- wake-time deviation
- sleep-midpoint deviation
- sleep-opportunity constraint before planned sessions

### Phase 3 — shadow decision model

Add a `SleepRecoveryEvidence` concept:

```ts
interface SleepRecoveryEvidence {
    state:
        | 'normal'
        | 'minor_disruption'
        | 'meaningful_sleep_deficit'
        | 'persistent_sleep_deficit'
        | 'uncertain';

    confidence: 'high' | 'moderate' | 'low';

    acuteDurationDeficitMin: number | null;
    accumulated2dDeficitMin: number | null;
    accumulated3dDeficitMin: number | null;

    subjectiveConcordance: boolean | null;
    physiologicalConcordance: boolean | null;

    evidence: string[];
}
```

Keep it shadow-only initially.

### Phase 4 — incremental-value replay

Compare feature sets A–F using walk-forward analysis.

### Phase 5 — prospective shadow evaluation

Measure:

- decision changes
- false conservative changes
- missed adverse outcomes
- agreement with post-session outcomes
- user overrides
- calibration by session type

### Phase 6 — selective promotion

Promote only features that demonstrate:

- stable incremental value
- low false-positive modification rate
- understandable causal interpretation
- compatibility with safety constraints

---

## 19. Final recommendation

The project should ingest enough detailed sleep data to:

- preserve source fidelity
- validate data quality
- support identity attribution
- enable research
- improve planning
- identify anomaly patterns

but it should **not assume that more sleep detail automatically means better training recommendations**.

The app will likely gain more value from:

- knowing the athlete slept 5h instead of their typical 7h30
- knowing this happened three nights in a row
- knowing tomorrow's VO₂ session is important
- knowing an optional PM ride would reduce tonight's sleep opportunity
- knowing HRV/RHR/respiration and subjective fatigue also deteriorated

than from knowing whether Garmin classified 72 or 105 minutes as deep sleep.

The product-level goal should therefore be:

> **Optimize training around credible sleep loss and protect future sleep opportunity — do not optimize training around noisy consumer sleep architecture.**

---

## 20. References and evidence sources

### Repository

- `app/src/engine/rules.ts`
- `app/src/engine/dataConfidence.ts`
- `app/src/engine/multisourceFusion.ts`
- `app/src/engine/multisourceBaselines.ts`
- `app/src/engine/healthAnomalyFeatures.ts`
- `app/src/engine/identityPassport.ts`
- `app/src/engine/identityAttribution.ts`
- `app/src/engine/identityEligibility.ts`
- `app/src/engine/replay.ts`
- `app/src/engine/simulation/`
- `app/src/engine/tests/failures/sleepRevisions.test.ts`
- `docs/analysis/2026-08-27-multisource-shadow-study.md`
- `docs/plans/2026-08-27-real-google-health-ingestion.md`

### External literature / guidance

1. **Athlete sleep and performance**
   - Suppiah HT, et al. Natural sleep variation and performance in elite athletes.
     PubMed: https://pubmed.ncbi.nlm.nih.gov/30479518/

2. **Acute sleep deprivation and physical performance**
   - Meta-analysis of acute sleep loss effects across performance domains.
     PubMed: https://pubmed.ncbi.nlm.nih.gov/39006249/

3. **Athlete sleep consensus**
   - Expert consensus recommendations regarding sleep in athletes.
     PubMed: https://pubmed.ncbi.nlm.nih.gov/33144349/

4. **Sleep extension / napping**
   - Systematic review / evidence synthesis on sleep interventions and athletic performance.
     PubMed: https://pubmed.ncbi.nlm.nih.gov/37462808/

5. **Consumer wearable sleep validity**
   - Meta-analysis of consumer wrist-worn sleep-tracking devices compared with PSG.
     PubMed: https://pubmed.ncbi.nlm.nih.gov/39484805/

6. **Sleep regularity in athletes**
   - Scoping review of sleep regularity, wellbeing and performance in athletes.
     PubMed: https://pubmed.ncbi.nlm.nih.gov/42563357/

7. **Consumer sleep technology clinical limitations**
   - American Academy of Sleep Medicine position/guidance on consumer sleep technology.
     https://aasm.org/advocacy/position-statements/consumer-sleep-technology/

8. **Garmin Training Readiness**
   - Garmin documentation describing Training Readiness inputs.
     https://www8.garmin.com/manuals/webhelp/GUID-EA112C95-8563-4EED-AADF-2AADFBB95646/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html

---

## 21. Open empirical questions

The following remain unresolved and should be answered with project data rather than assumptions:

- Does Garmin sleep score add value beyond sleep duration + HRV + RHR + subjective sleep?
- Does accumulated sleep-duration deficit predict workout degradation?
- Does bedtime drift predict poorer next-day key-session execution?
- Does Eight Sleep fragmentation add value beyond duration?
- Does Garmin `awakeCount` meaningfully correspond to Eight `shortAwakes`?
- Are real Eight `awake` and Garmin `awakeSleepSec` directionally consistent?
- Do stage metrics add any incremental value at all?
- Are detailed overnight HRV dynamics useful beyond nightly averages?
- Can detailed sleep data materially improve Eight Sleep identity attribution?
- Do algorithm-version changes create measurable baseline discontinuities?
- Does sleep-related evidence have different predictive value for VO₂, threshold, strength, sprint, field and easy-endurance sessions?
