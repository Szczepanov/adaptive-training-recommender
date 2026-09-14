# Body-composition and fueling observations analysis — 2026-09-14

## Status and scope

This is a point-in-time analysis of how longitudinal body mass, home tape measurements, connected
scale estimates and subjective hunger fit the recommender. The proposed decision is recorded in
[ADR-0039](../adr/0039-longitudinal-body-composition-and-fueling-observations.md), with execution in
[the implementation plan](../plans/body-composition-and-fueling-observations.md).

The product goal is useful longitudinal review without creating duplicate measurements, hiding
source changes, or giving noisy body-composition/appetite signals recommendation authority.

---

## Executive summary

The repository already has distinct domains for provider recovery telemetry, source-aware health
observations, formal testing evidence and daily subjective check-ins. The new capability should
preserve those boundaries.

The recommended v1 design is:

- use connected/provider body mass automatically when it is already available;
- keep manual body mass only as an explicit fallback, not a routine duplicate entry;
- store home tape measurements in `anthropometry_entries`;
- use a simple optional `hunger1To10` + timing field in the daily check-in;
- treat connected-scale body fat, muscle, water, bone and related outputs as source-specific
  **device estimates** rather than criterion body composition;
- only support provider composition fields that the actual ingestion payload exposes with clear
  semantics and units;
- compose retrospective series in Data without averaging or silently splicing sources;
- keep every v1 signal outside recommendation logic.

This supersedes the earlier draft's assumption that 0–100 VAS and routine manual weight entry were
the best defaults.

---

# 1. Existing architecture

## 1.1 Provider body mass already exists

`DailyRecoverySnapshot.raw` already supports provider-origin body mass and body-fat context. The
feature should therefore not introduce a second unqualified “current weight”.

A common real-world flow is a connected bathroom scale syncing into Garmin Connect. If that weight
already reaches the application, asking the athlete to type it again adds burden and creates an
avoidable second source.

**Recommendation:** provider-first display and trend selection; manual `body_mass_kg` remains a
fallback for athletes without connected weight or for an explicitly separate measurement.

## 1.2 Connected-scale composition needs different semantics from weight

Body mass is the scale's primary measurement. Fat, muscle, water, bone and similar consumer-scale
outputs are typically impedance/model-derived estimates.

Recent evidence supports conservative treatment:

- BIA vs four-compartment systematic review, PMID 41718193:
  https://pubmed.ncbi.nlm.nih.gov/41718193/
- BIA vs DXA in athletes, PMID 36853902:
  https://pubmed.ncbi.nlm.nih.gov/36853902/
- inter-device impedance/composition variation in athletes, PMID 39047869:
  https://pubmed.ncbi.nlm.nih.gov/39047869/

These studies show material individual-level disagreement and device dependence. Therefore the app
may retain such metrics as source-labelled context, but should not present them as exact tissue
compartments or fuse them across devices.

Importantly, the product must inspect the actual Garmin/provider payload before adding fields. If
Garmin ingestion exposes body fat but not muscle/water/bone, the app should not reconstruct or ask
users to manually mirror the missing values just to complete a dashboard.

## 1.3 Manual anthropometry still deserves its own domain

ADR-0027 provider bundles remain server-managed. Formal `MetricObservationRevision` /
`AssessmentAttempt` remains Testing infrastructure. Routine tape measurements fit neither model.

A focused user-owned `anthropometry_entries` collection is still the cleanest v1 boundary.

## 1.4 Hunger belongs near Check-in but outside readiness

Hunger is low-burden subjective context. It fits `DailySubjectiveCheckin` provided that missingness
is valid, prior history stays hidden before today's first response, and the field never maps into
`SubjectiveInput`, strain, fatigue or ranking.

---

# 2. Evidence and product-scale decisions

## 2.1 Tape measurements require protocol consistency

Waist values depend on anatomical site, posture, respiratory phase and timing even when repeated
measurements are reliable:

- https://pubmed.ncbi.nlm.nih.gov/19343017/
- https://pubmed.ncbi.nlm.nih.gov/19165166/
- https://pubmed.ncbi.nlm.nih.gov/12540397/

Metric identity must therefore include the exact landmark and protocol revision. Non-waist sites
are app-defined repeatable home landmarks, not claims of clinical or ISAK equivalence.

Two circumference readings are useful for technique quality. A third can be requested when the
first pair differs beyond a versioned product-quality tolerance.

