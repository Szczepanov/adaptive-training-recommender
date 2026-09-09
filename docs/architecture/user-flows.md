# User flows

Living reference for how navigation and user flows work today. Design rationale belongs in
ADRs and implementation plans; this document describes current behaviour. When this document
and code disagree, the code wins.

## Source map and maintenance contract

Use the concrete paths below when checking this document. Prefer these source-of-truth files
over inferred component names or historical plans.

* `app/src/types/navigation.ts` `Screen` — the complete in-app route type.
* `app/src/main.tsx` — mounts `AuthProvider` and `AccountScopedApp`.
* `app/src/AccountScopedApp.tsx` `AccountScopedApp` — keys the `App` subtree by Firebase
  `uid` so account transitions replace account-scoped React state.
* `app/src/App.tsx` `App`, `loadDecisionInput`, `handleNavigate` — route state, daily
  auto-routing, global overlays/banners, screen rendering, and session launch plumbing.
* `app/src/components/Header.tsx` `Header` and `app/src/components/MobileNav.tsx`
  `MobileNav` — desktop and mobile navigation chrome.
* `app/src/contexts/AuthContext.tsx` `AuthProvider` — Firebase auth phase and background
  first-use/default-data initialization.
* `docs/architecture/morning-decision-ux.md` — Home disclosure, confidence, and
  alternatives contracts.
* `docs/architecture/account-scoped-ui-state.md` — account-isolation invariant.
* `docs/architecture/session-execution.md` — saved-template and structured-session
  lifecycle.

This file intentionally references symbols rather than line numbers. If navigation changes,
update this document in the same PR.

## Global shell

There is no URL router. `App.tsx` keeps a `Screen` value in React state and renders the
corresponding screen.

### Authentication and account isolation

`AuthProvider` resolves `AuthPhase` (`CHECKING` / `LOGIN` / `AUTHENTICATED`) via Firebase
`onAuthStateChanged`.

* During `CHECKING`, `LoginScreen` renders the authentication-checking state.
* During `LOGIN`, `LoginScreen` renders the sign-in/create-account/reset/Garmin-auth UI.
* During `AUTHENTICATED`, `App` becomes available after the initial daily route is resolved.
* `initializeUserData` runs in the background after an authenticated Firebase user is
  observed. It ensures default preferences exist and asks `trainingSettingsService` to
  create/migrate the typed training-settings profile. Authentication itself does not wait
  for this initialization to finish.
* `AccountScopedApp` keys `<App>` as `user:${uid}` (or `anonymous` while unauthenticated),
  replacing the whole account-scoped UI subtree when the authenticated identity changes.
  `App` also keeps explicit reset/cancellation guards as defense in depth for asynchronous
  work and date-scoped state.

See `account-scoped-ui-state.md` for the invariant and regression scenario.

### Initial and daily auto-route

`App.tsx` `loadDecisionInput` composes
`decisionComposer.composeDailyDecisionInput(userId)` and chooses the first authenticated
screen:

* `hasCompletedSubjectiveCheckinForDecision(input)` → `home`.
* Otherwise → `checkin`.
* If initial composition fails, route toward `checkin`; that screen reads its own daily
  document and still allows return to the dashboard.

Until the first route for the current `uid` is known, `App` shows
`Loading today's check-in status...`, preventing a transient Home render before the check-in
gate is known.

After initial routing, a new calendar day is re-evaluated only while the athlete is already
on `home` or `checkin`. The check runs on window focus, visibility change, and a 60-second
interval. It does not eject the athlete from `sessions`, `testing`, `plan`, or another
workflow mid-task. Returning to `home` or `checkin` across midnight triggers a refresh.

`handleNavigate` updates the route and closes the desktop Settings menu and mobile More
drawer; it is not a URL/history transition.

### Onboarding overlay and resume banners

`OnboardingWizard` is an overlay, not a `Screen`. It appears when both conditions hold:

* onboarding is not dismissed for the current user; and
* the composed decision input has zero active goals.

Successful onboarding writes training settings, the training-intent profile, and (if the
athlete is still goal-less) an active goal before `onCompleted` stores the per-user browser
dismissal key. There is currently no Skip action. A blocked `localStorage` write alone does
not make a successfully onboarded athlete loop forever, because the active-goal gate also
suppresses the overlay.

`App` can also render two resume/cleanup banners above `<main>`:

* an open legacy Strength v1 document can be closed by transitioning it to `abandoned`;
* an in-progress structured execution can be resumed in `sessions` or `testing`, depending
  on the resolved `SessionIntent`.

The desktop `Header` is hidden while a structured runner is in progress. `MobileNav` is
hidden during `checkin` and while a structured runner is in progress.

## Screens

The complete `app/src/types/navigation.ts` `Screen` union is:

