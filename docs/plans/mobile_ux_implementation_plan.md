# Adaptive Training Recommender — Mobile UX/UI Implementation Plan

**Status:** `Implemented` (2026-08-19)
**Repository:** `Szczepanov/adaptive-training-recommender`
**Primary target:** Mobile web / PWA, with Xiaomi 14T Pro as the real-device acceptance target
**Primary workflow:**
`Open app → subjective check-in → understand today's state in ~5 sec → inspect today's recommendation → start/export workout`

> [!NOTE]
> **Historical Record:** This implementation plan has been delivered. Retained for reasoning and architectural context.

---

## 1. Objective

Redesign the mobile experience around the athlete's daily decision flow instead of treating the mobile Home screen as a compressed desktop dashboard.

The intended result is a mobile-first experience where the athlete can:

1. Open the app.
2. Complete the subjective check-in quickly.
3. Understand today's recovery/training state within roughly five seconds.
4. Review the recommended session.
5. Start or export the workout with minimal friction.
6. Access detailed analytics, goals, settings, imported-plan critique, and history only when needed.

The recommendation engine, safety behavior, persistence model, Garmin ingestion, audit/replay behavior, and authored-session provenance should remain functionally intact unless explicitly noted.

---

# 2. Product Principles

## 2.1 Daily decision first

The Home screen should answer four questions immediately:

1. **Do I need to do anything before the app can make a decision?**
2. **How ready am I today?**
3. **What am I training today?**
4. **What is the next action?**

Anything that does not help answer those questions belongs below the fold or behind progressive disclosure.

## 2.2 Mobile is not compressed desktop

Do not preserve desktop structures when they become awkward on narrow screens.

Examples:

- A desktop weekly grid should become a mobile week strip / stacked day card.
- A multi-column recovery dashboard should become a compact metric strip.
- Detailed recommendation rationale should collapse behind "Why this today?".
- Settings and analytics should not consume permanent Home-screen space.

## 2.3 One dominant action per state

Examples:

- Before check-in: **Complete check-in**
- After check-in, before recommendation reveal if still applicable: **See today's plan**
- Recommendation ready: **Start workout**
- During workout: **Log set / Start interval / Complete step**
- Workout complete: **Finish session**

Secondary actions such as export, details, adjust load, history, and analytics should be visually subordinate.

## 2.4 Progressive disclosure

Show:

- decision summary first,
- important supporting metrics second,
- engine rationale third,
- raw telemetry / analytics last.

The app is technically sophisticated; the mobile UI should not require the user to parse that sophistication every morning.

## 2.5 Preserve safety visibility

Safety-relevant information must not be hidden merely for visual simplicity.

Examples:

- pain / illness flag,
- active injury restrictions,
- unavailable "Harder" option,
- incomplete safety check-in,
- significant recovery-data failure,
- session stop conditions.

---

# 3. Current Mobile Problems to Address

## 3.1 Excessive nested horizontal padding

Current mobile content effectively receives padding from multiple layers:

- `.app-content`
- page-level containers such as `.home-container`
- `.dashboard-card`

This materially reduces usable width on ~360–412 px devices.

### Target

Use a single page gutter plus card padding.

Recommended baseline:

- page gutter: `16px`
- card padding: `16px`
- compact internal sections: `12px`
- mobile section gap: `12–16px`

Avoid stacking page-level `1rem` padding inside another page-level `1rem`.

---

## 3.2 Weekly plan breaks down on narrow screens

The current external week component uses a fixed left date column and a remaining session column. Inside the session column, the layout also contains:

- modality icon,
- title,
- meta,
- actions.

On mobile, long session names collapse into narrow word columns.

### Target

At mobile widths, each day should stack vertically:

```text
WED · AUG 19

🚴 VO₂ 30/15 Repeated Aerobic Power
Hard · 60–75 min · Planned

[Workout] [Reschedule]
```

The Home screen should preferably show an even more compact 7-day overview and allow expansion.

---

## 3.3 Check-in is too sequential for a daily habit

The current flow presents six subjective values as separate steps, followed by safety/availability steps.

This is too much interaction for an action that may happen every morning.

### Target

Convert the normal daily check-in into a single-screen rapid input form.

The user should usually be able to complete it without changing screens.

---

## 3.4 Readiness summary semantics are misleading

