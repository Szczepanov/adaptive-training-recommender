# User flows

Living reference for how navigation and user flows work today. Design rationale lives in
ADRs and in `mobile_ux_implementation_plan`; this document describes current behaviour.
When this document and code disagree, the code wins.

Related:

* `navigation.ts` `Screen` — the single route type.
* `App.tsx` `App`, `loadDecisionInput`, `handleNavigate` — routing authority.
* `AccountScopedApp.tsx` `AccountScopedApp` — account-scoped remount.
* `Header.tsx` `Header`, `MobileNav.tsx` `MobileNav` — desktop vs mobile chrome.
* `morning-decision-ux.md` — Home disclosure, confidence, alternatives contracts.
* `account-scoped-ui-state.md` — auth isolation invariant.
* `session-execution.md` — saved-template lifecycle.

## Global shell

There is no URL router. `App.tsx` `screen` state is the router.

### Auth gate

`AuthContext.tsx` `AuthContext` resolves `AuthPhase` (`CHECKING` / `LOGIN` / `AUTHENTICATED`)
via Firebase `onAuthStateChanged`. First login runs `initializeUserData`: creates default
preferences and v3 training settings under `users/{uid}/...`.

* `authPhase !== AUTHENTICATED` → only `LoginScreen.tsx` `LoginScreen` renders.
* Authenticated but decision input not yet composed for this `uid` → blocking
  `Loading today's check-in status...`. This prevents a Home flash before the check-in
  gate is known.
* `AccountScopedApp.tsx` `AccountScopedApp` keys `App` by `user:${uid}` (`anonymous`
  while logged out), so switching accounts remounts the whole UI subtree. See
  `account-scoped-ui-state.md` for the invariant.

### Daily auto-route

`App.tsx` `loadDecisionInput` composes `decisionComposer.composeDailyDecisionInput`
and then chooses the first screen:

* `hasCompletedSubjectiveCheckinForDecision(input)` true → `home`.
* Otherwise → `checkin`.
* On composition failure → fail toward `checkin` (that screen reads its own daily
  document and still offers a Dashboard escape hatch).

Re-routing on a new calendar day only happens while already on `home` or `checkin`,
checked on focus / visibility change / 60s interval. It never ejects `sessions`,
`testing`, `plan`, or other workflows mid-task.

`App.tsx` `handleNavigate` only sets `currentScreenRef` / `screen` and closes the
desktop `Settings` dropdown and mobile `More` drawer. Returning to `home`/`checkin`
across midnight triggers a reload.

### Overlays and banners

* `OnboardingWizard.tsx` `OnboardingWizard` is a modal overlay, not a `Screen`. It shows
  when `!onboardingDismissed && decisionInput.activeGoals.length === 0`. Dismissal is
  persisted per-user in `onboardingStorage.ts` (`adaptive_training_onboarding_done_{uid}`).
* Resume banners sit above `<main>`:
  * legacy Strength v1 open document → `Close legacy session` (transitions to `abandoned`,
    no resume in old UI).
  * `sessionExecutionService.findInProgressExecution` hit → `Resume session`, routed to
    `sessions` or `testing` based on resolved `SessionIntent`.
* Chrome hiding: `Header` hides during an in-progress runner in `sessions`/`testing`;
  `MobileNav` hides on `checkin` and during an in-progress runner.

## Screens

`navigation.ts` `Screen`:

`home` | `checkin` | `goals` | `constraints` | `preferences` | `data` | `plan` | `brief` | `sessions` | `testing`

