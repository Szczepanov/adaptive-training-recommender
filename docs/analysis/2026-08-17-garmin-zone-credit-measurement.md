# Garmin zone-credit candidate measurement (2026-08-17)

## Decision

**Do not enable `power-zones-direct-share-v1` in production.** Keep the existing
TE-derived completed-training stimulus as the decision authority and retain the candidate
only for measurement.

The candidate produced complete, technically coherent evidence, but every observed
activity disagreed with TE and the sample has no outcome labels capable of showing that
the candidate's systematically lower quality credit is more accurate. Enabling it would
therefore be an unvalidated policy change rather than an evidence-backed improvement.

## Measurement boundary

* Source: a bounded 28-day Garmin history ending 2026-08-17.
* Fetch budget: at most eight non-easy power-bearing activities; three detail endpoint
  operations per sampled activity, matching D-DETAIL-GATE's per-activity budget.
* Privacy: activity IDs, real dates, HR values, credentials, and raw provider payloads
  were excluded. Reduced evidence was streamed in memory and not written to disk.
* Candidate: ADR-0022 `power-zones-direct-share-v1`.
* Comparator: the current modality/intensity/TE-derived stimulus path.
* Credit: ADR-0014's existing delivered-dose and `inferred` confidence scaling, compared
  for zone-2 aerobic, threshold, VO2 max, surge-repeatability, and race-specific
  endurance objectives.

This is real-history disagreement evidence, not clinical validation. It contains no
performance outcome, coach adjudication, next-day response, or prescribed-interval match.

## Results

| Measure | Result |
|---|---:|
| Sampled activities | 8 |
| Candidate-eligible complete 7-zone activities | 8 |
| Fallback activities | 0 |
| Activities with at least one credit disagreement | 8 |
| Mean absolute objective-credit delta | 0.112 |
| Power-zone duration coverage | 0.951–1.070 of recorded duration |

Mean candidate-minus-TE credit deltas:

| Objective | Mean delta |
|---|---:|
| Zone-2 aerobic | -0.022 |
| Threshold quality | -0.137 |
| VO2 max | -0.151 |
| Surge repeatability | -0.206 |
| Race-specific endurance | 0.000 |

The zero race-specific delta is expected: ADR-0022 deliberately leaves
`fatigueResistance` on the TE path because aggregate zone time does not measure
late-session durability. The other deltas show that direct time share is materially more
conservative than the current session-level profiles, especially for brief high-zone work.
There is no evidence in this sample that the reductions improve recommendation quality.

## Interval-fade evidence

The pure matched-set feature supports fade, negative splits, missing-power fallback, and
Warsaw-local start-date attribution. The real-history sample did not contain a persisted,
auditable mapping from authored work intervals to Garmin lap indexes. ADR-0022 forbids
guessing that mapping from auto-laps, so no real interval-fade conclusion was claimed.

This absence is decision-relevant: lap summaries are usable once a matched set exists,
but they do not justify changing credit on their own.

## Regression and replay evidence

The committed semantic baseline had already fallen behind 14 committed scenarios before
this work. It was refreshed only after the existing 29-scenario/553-day corpus completed
with zero hard-constraint violations. With the production selector off,
`npm run simulate:diff` then reported:

```text
No semantic differences found. Current simulation matches committed baseline.
```

The synthetic pre-zone-credit audit fixture replayed successfully through the repository
CLI with `reproducible: true`, `policyMatchesCurrent: true`, and no errors.

`POLICY_VERSION` was intentionally not bumped. ADR-0022 and ADR-0020 both require a bump
only when a candidate can affect a production decision; no production composition path
can select this candidate.

## Reproduction

Run the de-identified live comparison without creating an intermediate file:

```powershell
$zoneEvidence = uv run python scripts/export_garmin_zone_evidence.py --days 28 --max-activities 8
Push-Location app
$zoneEvidence | node scripts/measure-garmin-zone-credit.mjs -
Pop-Location
```

Then verify the production path and replay:

```powershell
Push-Location app
npm run simulate:diff
npm run replay:recommendation -- ../tests/fixtures/pre_zone_credit_recommendation_audit.json
Pop-Location
```

## What would justify reopening the ship decision

A later proposal needs more than additional unlabeled zone distributions. It should add
an auditable authored-interval/lap match or outcome-labelled evidence, compare at least
one alternative mapping against `v1`, and show improved decision quality without new
constraint violations or excessive objective misses. Until then, TE remains authoritative.