The current Home summary averages dimensions including:

- readiness,
- sleep quality,
- fatigue,
- soreness,
- mental stress,
- motivation.

Fatigue, soreness, and stress are negative dimensions, so simple averaging can produce a high "readiness" score when those negative dimensions are high.

### Target

Do not use the current simple mean as a readiness score.

Preferred solution:

- display **subjective readiness** directly from the explicit readiness input,
- display the engine's load mode separately,
- optionally show concise supporting signals.

Example:

```text
READY TO TRAIN
Normal load

Subjective readiness 8/10
Garmin recovery: good
```

If a composite score is desired later, define it explicitly and test its directionality.

---

## 3.5 "Reveal recommendation" adds friction to the primary workflow

The current Decision Journal design delays the recommendation until the user actively reveals it.

This is valuable for experimentation, but it conflicts with the primary mobile use case.

### Target

Make prediction/journal behavior optional.

Possible UI:

```text
Today's plan is ready

[See today's plan]

Optional:
Predict the coach decision first
```

The normal daily path should not require journaling.

---

## 3.6 Training mode still feels like regular navigation

The structured session runner is functionally strong, but normal app navigation remains globally present.

### Target

Treat an active workout as a dedicated mode.

Hide normal bottom navigation during active session execution.

Prioritize:

- current step,
- target,
- timer,
- current input,
- primary action.

---

# 4. Target Mobile Information Architecture

## 4.1 Bottom navigation

Recommended mobile bottom navigation:

1. **Today**
2. **Check-in**
3. **Plan**
4. **More**

### Why

- `Today` represents the primary daily decision surface.
- `Check-in` is a daily action and deserves direct access.
- `Plan` supports week-level planning and imported plans.
- `More` contains settings, goals, detailed data, AI export, account actions, etc.

### Move out of permanent bottom nav

- Goals
- Detailed Data
- Training Setup
- Preferences
- Structured Sessions authoring/import
- AI context export

These remain accessible through More.

---

# 5. Target Home Screen States

The Home screen should be state-driven.

---

## 5.1 State A — Garmin synced, check-in missing

### Layout

```text
Adaptive Coach                           Garmin synced 09:05

Good morning

Complete your morning check-in
~10 seconds

[ Start check-in ]

Sleep 91     HRV 69     RHR 41     Battery 82
```

### Rules

- Do not render the full weekly plan above the fold.
- Do not show detailed recommendation placeholders.
- Do not show the Decision Journal as a primary card.
- If Garmin data is unavailable, replace the metric strip with a clear data-state message.

### Primary action

**Start check-in**

---

## 5.2 State B — safety check incomplete

### Layout

```text
Today's decision needs one more check

Pain / illness information is required before
the coach can safely recommend a session.

[ Complete safety check ]
```

### Rules

- Safety state must override aesthetics.
- Avoid presenting a normal recommendation until engine requirements are satisfied.

---

## 5.3 State C — check-in complete, normal recommendation ready

### Layout

```text
TODAY

Ready to train                         NORMAL LOAD

Subjective readiness 8/10
Garmin recovery good

TODAY'S TRAINING

🚴 VO₂ 30/15 Repeated Aerobic Power

Hard · 60–75 min · Cycling

Repeated aerobic-power intervals while
maintaining controlled execution quality.

[ Start workout ]

Details              Export
```

Optional collapsed section:

```text
Why this today?  ›
```

Below:

```text
THIS WEEK

W   T   F   S   S   M   T
●   ○   ⚽  🚴  ○   🏋  ○

[ View full week ]
```

---

## 5.4 State D — modified/reduced recommendation

Use stronger visual differentiation, but not alarmist styling.

Example:

```text
TODAY

Train, but reduce load                 REDUCED LOAD

Main reason
Quadriceps soreness is elevated versus your normal.

TODAY'S TRAINING

🚴 Aerobic endurance
45–60 min · Easy–Moderate

[ Start workout ]
```

Expandable:

- Why reduced?
- What changed from plan?
- Safety constraints
- Full engine rationale

---

## 5.5 State E — recovery day

Example:

```text
TODAY

Recovery recommended                   RECOVERY DAY

High accumulated strain + poor overnight recovery.

Suggested:
30–40 min easy spin or full rest

[ View recovery options ]
```

Do not present the state as a failure.

---