| Screen | Component | Purpose |
|---|---|---|
| `home` | `Home.tsx` `Home` | Today dashboard: recommendation, alternatives, adherence, week-ahead |
| `checkin` | `DailyCheckin.tsx` `DailyCheckin` | Morning subjective + safety + availability input |
| `goals` | `Goals.tsx` `Goals` | Goals / target events CRUD driving periodization and taper |
| `constraints` | `TrainingSettings.tsx` `TrainingSettings` | Hard gates: equipment, safety limits, time/location, injury constraints |
| `preferences` | `Preferences.tsx` `Preferences` | Soft preferences: modalities, style, capabilities, connections |
| `data` | `DataView.tsx` `DataView` (+ `HealthAnomalyShadowPanel`, `IdentityReviewCard`) | Read-only telemetry inspector, 9 tabs |
| `brief` | `DataView` with `initialTab="brief"` | Export context for AI (same component, different entry tab) |
| `plan` | `PlanView.tsx` `PlanView` | 7-day week architecture: coach plan vs AI forecast |
| `sessions` | `session/SessionRunner.tsx` `SessionRunner` (+ `SessionJsonImport`, `ManualSessionBuilder`) | Execute / author structured sessions |
| `testing` | `testing/TestingWorkflow.tsx` `TestingWorkflow` | Locked protocol assessments → raw observations |

There are no dedicated `login` or `onboarding` routes; both are conditional renders.

## Navigation chrome

Desktop (`Header.tsx` `Header`) and mobile (`MobileNav.tsx` `MobileNav`) expose the
same ten screens with opposite prominence.

| Screen | Desktop | Mobile |
|---|---|---|
| `home` | `Home` link + brand `⚡ Adaptive Coach` | Bottom `🏠 Today` |
| `checkin` | `Check-in` link | Bottom `✓ Check-in` |
| `plan` | `Settings ▾` → `📋 Import Training Plan` | Bottom `📋 Plan` (top-level) |
| `sessions` | `Sessions` link | `More` drawer → `🚀 Structured Sessions` |
| `testing` | `Testing` link | `More` drawer → `🧪 Protocol Testing` |
| `goals` | `Goals` link | `More` drawer → `🎯 Goals & Target Events` |
| `data` | `Data` link (runs `loadDecisionInput` first) | `More` drawer → `📊 Detailed Data` |
| `brief` | `Settings ▾` → `📤 Export Context for AI` | `More` drawer → `📤 Export Context for AI` |
| `constraints` | `Settings ▾` → `⚙️ Training Setup` | `More` drawer → `⚠️ Training Setup` |
| `preferences` | `Settings ▾` → `⚙️ Coach Preferences` | `More` drawer → `⚙️ Coach Preferences` |

Notes:

* Desktop `Settings` active state covers `constraints` / `preferences` / `plan` (omits
  `brief`). Mobile `More` active state covers `goals` / `constraints` / `preferences` /
  `data` / `brief` / `sessions` / `testing`.
* Only desktop shows `GarminSyncBadge.tsx` `GarminSyncBadge` next to the brand.
* Both chrome menus end with non-clickable `Build {label}` and `Sign Out`.

## Flows

### 1. Sign-in

Entry: automatic when logged out.

`LoginScreen.tsx` `AuthMode`:

1. `sign-in`: email + password → `emailAuthService.signIn`. Links to `sign-up` and
   `forgot-password`. Secondary `Continue with Garmin` → `garmin` mode.
2. `sign-up`: email + password + confirm → `emailAuthService.signUp`. Anti-enumeration
   wording on `email-already-in-use`.
3. `forgot-password`: email → `requestPasswordReset` → uniform
   `If an account exists...` confirmation → back to sign-in.
4. `garmin`: Garmin email + password → `garminAuthService.startLogin`; if
   `mfa_required`, OTP step → `completeMfa` → `signInWithCustomToken`.

Exit: success flips `onAuthStateChanged` to `AUTHENTICATED`; no explicit navigate.
Confusing today: "Garmin login" (auth into the app) vs `Preferences`
`GarminConnectionSection` (link wearable for sync) share credential phrasing but are
different tasks.

### 2. First run / onboarding

Entry: automatic overlay on first authenticated load with zero active goals.

