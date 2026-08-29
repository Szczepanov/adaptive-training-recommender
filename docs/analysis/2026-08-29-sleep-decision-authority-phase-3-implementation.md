# Sleep-decision-authority Phase 3: shadow SleepRecoveryEvidence (2026-08-29)

Implements Phase 3 of the reviewed sleep-data-for-training-recommendations analysis
([`docs/analysis/2026-08-29-sleep-data-training-recommendations-analysis.md`](2026-08-29-sleep-data-training-recommendations-analysis.md)
§18): a shadow-only categorical evidence concept built on Phase 2's derived sleep-duration/
timing baselines
([`docs/analysis/2026-08-29-sleep-decision-authority-phase-2-implementation.md`](2026-08-29-sleep-decision-authority-phase-2-implementation.md)).

## Genuinely shadow

`evaluateSleepRecoveryEvidence()` (`app/src/engine/sleepRecoveryEvidence.ts`) is a pure
function of `DailyReadiness` -- it reads `objective`/`subjective`, never mutates either,
and is called from nowhere in production decision code. Nothing changes today's training
recommendations.

`POLICY_VERSION` intentionally remains unchanged. The repository policy-drift gate now has
a narrow fail-closed exception for this Phase 3 wiring rather than pretending a new live
policy exists. The exception passes only while all of the following remain true:

- the only changed file from the normal decision-affecting list is `adapters.ts`;
- production changes in `app/src` are limited to `adapters.ts`, `models.ts`, and
  `sleepRecoveryEvidence.ts`;
- `evaluateSleepRecoveryEvidence` has no production caller outside its own module;
- the new sleep-duration/timing objective fields have no production references outside the
  adapter/model/evaluator boundary;
- this implementation note continues to state the no-bump shadow contract explicitly.

A future import from `rules.ts`, `fatigue.ts`, `planner.ts`, or another production consumer
therefore breaks the exception and restores the normal `POLICY_VERSION` requirement.

## Wiring

Phase 2's Python-computed fields (`snapshot.derived.deltas.sleepDurationVs7dMedian` etc.)
weren't reachable from the TS engine at all yet. Extended following the established
`respiration_delta` precedent (optional fields on `EngineObjectiveInput`, gated on
`baselineComputationVersion >= N` in `adapters.ts`, not the individual field's own
null-ness):

- `EngineObjectiveInput` gains `sleep_duration_delta_7d_min`/`28d_min`,
  `sleep_duration_accumulated_2d_deficit_min`/`3d_deficit_min`, and
  `bedtime`/`wake_time`/`sleep_midpoint_deviation_7d_min`/`28d_min` -- all optional,
  gated on `baselineComputationVersion >= 6`.
- `mapSnapshotToEngineInput` converts the Python side's seconds to minutes for the
  duration/deficit fields; the circular time-of-day deviations are already minutes on
  the Python side and pass through unconverted.

The timing fields are deliberately wired but do **not** affect the Phase 3 state. The
reviewed architecture treats sleep timing primarily as planning/coaching context, and the
Phase 2 analysis found no defensible universal threshold for turning a bedtime or midpoint
deviation directly into a training downgrade.

## `SleepRecoveryEvidence`

Matches the reviewed analysis's proposed interface (§18 Phase 3): `state`
(`normal`/`minor_disruption`/`meaningful_sleep_deficit`/`persistent_sleep_deficit`/
`uncertain`), `confidence` (`high`/`moderate`/`low`), `acuteDurationDeficitMin`,
`accumulated2dDeficitMin`/`3dDeficitMin`, `subjectiveConcordance`,
`physiologicalConcordance`, and `evidence: string[]`.

**Sign convention note**: `acuteDurationDeficitMin` is `-sleep_duration_delta_7d_min`
(baseline minus current), so positive means a short night -- matching
`accumulated2d/3dDeficitMin`'s existing convention rather than
`EngineObjectiveInput`'s own `current - baseline` convention.

The accumulated values are **relative-to-personal-baseline shortfall/surplus**, not an
estimate of physiological sleep need or clinical sleep debt. The Phase 2 implementation
makes this distinction explicit because a habitual 28-day median can itself differ from an
individual's actual sleep requirement.

## Classification: a first cut, not a validated model

Per the reviewed analysis's own promotion criteria (§14), thresholds get tuned against
real outcomes in Phase 4/5 (replay/prospective evaluation) before any activation
decision. Current named constants remain provisional:

- `PERSISTENT_ACCUMULATED_3D_DEFICIT_MIN = 90`;
- `MEANINGFUL_ACUTE_DEFICIT_MIN = 60`;
- `MEANINGFUL_ACCUMULATED_DEFICIT_MIN = 60`;
- `MINOR_ACUTE_DEFICIT_MIN = 20`;
- subjective low/high anchors at 4/7 on the 1–10 scale.

Review hardening deliberately makes the classifier conservative around noisy boundaries:

- `persistent_sleep_deficit` requires both a large 3-day accumulated deficit **and at
  least a minor current-night deficit**. A 1-minute or rounding-sized shortfall cannot
  transform a recovering 3-day window into `persistent_sleep_deficit`.