## 2.2 Hunger changes from 0–100 VAS to 1–10

Digital appetite VAS instruments have supporting research:

- https://pubmed.ncbi.nlm.nih.gov/36678176/
- https://pubmed.ncbi.nlm.nih.gov/34503591/

However, this product is not trying to reproduce a laboratory appetite instrument. The user-facing
need is a quick repeated within-person rating. A 1–10 integer scale is simpler and matches the
interaction style of the existing subjective check-in.

Recommended semantics:

```text
1  = not hungry at all
5  = moderate / typical hunger
10 = extremely hungry
```

`5` is descriptive only and must not be prefilled.

The app must not claim that this 1–10 rating is numerically interchangeable with the researched
0–100 VAS. Timing still matters; `morning_pre_breakfast` remains the preferred comparison series.

---

# 3. Practical measurement set

| Measurement | Identity | Suggested cadence | Priority |
|---|---|---:|---|
| Weight | provider source first; optional `body_mass_kg` fallback | daily if available | primary trend |
| Hunger | `hunger1To10` + timing | daily optional | context |
| Waist minimum | `waist_minimum_cm` | weekly | core |
| Abdomen at navel | `abdomen_umbilicus_cm` | weekly | core |
| Hips maximum | `hips_max_cm` | weekly | core |
| Thigh fixed site | `thigh_mid_cm` + laterality | weekly/fortnightly | useful secondary |
| Chest | `chest_nipple_line_cm` | weekly/fortnightly | optional |
| Relaxed upper arm | `upper_arm_relaxed_mid_cm` + laterality | weekly/fortnightly | optional |
| Forearm maximum | `forearm_max_cm` + laterality | fortnightly | optional |
| Calf maximum | `calf_max_cm` + laterality | fortnightly | optional |

A baseline session may record both limb sides. Routine tracking can use one fixed side or both, but
laterality must remain part of series identity.

Preferred tape context is morning when practical, after voiding, before food/drink and training,
with the same landmark/posture and a horizontal snug tape that does not compress tissue.

---

# 4. Trend and source semantics

Body mass should use one deterministic point per source/local date before weekly math. Manual same-
day duplicates never increase coverage. Provider adapters own provider-specific deduplication.

V1 body-mass summaries remain transparent:

- selected-source raw daily points;
- 7-day mean only with at least 4 distinct valid dates;
- adjacent-window change only when both windows qualify;
- coverage displayed explicitly;
- no interpolation or carry-forward.

Manual/provider series are never averaged or gap-filled into each other. Explicit source selection
is sticky. Provider weight should normally be the initial source when it has usable coverage,
because that avoids duplicate manual entry.

Circumference trends compare only the same metric + laterality + protocol revision. They do not
infer tissue type.

Hunger trends use the same timing context, with morning/pre-breakfast as the default. Missing days
remain missing.

Connected-scale composition remains secondary: exact provider metric + source + unit are preserved;
no cross-device normalization is assumed.

---

# 5. UX recommendation

Keep the feature inside **Data**.

Suggested order:

1. Body mass — connected/provider source by default, 7-day mean/change/coverage.
2. Waist and abdomen — primary tape trend.
3. Hips/thigh — secondary anthropometry.
4. Hunger — timing-aware 7d/28d retrospective summary.
5. Other circumferences — expandable.
6. Scale estimates — only provider fields actually available, labelled as device estimates.
7. `Log measurements` — tape-first; manual weight is an explicit fallback rather than a required
   field when provider weight is present.

No new top-level navigation item is needed.

---

# 6. Safety, privacy and failure semantics

The feature remains observational. It does not convert a circumference change into fat/muscle
change, does not treat a connected-scale estimate as criterion truth, and does not let hunger or
body trends directly alter training.

Sensitive values remain user-scoped, excluded from analytics/error logging and recommendation
audits, and manual records support correction/deletion. Missing provider fields remain missing;
they are not synthesized or manually backfilled by default.

---

# 7. Recommendation

Proceed with Option D from ADR-0039, refined as follows:

1. provider-first body mass with explicit manual fallback;
2. tape-focused user-authored anthropometry;
3. optional `hunger1To10` + timing;
4. source-aware transparent body-mass/circumference/hunger trends;
5. provider BIA metrics only when actually exposed, clearly labelled as device estimates;
6. zero recommendation authority until a separate future evidence/activation decision.

The governing boundary remains: **measurement, retrospective interpretation and training authority
are separate decisions**.
