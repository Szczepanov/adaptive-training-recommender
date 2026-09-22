# Analysis: Previous-Day Calorie Tracking Scoring in Daily Check-in — 2026-09-22

## Status and Scope

- **Status:** Implemented in PR #710 (pending merge)
- **Related ADRs:** [ADR-0042: Nutrition Ingestion, Provenance, and Decision Authority](../adr/0042-nutrition-ingestion-provenance-and-decision-authority.md), [ADR-0039: Body Composition & Fueling Observations](../adr/0039-longitudinal-body-composition-and-fueling-observations.md), [ADR-0003: Timezone & Previous-Day Step Window](../adr/0003-timezone-semantics-and-d1-step-window.md)
- **Related Implementation Plan:** [Previous-Day Calorie Tracking Scoring](../plans/previous-day-calorie-tracking-scoring.md)

---

## Executive Summary

1. **The User Need**:
   Athletes syncing dietary calorie intake through Garmin Connect can have logging lapses: forgetting dinner, snacks, or condiments; logging only part of the day; abandoning tracking for a day; or deliberately completing a full-day fast. The current Garmin adapter cannot certify the upstream food-logging application, so product copy must not assume MyFitnessPal provenance. Without subjective logging-quality context, retrospective views cannot distinguish a self-reported complete log from a partial/untracked day or a deliberate zero-calorie fast.

2. **Core Inquiries Evaluated**:
   - **Can we assume 0 kcal for the previous day is untracked?**
     **No.** Conflating 0 kcal with "untracked" creates false missingness for a deliberate full-day zero-energy fast. Conversely, assuming every 0 kcal record is a fast would misclassify logging drop-out. Strict missingness semantics (ADR-0042 `D-NUT-MISSING`: missing != 0) require zero and missing to remain distinct. The subjective check-in may mark a deliberate full-day fast, but contradictory positive synced intake must remain visible as a conflict rather than being overwritten.
   - **What scoring levels should be provided?**
     A discrete, low-cognitive-load 5-state adherence scale:
     1. `fully_tracked`: Athlete reports logging the whole day.
     2. `mostly_tracked`: Main meals logged; some smaller items or portions uncertain.
     3. `minimal`: Only a small part of the day logged.
     4. `untracked`: No meaningful food logging for the day.
     5. `fasted`: Deliberate **full-day** fast with no caloric intake.
     - *Unrated / Cleared*: `null` or omitted when the athlete does not track calories or chooses to skip the question.

