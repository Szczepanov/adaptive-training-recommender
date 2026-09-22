# Analysis: Previous-Day Calorie Tracking Scoring in Daily Check-in — 2026-09-22

## Status and Scope

- **Status:** Proposed & Analyzed
- **Related ADRs:** [ADR-0042: Nutrition Ingestion, Provenance, and Decision Authority](../adr/0042-nutrition-ingestion-provenance-and-decision-authority.md), [ADR-0039: Body Composition & Fueling Observations](../adr/0039-longitudinal-body-composition-and-fueling-observations.md), [ADR-0003: Timezone & Warsaw Date Semantics](../adr/0003-warsaw-timezone-semantics.md)
- **Related Implementation Plan:** [Previous-Day Calorie Tracking Scoring](../plans/previous-day-calorie-tracking-scoring.md)

---

## Executive Summary

1. **The User Need**:
   Athletes syncing dietary calorie intake from MyFitnessPal via Garmin Connect frequently encounter logging lapses: forgetting to record dinner, snacks, or condiments; logging only part of the day; abandoning tracking for a day; or engaging in intentional fasting. Without subjective scoring of dietary tracking completeness, downstream views and potential future fueling models cannot distinguish between high-accuracy data, severe underreporting, unrecorded days, and genuine 0 kcal fasting days.

2. **Core Inquiries Evaluated**:
   - **Can we assume 0 kcal for the previous day is untracked?**
     **No.** Conflating 0 kcal with "untracked" creates false missingness for athletes practicing deliberate fasting (intermittent fasting, 24-hour water fasts, religious/medical fasting). Conversely, assuming 0 kcal is always a deliberate fast would misclassify ordinary logging drop-out as starvation. Strict missingness semantics (ADR-0042 `D-NUT-MISSING`: missing != 0) dictate that 0 kcal and unlogged must remain semantically distinct, and subjective confirmation is required to certify a true 0 kcal fast.
   - **What scoring levels should be provided?**
     A discrete, low-cognitive-load 5-state adherence scale:
     1. `fully_tracked`: Conscientiously logged all meals, snacks, and beverages (~90–100% complete).
     2. `mostly_tracked`: Logged main meals; omitted minor snacks, dressings, or rough portion estimates (~65–85% complete).
     3. `minimal`: Logged only 1–2 items (e.g. coffee or breakfast) and stopped (<50% complete).
     4. `untracked`: Did not log food yesterday at all.
     5. `fasted`: Deliberate fast all day; intake was intentionally 0 kcal (or non-caloric fluids only).
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
1. **Garmin Provider Payload Behavior (`fetch_daily_nutrition`)**:
   - When an athlete does not open or log in MyFitnessPal, Garmin Connect daily stats typically sets `includesCalorieConsumedData: false`. `GarminProviderAdapter` maps this to `has_intake_data: false` and `energy_intake_kcal: None`.
   - However, if an athlete opens the MyFitnessPal diary but logs zero items, or if Garmin Connect initializes a daily food log entry without line items, Garmin may emit `consumedKilocalories: 0` with `includesCalorieConsumedData: true`.
2. **Physiological Reality of Fasting**:
   - Athletes engage in intermittent fasting (e.g., 24-hour fasts, 5:2 fasting schedules, water fasts, Ramadan/Yom Kippur observance).
   - On a true fasting day, consumed energy is genuinely 0 kcal. The metabolic and hormonal impact of a zero-calorie day (glycogen depletion, lipolysis, sympathetic tone modulation) is profound and real.
   - If the system automatically treated 0 kcal as "untracked", a genuine fast would be erased from the athlete's history as missing data.
3. **Behavioral Reality of Underreporting**:
   - Conversely, if the system treated all 0 kcal days as fasting, every forgotten weekend or abandoned day would be logged as acute caloric starvation.
4. **Conclusion**:
   - Telemetry alone cannot disambiguate "forgot to log" from "deliberately ate 0 kcal".
   - The daily check-in is the precise tool to resolve this ambiguity:
     - Selecting **Fasted (0 kcal)** explicitly validates that 0 kcal was intentional.
     - Selecting **Untracked** marks the day as unrecorded/missing regardless of whether synced calories are 0 or null.

---

### 1.2 Granularity of Adherence Scoring: What levels should exist?

