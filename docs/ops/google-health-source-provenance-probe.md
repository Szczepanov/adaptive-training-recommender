# Google Health Source-Provenance Probe

This runbook verifies what the user's real Google Health account exposes before the
Multisource Health & Recovery (MS) capability depends on any assumed provider path.

It is deliberately a **probe**, not an implementation guide.

The output belongs in a new dated analysis document. Do not rewrite this runbook with one
athlete's results.

---

## 1. Objectives

Answer:

1. Can the application authorize Google Health with minimum read-only scopes?
2. Which recovery data types are present?
3. Does raw data preserve the original source application?
4. Does Garmin-origin data appear?
5. Does Eight Sleep-origin data appear?
6. Which Eight Sleep metrics appear, if any?
7. How do timestamps map to `Europe/Warsaw` dates?
8. How long after device/app sync does data become queryable?
9. Does raw `list` differ materially from `reconcile`?
10. Can direct Garmin and Google-transported Garmin be matched without ambiguity?

---

## 2. Safety / privacy rules

Do not commit raw health payloads.

Do not commit:

- Google OAuth access/refresh tokens;
- health user ID if considered sensitive in project fixture policy;
- account email;
- precise bedtime/wake timestamps from the real account;
- device serial numbers;
- full package/device metadata if not required;
- location;
- raw heart-rate sample series.

Evidence committed to the repository must be reduced to the minimum structure necessary to
support the conclusion.

Prefer synthetic replacements for values while retaining real field names/source categories.

---

## 3. Phone-side pre-check

On Android, open Health Connect and inspect connected apps / data permissions.

For Garmin Connect, confirm Health Connect sharing is enabled.

Garmin documents one-way export from Garmin Connect to Health Connect on supported Android
versions.

Check whether Eight Sleep is listed as a Health Connect-connected app.

This UI check is **not enough** to conclude export direction. It only establishes that an
integration relationship exists.

Record:

```text
Garmin connected? yes/no
Garmin write categories visible: [...]
Eight Sleep connected? yes/no
Eight Sleep write categories visible: [...]
Eight Sleep read categories visible: [...]
```

If the UI distinguishes read and write permissions, record them separately.

---

## 4. Google Cloud setup

Use a dedicated development/test OAuth client.

Enable the Google Health API.

Configure the OAuth consent screen with the minimum required read-only scopes.

Initial target scopes:

```text
https://www.googleapis.com/auth/googlehealth.sleep.readonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
```

Do not request write scopes.

Do not request activity/fitness scope unless the probe specifically needs an activity data type.

Official scope reference:

https://developers.google.com/health/scopes

---

## 5. Obtain authorization

Use the repository's eventual connection flow or, before code exists, Google's documented OAuth
testing tools/codelab.

The probe must end with:

- an access token usable for Google Health;
- a refresh path appropriate to the chosen test setup;
- the granted-scope set recorded;
- no token written into committed files.

If the consent screen is in Testing mode, note any token-lifetime constraints that may affect a
multi-day latency probe.

---

## 6. Resolve Google Health identity

Call the Google Health identity endpoint while authorized and record the returned
`healthUserId` only in local secure probe state.

The purpose is to map webhook/source records later; it is not an athlete-facing identifier.

Reference:

https://developers.google.com/health/reference/rest/v4/users/getIdentity

---

## 7. Query raw data first

Use:

```text
GET https://health.googleapis.com/v4/users/me/dataTypes/{dataType}/dataPoints
```

Do **not** begin with `:reconcile`.

Target candidate data types based on current API support and granted scopes.

At minimum inspect sleep and the available HRV/resting-HR/respiration families.

For each returned data point, inspect `dataSource.application.packageName` (or equivalent package identifier in the response) and reduce/record:

```json
{
  "dataType": "...",
  "intervalKind": "...",
  "source": {
    "applicationPackage": "...", // extracted from dataSource.application.packageName
    "platform": "...",
    "recordingMethod": "..."
  },
  "hasStableSourceRecordIdentity": true,
  "hasDeviceMetadata": true,
  "valueShape": "scalar|session|summary|samples"
}
```

Do not retain real physiological values in the committed probe evidence unless a value is
necessary for an equivalence claim; if needed, transform/sanitize it.

---

## 8. Build the source matrix

Create a local table:

| Data type | Garmin source seen | Eight Sleep source seen | Other source | Notes |
|---|---:|---:|---|---|
| sleep | | | | |
| HRV | | | | |
| resting HR | | | | |
| heart rate | | | | |
| respiration | | | | |
| sleep respiration summary | | | | |
| sleep temperature derivation | | | | |

Do not infer `provider` from value shape. Use source application metadata.

Unknown packages remain unknown until verified.

---

## 9. Garmin transport-equivalence probe

Pick several dates/nights for which direct Garmin data already exists.

For each overlapping metric compare:

```text
direct Garmin value/timestamp/date
Google Health raw record with Garmin origin
```

Record:

- exact equality or numeric delta;
- timestamp delta;
- logical-date mapping;
- stage-duration delta;
- whether one route is missing;
- whether one route updates later;
- whether multiple Google records correspond to one direct record.