`home` | `checkin` | `goals` | `constraints` | `preferences` | `data` | `plan` | `brief` | `sessions` | `testing`

| Screen | Main component | Current responsibility |
|---|---|---|
| `home` | `Home` | Today's adaptive recommendation, alternatives, adherence/follow-up, and week-ahead context |
| `checkin` | `DailyCheckin` | Subjective recovery, safety/tissue context, and today's availability |
| `goals` | `Goals` | Goal and target-event CRUD used by periodization/taper logic |
| `constraints` | `TrainingSettings` | Hard training setup: equipment, safety limits, time/location, injury constraints |
| `preferences` | `Preferences` | Soft coaching preferences, planning intent, capabilities, and provider connections |
| `data` | `DataView` plus anomaly/identity cards | Telemetry/context inspection and export; Activities also exposes explicit corrective writes such as reclassification/source unlinking |
| `brief` | `DataView` with `initialTab="brief"` | Export context for AI through the same component with a different entry tab |
| `plan` | `PlanView` | Seven-day coach-plan versus adaptive-forecast view and plan editing/import |
| `sessions` | `SessionRunner`, `SessionJsonImport`, `ManualSessionBuilder` | Execute, import, build, and manage structured sessions/templates |
| `testing` | `TestingWorkflow` | Locked protocol assessments and raw observation capture |

There are no dedicated `login` or `onboarding` routes; both are conditional renders.

## Navigation chrome

Desktop and mobile expose all ten `Screen` values, but with different prominence.

| Screen | Desktop `Header` | Mobile `MobileNav` |
|---|---|---|
| `home` | `Home` plus brand → Home | Bottom `Home` |
| `checkin` | `Check-in` | Bottom `Check-in` |
| `plan` | Settings → `Plan` | Bottom `Plan` |
| `sessions` | `Sessions` | More → `Sessions` |
| `testing` | `Testing` | More → `Testing` |
| `goals` | `Goals` | More → `Goals` |
| `data` | `Data` (refreshes decision input first) | More → `Data` (refreshes first) |
| `brief` | Settings → `Export Context for AI` | More → `Export Context for AI` |
| `constraints` | Settings → `Training Setup` | More → `Training Setup` |
| `preferences` | Settings → `Coach Preferences` | More → `Coach Preferences` |

Every label above renders from `navigation.ts` `SCREEN_LABELS`, the single source of
truth shared by `Header`, `MobileNav`, and each screen's heading (#485).

Current chrome details worth preserving when changing navigation:

* Desktop Settings is marked active for `constraints`, `preferences`, and `plan`, but not
  `brief`.
* Mobile More is marked active for `goals`, `constraints`, `preferences`, `data`, `brief`,
  `sessions`, and `testing`.
* Only desktop renders `GarminSyncBadge` beside the brand.
* Both menus show a non-clickable `Build {label}` entry followed by a clickable `Sign Out`.

## User flows

### 1. Sign-in

Entry is automatic whenever auth is not authenticated.

`LoginScreen` has four modes:

1. `sign-in`: email/password through `emailAuthService.signIn`.
2. `sign-up`: email/password/confirmation through `emailAuthService.signUp`; account-exists
   errors use non-enumerating copy.
3. `forgot-password`: `requestPasswordReset` with a uniform "If an account exists..."
   confirmation.
4. `garmin`: Garmin credentials through `garminAuthService.startLogin`; an MFA challenge,
   when required, completes through `completeMfa`, then Firebase signs in with the returned
   custom token.

Success is observed by Firebase auth; no explicit screen navigation is required.

Potential confusion: "Sign in with Garmin" is an app-authentication method, while Garmin
connection controls under Preferences link wearable data for sync. They are separate tasks.

### 2. First run / onboarding

Entry is the automatic overlay described above: authenticated, not dismissed, and no active
goals.

The wizard is:

`Welcome` → `Focus` → `Equipment + sport access + exercise days` →
`Generate Today's Recommendation`.

Completion writes in deliberate order:

1. `trainingSettingsService.updateTrainingSettings`;
2. `trainingIntentProfileService.upsert`;
3. `goalService.createGoal` only if no active goal exists;
4. `onCompleted`, which stores the account-scoped dismissal flag and reloads decision input.

Failures remain in the wizard with selections intact for retry. Creating the goal last keeps
"has an active goal" from suppressing onboarding before the settings/profile writes have
succeeded.

### 3. Daily core loop

Typical path:

`checkin` → `home` → optional `sessions` → `home`.

1. If today's subjective check-in is incomplete, initial/daily routing selects `checkin`.
2. `DailyCheckin` saves today's check-in and then refreshes decision input before navigating
   to `home`.
3. `Home` composes/evaluates the current decision, applies fail-closed source and wearable
   gates, persists the recommendation, and presents the morning decision.
