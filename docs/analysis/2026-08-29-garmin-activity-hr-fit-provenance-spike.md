# 2026-08-29 Garmin Activity HR FIT Provenance Spike

## Scope and safety boundary

This is the HRF0 real-account evidence spike for [Activity heart-rate measurement fidelity](../plans/activity-heart-rate-measurement-fidelity.md). It is evidence only: it introduces no runtime, schema, persistence, or recommendation-policy change.

Original activity downloads were decoded only in memory. No FIT file, timestamp, location, activity identifier, serial number, raw HR sample, or account identifier was written to the repository or this report. Activity categories and aggregate results below are intentionally sanitized.

## Environment

- Repository runtime used for the spike: Python 3.12 environment managed by `uv`.
- Installed Garmin Connect client: `garminconnect==0.3.11`.
- The original-download API is `Garmin.download_activity(activity_id, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)`.
- `ActivityDownloadFormat` is nested on `Garmin` in the installed client; importing it from the package root fails. HRF2 must use the installed form rather than a guessed package-level import.
- Official decoder used for the evidence spike: `garmin-fit-sdk==21.214.0`, invoked ephemerally with `uv run --with` and not added to project dependencies.

The official decoder exposes `Stream.from_byte_array` and `Decoder.read`, so decoding can remain in memory. Garmin documents FIT as an extensible binary protocol and publishes Python among its supported SDKs. [FIT SDK overview](https://developer.garmin.com/fit/overview/) [FIT Python SDK](https://github.com/garmin/fit-python-sdk)

## Download behavior

Six originals downloaded successfully: five representative activities from the trailing year and one oldest available activity from 2023. Each response was a ZIP container with exactly one `.fit` member, not a bare FIT file.

The sampled requests completed sequentially without a `429` response. This is not a rate-limit characterization: HRF2 must retain the existing retry/backoff behavior and use bounded pacing rather than infer an unlimited request budget from this small probe.

No unavailable-original, authentication, or server-error response was deliberately induced. Those cases remain unobserved and must be classified explicitly by the future acquisition boundary.

## Sample coverage

| Required case | Observation |
|---|---|
| Road cycling | Observed; FIT has HR, cadence, power, timestamps, laps, and device inventory. |
| Virtual cycling | Observed; FIT has HR, cadence, power, timestamps, and laps. |
| Running | Observed; FIT has HR, cadence, power, timestamps, and laps. |
| Strength | Observed; FIT has HR and timestamps; no FIT lap records in the sample. |
| Soccer / field | Observed; FIT has HR, cadence, timestamps, and one lap. |
| Watch-only HR | Not established. A watch recording device is present, but the FIT records do not prove the winning HR source. |
| Known electrode chest strap | Not established. External device inventory is not proof of a chest strap or of per-sample source. |
| Third-party external HR | Not established. |
| Dynamic Source Switching-capable watch + strap | Not established. |
| Steady cycling / cycling intervals | Not separately classified in this spike. |
| Airbike / high-arm-motion cardio | Not observed. |

## Provenance findings

All five representative files decoded with zero decoder errors. Their `device_info` inventories contained recording-device and accessory entries with `device_index`, device type, manufacturer, product, source type, and software-version fields. Some samples contained non-local ANT+ and Bluetooth Low Energy accessories.

The evidence is inventory evidence only. Across the sampled `record` messages:

- `heart_rate` was present;
- no `device_index` was present;
- no `heart_rate_source` was present;
- event records did not expose a source-switch event field.

Consequently, the spike found no sample-level origin marker and no separate wrist/external HR streams. An activity with an external accessory must remain `mixed_possible` or `unknown` source provenance until another explicit source proof exists. It must not be labelled confirmed external or electrode-chest-strap HR from this inventory alone.

The official decoder also surfaced non-standard/numeric message entries without throwing. HRF2 must retain only recognized fields and ignore unknown/developer data unless a later, reviewed decoder contract assigns it meaning.

## Trace-to-summary reconciliation

The table classifies Garmin Connect summaries against the assessed original FIT stream. A numerical match demonstrates consistency, not identical transformation lineage.

| Summary | Result | Classification | Reason |
|---|---|---|---|
| Activity-list `averageHR` | Exact match to FIT `session.avg_heart_rate` for all five samples | `CONSISTENT_BUT_NOT_PROVEN` | Matching values alone cannot prove that all future activities use the same effective source or transformation. |
| Activity duration | FIT `session.total_timer_time` matched the activity-list duration within sub-millisecond floating-point representation | `CONSISTENT_BUT_NOT_PROVEN` | Confirms a compatible session denominator in these samples, not a universal lineage rule. |
| Lap `averageHR` | Exact per-lap match for road cycling, virtual cycling, running, and soccer | `CONSISTENT_BUT_NOT_PROVEN` | FIT and Garmin Connect returned equal values and counts for these four samples. |
| Strength lap `averageHR` | FIT had no lap records while Garmin Connect returned one split | `NOT_COMPARABLE` | The representations have different segmentation. |
| `hrInZones` | FIT session uses a seven-element `time_in_hr_zone` array; Garmin Connect returned five `secsInZone` buckets, with materially different totals and no demonstrated boundary mapping | `NOT_COMPARABLE` | Do not transfer FIT authority to `hrInZones` until HRF2 defines and verifies a zone-boundary/denominator reconciliation. |

No field earns `VERIFIED_SAME_EFFECTIVE_TRACE` from this spike. HRF4 must carry a summary-compatibility state and preserve `NOT_COMPARABLE` rather than silently attaching the FIT assessment to HR zones or strength splits.

## Decoder decision

### HRF0 evidence decoder

`garmin-fit-sdk==21.214.0` was the technical decoder used for the real-account spike:

- it installed and ran under the spike runtime;
- it decoded all five representative real-account FIT members without errors;
- it exposed `device_info`, `record`, `session`, `lap`, and `time_in_zone` messages needed by the planned boundary;
- it returned structured errors for both a deliberately truncated FIT member and a CRC-mutated FIT member, without raising from the probe call.

The decoder can still emit partial messages alongside an error. HRF2 must treat *any* decoder error as a failed enrichment, discard partial fidelity output, and leave the core activity sync successful with HR measurement state absent/unknown.

The official FIT SDK uses Garmin's FIT Protocol License rather than a conventional permissive open-source license. That made it unsuitable as the repository's default runtime dependency without a separate redistribution/deployment acceptance decision. [FIT Protocol License](https://thisisant.developer.garmin.com/pages/developer/ant/licensing/flexible-and-interoperable-data-transfer-fit-protocol-license/index.html)

### HRF2 runtime decoder follow-up

HRF2 therefore selects `fitdecode==0.11.0` for the shipped runtime boundary. `fitdecode` is MIT-licensed and its 0.11.0 generated profile is based on FIT SDK profile 21.171, which is older than the 21.214 official SDK used for this spike. That distinction is intentional and must remain visible: the official-SDK spike proves the observed account/file semantics, while the runtime library choice is a separate implementation decision.

The runtime boundary consequently stays conservative:

- process only `fitdecode` data frames; definition/header/CRC frames are not evidence rows;
- request optional fields with an explicit fallback because legitimate modality-specific FIT records can omit cadence, power, manufacturer or other fields;
- preserve FIT array fields such as `time_in_hr_zone` as arrays rather than coercing them to scalars;
- use only recognized HRF fields and ignore unknown/developer data unless a later reviewed contract assigns it meaning;
- fail the whole fidelity enrichment on decoder/CRC/resource-boundary errors while preserving the base activity sync;
- bound both original bytes and decoded transient object counts to keep in-memory decoding operationally bounded.

Switching libraries does **not** retroactively prove byte-for-byte or field-for-field parity for the real-account corpus. Before HRF3 output is used as scientific/ship evidence, replay representative account originals through the runtime `fitdecode` path transiently and record only sanitized aggregate parity/errors. Raw originals remain non-persistent and must not be committed as fixtures.

## Vendor load lineage

`activityTrainingLoad` remains vendor-derived, materially HR-dependent evidence by default. Garmin describes Training Load as EPOC-based and Exercise Load as an activity impact score; it must not be used as independent corroboration of an assessed HR trace. [Garmin Training Load support](https://support.garmin.com/en-GB/navionics/faq/SEkNpdGyhR917js0qQL3Q6/)

## HRF2 implementation constraints unlocked by the spike

1. Add an opt-in, bounded original-download wrapper using `Garmin.ActivityDownloadFormat.ORIGINAL`.
2. Accept the observed ZIP-with-one-FIT-member response shape; reject unexpected ZIP layouts safely.
3. Keep byte handling in memory and persist only compact derived evidence after the later HRF4 contract is approved.
4. Treat an unavailable download, malformed ZIP, decoder error, or unknown source provenance as not assessed, never as `UNRELIABLE`.
5. Record device inventory separately from source provenance. No sampled record-level data supports confirmed external source or source-switch reconstruction.
6. Treat session average and the sampled compatible laps as `CONSISTENT_BUT_NOT_PROVEN`; retain explicit `NOT_COMPARABLE` for HR zones and strength splits.
7. Keep `activityTrainingLoad` in the parent HR lineage, not as an independent quality signal.
8. Treat runtime-decoder parity against the sanitized real-account corpus as an explicit validation prerequisite before HRF3-derived evidence contributes to activation decisions.

## Outcome

HRF0 is complete for the available account history. It validates the acquisition shape, conservative source/lineage boundaries, and official-SDK error behavior without changing production recommendations. ADR-0031 is accepted, HRF1's provider-neutral contracts are implemented, and HRF2's default-off target-only acquisition boundary uses MIT-licensed `fitdecode`. The prior FIT-SDK licensing blocker is therefore resolved for runtime implementation; runtime-decoder parity on representative account originals remains an explicit evidence-validation step before HRF3 output can support any ship/no-ship argument.