# 6. Phase 1 — Core Daily Flow

This phase provides the largest UX gain and should be implemented first.

---

## 6.1 Task 1 — Introduce mobile layout tokens

### Files

Likely:

- `app/src/index.css`
- `app/src/App.css`
- `app/src/components/Home.css`
- shared CSS variables if appropriate

### Add design tokens

Suggested variables:

```css
--mobile-page-gutter: 16px;
--mobile-card-padding: 16px;
--mobile-section-gap: 16px;
--mobile-compact-gap: 8px;
--touch-target-min: 44px;
--radius-card: 14px;
--radius-control: 10px;
```

### Acceptance criteria

- No double page gutter on Home.
- Cards use consistent spacing.
- At 360 px viewport width, recommendation titles remain readable.
- No horizontal scroll.

---

## 6.2 Task 2 — Rebuild Daily Check-in as a rapid single-page form

### Primary files

- `app/src/components/DailyCheckin.tsx`
- `app/src/components/DailyCheckin.css`
- related tests

### UX structure

#### Header

```text
Morning Check-in
Today · Aug 19
```

#### Six subjective dimensions

Use compact rows.

Example:

```text
Readiness       8
[────────●──]

Sleep           9
[─────────●─]

Fatigue         2
[─●────────]

Soreness        4
[───●──────]
```

Repeat for stress and motivation.

### Important label semantics

Because some scales are positive and some negative, show explicit endpoint labels.

Examples:

**Readiness**
`1 Not ready — 10 Fully ready`

**Fatigue**
`1 Fresh — 10 Exhausted`

**Soreness**
`1 None — 10 Severe`

**Stress**
`1 Low — 10 Extreme`

This prevents ambiguity.

### Safety section

Default collapsed/compact:

```text
Pain or injury       No
Illness symptoms     No
Already trained      No
Limited time         No
```

If pain/injury = Yes:

expand tissue-response UI.

If illness = Yes:

show relevant warning / engine implication.

### Availability

Compact:

```text
Available today       75 min
Preferred modality    Any
Environment           Either
```

Avoid over-emphasizing fields the engine can safely default.

### Sticky footer CTA

```text
[ Save & see today's plan ]
```

### Persistence

Preserve existing Firestore schema and `checkinService` behavior.

### Editing existing check-in

When today's check-in already exists:

- load values directly into the same form,
- use CTA `Save changes`,
- avoid routing into a separate post-submission summary unless explicitly requested.

### Post-submission comparison

The current comparison of subjective vs wearable data can remain, but it should become:

- a secondary "Compare with Garmin" expandable section,
- not the mandatory landing state after check-in.

### Acceptance criteria

- Normal check-in can be completed on one screen.
- No step-by-step page navigation required for normal case.
- All existing check-in fields remain persistable.
- Tissue-response flow remains available when needed.
- Existing safety semantics are preserved.
- The CTA can save and navigate directly to Today/Home.
- At 360 px, all controls remain usable without horizontal scroll.
- Minimum touch target 44 px for toggles/buttons.

---

## 6.3 Task 3 — Fix displayed readiness semantics

### Primary file

- `app/src/components/Home.tsx`

### Remove

The simple average of positive and negative dimensions.

### Replace with

Preferred first iteration:

```ts
const subjectiveReadiness = decisionInput?.subjectiveCheckin?.readiness ?? null;
```

Display:

- explicit subjective readiness,
- engine mode (`train`, `modify`, `recover`),
- Garmin state separately.

### Do not

Create a new arbitrary composite score without explicit design and tests.

### Acceptance criteria

- High fatigue can no longer increase displayed "readiness".
- High soreness can no longer increase displayed "readiness".
- Home labels match underlying semantics.

### Tests

Add unit tests for display model / helper if extracted.

Examples:

- readiness=9, fatigue=9 → displayed subjective readiness remains 9, but no fake composite.
- readiness=3, fatigue=1 → displayed readiness is 3.
- missing subjective readiness → no misleading numeric score.

---

## 6.4 Task 4 — Refactor Home into a state-first mobile layout

### Primary files

- `app/src/components/Home.tsx`
- `app/src/components/Home.css`

### Recommended new subcomponents

Extract components rather than continuing to grow `Home.tsx`.

Potential structure:

