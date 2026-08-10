# Phase 6.4 calibration corpus evidence

**Date:** 2026-08-10

## Scope

Phase 6.4 adds reproducible, synthetic evidence for recommendation-policy review. Run it
from `app/` with:

```text
npm run simulate:calibrate
```

The command runs the shared scenario corpus and writes a regenerable JSON and Markdown
report to `app/artifacts/calibration-reports/latest/`. It does not modify the semantic
baseline or read Firebase/Garmin data.

## What is traced

Each simulated day records only compact, derived facts needed to review a decision:

- mode/readiness tier, selected canonical template, category, modality, and cost profile;
- raw and clamped external load, internal response, and combined fatigue vectors;
- canonical objective keys and completed/projected/required credit;
- contributor objective additions/drops, fixed-activity profile activation, and gate codes;
- top/runner-up utility and selected-versus-best-benefit diagnostics.

The trace deliberately excludes raw activity records, raw wearable payloads, free-text
check-ins, event/activity titles, and Firebase exports.

## Corpus boundary coverage

The shared 24-case corpus covers green/borderline/poor readiness, low-to-high recent load,
no-event through taper states, time/equipment/injury/travel constraints, and exact/inferred/
partial completion evidence. It includes multi-event taper transitions and fixed activities.

The generated report aggregates mode and fatigue-tier counts, typed rejections, recovery
selection, objective creation/resolution/miss totals, fragile top-two selections,
fixed-activity activations, and multi-event contributor transitions by scenario and across
the corpus.

## Interpretation boundary

This is deterministic policy-regression evidence, not physiological or clinical
calibration. A frequently activated rule is a review signal, not a recommendation to change
a threshold. Any later policy change must follow the Phase 6.4 policy-change evidence note
requirements in the Phase 6 plan, including its own dated analysis and rollback condition.