4. Choosing a structured session resolves its stored definition before navigating to
   `sessions`. Resolution failure rejects the launch rather than silently stranding an
   occurrence claim.
5. Completing or abandoning the structured runner returns through its `onClose` path to
   `home`.
6. Later-day/adherence/tissue follow-ups feed subsequent decisions without becoming a second
   route system.

A stale intraday decision/claim is handled by reloading the complete decision context rather
than partially applying an obsolete write.

### 4. Check-in

`DailyCheckin` groups four kinds of work:

1. pending next-morning/tissue follow-ups from previous training;
2. subjective recovery ratings;
3. health/safety, physical-work, and local-tissue context;
4. today's availability and modality/environment constraints.

Garmin context is deliberately hidden until the first complete subjective submission to
reduce anchoring on wearable values. The normal submit path saves and returns to Home;
Back/Skip can return without saving. Partial daily documents can exist, but baseline logic
uses its own completeness rules rather than treating every partial save as a valid subjective
baseline point.

### 5. Structured sessions

`App.tsx` uses `sessionAuthoringMode` to switch the `sessions` route between:

* `SessionRunner`;
* JSON import; and
* manual session building/editing.

The runner restores an existing execution when applicable, otherwise exposes saved/custom
and built-in definitions, executes the selected prescription, records performed entries, and
finishes through the completion flow. `StrengthOverloadHistory` is rendered below the runner
at the `App` level.

An in-progress structured execution is global account state for resume purposes. A stored
prescription that cannot be resolved is fail-closed instead of allowing a second session to
start over ambiguous execution state.

### 6. Week plan

`PlanView` loads the decision context together with fixed/imported plan data, applies the
same safety/data-availability principles as the daily recommendation path, and renders the
week architecture.

When an imported plan exists, the screen presents both:

* the coach-authored plan (`ExternalPlanWeek`), including supported move/replace flows; and
* the AI adaptive forecast (`WeekAheadStrip`).

Without an active imported plan, the evergreen/adaptive forecast remains available and the
screen offers plan import/revision. The screen also renders schedule-overlay context.

Current UX ambiguity: coach plan, adaptive week forecast, and today's Home recommendation
can differ without one explicit "this is authoritative for today" banner.

### 7. Goals and target events

`Goals` supports active/archived/all filtering and goal creation/editing, pause/reactivate,
archive, and archived-goal deletion. Dated event goals carry event metadata used by
periodization/taper calculations, and the screen derives the current focus event/phase.

Two implementation details matter to navigation work:

* paused goals appear only under `all`, because there is no dedicated paused filter; and
* `Goals` takes only `userId`; it owns no repair/deep-link navigation, and callers
  reach it through `App.tsx` `handleNavigate`.

### 8. Training Setup versus Coach Preferences

The two routes intentionally have different authority:

* `constraints` / `TrainingSettings` owns hard feasibility and safety inputs. Several
  controls persist immediately.
* `preferences` / `Preferences` owns softer coaching/planning preferences and connection
  configuration and uses an explicit save/reset model for editable preference state.

The distinction is architecturally important, but some concepts overlap in the UI:
equipment versus unavailable modalities, hard time limits versus preferred/default times,
and persistent environment setup versus today's `indoorOnly` availability.

### 9. Data and AI export

`DataView` has nine tabs:

`Recovery` | `Activities` | `Strength History` | `Check-in` | `Goals` |
`Training Setup` | `Coach Preferences` | `Adherence` | `Context brief`.

Most of the surface is inspection/export. The Activities tab is the exception: it exposes
corrective actions (for example activity reclassification, and canonical-source unlinking
when that read model is enabled), so the screen must not be described as strictly read-only.

The `brief` route is the same `DataView` component opened on `Context brief`. The Data and
brief navigation entries refresh decision input before navigating. If `decisionInput` is
null, DataView shows `No data available`; that state has no in-component retry action,
although the global navigation chrome remains available.

### 10. Protocol testing

`TestingWorkflow` owns the assessment lifecycle rather than creating a separate runner:

`lookup` → `ready/lock` → `running` (delegates to `SessionRunner`) → raw result capture →
`complete` or `abandoned`.

Open attempts are recovered on mount. The workflow records assessment-specific context and
raw observations around the shared structured-session execution. Global resume state marks
an in-progress testing execution with `SessionIntent = testing`, routing Resume back to the
`testing` screen.

Because `testing` and ordinary `sessions` share the runner, their in-run visual structure is
very similar; provenance/context around the runner is therefore important.

## Save/write ownership by flow

This table is intentionally high-level. It exists to prevent UX work from accidentally
moving an input across an authority boundary.

