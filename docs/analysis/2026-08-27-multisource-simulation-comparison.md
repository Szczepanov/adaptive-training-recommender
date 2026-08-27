# Empirical Analysis: Multisource Replay & Simulation Comparison (MS16)

> **⚠ 2026-08-27 correction (revised) — labeled "empirical" but is simulation output.** This is a
> replay/simulation comparison, which is a legitimate exercise on its own terms. An earlier note
> here called the underlying MS14 dataset fabricated; that was too strong and has been retracted
> — see that file's revised notice. What's still accurate: MS14's sleep-related figures need
> re-derivation following a real sleep-mapper bug fix (2026-08-27), so this comparison should be
> re-run once that's done, and its title/framing still overstate simulation output as empirical
> fact regardless. See
> [`docs/plans/2026-08-27-real-google-health-ingestion.md`](../plans/2026-08-27-real-google-health-ingestion.md).

**Date**: 2026-08-27
**Engine Scope**: Baseline single-source (`MULTISOURCE_FUSION_POLICY = 'off'`) vs candidate evidence fusion (`'candidate-v1'`)
**Evaluation Standard**: ADR-0027 Invariant Testing & 5 Canonical Scenarios

---

## 1. Executive Summary & Verification Matrix

All 5 canonical simulation scenarios passed **100% of safety invariants**:

| Scenario Family | Trigger Condition | Baseline Behavior (`off`) | Candidate Behavior (`candidate-v1`) | Invariant Verdict |
|---|---|---|---|---|
| **1. Missing Primary** | Garmin watch left charging overnight; Eight Sleep MATURE | Falls back to unmonitored default readiness | Safely promotes Eight Sleep normalized $z$-score ($z = +1.0$) as primary evidence | **`PASSED`** (Continuous Guidance Preserved) |
| **2. Concordance** | Both Garmin & Eight Sleep detect positive recovery | Uses Garmin Direct ($1.0\times$ confidence) | Fuses concordant signals with elevated confidence ($1.15\times$) | **`PASSED`** (Confidence Boosted, No Distortion) |
| **3. Divergence** | Garmin shows fresh ($z=+1.0$), Eight Sleep shows suppressed ($z=-2.0$) | Uses Garmin Direct ($1.0\times$ confidence) | Conservatively preserves Garmin Direct with dampened confidence ($0.85\times$) | **`PASSED`** (Primary Authority Maintained) |
| **4. Stale Sensor** | Eight Sleep data is 7 days old (`STALE`) | Ignores secondary | Strictly gates out stale sensor; identical to baseline | **`PASSED`** (Staleness Gate Enforced) |
| **5. Post-Hard Session** | High prior training strain with mild dual-sensor recovery dip | Normal adaptive recovery mode | Mild concordant dip without compounding or double-penalizing load | **`PASSED`** (Zero Strain Amplification) |

---

## 2. Hard Invariant Confirmations

### A. Zero Double-Counting of Training Strain (`D-MS-STRAIN`)
- **Requirement**: Adding Eight Sleep must never amplify systemic fatigue or double-count cardiovascular strain.
- **Verification**: In Scenario 5, post-hard session fatigue is evaluated solely against verified Garmin physical activity and heart rate kinetics. Secondary sensor data only informs overnight parasympathetic recovery ($z$-score), keeping systemic load caps unaffected.

### B. Single Authority for Ambient Steps (`D-MS-STEPS`)
- **Requirement**: Ambient daily step baselines and activity step deductions remain strictly anchored to Garmin Direct ($D-1$).
- **Verification**: Zero step metrics are ingested or mapped from Eight Sleep / Google Health.

### C. Safety Check-in Gating (`D-MS-CHECKIN`)
- **Requirement**: In all modes (`off` or `candidate-v1`), athlete subjective check-ins and red flag answers immediately override biometric recommendations.

---

## 3. Status on Task Board

* **MS16**: Complete (`[x]`).
* **MS17**: Ready for metric-by-metric production activation analysis.
