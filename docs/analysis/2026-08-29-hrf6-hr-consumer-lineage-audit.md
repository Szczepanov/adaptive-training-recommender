# HRF6 — HR consumer and lineage audit

**Status:** complete — shadow-only; no production consumer changed.

## Code-backed inventory

| Consumer | Field | HR-derived / lineage | HRF use | Current behavior | HRF6 disposition / fallback |
|---|---|---|---|---|---|
| `ActivityTelemetry` | `averageHr`, `hrInZones`, `averageHrBpm` | Garmin summaries; FIT compatibility is not established | display | renders read-only telemetry | observational; no gate or fallback needed |
| `contextBrief` and `contextBriefActivityTelemetry` | `averageHr`, `hrInZones`, `averageHrBpm`, `activityTrainingLoad` | summary/vendor fields; no FIT inheritance proven | display | renders context only | observational; no gate or fallback needed |
| `completedTraining` | `activityTrainingLoad` | Garmin Exercise/Training Load is EPOC-based; Garmin documents EPOC prediction from heartbeat data | training load | with Training Effect, upgrades the evidence tier to `measuredEffort` | unchanged in production; `getGarminTrainingLoadAuthority` records the future fail-closed shadow result. If blocked after activation, do **not** fall back to Training Effect as independent corroboration; use only explicitly non-HR-derived evidence such as duration/modality, verified direct power/pace, or athlete/manual completion evidence |
| `completedTraining` | `trainingEffectAerobic` | Garmin documents aerobic Training Effect as accumulated EPOC measured from heart rate | training effect | contributes to the `garminTrainingEffect`/`measuredEffort` evidence tiers and may infer intensity when no explicit intensity tag is available | unchanged in production; `getGarminTrainingEffectAuthority(..., 'trainingEffectAerobic')` records the future fail-closed shadow result. A blocked Training Effect cannot fall back to Training Load because both share vendor HR/EPOC lineage |
| `completedTraining` | `trainingEffectAnaerobic` | Garmin documents anaerobic Training Effect as derived by analysing heart rate **and** speed/power to quantify anaerobic contribution to EPOC | training effect | contributes to the `garminTrainingEffect`/`measuredEffort` evidence tiers and may infer intensity when no explicit intensity tag is available | unchanged in production; `getGarminTrainingEffectAuthority(..., 'trainingEffectAnaerobic')` records the future fail-closed shadow result. Speed/power contribution does not make the vendor summary independent corroboration of HR fidelity |
| `completedTraining` | `averageHr` | Garmin average summary | none | deliberately not consulted | remains unused |
| health-anomaly engine | activity HR | no current consumer | health anomaly | no activity-HR authority path | none; HRF5 keeps future use observational pending independent corroboration |
| max-HR, threshold, decoupling, interval-response | activity HR | no current consumers | sensitive use cases | absent | no bypass exists; future consumers must call `getHrUseAuthority` with the matching use case and required context |

## Vendor HR/EPOC lineage conclusion

The three vendor effort summaries currently relevant to `completedTraining` are one HR-dependent lineage family for HRF purposes:

- `activityTrainingLoad`: EPOC-based Exercise/Training Load. Garmin states that its device engine predicts EPOC in real time by analysing heartbeat data.
- `trainingEffectAerobic`: accumulated EPOC/Training Effect. Garmin explicitly states that aerobic Training Effect uses heart rate to measure accumulated exercise intensity.
- `trainingEffectAnaerobic`: Garmin states that anaerobic Training Effect analyses heart rate together with speed (or cycling power) to quantify the anaerobic contribution to EPOC.

Therefore none of these three fields can independently corroborate the fidelity of the activity HR trace. In particular, a future HRF gate must not block `activityTrainingLoad` and then silently recover authority from Training Effect, or vice versa.

The adapters intentionally pass `inputLineageVerified: false`. A clean/high-confidence FIT trace — even when `summaryCompatibility` is `verified_same_effective_trace` for the reconciled HR summary — does not prove that a separately supplied Garmin Training Load or Training Effect value was calculated from that exact assessed trace. Until that child-input lineage is explicitly reconciled, the sensitive use is fail-closed with `INPUT_LINEAGE_UNVERIFIED`.

## Current-production boundary

HRF6 remains shadow-only. This audit does **not** change the existing `completedTraining` evidence hierarchy or intensity inference. Today:

- Training Effect can contribute to Garmin intensity inference;
- Training Effect alone can produce the `garminTrainingEffect` evidence tier;
- Training Effect plus positive `activityTrainingLoad` can produce the `measuredEffort` evidence tier.

Those facts are precisely why all three vendor fields need shadow authority coverage before any later HRF activation changes production decisions.

## Research basis

Vendor methodology was checked against Garmin's current public documentation rather than inferred from field names:

- Garmin, **Training Load**: https://www.garmin.com/en-SG/garmin-technology/running-science/physiological-measurements/training-load/
- Garmin, **Training Effect**: https://www.garmin.com/en-US/garmin-technology/running-science/physiological-measurements/training-effect/

These sources establish the HR/EPOC dependency needed for this lineage classification; they do not establish exact per-device raw input lineage, which is why `inputLineageVerified` remains `false`.

## Boundaries retained

- No activity HR field changes readiness, physiological strain, or completion in this PR.
- `UNKNOWN` remains distinct from `UNRELIABLE` through HRF5 authority reasons.
- Existing HR displays remain observational.
- No raw FIT, samples, GPS, or identifiers are introduced.
- Vendor Training Load and Training Effect are not double-counted as independent HR corroboration.