```text
components/home/
  TodayStatusCard.tsx
  TodayRecommendationCard.tsx
  RecoveryMetricStrip.tsx
  MobileWeekOverview.tsx
  HomeSecondarySections.tsx
```

Do not force this exact structure if it creates unnecessary churn, but Home is already large enough that extraction is justified.

### Above-the-fold order

1. action-needed banner / check-in CTA
2. today's state
3. today's training recommendation
4. compact week preview

### Move below / collapse

- profile completeness
- Decision Journal
- detailed recovery metrics
- goals preview
- training restrictions
- full weekly critique
- detailed data CTA

### Acceptance criteria

After completed check-in, a user can identify within one viewport:

- current state,
- session title,
- duration,
- intensity/load,
- Start action.

---

## 6.5 Task 5 — Make Start the primary recommendation action

### Current actions

The recommendation area can contain:

- view workout,
- start session,
- load adjustment,
- export,
- rationale,
- prescription.

### Target hierarchy

Primary:

```text
[ Start workout ]
```

Secondary:

```text
Details      Export
```

Tertiary:

```text
Adjust load
Why this today?
```

### Rules

If the session is already active:

```text
[ Resume workout ]
```

If no executable structured binding exists:

- allow workout details/export,
- do not show a dead Start button.

### Acceptance criteria

- only one visually dominant CTA,
- Start/Resume is reachable without expanding details,
- Export remains accessible in no more than one extra tap.

---

## 6.6 Task 6 — Make Decision Journal optional

### Primary file

- `app/src/components/Home.tsx`
- `DecisionJournalCard.tsx` if required

### Target behavior

Do not block the recommendation by default.

Possible pattern:

```text
Optional
Predict today's coach decision first
```

If selected:

- reveal Decision Journal interaction,
- preserve existing journal/audit behavior.

### Migration approach

Safest first version:

- keep existing journal persistence unchanged,
- remove its use as a mandatory visual gate,
- retain existing `recommendationRevealed` semantics only inside journal interaction if necessary.

### Acceptance criteria

- normal mobile user can see today's recommendation without journaling,
- journal feature still works,
- persisted decision data remains valid,
- replay/audit behavior unaffected.

---

## 6.7 Task 7 — Fix ExternalPlanWeek mobile layout

### Primary files

- `app/src/components/ExternalPlanWeek.tsx`
- `app/src/components/ExternalPlanWeek.css`

### Mobile breakpoint

At approximately `max-width: 600px`:

Change `.external-week-day` from:

```css
grid-template-columns: 5.5rem 1fr;
```

to a stacked layout.

Example:

```css
.external-week-day {
  display: block;
}

.external-week-daylabel {
  flex-direction: row;
  gap: .4rem;
  align-items: baseline;
}

.external-week-session {
  display: grid;
  grid-template-columns: auto 1fr;
}

.external-week-session-actions {
  grid-column: 1 / -1;
}
```

Exact implementation can vary.

### Additional change

Home should not necessarily render the full external week card by default.

Create a compact week summary for Home and keep the full plan in Plan screen.

### Acceptance criteria

- long titles wrap naturally by phrase/line, not one word per line,
- actions do not squeeze the title,
- no overflow at 360 px,
- full workout details remain usable.

---

# 7. Phase 2 — Navigation and Workout Mode

---

## 7.1 Task 8 — Change bottom navigation

### Primary files

- `app/src/components/MobileNav.tsx`
- `app/src/App.tsx`
- navigation type definitions

### Target

```text
Today | Check-in | Plan | More
```

### Mapping

- Today → `home`
- Check-in → `checkin`
- Plan → imported/rolling plan view
- More → drawer

### Move Goals to More

Goals remain important but are infrequently edited.

### More drawer recommended order

1. Goals
2. Detailed Data
3. Training Setup
4. Coach Preferences
5. Structured Sessions
6. Import Training Plan
7. Export Context for AI
8. Sign out

Exact order can be refined after usability testing.

### Acceptance criteria

- primary workflow requires fewer nav transitions,
- active screen is clearly indicated,
- More remains keyboard/focus accessible.

---

## 7.2 Task 9 — Hide normal bottom nav during active workout

### Primary file

- `app/src/App.tsx`

### Logic

When:

- structured session is in progress, or
- strength session is in progress,

and current screen is the active runner:

do not render normal mobile bottom nav.

### Provide instead

