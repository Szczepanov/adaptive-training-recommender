# HRF8 Bounded Replay and Decoder Qualification

**Date:** 2026-08-29
**Scope:** bounded, read-only HRF8 evidence run against real-account activity originals
**Evidence status:** partial D-HRF-DECODER qualification plus a bounded replay smoke check
**Decision posture:** no ship; HRF remains shadow-only
**Repository code baseline reviewed here:** `5ebea4f93146386359103be49f73a49e3f42e8ca` (the PR base; the bounded run did not record a separate execution commit SHA)

## Scope and privacy boundary

The operator ran a bounded 42-day query, which listed 36 activities. One available
original was selected from each of seven distinct activity classes, so 7 of the 36 listed
activities (19.4%) were replayed. Original downloads were decoded only in memory and
discarded per activity. This report records only aggregate counts and structural decoder
comparisons: it contains no FIT bytes, HR sample arrays, GPS, timestamps, activity IDs,
owner IDs, sensor serials, or credentials.

This was a coverage-oriented convenience sample, not a random sample and not a
prevalence-estimating cohort. The committed aggregate report does not retain the seven
class labels or the denominator of activities for which an original download was
available. Consequently it cannot independently demonstrate class stratification,
original-FIT availability, or population coverage. Those are evidence limitations, not
negative findings.

The sample is useful for reducing decoder-risk and locating obvious replay behavior. It
is not a calibrated accuracy study, a complete HRF8 historical replay, a prevalence
estimate, or a substitute for the independent paired-reference evidence required by
ADR-0031.

## Runtime/reference decoder qualification

The runtime decoder was `fitdecode 0.11.0`, whose generated FIT profile is based on
FIT SDK profile `21.171.0`. The ephemeral reference decoder was
`garmin-fit-sdk 21.214.0`; it was invoked outside the normal dependency graph and was
not added to `pyproject.toml` or the shipped image. Recording both decoder versions and
profile generations is required by D-HRF-DECODER because the runtime profile is older
than the vendor reference profile.

All seven selected originals decoded successfully under both decoders. The bounded
comparison recorded the following results. Here, `7 / 7 match` means both decoders agreed
on the comparison that was actually recorded; it does **not** mean every optional field
was present in every file or record.

| HRF-consumed surface | Bounded comparison | Qualification status | Limitation |
|---|---:|---|---|
| record data-frame count | 7 / 7 match | covered for count | no value-level trace equivalence claim |
| HRF-relevant message cardinality | only selected device/timer/lap counts or presence were retained | partial | complete per-message cardinality parity, including session multiplicity, was not retained |
| HR/cadence/power sample presence | 7 / 7 match for each field | partial | aggregate non-null coverage/value parity was not retained |
| device-inventory entry count | 7 / 7 match | partial | source-reasoning field values (`device_index`, manufacturer, product, device type, source type) were not retained as a parity result |
| timer-event count | 7 / 7 match | partial | event-state sequence and timestamp ordering/window parity were not retained |
| session average HR presence/value | 7 / 7 match | covered | numerical equality does not prove upstream summary lineage |
| lap average-HR count | 7 / 7 match | partial | per-lap average-HR value parity was not retained |
| session-scoped HR-zone arrays | 7 / 7 match | covered for the compared arrays | summary compatibility remains a separate lineage question |
| decode/CRC failure classification | not exercised in this healthy-file comparison | open | strict runtime failure behavior is tested separately; cross-decoder failure-class parity was not established here |

The zone comparison initially appeared to disagree when only the official SDK's
`session_mesgs` was inspected. Six of seven files expose the session-scoped zone array
through `time_in_zone_mesgs` instead. Applying the same session-scoped fallback as
`fit_activity.py` reconciled all seven. This is an API-shape observation, not a new
source-lineage claim.

No disagreement was observed on the comparisons actually performed. However, the prior
report overstated that result by calling the complete HRF-consumed decoder surface
qualified. Counts alone cannot establish semantic parity for device fields that drive
source reasoning, timer state that defines active analysis windows, session multiplicity,
or lap values used in summary reconciliation. This bounded run therefore provides
**partial decoder qualification evidence**, not complete D-HRF-DECODER qualification.

