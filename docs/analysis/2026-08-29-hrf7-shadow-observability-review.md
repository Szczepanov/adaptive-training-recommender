# HRF7 Shadow Observability — PR #291 Review

**Date:** 2026-08-29  
**Scope:** PR #291 (`feat(hrf): add shadow replay observability`)  
**Decision posture:** shadow/evidence-only; no production recommendation authority

## Review outcome

PR #291 implements the intended HRF7 execution layer: compact activity-level replay rows, aggregate observability, a bounded read-only activity-history service, and a calm activity-detail explanation that preserves the distinction between `NOT_ASSESSED`, assessed `unknown`, and assessed failure.

The review found several semantics that were safe in the sense of not changing recommendations, but could still make the **observability itself misleading**. Those were corrected on the PR branch before considering HRF7 complete.

## Corrections made during review

### 1. Explicit rate denominators

The approved HRF plan asks HRF7 to measure assessment-unknown and summary-reconciliation/discordance **rates**, not only counts.

The replay summary now exposes:

- `assessmentUnknownRate = assessed unknown / assessed activities`;
- `summaryComparableCount = verified_same_effective_trace + consistent_unproven + discordant`;
- `summaryReconciliationRate = verified_same_effective_trace / comparable`;
- `summaryDiscordanceRate = discordant / comparable`.

`unknown`, `not_comparable`, and not-assessed records are excluded from the summary reconciliation/discordance denominator rather than silently being treated as agreement or disagreement.

### 2. Chest-strap failures are not inferred from generic external-sensor presence

The original replay counter used `externalHrSensorPresent === true` for the plan's “poor trace despite strap presence” metric.

That is too broad because HRF explicitly separates:

- external sensor presence;
- source provenance;
- sensor technology.

An optical armband or unknown external sensor must not be reported as a failed electrode chest strap. The replay now counts this metric only when `sensorTechnology === electrode_chest_strap` and the trace is actually classified `poor`.

### 3. “Useful wrist trace preserved” requires a real display candidate

HRF authority can say that average-HR display *would* be allowed even when an activity has no persisted average-HR value. Counting that as a production display preserved would inflate observability.

`usefulWristTraceCount` and the “feature-specific block while display remains available” aggregate now require an actual current `averageHr` display candidate in addition to the HRF authority result.

### 4. Malformed/reversed replay ranges fail closed

A bounded replay must not turn bad operator input into a valid-looking zero-activity report.

The read-only replay service now validates strict `YYYY-MM-DD` calendar dates and requires `startDate <= endDateInclusive` before querying Firestore. Invalid input returns `report: null` with an explicit `inputIssues` entry and does not call the activity source.

This remains distinct from:

- unavailable activity history;
- malformed persisted activity records.

### 5. Assessed `unknown` always retains a reason bucket

If an assessed measurement has `measurementConfidence === unknown` but its persisted reason list is empty, the replay now records `ASSESSMENT_REASON_UNSPECIFIED`. This prevents the unknown-count numerator from exceeding the sum of its reason buckets without explanation.

## External semantics checked

Garmin's current public documentation continues to support the conservative HRF6/HRF7 classification of Garmin Training Load and Training Effect as materially HR-dependent vendor summaries:

- Garmin describes Training Effect as being determined by user profile/training history, **heart rate**, duration, and intensity. Its anaerobic Training Effect uses heart rate together with speed or cycling power.
- Garmin describes Training Load as EPOC-based and states that its EPOC engine predicts accumulation by analysing heartbeat data.
- Garmin also states that estimated EPOC is core to Training Effect and training-load calculations.

References:

- Garmin Support — *What Is the Training Effect Feature on My Garmin Device?*  
  https://support.garmin.com/?faq=Vi2undejXR5Mmq662o4lO9
- Garmin Technology — *Training Load*  
  https://www.garmin.com/en-US/garmin-technology/cycling-science/physiological-measurements/training-load/
- Garmin Technology — *EPOC*  
  https://www.garmin.com/en-US/garmin-technology/running-science/physiological-measurements/epoc/

This evidence supports **HR dependence**, not exact lineage. It therefore does not justify upgrading Garmin vendor summaries when their exact relationship to the assessed FIT HR stream is unverified. The existing fail-closed HRF adapters remain correct.

## Safety and architecture checks

The reviewed implementation preserves the HRF/ADR-0031 boundaries:

- no recommendation, readiness, completed-training, or policy-version behavior is changed;
- replay code reads compact persisted activity evidence only;
- no raw FIT bytes, full HR traces, GPS traces, credentials, or sensor serials are persisted by the replay;
- missing fidelity remains `NOT_ASSESSED`, never `UNRELIABLE`;
- assessed `unknown` remains separate from missing assessment;
- per-use authority remains feature-specific;
- vendor Training Load / Training Effect lineage remains fail-closed;
- Firestore access remains user-scoped through the existing activity service;
- the inclusive end date is converted to the existing exclusive range convention with local-calendar date arithmetic.

## Tests added/strengthened in review

The PR now covers, in addition to its original HRF7 tests:

- rate-denominator behavior and zero-safe rates;
- chest-strap vs optical-external distinction;
- no false “useful wrist display” count when no average-HR display candidate exists;
- fallback reason accounting for assessed `unknown`;
- invalid calendar dates;
- reversed replay ranges;
- no Firestore activity read for invalid operator input.

## Remaining boundary

HRF7 provides **observability, not activation evidence**. It does not establish wrist-HR accuracy, per-device reliability, or safe production thresholds.

HRF8 still needs the historical replay and independent prospective paired-reference evidence required by the approved plan. HRF9 production gating must remain blocked until that evidence is reviewed and a separate activation decision is accepted.