A workout-specific exit/back affordance.

### Acceptance criteria

- no accidental navigation taps during workout,
- user can still safely exit or minimize session,
- active session can be resumed afterward.

---

## 7.3 Task 10 — Create workout-mode visual hierarchy

### Primary files

- `app/src/components/session/SessionRunner.tsx`
- `app/src/components/session/SessionRunner.css`
- strength runner files if needed

### Top bar

Target:

```text
← Exit                     31:42
VO₂ 30/15
Set 4 of 8
```

### Active step

The current step is the main object.

For interval:

```text
WORK
00:24

Target 340–360 W
Cadence 95–105 rpm
```

For strength:

```text
BACK SQUAT

80 kg × 6
RPE 7.5

[ Log set ]
```

### Secondary information

Collapse or visually de-emphasize:

- full session ribbon,
- old logged entries,
- notes,
- completed blocks,
- future steps.

### Sticky action

Where safe, keep the primary logging control near the bottom thumb zone.

### Acceptance criteria

- current step is obvious within one second,
- primary action is reachable with one hand,
- no persistent unrelated app navigation,
- timers and safety stop conditions remain visible.

---

# 8. Phase 3 — Polish and Secondary Screens

---

## 8.1 Task 11 — Compact recovery presentation

### Home

Show 3–4 key metrics only.

Example:

```text
Sleep 91
HRV 69
RHR 41
Battery 82
```

### Detailed Data

Keep richer:

- baselines,
- 7d/28d deltas,
- telemetry,
- history.

### Acceptance criteria

- Home metrics scan in <2 seconds,
- detailed information remains accessible elsewhere.

---

## 8.2 Task 12 — Typography hierarchy

Suggested mobile hierarchy:

- page title: 20–22 px
- major state: 22–26 px
- workout title: 20–22 px
- card heading: 15–16 px
- body: 14–16 px
- metadata: 12–13 px

Avoid excessive uppercase text.

Use uppercase primarily for:

- small badges,
- modality/state labels.

---

## 8.3 Task 13 — Standardize card styling

Current styling uses several similar but slightly different dark surfaces.

Create a small consistent system:

- page background
- primary card
- elevated/interactive card
- info strip
- warning surface
- danger/safety surface

Do not redesign the entire color palette in Phase 1.

---

## 8.4 Task 14 — Standardize action hierarchy

### Primary button

Use for one action only.

Examples:

- Start check-in
- Save & see today's plan
- Start workout
- Log set
- Complete session

### Secondary button

Examples:

- Export
- Details
- Edit check-in

### Tertiary/text

Examples:

- Why this today?
- View full week
- Manage goals

---

## 8.5 Task 15 — Improve empty/loading/error states

Examples:

Instead of:

```text
Unable to compute recommendation yet.
```

Prefer:

```text
Today's plan isn't ready yet

Garmin recovery data is still missing.
Try syncing again or check back after Garmin finishes processing sleep.
```

With one relevant action.

---

# 9. Responsive Breakpoints and Device Matrix

## Required test widths

Use at least:

### 360 px wide

Purpose:

- narrow Android baseline,
- catches layout compression bugs.

### 390 px wide

Purpose:

- preserve existing Playwright mobile baseline.

### 412 px wide

Purpose:

- representative wider Android viewport.

### Desktop

Keep current desktop visual regression coverage.

---

# 10. Xiaomi 14T Pro Acceptance Testing

The Xiaomi 14T Pro should be the final real-device acceptance environment.

Test with:

- Chrome
- installed PWA mode if used
- portrait orientation
- system font scaling default
- at least one test with larger text scaling if practical

## Key scenarios

### Scenario 1 — morning flow

1. Open app.
2. Verify Garmin sync status is visible but not dominant.
3. Tap Check-in.
4. Complete all normal subjective values.
5. Save.
6. Arrive on Today.
7. Identify state and workout in one viewport.
8. Start workout.

### Scenario 2 — injury flag

1. Set pain/injury = yes.
2. Verify tissue-response detail expands.
3. Save.
4. Confirm safe recommendation state.
5. Confirm "Harder" remains unavailable if required.

### Scenario 3 — reduced load

1. Use fixture causing modify mode.
2. Confirm reason for reduction is immediately visible.
3. Confirm workout CTA remains clear.

### Scenario 4 — weekly plan