Use at least:

- normal night;
- night with unusual wake time if available;
- one date around midnight/local-date edge if available;
- one day after a device resync/correction if naturally observed.

No need to manufacture bad health data.

---

## 10. Eight Sleep export-direction probe

The critical test is source provenance for the **required recovery metric set**:
- `sleep_session` / sleep duration
- `sleep_stages` (deep, rem, light, awake)
- `hrv_rmssd_ms` (overnight HRV)
- `sleeping_heart_rate_bpm` / `daily_resting_heart_rate_bpm`
- `respiration_rate_brpm` (sleeping respiration)

### Full Pass condition

**All** required recovery metrics appear in raw Google Health data with verified Eight Sleep source provenance (`dataSource.application.packageName == "com.eightsleep.eightsleep"` or equivalent verified package).

### Partial Pass condition

**At least one, but not all**, required recovery data types appear with Eight Sleep provenance. Record exactly which metrics are present and which are missing to inform the hybrid transport decision in MS11.

### Fail condition

**None** of the required Eight Sleep-origin records appear despite:

- Health Connect linkage being enabled;
- the Pod having a completed night;
- Eight Sleep app sync completing;
- sufficient Google Health polling delay;
- correct scopes.

A fail result means:

> Do not design Eight Sleep acquisition around Google Health.

It does **not** mean Google Health is useless for the project.

---

## 11. Raw vs reconciled comparison

For a small set of overlapping dates, query:

```text
raw list
```

and:

```text
dataPoints:reconcile
```

Compare:

- number of source records;
- whether original-source disagreement disappears;
- sleep-session boundaries;
- aggregate values;
- whether reconciled result can still be traced to source records sufficiently for audit.

Expected design use:

```text
recovery science → raw
display/general aggregate → reconcile only if beneficial
```

The probe verifies rather than assumes this.

---

## 12. Latency measurement

For at least several nights/days, record approximate times:

```text
device/app sync completed
Health Connect record visible (if observable)
Google Health raw API record visible
```

Compute:

```text
Garmin → Google Health latency
Eight Sleep → Google Health latency (if path exists)
```

Use rounded minutes in committed evidence.

This determines the repair-sync lookback and whether the source is available early enough for a
morning recommendation.

---

## 13. Date/time semantics

For each session-like data type, inspect:

- physical UTC interval;
- civil/local interval if supplied;
- source timezone metadata if supplied;
- desired `Europe/Warsaw` logical recovery date.

Verify DST-sensitive behavior if the project later reaches a DST transition; do not invent a
result before then.

The application must continue to obey ADR-0003.

---

## 14. Duplicate and revision behavior

Repeat the same query multiple times.

Then repeat after device/app resync if possible.

Determine:

- stable record ID present?
- same ID with changed value?
- delete/recreate behavior?
- duplicate records with same source interval?
- one source record split into multiple API points?

These results determine MS2 idempotency rules.

---

## 15. Optional webhook probe

Only after raw polling works.

Register a development subscriber according to Google Health webhook documentation.

Verify:

1. endpoint verification with authorization succeeds;
2. unauthorized verification request is rejected;
3. notification authorization is validated;
4. Google signature is verified;
5. duplicate notification is safe;
6. notification can be mapped from `healthUserId` to local account;
7. worker queries the affected interval instead of trusting the webhook as the health payload.

Do not put full health data in queue/log payloads.

Reference:

https://developers.google.com/health/webhooks

---

## 16. Evidence artifact

Create:

```text
docs/analysis/YYYY-MM-DD-google-health-source-provenance-probe-results.md
```

Recommended sections:

```markdown
# Google Health Source-Provenance Probe Results (YYYY-MM-DD)

## Environment
## Scopes granted
## Data types observed
## Source application matrix
## Garmin direct-vs-Google equivalence
## Eight Sleep result
## Raw-vs-reconciled differences
## Latency
## Date/time behavior
## Duplicate/revision behavior
## Security/operational findings
## Decision impact on MS plan
## Sanitization statement
```

---

## 17. Decision matrix after the probe

| Result | MS plan action |
|---|---|
| Garmin present, Eight Sleep fully present | Google Health can be preferred Eight Sleep transport; keep Garmin direct |
| Garmin present, Eight Sleep partially present | hybrid Eight Sleep decision by metric |
| Garmin present, Eight Sleep absent | keep Google Health generic; evaluate MS18 only if justified |
| Garmin source metadata ambiguous | do not use Google route for source-specific baselines until resolved |
| Google Health latency too slow for morning decision | keep as shadow/backfill source only |
| Google transform differs from direct Garmin | keep transport-separated observations |
| Google route equivalent to Garmin direct | eligible for dedup/fallback after evidence |

---

## 18. Exit criteria

Probe is complete only when:

- source application provenance is observed and recorded;
- Eight Sleep export direction is empirically classified;
- Garmin transport behavior is classified;
- minimum viable scopes are known;
- date semantics are understood;
- duplicate/revision behavior is understood enough for MS2;
- latency is measured;
- sanitized evidence is published;
- MS plan is updated accordingly.

No engine change is part of this runbook.