| Surface | Main write behaviour |
|---|---|
| Auth | Firebase auth plus auth-service flows; user defaults initialize in background |
| Onboarding | Ordered settings → intent profile → goal writes, then browser dismissal flag |
| Check-in | Daily subjective/safety/availability document plus follow-up responses |
| Home | Recommendation persistence and bounded interaction/claim writes |
| Goals | Explicit goal/event CRUD |
| Training Setup | Hard setup/constraint writes, including immediate-persist controls |
| Coach Preferences | Preference/connection/planning-intent edits with explicit save/reset where applicable |
| Data | Mostly read/export; Activities includes explicit corrective writes |
| Plan | Imported-plan creation/revision and supported move/replace operations |
| Sessions | Template lifecycle plus `SessionExecution`/performed evidence |
| Testing | Assessment-attempt lifecycle plus raw observation revisions |

## Known confusing spots (observed, not proposed)

1. Desktop promotes Sessions, Testing, Goals, and Data; mobile promotes Plan and moves those
   items into More. Navigation muscle memory does not transfer cleanly.
2. `preferences` (soft), `constraints` / Training Setup (hard), and per-day check-in
   availability use different names and save models for partially overlapping concepts.
3. Tissue/safety information appears in daily check-in, persistent injury constraints, and
   post-session response/follow-up flows. The layering is intentional but difficult to
   discover.
4. Imported coach plan, adaptive week forecast, and Home recommendation can disagree without
   a single authority explanation in the UI.
5. AI/context export appears as the `brief` route, the DataView Context brief tab, and raw
   Activities JSON export.
6. `sessions` and `testing` share `SessionRunner`, so the execution UI alone does not strongly
   communicate provenance.
7. Several recovery states are weak rather than truly terminal: DataView's no-data state has
   no local retry, some PlanView invalid states have limited repair affordance, a missing
   stored session prescription is fail-closed, testing abandonment is terminal for that
   attempt, and onboarding has no Skip.
8. Garmin is used both as an app sign-in path and as a wearable/provider connection, which
   can read as one task even though the flows and credentials have different purposes.

## Recommendations for future flow improvements

These are candidates, not committed architecture. Keep behavioural fixes separate from this
living-reference section when implementing them.

### Information architecture and naming

1. ~~Use one user-facing name per `Screen` across Header, MobileNav, and screen titles.~~
   Done (#485): one canonical label per `Screen` renders from `navigation.ts`
   `SCREEN_LABELS` in Header, MobileNav, and each screen heading.
2. Make desktop and mobile primary destinations more symmetrical, or document a deliberate
   reason for the difference. A daily-loop set such as Today / Check-in / Plan is the most
   obvious candidate.
3. Group Mobile More by intent (train / configure / understand) rather than one flat list.

### Daily loop and repair

4. Add an explicit authority/explanation banner when coach plan, adaptive forecast, and the
   Home recommendation differ.
5. Standardize fail-closed recovery: say what is missing, link to the owning repair surface,
   and provide retry when retry is meaningful.
6. Make Check-in progress and partial-save semantics explicit so Back/Skip versus submit is
   unambiguous.

### Settings

7. Visually pair Training Setup (hard gates) and Coach Preferences (soft preferences), with
   cross-links between overlapping equipment/time/environment concepts.
8. ~~Either remove `Goals.onNavigate` or use it for explicit repair/deep-link flows; an unused
   navigation prop is misleading API surface.~~
   Done (#484): removed the unused `Goals` `onNavigate` prop — no repair flow needed it —
   and kept `constraints` as the stable route key with user-facing copy in `navigation.ts`
   `SCREEN_LABELS` (`Training Setup`).
9. Review immediate-persist Training Setup controls for undo/confirmation where a mistaken
   toggle can materially change feasibility/safety decisions.

### Sessions and testing

10. Differentiate normal session execution and protocol testing more strongly around the
    shared runner, especially during execution and completion.
11. ~~Consolidate the structured-session creation entry points behind a clearer `New session`
    chooser while preserving the underlying import/manual/template contracts.~~ Done (#495):
    one `New session` entry with a From template / From fixture / Import JSON / Build manually
    chooser; save-as-template is a secondary action inside the completion dialog rather than
    an active-run peer action.
12. Make companion/follow-up executions explicit and clarify whether abandoning a testing
    attempt is intentionally destructive/terminal before confirmation.

### Onboarding, auth, and export

13. Add an explicit onboarding Skip/dismiss path only if product semantics define what a
    goal-less dismissed account should do; do not implement it as a browser flag alone.
 14. ~~Use distinct copy for app authentication (`Continue/Sign in with Garmin`) and wearable
     data connection (`Connect Garmin wearable`).~~ Done (#497): `LoginScreen` garmin mode
     uses `Sign in with Garmin`, `GarminConnectionSection` uses `Connect Garmin wearable`.
15. Choose a canonical AI-export surface and make the other export affordances clearly point
    to or distinguish themselves from it.
16. Add local retry/repair affordances to weak recovery states, starting with DataView's
    null-input state and PlanView source failures.
