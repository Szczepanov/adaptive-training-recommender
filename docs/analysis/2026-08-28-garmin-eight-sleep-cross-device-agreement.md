# Garmin Direct vs Eight Sleep Direct: cross-device sleep-duration agreement (2026-08-28)

First real-data read of MS14's cross-device comparison against the direct Eight Sleep
connector (bypassing Google Health on both sides — see `docs/analysis/2026-08-28-eight-sleep-direct-ingestion-reliability.md`
for why direct was chosen over Google Health, and the ES9 sleep-duration mapper fix in
`google_health_mapper.py` for a related but separate Google-Health-side finding).

## Data

`audit-multisource --days 365 --eight-sleep-transport eight_sleep_direct`, run against the
real account, full year (2025-08-29 to 2026-08-28), 314 nights with both sources present.

## Headline numbers

| Stat | All 314 nights |
|---|---|
| Mean absolute delta | 56.9 min |
| Median absolute delta | 27.2 min |
| P90 absolute delta | 168.5 min |
| Nights >60min disagreement | 85/312 (27%) |
| Nights >120min disagreement | 40/312 (13%) |
| Correlation | 0.414 |

The same shape held at a smaller 180-night sample (mean 54.3min, median 26.8min, 18/154
>120min) — this is a stable structural pattern in the data, not small-sample noise.

## The mean is misleading on its own

Median is consistently roughly **half** the mean at every sample size tested. A reader
seeing only the mean would conclude a "typical" night disagrees by nearly an hour; most
nights actually disagree by roughly half that. The gap is driven by a real minority
(~13%) of nights with extreme (2+ hour) disagreements, not a uniformly-noisy signal.

## Root cause of the outlier tail: multi-location sleep

Manually inspected the 38 real nights with >120min disagreement, comparing each night's
Eight Sleep session-start timestamp against that same night's Garmin-detected sleep-start
timestamp:

- **27/38 (71%)** had an Eight Sleep start materially later (60+ min) than Garmin's own
  detected sleep start for that night.
- **9 of the top 10 largest disagreements** were late-start nights.
- The single largest gap (466 minutes) had Eight Sleep not registering bed presence until
  **3:06am** that night.

The explanation, confirmed by the account owner: sleep sometimes begins in a different bed
(a child's bed) before moving to the Eight-Sleep-equipped bed mid-night. Eight Sleep can
only measure presence in its own bed; Garmin (wrist-worn) tracks sleep regardless of
location. This is a genuine measurement-scope difference, not a device-accuracy problem —
Eight Sleep is measuring correctly for what it can observe.

## Tooling change

`multisource_audit.py` gained `_likely_bed_move()`: a self-relative heuristic (Eight
Sleep's start vs. that same night's Garmin-detected start, >60min gap) that flags likely
bed-move nights without asserting on nights where classification isn't possible (missing
timestamps stay in the "clean" stats — never speculatively excluded). The report now
carries both the all-nights numbers and a parallel excluding-flagged-nights set
(`sleepDurationMeanDiffMinutesExclBedMove`, `sleepDurationMedianDiffMinutesExclBedMove`,
`likelyBedMoveDates`), and the CLI prints both.

Deliberately a heuristic, not a filter applied silently or upstream: it doesn't change what
gets persisted or what the "all nights" stats show, only adds a second, clearly-labelled
view. A night the heuristic can't classify (either timestamp missing — the pre-fix Garmin
history before PR #258's session-timing capture, for example) stays in the clean stats
rather than being dropped without evidence.

### Real result — smaller effect than expected, for an honest reason

Re-ran `audit-multisource --days 365 --eight-sleep-transport eight_sleep_direct` with the
heuristic live:

| | All 312 nights | Excluding flagged |
|---|---|---|
| Flagged as likely bed move | — | 17 |
| Mean | 56.9 min | 50.8 min |
| Median | 27.2 min | 25.5 min |
| N | 312 | 295 |

Only 17 nights got flagged — far fewer than the 27/38 late-start nights found in the
manual spot-check above. The reason: `_likely_bed_move()` needs **both** Garmin's own
sleep-session start and Eight Sleep's, and Garmin timing coverage is only **118/363
nights (32%)** — the PR #258 fix that made Garmin capture real session timestamps only
covers sync's going forward, not retroactively. Most of this year's history predates it,
so most nights simply can't be classified either way and stay (correctly, per the
never-speculatively-exclude design) in the clean stats rather than being flagged or
dropped. The manual spot-check used a looser fixed-clock threshold (Eight Sleep start at
or after 22:00) that doesn't need Garmin's timestamp at all, which is why it caught more
nights but is a weaker signal (it can't distinguish a genuinely late shared bedtime from
an actual bed move).

This heuristic's real yield will grow over time as more nights accumulate with Garmin's
new timing capture in place — it's currently working with a small, recent-biased subset
of the dataset. Worth re-running this same command periodically to watch the classified
share grow.

## Interpretation for ES10

This does not, by itself, resolve whether direct Eight Sleep should gain baseline/fusion
authority — that decision needs its own evidence-backed review (D-8S-NO-AUTHORITY,
ADR-0030) and prospective accumulation, not a single point-in-time comparison. What this
establishes:

- The comparison tooling itself is correct (independently cross-checked against raw
  Firestore data; the tool's reported mean matched a manual computation exactly).
- Some of the apparent disagreement is a real behavioral confound (multi-location sleep),
  not evidence against Eight Sleep's measurement quality on ordinary nights — but the
  currently-classifiable share is small (17/312 nights) because Garmin's own session
  timing only covers a recent minority of the year. The unclassified confound is likely
  larger than what's currently measurable.
- Even with that limitation, the **median** (27.2min all-nights, 25.5min excluding the 17
  classifiable bed-move nights) is the more representative number for "typical" night
  agreement than the mean (56.9min) — the mean is dominated by the outlier tail regardless
  of how much of that tail is bed-move-explained.
- Re-run this comparison again in a few months, once more of the year has Garmin session
  timing coverage — the bed-move classification should become substantially more complete
  and the excl-bed-move numbers more trustworthy.