1. Open Plan.
2. Find long VO₂ workout title.
3. Confirm title wraps naturally.
4. Expand workout.
5. Reschedule.
6. Confirm no horizontal overflow.

### Scenario 5 — active session

1. Start session.
2. Confirm bottom nav disappears.
3. Log several steps/sets.
4. Use timer/rest timer.
5. Exit.
6. Resume from active-session banner.

---

# 11. Visual Regression Harness Changes

The repository already contains a Playwright visual review flow.

Extend it rather than creating a separate screenshot system.

## Add projects / viewports

Recommended:

```text
visual-mobile-narrow   360 × 800-ish
visual-mobile          390 × 844
visual-mobile-wide     412 × 915-ish
visual-desktop         existing
```

Exact heights are less important than widths because full-page captures can handle vertical variation.

## Required fixtures/screens

Capture at least:

1. Home — check-in missing
2. Home — normal recommendation
3. Home — reduced recommendation
4. Home — recovery day
5. Check-in — normal
6. Check-in — pain expanded
7. Plan — full week
8. Session runner — active interval
9. Session runner — strength logging
10. Detailed recovery
11. More drawer

---

# 12. Functional Test Strategy

## 12.1 DailyCheckin

Tests should verify:

- all six subjective values save,
- negative scale labels are correct,
- pain flag expands tissue UI,
- pain flag off clears hidden tissue responses as before,
- availability persists,
- save returns to Today,
- editing existing check-in works.

## 12.2 Home

Tests should verify:

- check-in missing → check-in CTA,
- incomplete safety state → safety CTA,
- normal recommendation → Start CTA,
- modify → Reduced Load badge,
- recover → Recovery Day badge,
- displayed readiness uses correct semantics,
- journal does not block normal recommendation.

## 12.3 ExternalPlanWeek

Tests should verify behavior, while Playwright covers layout.

- expand workout,
- reschedule,
- choose alternative day,
- write failure,
- dropped session.

## 12.4 MobileNav

Tests:

- Today
- Check-in
- Plan
- More
- drawer focus trap
- Escape handling
- active state

## 12.5 Session Runner

Tests:

- active workout mode,
- current step,
- primary logging action,
- exit/resume.

---

# 13. Accessibility Requirements

Do not regress the accessibility work already present in the app.

## Requirements

- minimum touch targets: 44 × 44 px
- clear focus-visible states
- labels connected to sliders/controls
- do not rely only on color for training mode
- reduced/normal/recovery state has textual label
- drawer remains keyboard trapped while open
- safe Escape behavior
- workout timer does not rely on animation alone
- expandable rationale uses `aria-expanded`
- dialogs/bottom sheets receive meaningful labels

---

# 14. Performance Considerations

The redesign should not add a heavy UI framework unless there is a clear benefit.

Current React + CSS is sufficient.

## Prefer

- CSS
- small focused components
- existing lazy loading
- existing data services
- existing state logic

## Avoid in Phase 1

- component-library migration
- animation library
- icon package migration
- global state rewrite
- routing rewrite
- backend schema changes

---

# 15. Suggested Code Structure

This is optional but recommended to reduce `Home.tsx` complexity.

```text
app/src/components/home/
  TodayActionGate.tsx
  TodayStatusSummary.tsx
  TodayRecommendationCard.tsx
  RecoveryMetricStrip.tsx
  MobileWeekOverview.tsx
  WhyTodayDisclosure.tsx
```

Potential check-in extraction:

```text
app/src/components/checkin/
  SubjectiveScaleRow.tsx
  SafetyFlags.tsx
  AvailabilityCompact.tsx
  TissueResponseEditor.tsx
```

Use extraction only where it improves readability/testing.

---

# 16. Rollout Plan

## PR 1 — Mobile foundation + check-in

Scope:

- spacing tokens
- remove duplicate mobile gutters
- one-page check-in
- check-in navigation
- visual fixtures

Goal:

improve the first half of the morning flow without touching recommendation semantics.

---

## PR 2 — Today/Home redesign

Scope:

- Home state architecture
- fix readiness display
- recommendation CTA hierarchy
- optional Decision Journal
- compact Garmin strip
- compact week preview

Goal:

complete:

`check-in → understand today → start/export`

---

## PR 3 — Plan mobile redesign

Scope:

