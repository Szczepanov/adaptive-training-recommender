# Strength session UI/UX review (2026-08-18)

**Question asked.** Is the current Strength session interface usable as an in-gym logger,
and what should change before it is treated as a finished athlete-facing workflow?

**Verdict.** The persistence and lifecycle foundation is production-minded; the interface
is not. The current screen is a functional engineering console for proving per-set writes,
not yet a safe, efficient gym-floor experience. It preserves data well once the athlete
enters the right values, but makes the active session hard to rediscover, offers no way to
correct a logged set, lets adjacent buttons irreversibly close the session, and breaks down
visually on both desktop and a 390 px mobile viewport.

No P0 data-loss defect was found. There are five P1 usability defects that should block a
"finished UX" claim, followed by four P2 quality and accessibility gaps. Recommendation:
keep the feature available for controlled use, but do not promote it as the primary way to
run a strength prescription until the P1 set is addressed.

---

## 1. Scope and method

This is a point-in-time UI/UX review, not a recommendation-engine or Firestore-security
review. The latter was covered by
[`2026-08-17-strength-s-phase-implementation-review.md`](./2026-08-17-strength-s-phase-implementation-review.md).

Evidence used:

* current `StrengthSessionRunner`, `StrengthOverloadHistory`, their CSS, hooks and service
  boundaries;
* the S1.5/S1.7 commitments in `docs/plans/strength-session-logging.md` and the accepted
  UI-relevant semantics in ADR-0021;
* the production navigation in `App`, `Header` and `MobileNav`;
* the repository's Playwright visual-review harness and current captured-scenario set;
* direct browser inspection of the real React components against a temporary synthetic
  active session containing Bench Press and Front Squat sets plus two history rows.

The synthetic fixture was inspected at 1440 × 900 and 390 × 844. It exercised resume,
exercise selection, set display, input controls, logging, sync labels and overload history.
It did not write to Firestore, and the temporary harness changes were reverted after the
inspection. This review did not repeat the real IndexedDB kill/reopen/offline test still
owed by the prior implementation review, and it is not a substitute for an athlete using
the screen during a real session.

Severity means:

| Level | Meaning here |
|---|---|
| P1 | Likely to cause wrong data, lost confidence, accidental terminal action, or abandonment of the logger during normal use. |
| P2 | Material friction, comprehension, accessibility or maintainability gap that should follow immediately after the P1 work. |
| P3 | Polish; none is listed because the screen needs structural work before polish is useful. |

---

## 2. What is already good

The review should not confuse interaction shortcomings with a weak foundation.

* A set is persisted when it is logged, not deferred until completion. Pending versus
  server-acknowledged state is represented honestly.
* The next set is prefilled from the previous set, including its tagged gauge. That is the
  right default for repeated work.
* Resume crosses Warsaw-local midnight correctly, and stale sessions retain their work.
* RIR/RPE, velocity loss and technical quality remain distinct instruments rather than
  being collapsed into one misleading number.
* Free-text exercises are allowed, and overload history does not conflate distinct names.
* Pure entry, history, lifecycle, parsing and service rules have substantial unit coverage.

Those are valuable properties. The redesign should preserve them and change presentation
and interaction flow rather than reopen the data model.

---

## 3. Findings

### P1.1 — A resumed session looks empty until the athlete re-adds an exercise

**Observed.** The synthetic active session already contained two exercises and three sets.
On opening Strength, the screen showed only the two "Add exercise" rows and the terminal
actions. No existing exercise or set was visible. Selecting Bench Press from the catalog
and pressing **Add** made its old sets appear.

**Cause.** `useStrengthSessionRunner` restores `session` but leaves
`activeExerciseIndex` at `null`. `StrengthSessionRunner` renders an active exercise only
when that index exists. The only always-visible exercise navigator is
`plannedExercises`; manually added, unplanned and free-text exercises are not rendered as
a session list. Re-selecting a catalog exercise is labelled "Add" even when it is really
"open existing". A free-text exercise is worse: after switching away, the athlete must
type it again to reach it, and same-named free-text entries are deliberately not deduped
within a session.

**Impact.** The primary recovery promise is technically true in storage and false in the
first visual impression. An athlete can reasonably conclude that offline sets disappeared,
create a duplicate exercise, or abandon the session.

**Required direction.** Render one persistent session exercise navigator from
`session.exercises`, merged with not-yet-started prescribed exercises. On resume, select
the last-touched exercise (or the first incomplete prescribed exercise). Each item should
show target and progress, for example `Bench Press · 2/3 work sets`, and clearly distinguish
"add a new exercise" from "open an existing exercise".

### P1.2 — Finish and Abandon are immediate, adjacent and irreversible

**Observed/code-confirmed.** **Finish session** and **Abandon** sit side by side and call
`finishSession`/`abandonSession` directly. They remain enabled with no active exercise and
even with no logged set. There is no confirmation, completion summary or undo. In
`strengthSessionLifecycle`, both resulting states are terminal; reopening is explicitly
forbidden.