Athletes tracking in tools like MyFitnessPal do not experience binary "perfect" vs "nothing" tracking. Nutritional epidemiology and self-monitoring studies identify four primary tracking patterns plus fasting:

| Adherence Level | Key Identifier | Estimated Completeness | Typical Real-World Athlete Scenario | Data Quality Interpretation |
|---|---|---|---|---|
| **Fully Tracked** | `fully_tracked` | ~90% – 100% | Weighed/measured or conscientiously logged all meals, snacks, drinks, and oils. | **High Fidelity**: Safe for longitudinal intake baselines and energy balance trends. |
| **Mostly Tracked** | `mostly_tracked` | ~65% – 85% | Logged all primary meals (breakfast, lunch, dinner); skipped small snacks, condiments, or eating out was eyeballed. | **Underreported / Directional**: Good estimate of major intake; true intake is ~15-30% higher than synced value. |
| **Minimally Tracked** | `minimal` | < 50% | Logged breakfast or morning shake, then got busy and abandoned logging for the rest of the day. | **Incomplete**: Synced value significantly underestimates intake; should be excluded from calorie deficit/surplus computations. |
| **Untracked** | `untracked` | 0% | Completely forgot or deliberately took a day off from calorie counting. | **Missing / Unrecorded**: Discard intake value from analytical averaging. |
| **Fasted (0 kcal)** | `fasted` | 100% (of 0 kcal) | Deliberate water fast, 24-hour fast, or religious fasting; intentional 0 kcal intake. | **True Zero**: Confirmed zero intake, distinct from missing data. |

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
    | 'fully_tracked'   // Conscientiously logged all meals, snacks, and beverages (~90-100%)
    | 'mostly_tracked'  // Logged main meals; missed small snacks, drinks, or dressings (~65-85%)
    | 'minimal'         // Logged only 1-2 items; majority of the day unlogged (<50%)
    | 'untracked'       // Did not log food yesterday at all
    | 'fasted';         // Deliberate fast all day; intentional 0 kcal intake

export interface DailySubjectiveCheckin {
    // ... existing fields ...
    /** Optional rating of yesterday's (D-1) dietary tracking completeness. Zero recommendation authority (ADR-0042). */
    nutritionAdherenceYesterday?: NutritionTrackingAdherence | null;
}
```

### 2.2 Validation Rules (`validationCore.ts`, `decisionInputs.ts`)

- If present, `nutritionAdherenceYesterday` must be one of the 5 allowed enum values, or `null`.
- Empty strings or invalid strings are rejected with validation errors.
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
- Test `app/src/nutrition/__tests__/nutritionRecommendationInvariance.test.ts` proves that recommendation outputs are 100% invariant across all adherence levels.

---

## 3. UI/UX Design

### 3.1 Daily Check-in Component (`NutritionAdherenceSection.tsx` & `DailyCheckin.tsx`)

A dedicated card placed alongside Hunger & Fueling:
- **Title**: Yesterday's Calorie Tracking (D-1)
- **Context Pill**: Shows yesterday's synced calories if available (e.g., `Synced: 2,150 kcal` or `No intake synced (0 kcal)`).
- **Options**:
  - `[ Fully Tracked ]` (Green tint when selected)
  - `[ Mostly Tracked (~75%) ]` (Teal tint when selected)
  - `[ Minimal (<50%) ]` (Amber tint when selected)
  - `[ Untracked ]` (Gray/Red tint when selected)
  - `[ Fasted (0 kcal) ]` (Purple/Blue tint when selected)
- **Helper text**: "Scores your MyFitnessPal/dietary tracking adherence for yesterday. Helps identify unlogged meals and verify true fasting days without affecting your workout recommendations."
- **Clear Button**: Appears when a choice is active, allowing reset to unrated.

### 3.2 Retrospective Nutrition Surface (`NutritionPanel.tsx`)

- Displays the adherence badge on yesterday's card in `NutritionPanel`.
- If an athlete fasted (0 kcal), the UI prominently renders `Deliberate Fast (0 kcal)` rather than `Unlogged / Missing`.
- If an athlete marked `Untracked`, the badge highlights `Untracked (Intake unverified)`.
- If `Mostly Tracked` or `Minimal`, the badge indicates `Partially Logged`.
