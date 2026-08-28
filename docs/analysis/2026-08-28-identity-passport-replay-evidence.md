# Empirical Analysis: Physiological Identity Passport — Real-Data Historical Replay (PI8)

> **✅ 2026-08-28 (same day) — updated after fixing the root cause.** The original 0% coverage
> finding below was real, but its root cause turned out to be a data-plumbing gap, not a
> permanent limitation: Garmin's raw sleep API has always included `sleepStartTimestampGMT`/
> `sleepEndTimestampGMT`, and the code already parsed them internally for a respiration-window
> average — they were just never persisted. Once that was fixed (`canonical.py`, `garmin_provider.py`,
> `models.py`, `mapper.py`) and retroactively re-derived for already-collected history via the
> existing `rebuild` command (which replays the raw archive through the same canonicalization path
> — no bespoke backfill script or re-fetch from Garmin needed, see §7a), automatic USER coverage
> went from **0% → 63.4%** (`leaveOneOut`) / **0% → 36.6%** (`chronologicalExpandingWindow`). A
> second real bug found investigating the residual discordance — the exporter only passed the
> *first* Eight Sleep session per night, silently dropping a real overnight session whenever a
> short nap/presence reading was recorded for the same date — pushed it further to **68.3%** /
> **43.9%** once fixed (see §7b). §7 below has the full re-run. The original §1–§6 findings are
> kept below, unedited, because they're what led to finding and fixing the real gap — this is not
> a retraction, it's the record of how the fix was found.

**Date**: 2026-08-28
**Dataset**: 41 real paired nights (2026-06-30 to 2026-08-17), exported from live Firestore via
the new `export-identity-replay` CLI command against the linked user's real Garmin Direct
(`daily_recovery_snapshots`) and Eight Sleep-via-Google-Health (`health_observation_days`,
`provider=eight_sleep`, `transport=google_health`) data.
**Objective**: Run `app/src/engine/identityReplay.ts`'s out-of-sample replay (PI3/PI4/PI8,
ADR-0028) against real data for the first time, and report exactly what it shows — including
where the result is not what the plan document anticipated.

---

## 1. Executive Summary (original run, before the sleep-timing fix — see §7 for current numbers)

| Dimension | Result |
| --- | --- |
| Paired nights exported | **41** (both `leaveOneOut` and `chronologicalExpandingWindow` methods run) |
| Anchor (Garmin Direct) present | **41 / 41** — no `ANCHOR_MISSING` nights in this window |
| Automatic USER coverage | **0 / 41 (0.0%)**, both methods |
| UNCERTAIN | 41 / 41 |
| Reason codes on every night | `INSUFFICIENT_PASSPORT_HISTORY`, `SESSION_TIMING_DISCORDANT` |
| Lineage/anchor-quality abstentions | 1 (2026-07-18, `ANCHOR_QUALITY_INSUFFICIENT` — incomplete Garmin snapshot that day) |
| Single/multi-feature disagreement nights | 0 / 0 |