**Impact.** One imprecise tap can permanently close an otherwise valid session. The risk is
higher on the current small mobile controls. Completion also misses the natural point to
catch an implausible set, add a whole-session rating, or notice that a prescribed exercise
was skipped.

**Required direction.** Replace direct closure with a completion sheet that summarizes
duration, exercises, work/warm-up sets, notable gauges and incomplete prescribed work. It
should capture optional session RPE and notes before a final **Complete session** action.
Move **Abandon session** into a visually separated danger action with explicit confirmation
that partial sets are retained. The terminal lifecycle can remain unchanged.

### P1.3 — There is no correction path for a mistyped set

**Observed/code-confirmed.** Logged rows are display-only. The runner supports append, not
edit, delete or immediate undo. A valid-but-wrong input such as `725 kg` instead of
`72.5 kg` is persisted immediately and becomes immutable with the session after Finish.

**Impact.** Fast repeated data entry inevitably produces mistakes. A logger that cannot
correct them damages overload history and any later 1RM derivation; the technically correct
per-set durability makes the mistake durable too.

**Required direction.** Provide an edit action per set and a short-lived **Undo logged
set** affordance after every write. Preserve timestamp and gauge semantics deliberately;
do not emulate correction by appending an opposite record. Completion should flag gross
outliers without silently changing them.

### P1.4 — The responsive layout is not fit for a one-handed gym workflow