Before this decoder qualification is treated as complete for HRF8 activation evidence, a
future transient comparison should additionally record sanitized equality results for:

1. recognized HRF-relevant message counts, including session multiplicity;
2. non-null HR/cadence/power sample counts and aggregate coverage;
3. non-identifying device-source tuples used by HRF source reasoning;
4. timer event-type/state sequence and ordering/window semantics without persisting exact timestamps;
5. per-lap average-HR values, not only lap counts;
6. session-scoped zone-array shape and values;
7. decoder failure classification on controlled truncated/CRC-invalid synthetic inputs;
8. the selection rule, sanitized activity classes, original-download availability denominator,
   runtime commit, decoder versions, and profile generations.

Qualification must also be repeated after a material runtime decoder/profile change or
before HRF begins consuming a new FIT field whose semantics depend on a newer profile.

## Bounded historical replay smoke check

Running `assess_activity_hr_fidelity` over the same seven transient originals produced:

| Measure | Result |
|---|---:|
| assessable traces | 6 |
| partially assessable traces | 1 |
| moderate-confidence traces | 6 |
| unreliable traces | 1 |
| dropout artifact flags | 1 |
| `mixed_possible` source classifications | 3 |
| `unknown` source classifications | 4 |

All seven activity-list `averageHr` values were numerically within 1 bpm of the
FIT-derived session average. This is recorded as **consistent but unproven**, not
`verified_same_effective_trace`: a numerical match cannot establish that every existing
summary, lap, zone array, or vendor metric descends from the assessed effective trace.
The existing fail-closed `summaryCompatibility` behavior therefore remains correct.

The single unreliable/dropout result is a manual-review candidate. This aggregate run
does not expose raw traces, so it does not claim a false-positive determination.

This seven-activity smoke check does **not** satisfy the plan's full historical replay
requirements. In particular, it does not report the required stratification by source
evidence, motion risk, intensity, recording-device period and summary compatibility; it
does not quantify original-FIT/unknown-assessment coverage across the 42-day cohort; and
it does not yet report per-use authority changes, affected downstream features, or manual
false-positive review. HRF8 therefore remains open.

## Paired-reference evidence

No independently recorded wrist-versus-electrode-chest-strap session manifest was
available in this workspace. Consequently there is no valid paired accuracy result, no
alignment analysis, and no personal/device reliability claim.

Per ADR-0031 `D-HRF-REFERENCE`, a Garmin activity that might dynamically substitute the
connected strap into the watch stream is not an independent wrist/reference pair. A
future included session must document its recording arrangement, source-switching
protection, clock synchronization, shared analysis window, pause handling, resampling
rule, and alignment uncertainty before it is analysed. Samples lacking that evidence are
rejected rather than treated as supportive agreement.

## Activation recommendation

**Do not activate HRF authority in production.** The bounded partial decoder-parity
evidence and replay smoke check support continued shadow observability only. HRF9 remains
blocked until complete D-HRF-DECODER qualification is recorded for the replayed semantic
surface, a wider stratified historical replay and manual review are complete,
independently recorded paired-reference evidence exists for the activation scope, and a
separate activation decision accepts the resulting evidence.

## Follow-up

1. Complete the missing decoder-semantic checks listed above while keeping all real FIT
   bytes and identifying values transient.
2. Run the wider stratified historical replay required by the approved HRF plan, including
   original-FIT availability/unknown-assessment coverage and per-use authority deltas.
3. Review the bounded replay's unreliable/dropout case without retaining its raw trace in
   Firestore or the repository.
4. Collect representative, independently recorded wrist/reference sessions using the
   protocol in [the approved HRF plan](../plans/activity-heart-rate-measurement-fidelity.md).
5. Repeat the decoder qualification whenever the runtime decoder/profile or the consumed
   field surface materially changes.