**The headline finding was not "0% coverage" by itself — it was *why*.** Every one of the 41
nights failed for the identical, structural reason, traced to real code
(`identityAttribution.ts`'s `evaluateIdentityEvidence`): the evaluator requires session-timing
evidence (`groupEvidence.has('SESSION_TIMING')`) to be present at all before it can ever return
automatic `USER`, and it treats an unpairable session (`overlap === null`) as
`SESSION_TIMING_DISCORDANT` rather than "not evaluated". Real
Garmin Direct snapshots carried **no sleep session interval timestamps** at all — a gap documented
in code (`equivalence.py`: *"Direct-Garmin snapshots (RawMetrics) never carry interval timestamps
today... an honest gap, not a silent pass"*) and confirmed again here. So `overlap` was `null` for
every real night, `SESSION_TIMING_DISCORDANT` fired unconditionally, and automatic `USER` was
structurally unreachable — independent of how strong the RHR/HRV/respiration concordance was
underneath.

Investigating *why* that gap existed (§6 below, "open question") led directly to §7's fix: the
data wasn't fundamentally unavailable, it was just never plumbed through.

---

## 2. What was and wasn't measurable (original run)

- **RHR and HRV**: real values on all 41 nights (`restingHeartRate`: median 46.00 bpm, MAD 2.97;
  `hrv`: median 57.34 ms, MAD 8.83 — both consistent with the independently-run MS14 shadow study
  the same day range, see [`2026-08-27-multisource-shadow-study.md`](2026-08-27-multisource-shadow-study.md)).
- **Respiration**: real values on 34 / 41 nights (median 12.74 brpm, MAD 0.31 — matches MS14's
  12.7 brpm within rounding). The 7-night gap is real Eight Sleep respiration-observation absence,
  not an export defect.
- **Session timing**: **zero** real nights had Garmin session data (`garminSessions: []` for
  all 41). Eight Sleep session intervals were real and present (`observedStart`/`observedEnd` on
  the `sleep_session` observation), so the shared side of the pairing was genuine; there was simply
  nothing on the anchor side to pair it against — see §7 for why, and the fix.
- **Date range**: Eight Sleep data stops after 2026-08-17 in this account (a pre-existing, already
  documented gap — see MS14's doc), which is why the real paired-night count is 41, not the plan
  document's earlier working estimate of "42" (that number came from Eight Sleep-vs-Garmin-Direct
  *coverage overlap*, a different count than *rows exported for identity replay*, which additionally
  require a shared-source bundle to exist for each date within a possibly different day-boundary).

## 3. Bug found and fixed during this run

The first real run showed `respirationRate: N=0` for both before/after baseline gating — a bug in
the new exporter, not the replay engine: `identity_replay_export.py` initially read
`METRIC_DAILY_RESPIRATION_RATE_BRPM` ("daily_respiration_rate_brpm"), but
`google_health_mapper.py`'s `GoogleHealthMapper._map_respiration` always emits Google Health
respiration observations under `METRIC_RESPIRATION_RATE_BRPM` ("respiration_rate_brpm") — the
"daily_" constant is a different,
unrelated metric name never written by the Google Health ingestion path. `multisource_audit.py`
already carried a fallback for this exact ambiguity (`metric == METRIC_DAILY_RESPIRATION_RATE_BRPM
or metric == "respiration_rate_brpm"`), which is what surfaced the mismatch on inspection. Fixed
in [`identity_replay_export.py`](../../src/garmin_sync/identity_replay_export.py) before this doc
was written; the N=34/41 respiration figures above are from the corrected run.

## 4. Reproduce (original 0%-coverage run)

```bash
uv run python -m garmin_sync export-identity-replay --days 60
cd app
npm run evidence:identity-replay -- --input ../artifacts/identity-replay/replay-input.json
```

## 5. Limitations (carried from the original report)

- Every automatic status is out-of-sample (P-PI-16) — not applicable here since none existed yet,
  but held structurally for both replay methods run.
- No historical night is ever labelled `NOT_USER` (P-PI-8) — this replay reported `UNCERTAIN` only.
- Baseline before/after figures are a single full-window robust estimate, not a rolling 7d/28d
  baseline.
- Threshold sensitivity is coverage-only — no real negative labels exist yet to measure
  false-acceptance/precision, and coverage stayed 0/41 across every swept `minUserScore` (0.5–0.9),
  since the session-timing precondition — not the score threshold — was what gated every night.

## 6. Open question this raised (original run — see §7 for what was actually true)

Whether `garmin_direct`'s complete absence of session-interval data should make automatic
identity confirmation structurally impossible under the current evaluator, or whether the
evaluator/anchor-policy design should have a path that doesn't hard-require session-timing
evidence when the configured anchor is known to never supply it. Investigating this question
found that the premise was wrong — see §7.

---

## 7. The fix and the real, current result (2026-08-28)

**Root cause**: not a permanent data-availability limit. Garmin's raw sleep API response has
always included `dailySleepDTO.sleepStartTimestampGMT`/`sleepEndTimestampGMT`, and
`garmin_provider.py`'s `_sleep_window_gmt_ms()` already parsed them — but only to feed an internal
respiration-window average (`average_sleep_respiration_from_intervals`); the parsed timestamps
were discarded immediately after, never reaching `CanonicalDailyMetrics`, `daily_recovery_snapshots`,
or anything downstream. Fixed by threading `CanonicalDailyMetrics.sleep_session_start`/
`sleep_session_end` (real `datetime` values) through `RawMetrics.sleepSessionStart`/`sleepSessionEnd`
(ISO strings at the persisted-document boundary) to the snapshot, and reading them into
`identity_replay_export.py`'s `garminSessions`. (An earlier version of this fix used different
field names and a bespoke retroactive-backfill script; both were superseded before merging when
`main` turned out to have independently landed the same capability under this naming, more
completely integrated — see §7a below.)

**Retroactive population uses the existing `rebuild` command, not a bespoke script**: raw Garmin
sleep API responses are already archived to GCS per date (`service.py`'s `_archive_daily_payloads`,
`endpoint="sleep"`), and `service.rebuild(start, end)` (CLI: `rebuild --start-date ... --end-date
...`) already replays every archived raw payload (stats/sleep/hrv/activities) through the exact
same `canonicalize_from_raw` the live sync path uses, for any date where all four are present. No
new script was needed once the field-name reconciliation below happened.

**Real rebuild run**: 65-day window (2026-06-25 to 2026-08-28) — **65 / 65 dates rebuilt, 0
skipped**. Within the PI8 replay's 41-night window specifically, **40 / 41 nights now have real
Garmin session timing** (only 2026-07-18 lacks it, the same date already flagged
`ANCHOR_QUALITY_INSUFFICIENT` for an incomplete Garmin snapshot that day).

**Real replay result, re-run after the rebuild** (`export-identity-replay --days 60` →
`evidence:identity-replay`, both methods):

| Method | Automatic USER | Coverage |
| --- | --- | --- |
| `leaveOneOut` | 26 / 41 | **63.4%** (was 0.0%) |
| `chronologicalExpandingWindow` | 15 / 41 | **36.6%** (was 0.0%) |

`leaveOneOut`'s reason-code distribution: `SESSION_TIMING_CONCORDANT` on all 26 automatic-USER
nights; `SESSION_TIMING_DISCORDANT` on 15 nights — with real session-timing coverage now at 40/41,
this is overwhelmingly **genuine discordance, not data absence** (only 1 of the 15 lacks session
data at all). `chronologicalExpandingWindow`'s lower 36.6% is expected and explained by
`INSUFFICIENT_PASSPORT_HISTORY` (18/41 nights) — a chronological replay with `minTrainingNights=5`
on a ~6-week dataset has a real cold-start period before enough training history accumulates;
`leaveOneOut`'s 63.4% is the more informative number for this dataset's size.

**What this means for the original open question (§6)**: resolved, not by relaxing the evaluator,
but by fixing the real data gap as planned — the original 0% was entirely a missing-evidence
artifact, not genuine disagreement. A real residual remains: 14/15 `leaveOneOut` discordant nights
now have real session data on both sides and were genuinely found discordant (~35% of all 41
nights). Whether that's real device-to-device timing noise the evaluator's tolerance should absorb
better, or a real signal worth its own investigation, is a new, separate, genuinely open question —
not decided here, and not the same question §6 originally asked.

**Reproduce**:

```bash
uv run python -m garmin_sync rebuild --start-date 2026-06-25 --end-date 2026-08-28
uv run python -m garmin_sync export-identity-replay --days 60
cd app
npm run evidence:identity-replay -- --input ../artifacts/identity-replay/replay-input.json
```

### 7a. A note on how this shipped

The first pass at this fix (same root cause, same day) used its own field names
(`sleep_start_gmt_iso`/`sleep_end_gmt_iso`, `RawMetrics.sleepStartTimeGmt`/`sleepEndTimeGmt`) and a
bespoke retroactive-backfill script (`garmin_sleep_timing_backfill.py`, using a new
`FirestoreRecoveryRepository.patch_snapshot_fields` dotted-path patch method) — real, tested, and
run against the real account (31/65 dates patched, 27/41 nights in-window, yielding 34.1%/14.6%
coverage). While syncing this branch with `main` for merge, that turned out to duplicate work
already independently merged to `main` under different names (`sleep_session_start`/
`sleep_session_end`, `RawMetrics.sleepSessionStart`/`sleepSessionEnd`) — and `main`'s version was
more completely integrated (also threaded into `equivalence.py`'s MS10 transport-equivalence
comparison) and didn't need a bespoke backfill script at all, since the existing `rebuild` command
already covers the same retroactive-population need more generally. Reconciled by adopting `main`'s
naming and mechanism throughout, deleting the now-redundant script and its `patch_snapshot_fields`
dependency, and re-running the real rebuild + replay end to end to confirm the real numbers above —
which came out meaningfully *better* than the first pass (63.4% vs. 34.1%), since `rebuild`
achieved full 65/65 date coverage where the bespoke script only reached 31/65.

Full reports (both replay methods): `artifacts/identity-replay-reports/leave-one-out/report.md`,
`artifacts/identity-replay-reports/chronological-expanding-window/report.md` (not committed — real
per-night data, gitignored; regenerate via the commands above).

### 7b. A second real bug found investigating the residual discordance

Analyzing the 15 `leaveOneOut` discordant nights (raw session deltas computed directly from the
exported JSON, not assumed) found two genuinely different phenomena, not one:

- **3 nights (2026-07-05, 2026-08-03, 2026-08-14) had deltas of 18–24 *hours*** — not timing
  noise, a garbage comparison. The matched Eight Sleep "session" for those dates was 40–75 minutes
  long, at mid-afternoon/early-evening times — a nap or brief presence reading, not the night's
  real sleep. Checked directly against the real Firestore bundle: **a genuine full-length overnight
  session (4.9–8.5 hours) was sitting in the same bundle**, alongside the nap, both attributed to
  the same `logicalDate`. `identity_replay_export.py`'s `_find_sleep_session_observation` returned
  only the first `sleep_session` observation it found — silently dropping the real night whenever a
  nap happened to be listed first. Fixed: `_find_sleep_session_observations` (plural) now returns
  every candidate, feeding all of them into `identityFeatures.ts`'s `selectBestSessionPairing` —
  which already existed specifically to pick the best-overlapping candidate from a set that may
  include naps (its own docstring says so) — while the scalar baseline fields
  (`sharedSleepStartMinutesLocal`/`sharedSleepDurationMinutes`) now use the longest candidate, not
  whichever came first.
- **5+ nights (2026-07-07/08/15/16/20) had real, full-length sessions on both sides but a genuine
  51–146 minute start-time disagreement** larger than this account's own typical pattern —
  plausibly explained by time spent in bed before actually falling asleep. The evaluator already
  has a dedicated relaxed-tolerance path for exactly this (`identityAttribution.ts`'s
  `relaxedTimingConcordanceZThreshold`/`minRelaxedTimingJaccard`, active when physiology is fully
  concordant), and these nights still failed even that more generous bar. **This is not touched by
  this fix** — loosening an identity-safety threshold further without real prospective-label
  evidence would repeat the exact mistake this project has already had to correct once (see the
  multisource shadow study's fabrication correction), so it stays a genuinely open question, not
  something decided here.

**Real re-run after this fix**: 4 nights (2026-07-05, 2026-07-15, 2026-08-03, 2026-08-14) now
export more than one Eight Sleep session candidate. Automatic USER coverage improved further:

| Method | Automatic USER | Coverage |
| --- | --- | --- |
| `leaveOneOut` | 28 / 41 | **68.3%** (was 63.4%) |
| `chronologicalExpandingWindow` | 18 / 41 | **43.9%** (was 36.6%) |

`MULTIPLE_PAIRING_CANDIDATES` now appears in the real reason-code distribution for the first time
(1 night) — the existing ambiguity-surfacing path (`identityFeatures.ts`) correctly exercising for
real, exactly as designed, rather than silently picking one candidate.

**Still not decided**: PI9 activation. 68.3% real out-of-sample coverage on real data is
meaningfully more evidence than 0%, but it is still evidence *for the shadow-replay record*, not
an activation decision — that stays a separate, explicit decision for the project owner, consistent
with PI9's own status notes.