- A still-large 3-day shortfall remains `meaningful_sleep_deficit` even after a recovery
  night. The previous implementation could fall all the way to `normal` because only the
  2-day accumulated value was checked in the non-persistent branch.
- `subjectiveConcordance` has a neutral middle band (5–6). Consumer-wearable sleep metrics
  and subjective sleep quality are related but non-interchangeable signals; a middling
  self-report should not be forced into agreement or disagreement.
- `physiologicalConcordance` no longer treats any raw HRV decrease or RHR increase as
  meaningful. HRV/RHR must first exceed the athlete's own trailing variability, using the
  same conservative minimum noise floors as the live readiness engine (HRV 3 ms, RHR
  1.5 bpm). Within-noise and conflicting physiological signals remain `null`.
- `confidence` is explicitly **history confidence** only: mature 28-day duration history +
  a 3-night accumulated value can produce `high`, but that does not claim that finality,
  freshness, identity attribution, algorithm-version stability, or source semantics have
  all been validated. Those remain promotion gates before any future decision authority.

## Why the concordance changes are intentionally tri-state

The reviewed architecture says the app should become more willing to modify training when
independent domains converge. That only works if lack of strong evidence is not silently
converted to a negative vote.

Two external evidence points reinforce this implementation choice:

1. The 2021 athlete sleep expert consensus notes that the performance effect of the common
   real-world case of partial sleep restriction over 1–3 nights remains unclear and argues
   against one-size-fits-all sleep prescriptions. This supports personal baselines and
   conservative interpretation rather than hard reactions to small deviations.
2. A 2026 systematic review of wearable metrics versus patient-reported sleep quality found
   poor-to-moderate concordance, with wearable measures explaining only a small fraction of
   subjective-quality variance. Subjective sleep quality should therefore remain an
   independent evidence domain, not a boolean expected to mirror a wearable every morning.
3. HR/HRV monitoring reviews caution that small changes may sit inside normal day-to-day
   variability and are meaningful only alongside other signs/symptoms. That directly argues
   against the previous `hrv_delta < 0 || rhr_delta > 0` rule, where an arbitrarily tiny
   sign change counted as physiological agreement.

References:

- Walsh NP et al. *Sleep and the athlete: narrative review and 2021 expert consensus
  recommendations.* Br J Sports Med. PMID 33144349.
  https://pubmed.ncbi.nlm.nih.gov/33144349/
- Srivali N, Cheungpasitporn W. *Concordance of wearable device sleep metrics with
  patient-reported sleep quality: A systematic review.* Sleep Med. 2026. PMID 41946254.
  https://pubmed.ncbi.nlm.nih.gov/41946254/
- Bellenger CR et al. *Monitoring Athletic Training Status Through Autonomic Heart Rate
  Regulation: A Systematic Review and Meta-Analysis.* Sports Med. 2016. PMID 26888648.
  https://pubmed.ncbi.nlm.nih.gov/26888648/
- Bosquet L et al. *Is heart rate a convenient tool to monitor over-reaching? A systematic
  review of the literature.* Br J Sports Med. 2008. PMID 18308872.
  https://pubmed.ncbi.nlm.nih.gov/18308872/
- Lee YJ et al. *Performance of consumer wrist-worn sleep tracking devices compared to
  polysomnography: a meta-analysis.* J Clin Sleep Med. 2025. PMID 39484805.
  https://pubmed.ncbi.nlm.nih.gov/39484805/

## Known limitations intentionally left for replay/shadow evaluation

- The duration cut-points are product hypotheses, not clinically validated sleep-loss
  thresholds.
- Phase 2's accumulated feature is gap-tolerant: "most recent N nights with data" can span
  more than N calendar nights if a historical night is missing. This is acceptable while
  observation-only but must be revisited before promotion.
- `sleepDuration28dMad` is persisted upstream but is not yet part of the Phase 3 interface.
  Replay should test whether duration deviations normalized by personal duration variability
  outperform simple minute cut-points before adding another field merely because it exists.
- Garmin Direct is the current source for these engine-facing fields. Shared-sensor Eight
  Sleep observations still require identity attribution before they can influence
  athlete-specific baselines or recommendations.
- Finalized/provisional sleep revisions and freshness already have separate data-confidence
  handling; Phase 3's `confidence` field must not be mistaken for those checks.

## Verification

The original Phase 3 implementation added 15 evaluator tests and 3 adapter tests. The
review pass adds regression coverage for:

- a neutral subjective middle band;
- correct normal-state subjective evidence wording;
- within-noise HRV/RHR changes remaining unknown rather than concordant;
- material adverse physiology becoming concordant only beyond personal variability;
- material favorable physiology becoming discordant;
- conflicting material HRV/RHR directions remaining unknown;
- a noise-sized current-night deficit not creating `persistent_sleep_deficit`;
- a large 3-night deficit remaining `meaningful_sleep_deficit` during recovery;
- the policy-drift guard proving the Phase 3 evaluator has no production decision caller.

The Python data derivation remains unchanged by Phase 3. The full CI pipeline is the final
regression gate after these commits.