`OnboardingWizard.tsx` steps: `Welcome` → `Focus` (`general_fitness` / `running` /
`cycling` / `triathlon` / `strength`) → `Equipment` + sport access + `ExerciseDaysSlider`
(1–7, default 4) → `Generate Today's Recommendation`.

Writes (in order): `trainingSettingsService.updateTrainingSettings` (equipment map,
weekday/weekend time defaults) → `trainingIntentProfileService.upsert` (evergreen
priority + weekly commitment) → `goalService.createGoal` only if still goal-less.
Failures stay in the wizard with selections intact for retry. Creating the goal last
is deliberate: the goal is the onboarding-complete signal, so it must not suppress the
wizard before settings persist (see `morning-decision-ux.md` `Rapid onboarding completion`).

Today there is no Skip; storage-blocked browsers see the wizard on every refresh.

### 3. Daily core loop (the happy path)

Intended order: `checkin` → `home` → `sessions` → back to `home` next day.

1. Athlete lands on `checkin` (auto-routed if yesterday/today subjective is incomplete).
2. Completes `DailyCheckin` → `upsertTodayCheckin` → `onCheckinSaved` reloads decision
   input → `onNavigate('home')`.
3. `Home` composes the day (`decisionComposer.composeDailyDecisionInput`), applies
   fail-closed gates (see below), evaluates `evaluateTrainingWithIntent`, binds
   `primarySession`, persists via `recommendationService.saveRecommendation`, and shows
   the morning card (What / Why / What-would-change-it per `morning-decision-ux.md`).
4. Athlete optionally picks easier/harder or a one-tap alternative, then `Start session`
   → `onStartSession(binding)` resolves via
   `sessionDefinitionResolver.resolveSessionDefinition` → `sessions`.
5. `SessionRunner` executes and completes/abandons → `onClose` → `home`.
6. Next morning, `AdherencePrompt` / `LaterDayFollowupCard` / tissue follow-ups reconcile
   yesterday before the new recommendation.

Fail-closed gates on `Home` (and mirrored in `PlanView`): `INVALID`/`UNAVAILABLE`
recovery snapshot, goals, preferences, or training settings block the recommendation and
offer repair (`Review goals/preferences/training settings`, `GarminSyncNowButton`).
Wearable `sync_required`/`unavailable` shows a sync block instead of a stale plan.
`StaleDecisionError` on intraday claims forces a full reload rather than a partial write.

### 4. Check-in in detail

`DailyCheckin.tsx` `DailyCheckin` order:

1. Yesterday follow-up: pending tissue follow-ups plus `relevantFollowupRegions` derived
   from yesterday `sessionExecution` tissue tags, one at a time (Answer `normal` /
   `mild` / `moderate` / `severe`, auto-upserts plus `sessionResponseService`
   `next_morning`, or Skip).
2. Subjective Recovery: six 1–10 sliders (`readiness` / `sleepQuality` / `fatigue` /
   `soreness` / `mentalStress` / `motivation`, three inverted) + `Use typical values`.
3. Health & Safety: `painOrInjury` / `illnessSymptoms` / `alreadyTrainedToday` toggles,
   four red flags (`neurological` / `acute_trauma_structural` / `systemic_infection` /
   `rapidly_worsening`), `PhysicalWorkSection`, `HealthContextSection`,
   `Local Tissue Response` cards (region → morning state → pain-during / after-training /
   next-morning reaction; `severe` auto-sets `painOrInjury`).
4. Availability: `timeAvailableMin` (prefilled from preferences with source hint),
   `preferredModalityToday`, `indoorOnly`, notes.
5. Collapsible `Garmin Context` — only revealed after the first complete submit
   (anti-anchoring: wearable values hidden until subjective is captured).
6. `Save & see today's plan` / `Update & see today's plan` → home.

Exits: `Skip/Back to Dashboard` → `home` without saving; `View Today's Plan` when already
submitted. Partial saves are allowed but only fully-scored days enter subjective baselines.

