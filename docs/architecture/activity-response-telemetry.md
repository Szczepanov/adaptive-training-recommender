# Multi-resolution activity response telemetry

Issue #850 adds a bounded observation layer between native wearable traces and context-brief
response features. It is an observability/display architecture only. It does not alter
recommendation selection, readiness gates, training load, or POLICY_VERSION.

## Resolution model

Resolution is signal- and feature-specific. There is no global activity resolution.

1. **Source resolution** is the observed cadence of a usable signal in the decoded original
   FIT trace. Power, heart rate and cadence are estimated independently from timestamped
   samples. Missing or sparse signals retain an unknown resolution.
2. **Analysis resolution** is selected by the feature. Examples: 1/5/10-second windows for
   sprint response, work-step duration plus thirds for threshold/VO2 repeatability, and
   deterministic halves for steady endurance response.
3. **Export resolution** is semantic and bounded. Raw samples never cross the ingestion
   boundary. Standalone activity documents contain compact segment/session evidence only.

A feature is omitted when source cadence is too coarse for its analysis window. The system
does not interpolate a 1-second or 5-second peak from a 10-second source.

## Identity hierarchy

Segment identity uses the strongest available evidence, in this order:

1. reconciled Adaptive-authored occurrence/step, when an exact execution link exists;
2. FIT Workout Step definition plus performed Lap/Record workout-step linkage;
3. manual lap;
4. deterministic detected segment;
5. insufficient evidence.

The current implementation delivers FIT-step and manual-lap tiers. Reconciled authored
step identity remains a future integration with ADR-0034 occurrence reconciliation.
Detected segments are not manufactured merely from a workout fingerprint.

A FIT workout fingerprint is session identity evidence only. It does not prove which lap is
work, recovery, warm-up or cooldown. Garmin FIT Workout Step intensity and executed
workout-step linkage provide that semantic role.

## Ingestion boundary

The existing optional original-FIT acquisition path decodes Records, Workout Steps and
Laps in memory. Issue #850 extends that transient evidence with compact Lap timing,
performed workout-step linkage and lap summary values. Normal live sync derives the response
from the same original-FIT acquisition already used by HR-fidelity enrichment, so it adds no
second request for an activity.

Historical documents created before this response schema can be enriched explicitly with
`uv run python -m garmin_sync backfill-activity-response`. That operator command necessarily
makes one paced original-FIT request per qualifying historical activity because the raw FIT
trace was deliberately never persisted. It runs under the same per-user Garmin execution
lease as other Garmin operations, uses the configured backfill pacing, persists refreshed
token state on every exit path, and returns failure on rate-limit/processing failures. It is
not part of scheduled daily ingestion.

While the native trace is still in memory, activity_response.py derives:

- signal-specific source resolution;
- at most 64 semantic segment summaries;
- fixed power-duration peaks at 1 s, 5 s, 10 s, 30 s, 60 s, 3 min, 5 min and 20 min when
  source cadence supports each window; the 1-second peak remains moderate-confidence at a
  common 1 Hz source cadence because it is a single-record, sampling-sensitive statistic;
- one deterministic first/second-half summary for sessions long enough to support it.

The native records are then discarded. They are not written to Firestore, logs, context
briefs or raw activity-detail archives.

## Persisted contract

activityResponse is additive on the standalone activity document:

- derivationVersion;
- sourceResolution.powerSeconds / hrSeconds / cadenceSeconds;
- segmentCountTotal and segmentsTruncated;
- segments[];
- powerDurationPeaks[];
- optional steadyHalves.

A segment retains prescription and execution separately:

- semantic type and identity source;
- start offset and duration;
- prescribed target;
- performed average power plus supported 1/5/10-second peaks;
- average/end/max HR;
- average/max cadence;
- first/middle/last-third power and final-third HR;
- evidence confidence.

The segment array is capped at 64. The MMP family is fixed-size. Historical activity
documents without activityResponse degrade to the existing lap/session summary path.

## Read-side hydration and athlete UI

