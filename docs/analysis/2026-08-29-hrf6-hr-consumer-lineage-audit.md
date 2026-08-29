# HRF6 — HR consumer and lineage audit

**Status:** complete — shadow-only; no production consumer changed.

## Code-backed inventory

| Consumer | Field | HR-derived / lineage | HRF use | Current behavior | HRF6 disposition / fallback |
|---|---|---|---|---|---|
| `ActivityTelemetry` | `averageHr`, `hrInZones`, `averageHrBpm` | Garmin summaries; FIT compatibility is not established | display | renders read-only telemetry | observational; no gate or fallback needed |
| `contextBrief` and `contextBriefActivityTelemetry` | `averageHr`, `hrInZones`, `averageHrBpm`, `activityTrainingLoad` | summary/vendor fields; no FIT inheritance proven | display | renders context only | observational; no gate or fallback needed |
| `completedTraining` | `activityTrainingLoad` with Training Effect | vendor HR-dependent (EPOC/heartbeat); not independent corroboration | training load | combines it into current `measuredEffort` tier | unchanged in production; `getGarminTrainingLoadAuthority` records the future shadow result. Training Effect, duration, modality, completion, and power remain available when blocked |
| `completedTraining` | `averageHr` | Garmin average summary | none | deliberately not consulted | remains unused |
| health-anomaly engine | activity HR | no current consumer | health anomaly | no activity-HR authority path | none; HRF5 keeps future use observational pending corroboration |
| max-HR, threshold, decoupling, interval-response | activity HR | no current consumers | sensitive use cases | absent | no bypass exists; future consumers must call `getHrUseAuthority` |

## Lineage conclusion

`activityTrainingLoad` is documented in the approved HRF plan as EPOC/heartbeat-dependent. It is therefore modeled as `vendor_hr_dependent`, with `independentCorroboration: false`. The adapter intentionally passes `inputLineageVerified: false`: a verified FIT trace does not by itself reconcile the separately supplied Garmin load summary.

## Boundaries retained

- No activity HR field changes readiness, physiological strain, or completion.
- `UNKNOWN` remains distinct from `UNRELIABLE` through HRF5 authority reasons.
- Existing HR displays remain observational.
- No raw FIT, samples, GPS, or identifiers are introduced.