### 5. Sessions: run, import, build

`SessionRunner.tsx` `SessionRunner` states in order: restoring → companion prompt
(post-finish, time-gated) → picker → active run → `SessionCompletionSheet`.

* Picker: `Your custom templates` (Preview / Start / Edit / Duplicate / Archive +
  archived toggle) + built-in fixtures (Preview / Start) + `Import` (`SessionJsonImport`)
  + `Build` (`ManualSessionBuilder`).
* Active run: timer/sync/sound/save-template bar, step pills, active-step panel with
  Swap, input cards (`Repetition` / `Duration` / `Distance` / `Checkoff` / `ChoiceCard`),
  advisory rest preview, `GroupProgress`, editable performed list, Undo toast.
* Completion: complete/abandon → companion occurrence or `onClose` → `home`.
  `StrengthOverloadHistory` renders below the runner at the `App.tsx` level.

`App.tsx` `sessionAuthoringMode` swaps the whole `sessions` screen between `import`,
`manual`, and runner. Three creation paths (fixture / saved / import / build) plus the
save-as-template loop is the richest — and most confusing — part of this flow.
Companion sessions are separate executions and are easily mistaken for the next block.
A missing stored prescription (`Active session needs its stored prescription`) blocks
starting another session until resolved.

### 6. Week plan

`PlanView.tsx` `PlanView` loads fixed activities + plan blocks + decision input, applies
the same fail-closed and wearable gates as Home, then resolves `resolveTrainingIntent`
and critiques with `critiqueExternalWeek` / `evaluateTrainingWithIntent` /
`generateWeekAheadPlanWithIntent`.

Two views when an imported plan exists:

* `📋 Coach's Plan ({title})` — `ExternalPlanWeek` (move/replace session,
  `proposeReplacement` / `applyConfirmedProposal`).
* `🤖 AI Adaptive Forecast` — `WeekAheadStrip` with green/yellow/red confidence tiers.

Without an active plan, only the evergreen forecast shows plus a subtle
`Have a coach's plan? Import it` affordance; `📥 Import/Revise Plan` toggles
`ExternalPlanImport`. The screen always ends with `ScheduleOverlayCard`. Exit via
`onNavigate(checkin/goals/preferences/constraints)`; `onPlanChanged` reloads the
dashboard. Today the imported plan, the AI forecast, and the Home recommendation can
disagree with no single "follow this one" banner.

### 7. Goals and target events

`Goals.tsx` `Goals`: filter `active` / `archived` / `all` → grouped by category → per-card
`Edit` / `Pause`–`Reactivate` / `Archive` / `Delete` (archived only, with confirm) →
`GoalModal`.

Modal: title/description, `Open-ended` toggle (dated goals derive `category` via
`deriveGoalCategory`, read-only), target date, `This is a race/key event` →
`eventCategory` / `eventPreset` (`EVENT_PRESETS`) / `taperStartDate` / `eventLifecycle`
(`scheduled` / `completed` / `DNS` / `DNF` / `cancelled`, edit-only) / `targetOutcome`,
domain, priority ★1–5 (maps to taper class A/B/C), status (edit-only), optional
metric/value/unit. A side `EVENT PREPARATION` panel shows phase, countdown, priority,
and category when a focus event exists.

`paused` is invisible in the filter tabs (only `active` / `archived` / `all`), and the
accepted-but-unused `onNavigate` prop means repair flows cannot deep-link back cleanly.

### 8. Settings split: Training Setup vs Coach Preferences

Two screens own adjacent controls with different save models:

* `constraints` (`TrainingSettings.tsx` `TrainingSettings`, titled `Training Settings`):
  hard gates. Migration banner (`legacyReviewed`) → equipment (7 checkboxes, autosave) →
  safety limits (4 `avoid_*`, autosave) → time/location (weekday/weekend max,
  `either` / `indoor` / `outdoor`) → `preferActiveRecovery` → injury constraints
  (region / severity `monitor` / `limit` / `exclude` / restricted modalities / review-by /
  note + derived read-only restrictions). Every toggle autosaves with no undo.
