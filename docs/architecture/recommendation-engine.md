# Recommendation Engine Architecture

The frontend application (`app/src/engine/`) implements an adaptive training decision engine in TypeScript. It evaluates daily recovery snapshots, computes objective strain scores, selects training modes, and constructs structured workout prescriptions.

---

## 🧩 Architectural Layers

```text
Firestore / Daily Recovery Snapshot
                 │
                 ▼
     ┌───────────────────────┐
     │     validation.ts     │ (Schema validation & sanitization)
     └───────────┬───────────┘
                 │
                 ▼
     ┌───────────────────────┐
     │       rules.ts        │ (Strain scoring & mode hierarchy rules)
     └───────────┬───────────┘
                 │
                 ▼
     ┌───────────────────────┐
     │     templates.ts      │ (Session template catalog & systemic load caps)
     └───────────┬───────────┘
                 │
                 ▼
Adaptive Recommendation + Strain Telemetry + Human Rationale
```

---

## 📁 Source Code Organization

* [`app/src/engine/models.ts`](../../app/src/engine/models.ts) — Core interfaces: `DailyRecoverySnapshot`, `RecommendationResult`, `StrainTelemetry`, `StrainBreakdown`, `DecisionRationale`.
* [`app/src/engine/rules.ts`](../../app/src/engine/rules.ts) — Decision logic calculating acute metric deviations, multi-day baseline drift, mode overrides, and rationale text.
* [`app/src/engine/templates.ts`](../../app/src/engine/templates.ts) — Session template definitions, systemic load boundaries, and duration bounds.
* [`app/src/engine/validation.ts`](../../app/src/engine/validation.ts) — Schema sanitization ensuring input types and numeric boundaries are safe.

---

## ⚙️ Decision Logic & Mode Hierarchy

The engine evaluates training modes in a strict risk hierarchy:

1. **REST Mode (Override)**: Triggered when severe acute strain, sleep floor violations, or extreme HRV drops are present.
2. **RECOVERY Mode**: Recommended when moderate fatigue or baseline drift indicates high cumulative strain.
3. **AEROBIC_BASE Mode**: Default target mode when recovery metrics are balanced and stable.
4. **QUALITY_STRENGTH / THRESHOLD Mode**: Enabled when recovery scores demonstrate high readiness, low acute strain, and no drift penalties.

---

## 📈 Strain Telemetry Decomposition

Objective strain is calculated as:

$$\text{Total Strain} = \text{Acute Deviation} + \text{Multi-Day Drift} + \text{Contextual Penalties}$$

### Metric Weights & Penalties
* **HRV Drop**: Deviation below 7d or 28d baseline ($>10\%$ drop adds acute strain).
* **Resting Heart Rate Elevation**: $RHR > RHR_{baseline} + 3\text{ bpm}$ adds acute strain.
* **Sleep Deficit**: Sleep score $< 65$ or duration $< 6.5\text{ hours}$ triggers sleep floor penalties.
* **Step Overload**: Previous-day step count ($D-1$) exceeding target thresholds increases non-exercise fatigue load.
