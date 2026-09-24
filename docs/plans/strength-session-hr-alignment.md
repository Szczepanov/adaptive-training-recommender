# Strength session heart rate per set and per rest

* **Status:** Draft
* **Date:** 2026-09-24
* **Blocked by:** decision D1 below (persisting a compact per-activity HR series). It needs an
  amendment to [ADR-0026](../adr/0026-wearable-telemetry-enrichment-boundaries.md), because
  today FIT samples are decoded in memory for HR fidelity and deliberately discarded.
* **Unlocks:** per-set and per-rest HR on the Completed Workout card for a structured strength
  session recorded on a Garmin watch at the same time
* **Decision boundary:** display only. No per-set HR value reaches readiness, fatigue, strength
  load or selection. Using one would be a new decision-authority rule (ADR-0033: claim,
  coverage item, alignment test) plus a `POLICY_VERSION` bump. It would also conflict with
  ADR-0021 D-STRCOST, which keeps strength load based on logged sets.
* **Parent plan:** [training occurrence reconciliation](./training-occurrence-reconciliation-and-strength-session-unification.md),
  "Performed rest and execution timeline" → "align HR samples to set/rest intervals"

## Goal

An athlete starts a strength workout on the watch (usually with a chest strap) and the matching
structured session in the app within a few seconds of each other. The linked Completed Workout
should then show, for each logged set, the HR during the set, and for each rest, how far HR
came down before the next set.

## What already exists

- Reconciliation links the two recordings (`training-occurrence/reconciliationService.ts`). An
  overlapping time window scores full temporal evidence, so the "start both together" workflow
  auto-links. `manualLinkCandidatesFor` plus the Activities **Link Garmin …** action cover the
  cases the matcher leaves apart.
- The Completed Workout card renders the prescription, every logged set and actual vs. target
  rest (`training-occurrence/structuredSetDetail.ts`). It also shows the watch recording's
  average/max HR and HR time-in-zone.
- The set/rest timeline is durable. `SessionEntry.completedAt` ends each set.
  `SessionRestEvent.startedAt`/`endedAt` bound each performed rest (`sessions/restEventTiming.ts`).
- Per-second HR exists only transiently: `fit_activity.py` decodes `record.heart_rate` when
  `GARMIN_ACTIVITY_HR_FIDELITY_ENABLED=true`, then the provider boundary discards it.

## Gap

The app knows **when** each set and rest happened but not the HR. The ingestion side has the HR
but not the set timeline. Neither side persists anything that joins them.

## Decisions to take

| ID | Question | Recommendation |
|---|---|---|
| D1 | Persist a compact HR series for a linked strength activity? | Yes. Store 5 s buckets (mean, max) at `users/{uid}/activity_hr_series/{activityId}`, only for strength/fitness-equipment activities. About 720 points per hour, well inside a document's size limit. Raw per-second samples and FIT bytes stay unpersisted. Needs an ADR-0026 amendment: it is personal health data, and the amendment must say who can read it (owner only) and that it is never exported by the Context brief. |
| D2 | Where does alignment run? | In the app, as a pure function at read time: `alignHrToSetTimeline(series, entries, restEvents)`. Ingestion stays provider-neutral and ignorant of sessions. Alignment is recomputable after a formula change (ADR-0021 D-SETLOG spirit). |
| D3 | Set start time | Derive it from the previous rest's `endedAt`. Use `SessionExecution.startedAt` for the first set. Add an explicit `SessionEntry.startedAt` only if derived windows prove too coarse. |
| D4 | Clock skew between phone and watch | Use absolute timestamps without correction. Both clocks are network/GNSS synced to within a few seconds, which is below the 5 s bucket width. Show a "timing approximate" note when the two recordings' starts differ by more than 60 s. |
| D5 | HR trust | Show per-set HR only when the activity's `hrMeasurement` confidence is `moderate` or better, or `sourceForActivity === 'external'` (chest strap). Otherwise show "HR not reliable enough per set" (ADR-0031 per-use authority). |

## Work items

| ID | Work | Depends on |
|---|---|---|
| SH1 | ADR-0026 amendment for D1 (scope, retention, access, Context-brief exclusion) | — |
| SH2 | Python: build the bucketed series from `FitActivityEvidence.records` for strength activities when HR-fidelity FIT decoding runs; best-effort write; tests with synthetic FIT fixtures | SH1 |
| SH3 | Firestore rules (owner read, server-only write) + `npm run test:rules` coverage | SH1 |
| SH4 | Pure `alignHrToSetTimeline` (set peak/mean HR, HR at rest end, drop over rest) with tests for missing buckets, overlapping windows, skew and a partial session | — (can start now against a fixture series) |
| SH5 | Completed Workout card: per-set HR column and per-rest HR drop, D5 gating, 320/390 px visual check | SH2–SH4 |

## Non-goals

- HR-based strength load, readiness or fatigue signals (see Decision boundary).
- Using Garmin's own rep counting or exercise recognition. Logged sets remain canonical (ADR-0034).
- Backfilling series for historical activities. Series exist only from SH2 onward.