3. **Architectural Placement & Timing Invariants**:
   - The rating belongs in `DailySubjectiveCheckin` (`users/{userId}/daily_subjective_checkins/{today}`) as `nutritionAdherenceYesterday?: NutritionTrackingAdherence | null`.
   - **`D - 1` Semantics**: Check-in is performed on day `D` (Today) in `Europe/Warsaw` time. Rating dietary tracking completeness can only be answered for the previous completed calendar day `D - 1` (Yesterday). Day `D` intake is ongoing and partial (`isPartialDay: true`), making same-day rating impossible at morning check-in. This preserves strict symmetry with Invariant I3 (`totalSteps` is `D - 1`), `physicalWork` (unlogged labor completed yesterday), and `tissueResponses.nextMorningReaction` (reaction to yesterday's training).
   - **Zero Recommendation Authority (ADR-0042 `D-NUT-AUTH`)**: Observational only. Never consumed by training recommendation rules, readiness scoring, fatigue models, or volume caps. Engine source isolation and recommendation invariance must be strictly maintained.

---

## 1. Detailed Analysis of Core Questions

### 1.1 Can we assume 0 kcal for the previous day is just untracked?

**Conclusion: We cannot assume 0 kcal is untracked.**

#### Technical and Empirical Realities:
1. **Provider payload semantics (`fetch_daily_nutrition`)**:
   - The Garmin adapter maps `includesCalorieConsumedData: false` to `has_intake_data: false` and a missing canonical intake value.
   - When the provider affirmatively reports intake data, a numeric `0` remains a numeric zero rather than being normalized to missing. The adapter does not infer whether that zero represents a deliberate fast or incomplete diary behavior.
   - Upstream food-logging origin remains `null` unless provider metadata certifies it, per ADR-0042 `D-NUT-PROV`.
2. **Fasting terminology must stay precise**:
   - International fasting terminology distinguishes full fasting, modified fasting, intermittent fasting, and time-restricted eating; time-restricted eating normally includes caloric intake within an eating window.
   - Therefore `fasted` in this product means a deliberate **full-day zero-calorie fast**, not ordinary 16:8/time-restricted eating.
   - References: https://pubmed.ncbi.nlm.nih.gov/39059384/ and https://pubmed.ncbi.nlm.nih.gov/32480126/.
3. **Behavioral Reality of Underreporting**:
   - Conversely, if the system treated all 0 kcal days as fasting, every forgotten weekend or abandoned day would be logged as acute caloric starvation.
4. **Conclusion**:
   - Telemetry alone cannot disambiguate "forgot to log" from "deliberately ate 0 kcal".
   - The daily check-in is the precise tool to resolve this ambiguity:
     - Selecting **Full-Day Fast (0 kcal)** records the athlete's subjective statement that no caloric intake occurred for the whole day.
     - Selecting **Untracked** records that the diary was not meaningfully tracked. Neither answer rewrites or deletes contradictory provider telemetry; conflicts remain visible in the retrospective view.

---

### 1.2 Granularity of Adherence Scoring: What levels should exist?

Dietary self-monitoring research does **not** provide a consensus mapping from a subjective category such as "mostly tracked" to a calibrated percentage of true energy intake. Definitions of adherence vary across studies, and omissions/portion-size errors can occur even when a diary is used. Self-reported energy intake should therefore not be treated as true energy intake or corrected by a fixed percentage (see https://pubmed.ncbi.nlm.nih.gov/30115555/, https://pubmed.ncbi.nlm.nih.gov/36041186/, and https://pubmed.ncbi.nlm.nih.gov/26468491/).

The scale is intentionally **behaviorally anchored**, not numerically calibrated:

| Adherence Level | Key Identifier | Behavioral Anchor | Data Quality Interpretation |
|---|---|---|---|
| **Fully Tracked** | `fully_tracked` | Athlete reports logging all meals, snacks, caloric drinks and relevant cooking extras intended for tracking. | Highest subjective logging confidence; still not a validated measure of true energy intake. |
| **Mostly Tracked** | `mostly_tracked` | Main meals logged; some smaller items or portion estimates missing/uncertain. | Partial record; retain the synced number but label it as incompletely logged. |
| **Minimally Tracked** | `minimal` | Only a small part of the day was logged before tracking stopped. | Low-confidence intake record; do not infer the missing calories. |
| **Untracked** | `untracked` | No meaningful food logging for the day. | Missing/unverified intake context; do not convert missing to zero. |
| **Full-Day Fast (0 kcal)** | `fasted` | Deliberate full-day fast with no caloric intake. | Subjective zero-intake confirmation; if positive synced intake exists, surface a conflict instead of overwriting either source. |

#### Cognitive Load Considerations:
- Selecting among 5 labelled chips requires a single tap.
- A "Clear" action allows removing the answer if tapped accidentally.
- The field is **optional**: athletes who do not count calories or who wish to skip this step are never blocked from completing check-in.

---

### 1.3 Warsaw Calendar Date & `D - 1` Semantics

- In accordance with ADR-0003 and Invariant I2, calendar dates are strictly `Europe/Warsaw` strings (`YYYY-MM-DD`).
- In accordance with Invariant I3, recovery snapshots and morning check-ins record context for `D - 1`:
  - `totalSteps` reflects `D - 1`.
  - `physicalWork` records manual labor completed yesterday (`D - 1`).
  - `tissueResponses.nextMorningReaction` records morning reaction following yesterday's training (`D - 1`).
- Calorie counting for yesterday (`D - 1`) fits this exact temporal model.
- When an athlete checks in on date `D`, `D - 1` is completed, finalized, and closed out.

---

## 2. Architecture & Data Model

### 2.1 Canonical Model Extension (`app/src/engine/models.ts`)

```typescript
export type NutritionTrackingAdherence =
    | 'fully_tracked'   // Athlete reports logging the whole day
    | 'mostly_tracked'  // Main meals logged; some smaller items or portions uncertain
    | 'minimal'         // Only a small part of the day logged
    | 'untracked'       // No meaningful food logging for the day
    | 'fasted';         // Deliberate full-day fast; no caloric intake

export interface DailySubjectiveCheckin {
    // ... existing fields ...
    /** Optional rating of yesterday's (D-1) dietary tracking completeness. Zero recommendation authority (ADR-0042). */
    nutritionAdherenceYesterday?: NutritionTrackingAdherence | null;
}
```

### 2.2 Validation Rules (`validationCore.ts`, `decisionInputs.ts`)

- If present, `nutritionAdherenceYesterday` must be one of the 5 allowed enum values, or `null`.
- UI/service input normalizes an empty optional value to `null` (clear); persisted parser and Firestore rules reject non-enum strings, including an empty stored string.
- `computeDataQuality`: Does **not** include `nutritionAdherenceYesterday` in `missingFields`. `isComplete` remains dependent only on the core subjective scales, safety flags, and time available.

### 2.3 Firestore Security Rules (`firestore.rules`)

Add validation helper to `firestore.rules`:
```javascript
function hasValidNutritionAdherence(data) {
  return !('nutritionAdherenceYesterday' in data)
    || data.nutritionAdherenceYesterday == null
    || data.nutritionAdherenceYesterday in ['fully_tracked', 'mostly_tracked', 'minimal', 'untracked', 'fasted'];
}
```
Enforce `hasValidNutritionAdherence(request.resource.data)` in `users/{userId}/daily_subjective_checkins/{date}` create and update rules.

### 2.4 Checkin Service Lifecycle (`checkinService.ts`)

When `nutritionAdherenceYesterday === null`, explicitly delete the field on write using `deleteField()`:
```typescript
if (validatedCheckin.nutritionAdherenceYesterday === null) {
    payload.nutritionAdherenceYesterday = deleteField();
}
```

### 2.5 Strict Recommendation Invariance (ADR-0042 `D-NUT-AUTH`)

- The engine evaluators (`rules.ts`, `fatigue.ts`, `optimizer.ts`, `eligibility.ts`, `composer.ts`) do not import or consume `nutritionAdherenceYesterday`.
- `mapCheckinToSubjectiveInput` in `adapters.ts` does not forward nutrition adherence to `SubjectiveInput`.
- Architecture test `app/src/nutrition/__tests__/engineIsolation.test.ts` passes with zero engine imports of nutrition.
- Test `app/src/nutrition/__tests__/nutritionRecommendationInvariance.test.ts` proves that mapping to `SubjectiveInput` is invariant across all adherence levels.
- Architecture coverage additionally forbids `nutritionAdherenceYesterday` references in engine decision files outside the model/validation boundary, preventing accidental future promotion to recommendation authority.

---

## 3. UI/UX Design

### 3.1 Daily Check-in Component (`NutritionAdherenceSection.tsx` & `DailyCheckin.tsx`)

A dedicated card placed alongside Hunger & Fueling:
- **Title**: Yesterday's Calorie Tracking (D-1)
- **Context Pill**: Shows yesterday's synced calories if available (e.g., `Synced: 2,150 kcal`), `Intake reported; calories unavailable` when logging is affirmative but the value is missing, or `No intake data synced` when provider intake data is absent. Missing is never rendered as zero.
- **Options**:
  - `[ Fully Tracked ]` (Green tint when selected)
  - `[ Mostly Tracked ]` (Teal tint when selected)
  - `[ Minimally Tracked ]` (Amber tint when selected)
  - `[ Untracked ]` (Gray/Red tint when selected)
  - `[ Full-Day Fast (0 kcal) ]` (Purple/Blue tint when selected)
- **Helper text**: Describes this as self-reported logging-quality context, defines a full-day fast as no caloric intake for the whole day, and states that it has zero recommendation authority. It does not name an upstream diary app whose provenance Garmin has not certified.
- **Clear Button**: Appears when a choice is active, allowing reset to unrated.

### 3.2 Retrospective Nutrition Surface (`NutritionPanel.tsx`)

- Displays the adherence badge on yesterday's card in `NutritionPanel`.
- If an athlete marks a full-day fast, the UI renders `Marked Full-Day Fast (0 kcal)`; if positive synced intake exists for that day, the UI explicitly surfaces the contradiction instead of silently treating the day as a true zero.
- If an athlete marked `Untracked`, the badge highlights `Untracked (Intake unverified)`.
- If `Mostly Tracked` or `Minimal`, the badge indicates `Partially Logged`.


### 3.3 Retrospective read-window invariant

For a nutrition display window `[T0, T1]`, the corresponding adherence lives in check-ins on `[T0 + 1, T1 + 1]`.
The frontend therefore queries the validated check-in range `[T0 + 1, T1 + 2)` using
`CheckinService.getCheckinsInRangeState`. It must not use "latest N check-ins", because that silently
breaks historical `asOfDate` views and bypasses the validated range parser.
