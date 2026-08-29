# Eight Sleep stage-sum invariant check (Phase 1 item #3, 2026-08-29)

Gate for Phase 1 item #4 (persisting awake-in-bed/out-of-bed seconds from `sessions[].stages`):
verify Eight Sleep's own per-segment stage timeline reconciles against its own day-level
aggregate fields, mirroring the invariant already confirmed for Garmin's `sleepLevels`
(exact match, 100%, against `dailySleepDTO`'s deep/light/rem/awake totals).

## Method

Live sweep (Eight Sleep's archive stores mapped bundles, not raw payloads, so this requires
live API calls), every 5th day across the full comparison year (2025-08-29 to 2026-08-28),
73 sample dates. For each date with an unambiguous session (matches `mainSessionId`, or the
sole session present), summed `sessions[].stages` durations by `stage` type and compared
against the day-level `deepDuration`/`remDuration`/`lightDuration` fields, and separately
compared `stages` type `awake`+`out` against `presenceDuration - sleepDuration` (the removed
proxy metric).

## Result: the invariant does NOT hold

| Check | Matches (tolerance ±1s, ±5s for awake+out) |
|---|---|
| deep stage-sum == day `deepDuration` | 49/64 |
| rem stage-sum == day `remDuration` | 30/64 |
| light stage-sum == day `lightDuration` | **0/64** |
| awake+out stage-sum == presence−sleep | **0/64** |

**Deep** matches most of the time, with occasional large mismatches (e.g. -1560s, -1980s,
-780s on isolated dates — not just rounding noise).

**Light** never matched exactly across all 64 usable samples, with deltas ranging from tens
of seconds to over 1400s (~24min) on a single night — small relative to a ~7-8hr night, but
systematic, not random noise (0/64 is not what sampling variance around a true match would
produce).

**awake+out vs presence-minus-sleep**: never close (off by hundreds to low thousands of
seconds every time). This isn't concerning on its own — it actually confirms
presence-minus-sleep was never a valid proxy for within-session awake time in the first
place (already established when that metric was removed) — but it does mean the stage
segments cannot be validated against that particular cross-check.

## Interpretation

Eight Sleep's own two internal representations of "how much deep/rem/light sleep last
night" — the day-level score/aggregate fields already ingested, and the per-segment
`sessions[].stages` timeline — are **not fully self-consistent with each other**, unlike
Garmin, where the equivalent two representations (`dailySleepDTO`'s totals and
`sleepLevels`' segments) reconciled exactly in every case checked. This is a genuine,
previously-undiscovered data-quality difference between the two devices' internal data
models, not a bug in this sweep's method (the same method produced an exact match for
Garmin).

Two most likely explanations, not distinguished by this check:
- The two fields are computed by genuinely different pipelines/algorithm versions within
  Eight Sleep's backend (plausible given `sessions[].sleepAlgorithmVersion` exists as a
  distinct, trackable field per session — the day-level aggregate may be computed by an
  older or differently-scoped process than the session detail).
- The `stages` timeline's window differs subtly from the day-level aggregate's window
  (e.g. includes/excludes a short pre-sleep-onset or post-final-wake segment differently).

## Recommendation for item #4

Per the plan's stated gate: **do not persist awake-in-bed/out-of-bed seconds derived from
`sessions[].stages` without flagging this inconsistency**, since the same stage-sum method
that would produce those two new metrics also produces deep/rem/light sums that
systematically diverge from the already-ingested (and already-classified `research_only`)
deep/rem/light metrics. Persisting session-derived awake/out seconds alongside
already-inconsistent session-derived deep/rem/light would introduce a metric whose
relationship to the rest of the ingested data is not well understood yet.

This is a decision point for you, not something to resolve unilaterally: proceed with #4
anyway (clearly labeled as session-timeline-derived, with this inconsistency documented in
the metric's own comment), defer #4 pending further investigation into *why* the two
representations diverge, or drop #4 from Phase 1 scope entirely.
