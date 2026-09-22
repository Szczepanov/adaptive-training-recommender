# Previous-Day Calorie Tracking Scoring — Implementation Plan

**Status:** Implemented in PR #710 (pending merge)
**Blocked by:** none — builds upon [ADR-0042](../adr/0042-nutrition-ingestion-provenance-and-decision-authority.md)
**Unlocks:** Self-reported scoring of previous-day calorie logging completeness (fully tracked, mostly tracked, minimally tracked, untracked, fasted), disambiguation of true 0-kcal fasts from forgotten logs, and adherence-aware nutrition data presentation.
**Source analysis:** [2026-09-22 Calorie Tracking Scoring Analysis](../analysis/2026-09-22-previous-day-calorie-tracking-scoring-checkin.md)

---

## Stages Overview

- **S0: Domain Models & Contracts** — Define `NutritionTrackingAdherence` and update `DailySubjectiveCheckin` in `app/src/engine/models.ts`.
- **S1: Validation & Persistence** — Implement validation in `validationCore.ts`, parsing in `decisionInputs.ts`, and Firestore rules in `firestore.rules`.
- **S2: Service Layer & Lifecycle** — Update `CheckinService.upsertCheckin` in `app/src/services/checkinService.ts` to support deletion of cleared adherence ratings.
- **S3: Check-in UI Component** — Build `NutritionAdherenceSection.tsx` and integrate into `DailyCheckin.tsx` with yesterday's synced calorie summary.
- **S4: Nutrition View Integration** — Surface adherence badges in `NutritionPanel.tsx` and distinguish deliberate fasts from missing logs.
- **S5: Engine Isolation & Invariance Verification** — Prove zero engine imports of nutrition and recommendation invariance across all adherence states.
- **S6: Automated Test Suite & Code Review** — Unit tests for validation, Firestore rules emulator tests, component tests, subagent review, and PR creation.

---

## Detailed Stages & Acceptance Criteria

### S0: Domain Models & Contracts
- [x] Define `NutritionTrackingAdherence` type:
  `'fully_tracked' | 'mostly_tracked' | 'minimal' | 'untracked' | 'fasted'`
  in `app/src/engine/models.ts`.
- [x] Add `nutritionAdherenceYesterday?: NutritionTrackingAdherence | null;` to `DailySubjectiveCheckin`.
- [x] Ensure docstrings explicitly document zero recommendation authority per ADR-0042 `D-NUT-AUTH`.

### S1: Validation & Persistence
- [x] Add validation for `nutritionAdherenceYesterday` in `app/src/engine/validationCore.ts`:
  - Allow `null`, `undefined`, or one of the 5 allowed strings.
  - Reject invalid string values with clear error messages.
  - Verify that `computeDataQuality` does not treat this optional field as a required field for check-in completion.
- [x] Add parser support in `app/src/persistence/parsers/decisionInputs.ts`:
  - Validate and normalize `nutritionAdherenceYesterday` when reading persisted check-in documents.
- [x] Update `app/firestore.rules`:
  - Define `hasValidNutritionAdherence(data)` rule.
  - Incorporate into `create` and `update` rules for `/users/{userId}/daily_subjective_checkins/{date}`.

### S2: Service Layer & Lifecycle
- [x] Update `CheckinService.upsertCheckin` in `app/src/services/checkinService.ts`:
  - When `validatedCheckin.nutritionAdherenceYesterday === null`, set `payload.nutritionAdherenceYesterday = deleteField();` so clearing a score safely removes it from Firestore.

### S3: Check-in UI Component
- [x] Create `app/src/components/checkin/NutritionAdherenceSection.tsx` and `.css`:
  - Present options: Fully Tracked, Mostly Tracked, Minimally Tracked, Untracked, Full-Day Fast (0 kcal).
  - Include Clear button when a score is active.
  - Render contextual note explaining that this rating scores yesterday's logging completeness and does not affect the workout plan.
  - Optionally display yesterday's synced calories if available.
- [x] Wire `NutritionAdherenceSection` into `DailyCheckin.tsx` below `HungerSection`.
- [x] Add unit tests for `NutritionAdherenceSection` in `NutritionAdherenceSection.test.tsx`.

### S4: Nutrition View Integration
- [x] Update `NutritionPanel.tsx` to read D+1 adherence through the validated date-range API, including historical `asOfDate` windows (never "latest N" check-ins).
- [x] Render adherence badges:
  - `fasted`: render "Marked Full-Day Fast (0 kcal)" and flag conflicts when positive synced intake exists.
  - `fully_tracked`: render green "Fully Tracked" badge.
  - `mostly_tracked` / `minimal`: render "Partially Tracked" badge.
  - `untracked`: render "Untracked" badge.

### S5: Engine Isolation & Invariance Verification
- [x] Verify `app/src/nutrition/__tests__/engineIsolation.test.ts` passes (zero engine imports of nutrition) and rejects any `nutritionAdherenceYesterday` reference in engine decision files outside the model/validation boundary.
- [x] Verify `app/src/nutrition/__tests__/nutritionRecommendationInvariance.test.ts` passes and add tests proving that `nutritionAdherenceYesterday` values do not alter engine recommendations.

### S6: Full Suite & PR
- [ ] Run full test suites: `make check`, `npm test`, `npm run test:rules`.
- [x] Run code-reviewer subagent and address findings.
- [x] Create PR with detailed description.


## Review hardening added in PR #710

- [x] Removed pseudo-precise percentage accuracy from the subjective scale; categories are behavioral logging-completeness anchors only.
- [x] Reserved `fasted` for a deliberate full-day zero-calorie fast; time-restricted eating is not automatically a zero-calorie day.
- [x] Preserved ADR-0042 missingness semantics in UI copy: no synced intake is missing, not "0 kcal" or automatically "untracked".
- [x] Added explicit conflict display when a full-day-fast self-report coexists with positive synced intake.
- [x] Replaced latest-N check-in reads with the validated D+1 date-range read required by retrospective `asOfDate` windows.
- [x] Added an architecture regression guard that prevents the adherence field from entering recommendation decision code without an explicit architecture change.