- ExternalPlanWeek responsive redesign
- Plan tab
- long-title fixes
- rescheduling UX polish

---

## PR 4 — Workout mode

Scope:

- hide global bottom nav during active session
- session runner hierarchy
- sticky primary actions
- active session resume flow

---

## PR 5 — polish

Scope:

- typography
- component consistency
- secondary screens
- empty/loading/error states
- accessibility pass
- visual cleanup

---

# 17. Definition of Done

The redesign is considered successful when all of the following are true.

## Morning flow

- user can complete normal check-in without moving through multiple pages,
- Home immediately shows today's state,
- workout title and key metadata fit naturally on mobile,
- Start workout is visually dominant,
- Export is available with at most one secondary interaction.

## Comprehension

Within roughly five seconds after check-in, the user can answer:

- Am I good to train?
- Is load normal/reduced/recovery?
- What is the workout?
- How long?
- What do I do next?

## Layout

- no horizontal scrolling at 360, 390, or 412 px,
- no one-word-per-line workout titles,
- no overlapping buttons,
- no content hidden behind bottom navigation,
- safe-area insets respected.

## Training

- active session uses dedicated workout mode,
- current action is dominant,
- normal bottom nav is hidden,
- session can be resumed reliably.

## Safety

- pain/illness pathways remain intact,
- safety restrictions stay visible,
- recommendation eligibility is unchanged,
- harder-load restrictions are preserved.

## Engineering

- `npm run check` passes,
- existing engine tests pass,
- Firestore rules unaffected unless intentionally changed,
- visual regression captures refreshed,
- mobile narrow/standard/wide viewports pass manual review.

---

# 18. Prioritized Backlog

## P0 — must do

- [x] Remove duplicate mobile horizontal gutters.
- [x] Convert normal daily check-in to one page.
- [x] Fix readiness summary semantics.
- [x] Redesign Home around today's state and action.
- [x] Make Start/Resume the dominant CTA.
- [x] Stop Decision Journal from blocking the normal daily workflow.
- [x] Fix ExternalPlanWeek mobile title/action layout.
- [x] Add 360 / 390 / 412 mobile visual coverage.

## P1 — high value

- [x] Change bottom navigation to Today / Check-in / Plan / More.
- [x] Create compact Home week strip.
- [x] Hide global nav during active workout.
- [x] Simplify SessionRunner around current step.
- [x] Make recommendation rationale collapsible.
- [x] Compact Garmin metric strip.

## P2 — polish

- [x] Standardize card variants.
- [x] Standardize button hierarchy.
- [x] Standardize typography.
- [x] Improve empty states.
- [x] Improve error/retry states.
- [x] Review More drawer information architecture.
- [x] Review Goals and Detailed Data mobile screens.

---

# 19. Explicit Non-Goals for Initial Redesign

Do not combine the mobile redesign with unrelated architectural work.

Out of scope initially:

- Garmin ingestion changes
- recommendation-engine algorithm changes
- fatigue model calibration
- Firestore schema redesign
- auth redesign
- desktop redesign
- new chart library
- new component framework
- new router
- backend API migration
- PWA infrastructure rewrite

The exception is the misleading readiness summary on Home because it directly affects the user's interpretation of the UI.

---

# 20. Recommended First Implementation Slice

If implementation needs to start with the smallest coherent slice, do this first:

1. Remove duplicate Home/check-in mobile padding.
2. Implement `SubjectiveScaleRow`.
3. Render all six readiness dimensions on one page.
4. Keep safety + availability below them.
5. Save and navigate to Today.
6. Replace Home's composite readiness with explicit subjective readiness.
7. Move today's state + workout card above the weekly plan.
8. Make Start workout full-width primary CTA.
9. Add a 360 px Playwright visual capture.
10. Verify on Xiaomi 14T Pro.

This slice provides a meaningful UX improvement without requiring a broad rewrite.

---

# 21. Success Metric

The main qualitative success metric:

> A user should be able to open the app in the morning, enter subjective state, understand the recommendation, and start the session without thinking about the app's architecture.

A practical interaction target:

- **normal check-in:** ~5–15 seconds
- **understand today's state:** ≤5 seconds
- **start workout after check-in:** ≤2 taps
- **export workout after check-in:** ≤3 taps

The app can remain technically deep while the daily mobile interaction becomes simple.
