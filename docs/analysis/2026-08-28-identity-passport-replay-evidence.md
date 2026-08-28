# Empirical Analysis: Physiological Identity Passport — Real-Data Historical Replay (PI8)

> **✅ 2026-08-28 (same day) — updated after fixing the root cause.** The original 0% coverage
> finding below was real, but its root cause turned out to be a data-plumbing gap, not a
> permanent limitation: Garmin's raw sleep API has always included `sleepStartTimestampGMT`/
> `sleepEndTimestampGMT`, and the code already parsed them internally for a respiration-window
> average — they were just never persisted. Once that was fixed (`canonical.py`, `garmin_provider.py`,
> `models.py`, `mapper.py`) and retroactively backfilled for already-collected history from the
> existing raw archive (`garmin_sleep_timing_backfill.py`, no re-fetch from Garmin needed),
> automatic USER coverage went from **0% → 34.1%** (`leaveOneOut`) / **0% → 14.6%**
> (`chronologicalExpandingWindow`). §7 below has the full re-run. The original §1–§6 findings are
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
nights failed for the identical, structural reason, traced to real code (`identityAttribution.ts:235-237`
and `:453`): the evaluator requires session-timing evidence (`groupEvidence.has('SESSION_TIMING')`)
to be present at all before it can ever return automatic `USER`, and it treats an unpairable
session (`overlap === null`) as `SESSION_TIMING_DISCORDANT` rather than "not evaluated". Real
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
`google_health_mapper.py:535` always emits Google Health respiration observations under
`METRIC_RESPIRATION_RATE_BRPM` ("respiration_rate_brpm") — the "daily_" constant is a different,
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
or anything downstream. Fixed by threading `sleep_start_gmt_iso`/`sleep_end_gmt_iso` through
`CanonicalDailyMetrics` → `RawMetrics.sleepStartTimeGmt`/`sleepEndTimeGmt` → the persisted
snapshot, and reading them into `identity_replay_export.py`'s `garminSessions`.

**Retroactive backfill, not just going-forward**: raw Garmin sleep API responses are archived to
GCS per date (`service.py`'s `_archive_daily_payloads`, `endpoint="sleep"`). A new module,
[`garmin_sleep_timing_backfill.py`](../../src/garmin_sync/garmin_sleep_timing_backfill.py) (CLI:
`backfill-garmin-sleep-timing`), reads the *already-archived* raw payload back and patches
`raw.sleepStartTimeGmt`/`raw.sleepEndTimeGmt` onto the existing `daily_recovery_snapshots`
documents via an explicit dotted-field-path `update()` — not a merge-write on the whole `raw` map,
which would have risked touching sibling fields (`restingHr`, `hrvOvernightAvg`, `sleepScore`,
etc.) it must not touch. No re-fetch from Garmin's live API was needed. Verified directly against
Firestore (not just the CLI's own summary) that every patched document still has all of its
original fields intact, with only the two new fields added.

**Real backfill run**: 65-day window (2026-06-25 to 2026-08-28), 31 dates patched. Within the PI8
replay's 41-night window specifically, **27 / 41 nights now have real Garmin session timing** (the
remaining 14 have no archived "sleep" payload at all — archiving wasn't running yet for those
dates, a real, unrecoverable gap for that older history, not something this backfill can fix).

**Real replay result, re-run after the backfill** (`export-identity-replay --days 60` →
`evidence:identity-replay`, both methods):

| Method | Automatic USER | Coverage |
| --- | --- | --- |
| `leaveOneOut` | 14 / 41 | **34.1%** (was 0.0%) |
| `chronologicalExpandingWindow` | 6 / 41 | **14.6%** (was 0.0%) |

`leaveOneOut`'s reason-code distribution: `SESSION_TIMING_CONCORDANT` on all 14 automatic-USER
nights; `SESSION_TIMING_DISCORDANT` on 27 nights, which splits into two real, different causes —
the 14 nights with no archived session data at all (still correctly fail-closed to discordant, per
`identityAttribution.ts:235-237`'s treatment of `overlap === null`), **and 11 nights that do have
real session data on both sides but were genuinely found discordant** (e.g. a real timing mismatch
between the Garmin watch's and Eight Sleep pod's sleep-onset/wake detection — not a data-absence
artifact). `chronologicalExpandingWindow`'s lower 14.6% is expected and explained by
`INSUFFICIENT_PASSPORT_HISTORY` (32/41 nights) — a chronological replay with `minTrainingNights=5`
on a ~6-week dataset has a real cold-start period before enough training history accumulates;
`leaveOneOut`'s 34.1% is the more informative number for this dataset's size.

**What this means for the original open question (§6)**: mostly resolved, not by relaxing the
evaluator, but by fixing the real data gap as planned — most of the original 0% was genuinely
missing evidence, not genuine disagreement. But a real residual exists: even with full session
data, roughly 11/25 nights (44%) with real session timing on both sides showed genuine discordance.
Whether that's real device-to-device timing noise the evaluator's tolerance should absorb better,
or a real signal worth its own investigation, is a new, separate, genuinely open question — not
decided here, and not the same question §6 originally asked.

**Reproduce**:

```bash
uv run python -m garmin_sync backfill-garmin-sleep-timing --days 65
uv run python -m garmin_sync export-identity-replay --days 60
cd app
npm run evidence:identity-replay -- --input ../artifacts/identity-replay/replay-input.json
```

Full reports (both replay methods): `artifacts/identity-replay-reports/leave-one-out/report.md`,
`artifacts/identity-replay-reports/chronological-expanding-window/report.md` (not committed — real
per-night data, gitignored; regenerate via the commands above).

**Still not decided**: PI9 activation. 34.1% real out-of-sample coverage on real data is
meaningfully more evidence than 0%, but it is still evidence *for the shadow-replay record*, not
an activation decision — that stays a separate, explicit decision for the project owner, consistent
with PI9's own status notes.
