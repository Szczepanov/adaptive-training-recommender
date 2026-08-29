# HRF8 Bounded Replay and Decoder Qualification

**Date:** 2026-08-29
**Scope:** bounded, read-only HRF8 evidence run against real-account activity originals
**Decision posture:** no ship; HRF remains shadow-only

## Scope and privacy boundary

The operator ran a bounded 42-day query, which listed 36 activities. One available
original was selected from each of seven distinct activity classes. Original downloads
were decoded only in memory and discarded per activity. This report records only
aggregate counts and structural decoder comparisons: it contains no FIT bytes, HR sample
arrays, GPS, timestamps, activity IDs, owner IDs, sensor serials, or credentials.

The sample is useful for qualifying the currently consumed decoder surface and locating
obvious replay behavior. It is not a calibrated accuracy study, a prevalence estimate, or
a substitute for the independent paired-reference evidence required by ADR-0031.

## Runtime/reference decoder qualification

The runtime decoder was `fitdecode 0.11.0`. The ephemeral reference decoder was
`garmin-fit-sdk 21.214.0`; it was invoked outside the normal dependency graph and was
not added to `pyproject.toml` or the shipped image.

All seven selected originals decoded successfully under both decoders. The comparison
used the exact HRF-consumed semantic surface from `fit_activity.py`:

| Surface | Matching originals | Result |
|---|---:|---|
| record count | 7 / 7 | match |
| HR, cadence and power sample presence | 7 / 7 each | match |
| device-inventory entry count | 7 / 7 | match |
| timer-event count | 7 / 7 | match |
| session average HR presence/value | 7 / 7 | match |
| lap average-HR count | 7 / 7 | match |
| session-scoped HR-zone arrays | 7 / 7 | match |

The zone comparison initially appeared to disagree when only the official SDK's
`session_mesgs` was inspected. Six of seven files expose the session-scoped zone array
through `time_in_zone_mesgs` instead. Applying the same session-scoped fallback as
`fit_activity.py` reconciled all seven. This is an API-shape observation, not a new
source-lineage claim.

For this bounded sample, no decoder disagreement capable of changing HRF provenance,
quality, timer windows, summary compatibility, or authority was observed. Qualification
must be repeated after a material runtime decoder/profile change or before consuming a
new FIT field.

## Historical HRF replay

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

## Paired-reference evidence

No independently recorded wrist-versus-electrode-chest-strap session manifest was
available in this workspace. Consequently there is no valid paired accuracy result,
no alignment analysis, and no personal/device reliability claim.

Per ADR-0031 `D-HRF-REFERENCE`, a Garmin activity that might dynamically substitute the
connected strap into the watch stream is not an independent wrist/reference pair. A
future included session must document its recording arrangement, source-switching
protection, clock synchronization, shared analysis window, pause handling, resampling
rule, and alignment uncertainty before it is analysed. Samples lacking that evidence are
rejected rather than treated as supportive agreement.

## Activation recommendation

**Do not activate HRF authority in production.** The bounded decoder qualification and
historical replay support continued shadow observability only. HRF9 remains blocked until
there is independently recorded paired-reference evidence, the unreliable/dropout case
is manually reviewed, and a separate activation decision accepts the resulting evidence.

## Follow-up

1. Collect representative, independently recorded wrist/reference sessions using the
   protocol in [the approved HRF plan](../plans/activity-heart-rate-measurement-fidelity.md).
2. Review the bounded replay's unreliable/dropout case without retaining its raw trace
   in Firestore or the repository.
3. Rerun the decoder qualification and a wider stratified historical replay when the
   paired-reference corpus is available.