**Observed at 390 × 844.** Activating an exercise expanded the scrollable main area from
390 to 410 CSS px. The right edge of set metadata and the **Heaviest set** history column
sat outside the initial visible area. Measured control heights were 21 px for native
inputs/selects, 34 px for **Log set**, and 33 px for **Finish session**/**Abandon**. The two
"Add" buttons were about 40 × 21 px. The warm-up checkbox and its text split into separate
grid rows. Gauge value appeared as an unlabeled box below the warm-up field.

**Observed at 1440 × 900.** The centered main content shrank to about 330 px, with the
runner card about 282 px wide and most of the screen empty. Native white inputs and selects
visually broke the dark card, while long values and set metadata were clipped inside the
narrow column.

**Cause.** Desktop `.app-content` has a maximum width and automatic margins but no full
available width, so this intrinsically narrow child shrink-wraps the page. On mobile, the
two-column `.strength-set-entry` and child min-content can widen `.strength-runner` beyond
its parent. Controls inherit mostly browser-default sizing and theme.

**Required direction.** Give the screen an explicit responsive content width and
`min-width: 0`/border-box containment. Use a single entry column at narrow widths or a
deliberate two-column layout whose children can shrink. Make primary gym actions at least
44 px high, wrap set metadata without hiding sync state, and render history as mobile rows
or an intentionally scrollable region with a visible affordance. Theme all inputs and
selects consistently.

### P1.5 — The logger is detached from the prescription it is supposed to execute

**Code-confirmed.** A recommendation can seed exercise, sets, reps and gauge, but the
Strength screen does not show the session title, objective, total duration, block structure,
exercise instruction, stop conditions, or prior performance. `PlannedStrengthExercise`
extracts `optional`, but the component never displays it. Planned buttons do not show
completed/remaining sets. There is no direct **Start strength session** action from Home;
on mobile the destination is inside **More**. Reloading the app always returns `App` to
`home`, so `findActiveSession` does not run until the athlete navigates back into Strength.

**Impact.** The athlete must bounce between today's recommendation and the logger or
remember the workout. Safety/quality cues already present in `workouts/exercises.ts` are
invisible at the moment of execution. An active session has no app-level resume indicator.

**Required direction.** Make the recommendation's primary action **Start / resume and log
this session**. Carry its title and summary into a compact persistent header, render every
exercise with required/optional status and `completed / target` progress, and show the
exercise instruction/stop condition beside the active set form. When any session is in
progress, surface a global **Resume strength session** affordance instead of relying on the
More drawer.

### P2.1 — The repeated set-entry loop misses its own efficiency requirement

The S1.5 plan says the next set should be prefilled with **weight focused**. Prefill exists;
focus does not. `StrengthSessionRunner` has no input ref or focus effect. Browser inspection
after **Log set** found focus on the document body, not the weight field. The entry controls
are not a form, so Enter does not provide a defined submit path either.

After a successful log, keep the existing prefill, focus and select the weight value, and
support Enter/keyboard submission without making accidental double submissions possible.
Keep the timer and primary log action visible while the set list grows.

### P2.2 — Field semantics and assistive behavior are incomplete

The gauge's dynamic numeric input has no accessible name or visible unit-specific label.
The catalog and history selects have no labels. Both adjacent buttons expose the same
accessible name, **Add**. Free-text exercise identity relies on placeholder text, and
errors/sync changes are not announced through an alert or live region.

Visually, the blue 12.8 px state label is about 3.98:1 against the card before accounting
for its translucent blue background; the red 13.3 px Abandon text is about 3.89:1. Both
are below 4.5:1 for normal-sized text. Keyboard focus is left to inconsistent browser
defaults.

Use explicit `label`/`id` pairs, distinct action names (for example **Add catalog
exercise**), a labelled dynamic gauge field such as **RIR (0–10)**, visible focus styles,
and polite/urgent live regions for sync and errors respectively. Do not rely on color alone
for state.

### P2.3 — History is in the wrong place and does not yet communicate a trend

The entire 90-day history card loads below the live logger on every visit. During a workout,
the most useful historical fact is the previous performance for the active exercise, not a
separate five-column table several scrolls away. The table technically exposes load, reps,
tonnage and heaviest set, but comparison requires reading rows manually and the rightmost
data is clipped on the inspected mobile viewport.

Put **Session** and **History** into separate views, defaulting to Session while one is in
progress. Show a compact "last time" row beside the active exercise, then give History a
mobile-first progression view (recent load/reps, estimated trend only if honestly derived,
and access to the full table). Avoid implying that tonnage alone is progression quality.

### P2.4 — Current tests cannot protect the UX

`VisualScreen` excludes `strength`; `VisualReviewApp` never renders either Strength
component; `installVisualServices` supplies no active Strength fixture; and
`tests/visual/capture.pw.ts` captures no Strength state. The component tests use static
markup and assert that strings exist, so they cannot catch resume invisibility, focus loss,
mobile overflow, destructive-action behavior or clipped history. Playwright is already in
the repository, so the absence is a coverage choice rather than a tooling constraint.

Add visual/interaction scenarios for:

1. no session and today's prescribed session;
2. resumed multi-exercise session with synced and pending sets;
3. free-text exercise switching and correction/undo;
4. validation and sync-unavailable states;
5. completion/abandon confirmation and completed summary;
6. populated history at desktop and 390 px mobile widths.

The test should assert focus returns to weight after Log, no horizontal overflow exists,
all current exercises remain reachable, and the terminal transition requires confirmation.

---

## 4. Documentation divergences recorded by this review

Per the repository's documentation precedence, code wins and these statements should no
longer be read as current behavior:

| Document statement | Current code |
|---|---|
| S1.5 says prefill is "weight focused" and marks the item complete. | `StrengthSessionRunner` never programmatically focuses weight; after Log, focus leaves the control loop. |
| ADR-0021 says session RPE is "captured but unconsumed." | `StrengthSession` and its parser can store `sessionRpe`, but the runner exposes no field or writer for it. It is schema-supported, not captured. |
| ADR-0021 D-SETLOG describes persisted per-set notes. | `LoggedSet.notes` parses and persists if present, but `SetEntryDraft` and the runner expose no notes entry. |
| The visual-review workflow is the project's desktop/mobile UI guard. | It cannot render or capture the Strength screen today. |

This analysis records the divergence rather than editing the immutable ADR. The mutable S1
plan should be corrected when the UX work is scheduled so an implemented plan does not
continue to overstate behavior.

---

## 5. Recommended product shape

The strongest redesign is a single task flow rather than a prettier version of the same
page:

```text
Today's strength recommendation / active-session banner
  -> session overview (title, duration, exercise progress)
  -> active exercise (target, instruction, last time)
  -> large set-entry controls + Log set
  -> persisted row + Undo; next values prefilled, weight focused
  -> completion review (missing work, session RPE, notes)
  -> confirmed terminal summary
```

History remains available, but it should not compete with the live task. The persistent
exercise navigator is the spine of the workflow: it solves resume, switching, progress,
free-text discoverability and completed-session summary with one coherent component.

### Suggested implementation order

1. **Make the current flow safe:** exercise navigator/default selection, edit/undo,
   confirmation for terminal actions, responsive containment and large controls.
2. **Join prescription to execution:** direct Home CTA/resume banner, session header,
   required/optional progress, instructions and stop conditions.
3. **Complete the repeated-entry loop:** weight focus, Enter behavior, sticky timer/action,
   labelled gauge controls and live status announcements.
4. **Reframe history:** active-exercise "last time" in the runner; separate responsive
   history view.
5. **Lock it down:** first-class visual fixtures and Playwright interaction assertions,
   followed by the previously owed real offline kill/reopen test and one moderated session
   on a phone in an actual gym.

### Exit criteria for a finished Strength UX

* An existing session with multiple catalog and free-text exercises is understandable on
  first paint with no re-adding.
* A wrong set can be corrected, and an accidental tap cannot terminally close the session.
* A 390 px viewport has no horizontal overflow; primary actions are comfortably tappable.
* The athlete can execute the prescription without returning to Home for instructions.
* Log Set returns focus to the intended next edit and works through a full session without
  repeated navigation.
* Session RPE/notes are either genuinely captured or the ADR wording is superseded by an
  explicit decision not to capture them.
* Desktop/mobile visual and interaction scenarios cover every lifecycle state.

Until those criteria hold, the accurate label is **durable strength-set logger, UX in
progress**—not completed Strength-session UI.