`trainingHistory.ts` treats `activityResponse` as one optional evidence sidecar. The base
normalized activity remains available when the sidecar is absent or malformed, but the sidecar
itself is accepted only when its derivation version is supported and its required shape plus any
present nested evidence are internally valid. Unknown future derivation versions, invalid
source-resolution fields, segment fields, prescribed targets, power-duration
metadata, count/truncation bookkeeping, or steady-half values cause the complete
`activityResponse` sidecar to be omitted rather than partially hydrating provenance that no
longer matches the persisted contract.

`ActivityTelemetry` exposes the capability badge in the recent-activity card and keeps the
dense evidence behind a native `details` / `summary` disclosure. The expanded diagnostic view
shows source cadence and derivation provenance, fixed MMP windows with confidence and activity-half
context, steady-half summaries, semantic segment identity, prescribed-versus-performed telemetry,
within-segment response and evidence confidence. Wide segment evidence remains inside a local
horizontal-scroll container on narrow screens; it must not create page-level horizontal overflow.

Recent-activity JSON export preserves the hydrated sidecar unchanged, and the context-brief
consumer receives the same normalized activity object. This remains observational evidence:
hydration, display and export do not grant the sidecar recommendation, readiness, load or safety
authority.

## Context-brief consumers

contextBriefResponseFeatures.ts consumes semantic work/sprint segments before any lap
heuristic:

- long intervals, 4x4 and microintervals can be represented by executed step semantics;
- equal-duration recovery is not confused with work because role comes from the workout
  step definition;
- repeated 10-second sprints use short-window power and cadence; HR is not used to classify
  sprint quality;
- threshold/VO2 summaries may include within-repetition thirds and final-third HR, subject
  to the existing HR-fidelity authority;
- steady decoupling can use deterministic continuous halves before falling back to lap
  averages.

For legacy activities without semantic segments, the issue #814 >=120-second relative-power
lap heuristic remains available for tempo/threshold/VO2/anaerobic sessions. A workout
fingerprint alone no longer upgrades race/auto-laps into interval identity.

Planning export is bounded: repetition lists are capped, only selected 5-second/1-minute/
5-minute MMP values are included in compact activity lines, and semantic summaries replace
the raw lap digest when available. Diagnostic export can show all persisted semantic
segments and fixed MMP windows, but still never contains native samples.

All HR use continues through activityHrFidelity.ts. New segment-level HR does not create a
new HR authority or bypass measurement-quality gating.

## Resolution-preservation harness

activity_response.py exposes a deterministic calibration harness for candidate resolutions:

1 s, 2 s, 5 s, 10 s, 15 s, 30 s, 60 s, 120 s, 300 s and 600 s.

Two calibration levels are available:

- a signal-only MMP harness for synthetic power traces;
- an activity-feature harness that downsamples the transient record stream, re-derives the
  bounded response object, and compares the feature family actually present.

Structured work evaluates interval mean power (<=1% error), first-to-last fade (<=1
percentage point), power thirds (<=1.5%), average HR (<=1 bpm) and end HR (<=2 bpm).
Structured sprint evaluates mean/full-rep power and 5-second peak power (<=2%), peak cadence
(<=2 rpm) and last-vs-best fade (<=1 percentage point). Unstructured/steady evidence uses
the fixed MMP family and first-vs-second-half Pw:HR decoupling (<=1 percentage point).
These are engineering preservation tolerances from issue #850, not physiological thresholds.

Every candidate reports each feature as:

- preserved;
- degraded;
- feature unavailable at the candidate resolution; or
- source insufficient at the native resolution.

Source insufficiency is excluded from the candidate pass-rate denominator. The default
acceptance criterion is at least 95% preservation of source-supported features, and
`coarsest_preserving_resolution` exposes the coarsest candidate meeting that gate for
calibration reports. This harness is evaluation infrastructure; it does not dynamically
change recommendation policy or persist a downsampled raw trace.

## Boundaries and non-goals

This work does not:

- persist raw 1 Hz traces;
- make every session use the same resolution;
- treat auto-laps as semantic workout steps;
- establish physiological thresholds, W-prime, critical-power or durability models;
- use MMPs as recommendation authority;
- alter training policy or POLICY_VERSION.

Any future use of these derived values in recommendation selection requires a separate
policy review, evidence registration and simulation/drift verification.
