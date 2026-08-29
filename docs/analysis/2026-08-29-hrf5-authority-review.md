# HRF5 authority-engine review — 2026-08-29

## Scope

Deep review of PR #289 (`feat(hrf): add shadow HR evidence authority`) against:

- the accepted HRF5 policy table in `docs/plans/activity-heart-rate-measurement-fidelity.md`;
- ADR-0031's evidence-authority, lineage, use-case and shadow-mode invariants;
- the HRF0 real-account FIT/summary reconciliation spike;
- the HRF3 deterministic trace classifier;
- the HRF4 persistence/read contract.

The review intentionally ignores lint/static-analysis-only findings and focuses on decision-authority correctness, fail-closed behavior, test realism, and future HRF6 integration safety.

## Findings fixed

### 1. High trace confidence was incorrectly sufficient for context-sensitive authority

The original helper returned `ALLOWED` for high-confidence aerobic decoupling, interval response, max-HR updates and threshold-HR updates once activity-level summary compatibility passed.

That was weaker than the approved HRF5 table. The table additionally requires:

- decoupling: valid segment + lineage;
- interval response: valid segment + lineage;
- max HR: peak/context + lineage;
- threshold HR: protocol/context + lineage.

HRF3 cannot know which downstream interval, segment, peak or protocol a future consumer selected. Claiming `ALLOWED` without caller-supplied evidence therefore turned an unverified prerequisite into an implicit success.

**Fix:** `getHrUseAuthority(...)` now accepts optional `HrUseAuthorityContext`. Missing feature context fails closed. The argument remains optional so HRF5 stays source-compatible and shadow-only; sensitive calls without HRF6 adapter evidence are blocked rather than authorized.

### 2. Child metrics could borrow authority from an activity-wide summary scalar

ADR-0031 P-HRF-11 requires HR-derived child features to inherit parent-trace authority only when their own lineage is established.

HRF0 demonstrated why this matters:

- activity-list average HR was numerically consistent with FIT session average HR but not proven identical in lineage;
- lap HR was consistent for sampled cycling/running/soccer but strength segmentation differed;
- Garmin Connect `hrInZones` was not comparable with the FIT session zone array;
- `activityTrainingLoad` is materially HR-derived vendor evidence and is not independent corroboration of the assessed trace.

The original helper treated one `summaryCompatibility` scalar as sufficient for every summary-derived use. That creates a future footgun: a compatibility result established for one representation can accidentally authorize another child metric.

**Fix:** lineage-sensitive use cases additionally require `inputLineageVerified: true` from the eventual HRF6 consumer adapter. The persisted `summaryCompatibility` remains a conservative guard:

- explicit `discordant` always blocks and cannot be overridden;
- broad unknown/unverified compatibility blocks unless the exact consumed input was independently audited and marked verified;
- a broad `verified_same_effective_trace` value does not, by itself, prove which child metric a caller selected.

This keeps HRF5 generic while making the exact consumer/field audit an explicit HRF6 responsibility.

### 3. Moderate confidence was reported as `LOW_MEASUREMENT_CONFIDENCE`

For sensitive use cases, the original implementation blocked moderate-confidence evidence with the reason `LOW_MEASUREMENT_CONFIDENCE`.

The status was conservative, but the reason was factually wrong and would corrupt shadow observability/replay analysis.

**Fix:** `MODERATE_MEASUREMENT_CONFIDENCE` is now distinct. The status table remains unchanged: moderate evidence is bounded for zones/load/interval/compliance, blocked for decoupling/max-HR/threshold-HR, and observational at most for health anomaly.

### 4. The high-confidence fixture did not represent a state HRF3 can produce

The original test fixture combined:

```text
measurementConfidence = high
sourceForActivity = unknown
provenanceConfidence = unknown
sensorTechnology = unknown
```

HRF3 only promotes a clean trace from `moderate` to `high` when source evidence is confirmed external, technology is `electrode_chest_strap`, and coverage is at least 95%. Unknown/ambiguous provenance is capped at moderate.

The fixture therefore tested a synthetic state that the current producer cannot emit.

**Fix:** the default high-confidence test evidence now uses a confirmed external electrode chest strap with clean, high-coverage data. A deliberately inconsistent high-confidence + isolated-spike case remains only as defense-in-depth for feature-specific authority; a second test covers the realistic HRF3 low-confidence + spike output.

## Resulting authority contract

`hrMeasurement` continues to own activity-level technical evidence: source/provenance, motion risk, coverage/gaps, signal quality, global measurement confidence, broad summary compatibility, artifact flags and diagnostic version.

`HrUseAuthorityContext` owns facts that cannot safely be inferred by the activity-level classifier:

| Context field | Meaning | Required by |
|---|---|---|
| `inputLineageVerified` | exact HR-derived input used by the consumer is proven to descend from the assessed trace | zones, load, decoupling, intervals, max HR, threshold HR |
| `segmentContextVerified` | selected analysis segment/window is valid for the inference | decoupling, interval response |
| `peakContextVerified` | candidate peak has valid physiological/workout context beyond artifact screening | max-HR update |
| `thresholdProtocolVerified` | candidate comes from an accepted threshold protocol/context | threshold-HR update |
| `healthAnomalyCorroborated` | independent HA evidence corroborates the HR observation | health anomaly |

All fields default to unverified. HRF6 must prove the condition at the adapter boundary rather than HRF5 guessing it.

## Policy implementation improvements

The use-case/confidence matrix is now a typed `Record<HrUseCase, HrUsePolicy>` rather than a permissive final branch. Adding a new `HrUseCase` therefore requires a corresponding policy entry at compile time.

Feature-specific artifact logic remains independent of the global confidence label. `ISOLATED_SPIKE` blocks max-HR authority while not automatically blocking passive average display. When HRF3 has already downgraded the trace because of the spike, HRF5 retains both the global low-confidence reason and the peak-specific reason for explainability.

Health-anomaly behavior now represents the policy intent explicitly:

- high + independent corroboration: allowed by the shadow HRF5 policy;
- high without corroboration: observational;
- moderate: observational at most, even with corroboration;
- low/unreliable/unknown: blocked.

This remains evidence authority, not diagnosis.

## Test coverage added

The revised tests cover:

1. every use case at high confidence with all required context;
2. the full moderate-confidence policy matrix;
3. missing exact-input lineage;
4. missing segment, peak and threshold-protocol context;
5. broad unknown lineage vs exact audited input lineage;
6. discordant lineage as a non-overridable failure;
7. absent vs unknown vs unreliable vs low measurement evidence;
8. realistic HRF3 isolated-spike behavior;
9. workout-compliance independence from summary lineage;
10. health corroboration and the moderate-confidence ceiling;
11. stable policy-version output.

## Deliberate non-changes

This review does not:

- wire any production recommendation/readiness/compliance/health consumer;
- change the live recommendation `POLICY_VERSION`;
- duplicate HRF3 trace-quality scoring in TypeScript;
- infer sensor provenance from accessory presence;
- treat Garmin training load as independent corroboration;
- activate HRF before HRF8 replay/paired-reference evidence and a separate ship decision.

The next integration step remains HRF6: audit the exact field/derivation consumed by each HR feature and construct the corresponding `HrUseAuthorityContext` at a centralized adapter boundary.
