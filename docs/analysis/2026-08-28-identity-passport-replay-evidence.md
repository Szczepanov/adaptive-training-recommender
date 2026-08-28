# Empirical Analysis: Physiological Identity Passport — Real-Data Historical Replay (PI8)

**Date**: 2026-08-28
**Dataset**: 41 real paired nights (2026-06-30 to 2026-08-17), exported from live Firestore via
the new `export-identity-replay` CLI command against the linked user's real Garmin Direct
(`daily_recovery_snapshots`) and Eight Sleep-via-Google-Health (`health_observation_days`,
`provider=eight_sleep`, `transport=google_health`) data.
**Objective**: Run `app/src/engine/identityReplay.ts`'s out-of-sample replay (PI3/PI4/PI8,
ADR-0028) against real data for the first time, and report exactly what it shows — including
where the result is not what the plan document anticipated.

---

## 1. Executive Summary

| Dimension | Result |
| --- | --- |
| Paired nights exported | **41** (both `leaveOneOut` and `chronologicalExpandingWindow` methods run) |
| Anchor (Garmin Direct) present | **41 / 41** — no `ANCHOR_MISSING` nights in this window |
| Automatic USER coverage | **0 / 41 (0.0%)**, both methods |
| UNCERTAIN | 41 / 41 |
| Reason codes on every night | `INSUFFICIENT_PASSPORT_HISTORY`, `SESSION_TIMING_DISCORDANT` |
| Lineage/anchor-quality abstentions | 1 (2026-07-18, `ANCHOR_QUALITY_INSUFFICIENT` — incomplete Garmin snapshot that day) |
| Single/multi-feature disagreement nights | 0 / 0 |

**The headline finding is not "0% coverage" by itself — it's *why*.** Every one of the 41 nights
fails for the identical, structural reason, traced to real code (`identityAttribution.ts:235-237`
and `:453`): the evaluator requires session-timing evidence (`groupEvidence.has('SESSION_TIMING')`)
to be present at all before it can ever return automatic `USER`, and it treats an unpairable
session (`overlap === null`) as `SESSION_TIMING_DISCORDANT` rather than "not evaluated". Real
Garmin Direct snapshots carry **no sleep session interval timestamps** at all — a gap already
documented in code (`equivalence.py`: *"Direct-Garmin snapshots (RawMetrics) never carry interval
timestamps today... an honest gap, not a silent pass"*) and confirmed again here. So `overlap` is
`null` for every real night, `SESSION_TIMING_DISCORDANT` fires unconditionally, and automatic
`USER` is structurally unreachable — independent of how strong the RHR/HRV/respiration
concordance is underneath.

This is a real, reproducible finding about the current anchor policy (`garmin_direct`) against
real data, not a defect in this replay run. It is squarely the kind of evidence PI9 activation
needs to see before any decision is made — and this doc takes no position on that decision.

---

## 2. What was and wasn't measurable

- **RHR and HRV**: real values on all 41 nights (`restingHeartRate`: median 46.00 bpm, MAD 2.97;
  `hrv`: median 57.34 ms, MAD 8.83 — both consistent with the independently-run MS14 shadow study
  the same day range, see [`2026-08-27-multisource-shadow-study.md`](2026-08-27-multisource-shadow-study.md)).
- **Respiration**: real values on 34 / 41 nights (median 12.74 brpm, MAD 0.31 — matches MS14's
  12.7 brpm within rounding). The 7-night gap is real Eight Sleep respiration-observation absence,
  not an export defect.
- **Session timing**: **zero** real nights have Garmin session data (`garminSessions: []` for
  all 41 — a structural gap in `daily_recovery_snapshots`, not a per-night data quality issue).
  Eight Sleep session intervals ARE real and present (`observedStart`/`observedEnd` on the
  `sleep_session` observation), so the shared side of the pairing is genuine; there is simply
  nothing on the anchor side to pair it against.
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

## 4. Reproduce

```bash
uv run python -m garmin_sync export-identity-replay --days 60
cd app
npm run evidence:identity-replay -- --input ../artifacts/identity-replay/replay-input.json
```

Full reports (both replay methods): `artifacts/identity-replay-reports/leave-one-out/report.md`,
`artifacts/identity-replay-reports/chronological-expanding-window/report.md` (not committed —
regenerate via the commands above; both are byte-for-byte reproductions of what this doc reports).

## 5. Limitations (carried from the report itself)

- Every automatic status is out-of-sample (P-PI-16) — not applicable here since none exist yet,
  but holds structurally for both replay methods run.
- No historical night is ever labelled `NOT_USER` (P-PI-8) — this replay reports `UNCERTAIN` only.
- Baseline before/after figures are a single full-window robust estimate, not a rolling 7d/28d
  baseline.
- Threshold sensitivity is coverage-only — no real negative labels exist yet to measure
  false-acceptance/precision, and coverage stayed 0/41 across every swept `minUserScore` (0.5–0.9),
  since the session-timing precondition — not the score threshold — is what's gating every night.

## 6. Open question this raises (not decided here)

Whether `garmin_direct`'s complete absence of session-interval data should make automatic
identity confirmation structurally impossible under the current evaluator, or whether the
evaluator/anchor-policy design should have a path that doesn't hard-require session-timing
evidence when the configured anchor is known to never supply it. That is a design decision for the
identity evaluator (PI4/ADR-0028), separate from PI9's activation decision, and is not something
this export/evidence exercise decides — it only surfaces the fact plainly, backed by real numbers.
