# Phase 9.4 — subjective history integration

Date: 2026-08-16

This note records the implementation boundary for ADR-0020 D-SUBJHIST / D-SUBJPURE.

## Data path

1. `DecisionComposer` requests one bounded subjective-history range for the reference estimator's long window.
2. `CheckinService.getCheckinsInRangeState` queries a half-open range `[D-28, D)`; the decision date is never fetched.
3. Every returned Firestore row is parsed with `parseSubjectiveCheckin`, including path ownership and date identity. Invalid rows are excluded and surfaced as `DataIssue`s rather than coerced into neutral observations.
4. `computeSubjectiveBaseline` receives only the validated rows. Sparse history returns `null` under the estimator's independent recent/long coverage gates.
5. Raw historical rows remain local to the composition function. The returned composed input exposes only the normalized `SubjectiveBaseline`, a compact history state/revision, and bounded `DataIssue`s; debug/export helpers therefore do not duplicate the raw history array.
6. The transient derived baseline is attached to today's `DailyReadiness` before `evaluateTrainingWithIntent` is called. Recommendation persistence/audit does not receive raw historical rows.

## Failure semantics

- empty/sparse history -> no baseline;
- invalid-only history -> no baseline;
- partially malformed history -> valid rows may still mature a baseline and the malformed rows remain visible as compact `DataIssue`s;
- query/permission failure -> no baseline;
- today's ordinary check-in and absolute safety logic continue normally in all of the above cases.

The subjective-drift selector remains production-default `'off'`, so Phase 9.4 changes no persisted recommendation decision and does not bump `POLICY_VERSION`.

## Forecast boundary

The baseline computed for date `D` is **not** reused for tomorrow or the week-ahead path. A valid tomorrow baseline has `historyThroughDateExclusive = D+1` and may include date `D`; reusing today's baseline would silently violate the temporal contract once drift is enabled. Forecast integration therefore remains an explicit later decision rather than being approximated here.
