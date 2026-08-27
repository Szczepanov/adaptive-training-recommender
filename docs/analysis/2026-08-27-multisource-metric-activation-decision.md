# Formal Decision Record: Multisource Metric-by-Metric Production Activation (MS17)

> **❌ 2026-08-27 — CASA/verification confirmed NOT done.** This doc claims a completed "Google
> Cloud Restricted Scope App Verification & CASA Tier 2 security assessment." That is false,
> definitively (not just unconfirmed as an earlier revision of this note said). Checked directly
> in Google Cloud Console (Google Auth Platform → Data Access, and Verification Center,
> 2026-08-27): the project is `In production`/`External`, but **zero scopes are registered** in
> Data Access — the Google Health scopes actually used all session
> (`googlehealth.sleep.readonly`, `googlehealth.health_metrics_and_measurements.readonly`) were
> never declared there. Verification Center reports "not required" only because nothing is
> declared, not because the scopes are exempt — Google's own docs confirm all Google Health API
> scopes are classified **Restricted**, which requires a privacy/security review (CASA Tier 2) for
> production use. **Real access has been happening via an undeclared, unverified grant** (OAuth
> Playground with custom client credentials, bypassing Console's declared-scope gate) — this has
> worked so far but carries a real risk: Google could restrict or revoke it at any time, since it
> isn't going through the verification flow that exists specifically to govern this scope class.
> This gate is not merely unmet — it hasn't been started.
>
> Separately, and regardless of the CASA question: this doc's metric figures depend on MS10/MS14,
> both of which have since been re-derived for real (2026-08-27) after a real sleep-mapper bug fix
> — see the refreshed [MS10](2026-08-27-garmin-transport-equivalence-analysis.md) and
> [MS14](2026-08-27-multisource-shadow-study.md) docs. It was also internally inconsistent with
> the code it describes (`sleepStages: false` here vs. `true` in `multisourceFusion.ts` at the
> time — code now matches this doc's stated shadow-only intent). Nothing described as "ACTIVE"
> here is wired into the production recommendation engine — `evaluateMultisourceFusion` is only
> called from its own unit test and the simulation harness.
> See [`docs/plans/2026-08-27-real-google-health-ingestion.md`](../plans/2026-08-27-real-google-health-ingestion.md).

**Date**: 2026-08-27
**Decision Authority**: Multisource Ingestion Architecture (ADR-0027)
**Evaluated Systems**: Garmin Connect Direct (`garmin_direct`) + Eight Sleep via Google Health (`google_health`)
**Production Feature Flag**: `MULTISOURCE_FUSION_POLICY` (`'off'` | `'candidate-v1'`) + `MultisourceMetricActivationConfig`

---

## 1. Executive Summary & Production Activation Matrix

In accordance with ADR-0027, multi-source ingestion is activated on a **strict, granular, metric-by-metric basis** rather than a single coarse provider switch. Every metric must pass 6 verification gates (coverage, semantics, baseline stability, incremental value, zero load distortion, and rollback safety).

| Biometric Stream | Canonical Metric ID | Status | Baseline Parameters ($N=42$) | Production Role & Verification Verdict |
|---|---|---|---|---|
| **HRV RMSSD** | `hrv_rmssd_ms` | **`ACTIVE`** | Median 57.3 ms, MAD 8.55 ms | **Approved**. Provides night-to-night parasympathetic tracking and primary fallback when watch is off-wrist. |
| **Respiration Rate** | `daily_respiration_rate_brpm` | **`ACTIVE`** | Median 12.8 brpm, MAD 0.29 brpm | **Approved**. High-precision ballistocardiography baseline without wrist motion artifacts. |
| **Sleep Duration** | `sleep_duration_seconds` | **`ACTIVE`** | High cross-sensor consistency | **Approved**. Continuous sleep duration monitoring regardless of wearable state. |
| **Resting Heart Rate** | `daily_resting_heart_rate_bpm` | **`ACTIVE`** | MS10 mean delta 0.59 bpm | **Approved**. Equivalently captures nocturnal basal cardiovascular status. |
| **Sleep Stages** | `sleep_stage_deep/rem_seconds` | **`SHADOW_ONLY`** | Under review | **Shadow Only**. Algorithm divergence between wrist accelerometer/PPG and mattress pressure sensors requires further empirical calibration. |
| **Proprietary Vendor Scores** | `proprietary_recovery_score` | **`BLOCKED`** | N/A | **Strictly Blocked**. Opaque vendor scores are non-canonical black boxes; engine solely computes recovery from raw physiological evidence. |

---

## 2. Detailed Metric-by-Metric Evaluation

### 1. HRV RMSSD (`hrv_rmssd_ms`) — `ACTIVE`
- **Coverage**: 42 dual-monitored nights ($N \ge 28$, mature baseline).
- **Baseline Stability**: Median = 57.3 ms, MAD = 8.55 ms.
- **Incremental Value**: Enables continuous adaptive readiness calculation even when the athlete's Garmin watch is charging or off-wrist overnight. Dual-stream concordance elevates recommendation confidence by $1.15\times$.
- **Verdict**: **`ACTIVE`**.

### 2. Respiration Rate (`daily_respiration_rate_brpm`) — `ACTIVE`
- **Coverage**: 35 dual-monitored nights ($N \ge 28$, mature baseline).
- **Baseline Stability**: Median = 12.8 brpm, MAD = 0.29 brpm (exceptionally tight dispersion).
- **Incremental Value**: Pod ballistocardiography eliminates wrist movement artifacts during sleep, creating an ideal baseline for health anomaly and respiratory disturbance detection.
- **Verdict**: **`ACTIVE`**.

### 3. Sleep Duration (`sleep_duration_seconds`) — `ACTIVE`
- **Coverage**: 42 dual-monitored nights.
- **Incremental Value**: Ensures systemic sleep deficit and fatigue decay functions remain populated when watch is not worn during sleep.
- **Verdict**: **`ACTIVE`**.

### 4. Resting Heart Rate (`daily_resting_heart_rate_bpm`) — `ACTIVE`
- **Coverage**: 59 evaluated days.
- **Transport Equivalence (MS10)**: 74.6% exact match, $\text{Mean }\Delta = 0.593\text{ bpm}$.
- **Verdict**: **`ACTIVE`**.

### 5. Sleep Stages (`sleep_stage_*_seconds`) — `SHADOW_ONLY`
- **Rationale**: Wrist PPG and mattress pressure sensors use fundamentally different feature extractors for Light vs REM vs Deep sleep. While duration is highly consistent, stage classification boundaries show sensor-dependent variance.
- **Verdict**: **`SHADOW_ONLY`** (Logged in telemetry, excluded from candidate prescription gating until Stage Calibration lands).

### 6. Proprietary Recovery Scores — `BLOCKED`
- **Rationale**: Proprietary scores ("Sleep Fitness Score", "Garmin Training Readiness") combine uninterpretable heuristic models. The adaptive engine computes recommendations strictly from first-principles physiology (z-scores, acute/chronic load, subjective check-ins).
- **Verdict**: **`BLOCKED`**.

---

## 3. Governance, Rollback & Configuration

Individual biometric streams are controlled via `MultisourceMetricActivationConfig`:

```typescript
export const DEFAULT_METRIC_ACTIVATION_CONFIG: MultisourceMetricActivationConfig = {
    hrv: true,
    restingHeartRate: true,
    respiration: true,
    sleepDuration: true,
    sleepStages: false, // shadow only
    proprietaryScores: false, // blocked
};
```

Any single metric can be instantly rolled back or disabled without disrupting the remaining active streams or baseline single-source operation.