* `preferences` (`Preferences.tsx`): soft tie-breakers. `GarminConnectionSection` +
  `GoogleHealthConnectionSection` + `HealthRunYogaPresetSection` (one-click preset) +
  `TrainingPlanSection` (planning mode, priorities, weekly commitment) +
  `ModalitySections` (preferred / avoided / unavailable) + `StyleSections` (recovery
  style, times, verbosity, units) + `PerformanceSections` (capabilities, 1RM) +
  `PreferencesFooter` (explicit Save/Reset with `hasChanges` / `saving`).

Overlap causing confusion: equipment vs unavailable modalities, time limits vs default
times, environment vs per-day `indoorOnly`; explicit Save vs autosave vs daily check-in
availability.

### 9. Data and AI export

`DataView.tsx` `DataView` is read-only (9 tabs): `Recovery` (raw/derived/deltas,
candidate baselines v4/v5, data quality) | `Activities` (7-day `ActivityTelemetry` or
canonical `CompletedWorkoutList` behind `VITE_TRAINING_OCCURRENCE_ACTIVITIES_POLICY`,
Copy All JSON / Download / Reclassify via `ActivityReclassificationModal`) |
`Strength History` | `Check-in` | `Goals` | `Training Settings` | `Preferences` |
`Adherence` (30-day followed/modified/skipped by `train` / `modify` / `recover`) |
`Context brief` (`daily` 2d vs `full` 14d, persisted in localStorage, Copy, char/token
count).

`brief` is the same component with `initialTab="brief"`. Entry always runs
`loadDecisionInput` first except the Home `onViewData` shortcut, which reloads then
navigates. `No data available` (null `decisionInput`) currently has no retry action.

### 10. Protocol testing

`testing/TestingWorkflow.tsx` `TestingWorkflow` stages: `lookup` (bundled cycling tests
+ manual `protocolId` + revision) → `ready` (protocol lock card: metrics / burden /
warmup / familiarization / invalidation + comparison context + purpose
`familiarization` / `baseline` / `checkpoint` / `post_block` → `Confirm lock and start`)
→ `running` (delegates to `SessionRunner`, syncs `AssessmentAttempt`
`scheduled` → `in_progress`) → `capture` (numeric metric values + validity
`valid` / `invalid` / `practice` / `questionable` + reason/note + device provenance +
re-enter context → `Save raw observation(s)`) → `complete` (revisions + `Correct`
appends a new revision) / `abandoned`. Open attempts auto-recover on mount.
`Close` / `Done` → `home`; `onSessionStateChange` drives the global resume banner.

The runner looks identical to `sessions`; only the banner differentiates them.
Abandonment is terminal (no resume), and a reload after execution requires manual
re-entry of the locked context.

## Known confusing spots (observed, not proposed)

1. Desktop promotes `sessions` / `testing` / `goals` / `data`; mobile promotes `plan`
   and buries the former in `More`. Muscle memory does not transfer.
2. `preferences` (soft) vs `constraints`/`Training Settings`/`Training Setup` (hard) vs
   per-day `checkin.availability` — three names and three save models for overlapping
   equipment/time/location controls.
3. Tissue has three homes: daily check-in tissue → persistent `TrainingSettings` injury
   constraints → session `next_morning` / `LaterDayFollowupCard` responses. Correct
   layering, hard to discover which governs today.
4. Imported coach plan vs AI forecast vs Home recommendation can disagree with no
   follow-this-one banner.
5. Three export-to-AI paths: `brief` screen vs `data` → `Context brief` tab vs `data` →
   `Activities` → Copy All JSON.
6. `sessions` vs `testing` share the runner UI; only the banner says which provenance
   you are in.
