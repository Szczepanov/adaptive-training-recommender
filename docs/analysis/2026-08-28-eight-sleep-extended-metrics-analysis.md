# Eight Sleep extended metrics: what the detailed fields actually add (2026-08-28)

Answers the standing question from this session: does the private API's extra detail
(beyond what `eight_sleep_mapper.py` originally extracted) justify keeping the Eight Sleep
direct connector, or should it be dropped? Full real year (2025-08-29 to 2026-08-28), 314
nights, `NORMALIZER_VERSION=4` (post-fix, see below).

## Two real bugs found and fixed before trusting this data

Both caught by checking real probed **magnitudes**, not just field types/presence — the
first extraction pass only verified the latter.

1. **`sleepQualityScore.waso.current` / `performanceWindowStats.wasoBaseline` are
   fractions (probed at 0.0193 and 0.0616), not seconds.** The original ES-EXT/ES-EXT-2
   batches extracted them as `sleep_waso_seconds` / `waso_baseline_seconds` /
   `sleep_waso_seconds_7day_avg` with no conversion, producing implausible near-zero values
   next to the already-correct `sleep_stage_awake_seconds` (~7542s average). There's no
   documented conversion factor, so per this repo's "never invent evidence" rule these three
   metrics were removed entirely rather than guessed at.
2. **`social_jetlag_seconds` used `_num()`, which clamps negative values to `None`.** A real
   probe returned `socialJetlagSeconds=-139`. Jetlag is signed relative to the personal
   baseline, so roughly half of all real nights were silently dropped before the fix
   (observed as N=141/314 in an early pass of this same analysis). Switched to
   `_signed_num()`; N is now 306/314.

`NORMALIZER_VERSION` bumped 3→4, full year re-backfilled (`backfill-eight-sleep-direct
--days 365`) to force re-persistence — confirmed via direct Firestore read that all
re-persisted documents are `revision=4`/`normalizerVersion=4` with zero `waso_*` metrics
and populated negative `social_jetlag_seconds` values. See `eight_sleep_mapper.py`'s
`NORMALIZER_VERSION` comment and the fix commit for the full trail.

## Findings, corrected

| Metric | N | Mean | Median | Range |
|---|---|---|---|---|
| Snore duration | 314 | 885s (~15min) | 480s (8min) | 0–7560s |
| Heavy snore duration | 314 | 80s | 0s | 0–2310s |
| Snore % of night | 314 | 3.2% | 2% | 0–23% |
| Sleep latency (asleep) | 314 | 821s (~14min) | 450s (7.5min) | 0–7230s |
| Sleep latency (out of bed) | 314 | 138s | 30s | 0–1560s |
| Sleep debt vs personal baseline | 302 | -154s | -420s | -11600 to +12795s |
| Social jetlag vs personal baseline | 306 | -96s | -146s | -4199 to +3423s |

- **Snoring: 242/314 nights (77%) show any detected snoring; 37/314 (12%) show heavy
  snoring.** Garmin has no equivalent signal at all — this is genuinely new information,
  not a corroboration of something already captured.
- **Sleep latency: real and Garmin has no direct equivalent either** — Garmin's sleep
  staging infers a start time but doesn't separately report time-to-fall-asleep or
  time-to-get-out-of-bed the way Eight Sleep's routine score does.
- **Sleep debt / social jetlag are now correctly signed and populated** (previously only
  ~45% of jetlag nights were even recorded due to the bug above). Median debt is a 7-minute
  surplus; the first-quarter-of-the-year mean (-429s, surplus) trended toward the
  last-quarter mean (+132s, debt) — a real, modest year-over-year drift toward less rest
  relative to this account's own rolling baseline, not toward a fixed external target.
- **Chronotype is dead weight**: 314/314 nights classified `"early"` — zero variance, so as
  ingested this field carries no information for this user. Not worth acting on; kept for
  completeness/possible future variance, not because it's currently useful.
- **Circadian baseline timestamps (`bedtime_baseline_time` etc.) are rolling personal
  baselines that change most days** (299–308 unique values out of 314 nights) — they're
  Eight Sleep's own smoothed reference point, useful as the denominator for debt/jetlag
  above, but not independently interpretable as a fixed "your baseline is X" fact.
- **Tags are Garmin Health-Connect workout tags mirrored *into* Eight Sleep, not an
  Eight-Sleep-native illness/travel signal** — corrects an earlier working assumption in
  this session. Sample values: `Running`, `Elliptical`, `Other`, synced via
  `health-connect` with a literal `garmin.png` icon URL. 52/314 nights tagged. Since this
  is Garmin's own workout data reflected back, it adds **zero** incremental information
  over what Garmin already provides directly — redundant, not useless-but-irrelevant.
- **7-day rolling averages vs current-night values**: HRV's current-vs-baseline gap
  averages 5.4ms (modest, expected night-to-night variance around a stable baseline).
  Sleep duration's current-vs-baseline gap averages 63 minutes — large, and consistent with
  the already-documented bed-move/multi-location-sleep confound
  ([`docs/analysis/2026-08-28-garmin-eight-sleep-cross-device-agreement.md`](2026-08-28-garmin-eight-sleep-cross-device-agreement.md))
  rather than a new finding on its own.

## Verdict

Keep the connector, but for a narrower reason than duration/timing agreement:

- **Worth ingesting**: snoring (77% nightly detection, Garmin has nothing comparable) and
  sleep latency (no Garmin equivalent) are genuine incremental signal, not redundant with
  anything Garmin already reports. Sleep debt / social jetlag are now correctly extracted
  and usable as an Eight-Sleep-native circadian-consistency signal once N is trusted.
- **Not worth relying on for authority**: sleep duration/timing itself remains the weak
  spot (median 27min disagreement with Garmin across the full year, driven substantially by
  a real measurement-scope difference — Eight Sleep only sees its own bed). D-8S-NO-AUTHORITY
  stands: Eight Sleep should not gain baseline/fusion authority over Garmin for
  duration/timing metrics on this evidence.
- **Not worth acting on as ingested**: chronotype (zero variance) and tags (fully redundant
  with Garmin's own workout data). Neither is a reason to drop the connector — they're just
  not currently pulling their weight — but they're not reasons to add complexity around them
  either.

Net: the extended-mapper work was worth doing. It found real, Garmin-incomparable signal
(snoring, latency) that justifies keeping direct ingestion, separately from the
already-known duration/timing agreement weakness that keeps Eight Sleep out of the
recovery-scoring critical path per D-8S-NO-AUTHORITY.