7. Dead ends: `DataView` no-data state (no retry), `PlanView` `INVALID` without repair
   navigation, `SessionRunner` prescription-missing lock, `TestingWorkflow` `abandoned`
   with only `Done`, `OnboardingWizard` with no skip.

## Recommendations for future flow improvements

Grouped, smallest-first. None of these are committed plans; they are candidates for
the next UX pass.

### IA and naming (highest leverage)

1. Unify screen names across desktop and mobile. Pick one label per `Screen` and use it
   in `Header`, `MobileNav`, and the screen title: e.g. always `Training Setup`
   (not `Training Settings` in the title and `Training Setup` in nav), always `Plan`
   (not `Import Training Plan` on desktop only).
2. Give `More` a real information architecture: group drawer items (`Train`: Sessions,
   Testing, Plan; `Configure`: Goals, Training Setup, Coach Preferences; `Understand`:
   Detailed Data, Export for AI) instead of one flat list with a single lumped active
   state.
3. Promote the same primary tabs on both form factors, or document why they differ.
   Today `plan` is bottom-level on mobile and buried on desktop; pick the daily-loop
   tabs (`Today` / `Check-in` / `Plan`) as global primaries and demote the rest
   symmetrically.

### Daily loop

4. Add a one-line "follow this one" banner when coach plan, AI forecast, and Home
   disagree, linking to the authoritative source for today (`PlanView` already computes
   both; it only needs the verdict copy).
5. Standardize fail-closed repair: every gate should offer the same triplet —
   what is missing, where to fix it (deep link), and retry. `Home` has three repair
   idioms today (navigate vs resync vs reload); `PlanView` `INVALID` sometimes offers
   none.
6. Make check-in progress explicit: a 4-step header (Follow-ups → Recovery → Safety →
   Availability) with partial-save state, so `Skip/Back` does not feel like data loss
   and `Update & see today's plan` reads as the normal path.

### Settings

7. Merge or visually pair the overlapping controls: show Training Setup (hard gates)
   and Coach Preferences (soft) as two tabs of one Settings surface with a shared
   explicit Save model, or at minimum cross-link equipment ↔ unavailable modalities
   and time limits ↔ default times inline.
8. Rename `constraints` route or title to match navigation (`Training Setup`), and fix
   the `Goals` unused `onNavigate` so repair buttons can deep-link back to the
   blocking screen.
9. Add undo / confirmation for autosaved destructive toggles in `TrainingSettings`
   (equipment, `avoid_*`, injury constraints); today every toggle writes immediately.

### Sessions and testing

10. Differentiate `sessions` vs `testing` chrome beyond the banner: tint the runner
    header, keep the `TestingWorkflow` lock card visible (collapsed) during `running`,
    and label the completion sheet with its provenance (`SessionExecution` vs
    `AssessmentAttempt`).
11. Collapse session creation from four entries (fixture / saved / import / build) to
    one `New session` entry with a chooser, and move save-as-template out of the active
    run bar so it cannot be tapped mid-set.
12. Make companion sessions unmistakable (e.g. `Follow-up — not the next block`) and
    make `TestingWorkflow` abandonment resumable or explicitly destructive with
    confirm copy.

### Onboarding and auth

13. Add Skip to `OnboardingWizard` (persist dismissal without a goal) and a settings
    entry to re-launch it; log wizard completion in `usabilityMetrics.ts` alongside
    recommendation TTR.
14. Disambiguate the two Garmin concepts in copy: `Sign in with Garmin` (auth) vs
    `Connect Garmin wearable` (sync). Never reuse the same credential phrasing.

### Data / export dead ends

15. One export path: keep `brief` as the canonical Export for AI surface and turn the
    `DataView` context-brief tab and activities Copy All into deep links to it.
16. Add retry to `DataView` `No data available` and repair navigation to `PlanView`
    `INVALID`; audit every terminal state (`abandoned`, prescription-missing,
    storage-blocked onboarding) for at least one forward action.
