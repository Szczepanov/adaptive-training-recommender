# UI/UX and accessibility standard

**Status:** Normative, living standard
**Applies to:** `app/` user-facing web UI, including mobile/PWA layouts
**Primary product context:** an athlete often using the app quickly, one-handed, on a phone, before or during training

This document defines the cross-cutting UI/UX quality bar for Adaptive Training Recommender.
It is intentionally separate from:

- `docs/architecture/`, which describes how the product works today;
- `docs/analysis/`, which records dated findings;
- `docs/plans/`, which sequences work and can become historical;
- ADRs, which record durable architectural decisions and rationale.

A code path can exist today and still violate this standard. Treat that as product debt to fix
or explicitly document, not as a reason to lower the standard.

## 1. External baseline and project-specific bar

### 1.1 Accessibility baseline: WCAG 2.2 Level AA

The web application targets **WCAG 2.2 Level AA** as its accessibility baseline.

Primary references:

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI overview of WCAG](https://www.w3.org/WAI/standards-guidelines/wcag/)
- [WAI mobile accessibility guidance](https://www.w3.org/WAI/standards-guidelines/mobile/)

WCAG is the conformance standard. Passing automated tests does not by itself establish WCAG
conformance; manual review remains necessary for semantics, focus order, screen-reader
experience, interaction meaning, and real-device behavior.

### 1.2 Internal touch-target standard: 44 x 44 CSS px

WCAG 2.2 SC 2.5.8 requires a 24 x 24 CSS-pixel target or sufficient spacing, with defined
exceptions. This project deliberately uses a stronger default:

> **Every actionable mobile control should expose an effective hit area of at least 44 x 44
> CSS pixels unless an explicit exception applies.**

This matches the app's existing `--touch-target-min: 44px` token and is consistent with
Apple's 44 x 44 point mobile hit-target guidance:

- [WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Apple Human Interface Guidelines — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Apple UI Design Dos and Don'ts](https://developer.apple.com/design/tips/)

The visible glyph may be smaller than 44 px. The **interactive hit area** may not be.

### 1.3 Usability evaluation framework

Use Nielsen Norman Group's ten usability heuristics as an evaluation framework, not as a
formal conformance standard:

- [10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/)

The heuristics that matter especially strongly here are:

1. visibility of system status;
2. match between system and the real world;
3. user control and freedom;
4. consistency and standards;
5. error prevention;
6. recognition rather than recall;
7. flexibility and efficiency of use;
8. aesthetic and minimalist design;
9. plain-language error diagnosis and recovery;
10. help and documentation where the interface cannot be self-explanatory.

## 2. Product UX principles

### 2.1 Optimize the athlete's task, not the data model

Organize screens around what the athlete is trying to decide or do. Do not expose engine,
schema, persistence, or evidence-model structure merely because it exists internally.

For the daily loop, preserve the hierarchy already established by the product:

1. what needs attention;
2. what the athlete should do now;
3. why;
4. what would change the recommendation;
5. deeper evidence and telemetry on demand.

### 2.2 Mobile is a primary environment

Mobile is not a compressed desktop layout. Recompose the information hierarchy when a
desktop arrangement becomes awkward on a narrow screen.

Prefer:

- single-column task flow;
- thumb-reachable primary actions;
- stacked or transformed tables when possible;
- progressive disclosure for secondary detail;
- short labels and scannable status;
- dedicated workout mode during active sessions.

Do not preserve multi-column desktop geometry merely for visual parity.

### 2.3 One dominant action per state

Each important state should make the next likely action obvious.

Examples:

- incomplete daily input -> **Complete check-in**;
- recommendation ready -> **Start workout**;
- active set/step -> **Log set / Complete step**;
- finished work -> **Complete session**.

Secondary actions remain available but visually subordinate. Dangerous or destructive actions
must not compete visually with the normal primary action.

### 2.4 Progressive disclosure, with safety exceptions

Show the minimum information needed for a safe decision first, then supporting detail.

Good candidates for disclosure:

- engine scoring detail;
- raw telemetry;
- advanced authoring options;
- rarely used settings;
- historical detail.

Do **not** hide information whose absence could make the current action unsafe or misleading,
including active restrictions, important uncertainty, incomplete safety input, session stop
conditions, or a failed data dependency that changes what the recommendation means.

### 2.5 Recognition over recall

Do not require the athlete to remember a value, selection, previous session, recommendation,
or instruction from another screen when the interface can show or retrieve it in context.

Examples:

- show last-session performance beside the current exercise;
- preserve and expose in-progress work on resume;
- keep labels visible instead of relying on placeholders;
- show selected state and units at the point of entry;
- reuse already-entered information within a workflow instead of asking for it again.

### 2.6 User control, reversibility, and safe exits

Normal navigation and editing should feel reversible.

- Provide clear Back/Cancel/Close paths.
- Support browser Back/Forward semantics for top-level navigation when routing supports it.
- Preserve in-progress data when leaving a workflow unless the user explicitly discards it.
- Prefer undo or edit for low-cost mistakes.
- Require deliberate confirmation for irreversible or high-cost actions.
- Never place destructive and primary completion actions so close together that a slip can
  cause permanent state change.

### 2.7 Experience intent: calm confidence, agency, and focused momentum

The interface should not only be correct and usable. It should have a deliberate emotional
character.

The intended experience is:

> **A calm, competent coach that helps the athlete understand the situation, make the next
> decision, and get on with training.**

The app should generally leave the athlete feeling:

- **oriented** — "I understand today's state and what happens next";
- **calm** — important information is visible without routine uncertainty being dramatized;
- **confident** — the interface is predictable and the recommendation is explained honestly;
- **in control** — the athlete can inspect, adjust, correct, back out, resume, or provide
  feedback without fighting the system;
- **supported, not judged** — reduced load, recovery, missed training, incomplete data, or a
  changed plan are handled as normal training states rather than moral failures;
- **focused** — during training, the interface reduces cognitive work and keeps attention on
  the current step;
- **appropriately accomplished** — meaningful completion can feel satisfying without turning
  adherence into pressure or spectacle.

These are **design goals, not promises about a person's emotional state**. Different athletes,
contexts, injuries, and training outcomes produce different emotions. The product must not
measure success by manipulating a user into a particular feeling.

Useful platform guidance is consistent with this intent:

- [Apple Human Interface Guidelines — Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
  emphasizes agency, responsibility, simplicity, and choosing the emotion appropriate to the
  experience;
- [Apple Human Interface Guidelines — Writing](https://developer.apple.com/design/human-interface-guidelines/writing)
  recommends defining an app voice and adapting tone to the situation;
- [Apple Human Interface Guidelines — Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
  recommends matching the prominence and interruption level of feedback to its actual
  significance.

#### Emotional anti-goals

The app should **not intentionally create or exploit**:

- **guilt or shame** about missed sessions, reduced load, recovery days, low readiness, or
  imperfect adherence;
- **fear or medical anxiety** from routine data variation, missing wearable data, uncertain
  signals, or non-diagnostic health context;
- **false reassurance** when safety-relevant uncertainty or restrictions are present;
- **urgency** when no real deadline, safety condition, or time-critical action exists;
- **dependency or compulsive checking** through streak-loss threats, artificial scarcity,
  variable-reward mechanics, or repeated prompts that exist mainly to increase engagement;
- **punishment framing** such as treating rest as failure or harder training as inherently
  more successful;
- **over-celebration** that encourages an athlete to value app rewards above the quality,
  safety, or intent of the training itself;
- **overwhelm** from exposing every metric, engine explanation, or configuration choice at
  once.

The product is allowed to be energetic when the context deserves it. A completed test, a
personal best, or a finished training block can use warmer and more celebratory language.
Safety warnings, injury context, failed writes, and uncertain health signals should instead
use a calm, direct, proportionate tone.

#### Emotional intent by moment

| Moment | Desired experience | Design implication |
|---|---|---|
| Opening the app / morning check-in | Calm, quick, low-friction | Do not turn normal input into an interrogation; show progress and the next action clearly. |
| Recommendation ready | Oriented and confident, not commanded | State the recommendation and reason; preserve alternatives and uncertainty. |
| Reduced-load or recovery day | Supported and legitimate | Present recovery as an intentional training decision, not a failed day or downgraded achievement. |
| Missing/partial wearable data | Informed, not alarmed | Explain what is missing and what still works; reserve warning severity for consequences that justify it. |
| Injury/illness/safety restriction | Safe, respected, not diagnosed | Be direct about the restriction and next safe action without speculative medical language. |
| Active workout | Focused and capable | Minimize navigation and reading; keep the current action, timer/rest state, and correction path obvious. |
| Mistake / wrong entry | Forgiven and in control | Make correction, undo, or safe recovery easy; avoid accusatory copy. |
| Save/sync failure | Informed and recoverable | Preserve work, distinguish local/pending/failed states, and provide a specific retry path. |
| Workout/session completion | Satisfied, then finished | Confirm meaningful completion without unnecessary animation, pressure, or engagement traps. |
| Missed/abandoned session | Neutral and useful | Record what happened, allow context/correction, and move forward without shame language. |

#### Voice and tone

The default voice is:

- concise;
- calm;
- competent;
- respectful;
- athlete-facing rather than engine-facing;
- supportive without cheerleading;
- direct without sounding authoritarian;
- confident about known facts and explicit about uncertainty.

Tone changes with context:

- **normal daily flow:** neutral, efficient, lightly encouraging;
- **successful completion:** warm but proportionate;
- **recovery/reduced load:** matter-of-fact and validating of the training decision;
- **warning/safety:** serious, specific, and calm;
- **error:** non-accusatory, explain what happened and how to recover;
- **uncertain data:** transparent and non-alarmist.

Avoid anthropomorphizing the engine in ways that imply certainty, care, medical judgment, or
human understanding it does not possess. Prefer "Today's recommendation is..." over claims
such as "I know your body needs..." unless the product actually has evidence for that
statement.

#### Review question

For every material user-facing change, reviewers should be able to answer:

> **If this behaves exactly as designed, what is the athlete likely to feel at this moment,
> and is that emotional effect appropriate to the task and evidence?**

If the likely effect is pressure, guilt, confusion, alarm, helplessness, or false certainty,
the design needs a deliberate justification or revision.


## 3. Accessibility requirements

### 3.1 Semantic structure

Use native HTML semantics before recreating them with ARIA.

- Buttons perform actions; links navigate.
- Inputs have programmatically associated labels.
- Headings reflect document hierarchy.
- Lists, tables, regions, dialogs, tabs, and status messages use the appropriate semantic
  element or accessible role.
- ARIA supplements semantics; it does not replace correct native behavior.

Every control needs an accessible name that distinguishes it from similar controls.

### 3.2 Keyboard operation and focus

Every function available with a pointer must be available from the keyboard unless the
interaction is inherently path-based and WCAG permits an exception.

Requirements:

- visible `:focus-visible` treatment;
- logical focus order;
- no keyboard traps except intentional modal focus containment;
- dialogs move focus inside when opened and restore focus to the invoker when closed;
- safe Escape behavior for dismissible overlays;
- after repeated-entry actions, focus should move to the next useful control rather than
  falling back to `body`;
- sticky headers, footers, banners, and overlays must not fully obscure the focused element
  (WCAG 2.2 SC 2.4.11).

Aim for a strong, high-contrast focus indicator even though WCAG 2.2 SC 2.4.13 Focus
Appearance is Level AAA.

### 3.3 Pointer and touch

- Default mobile hit area: >=44 x 44 CSS px.
- Keep sufficient spacing between adjacent controls.
- Do not make precision gestures the only way to perform an important action.
- If drag-and-drop is introduced, provide a non-dragging alternative.
- Avoid tiny icon-only destructive actions; use a large hit area and a specific accessible
  name.

### 3.4 Contrast, color, and state

At minimum, meet WCAG 2.2 AA contrast requirements:

- normal text: 4.5:1;
- large text: 3:1;
- meaningful non-text UI boundaries/indicators: 3:1 where WCAG requires it.

Do not encode training mode, warning severity, completion, validation, or sync state by color
alone. Pair color with text, shape, iconography, or another redundant cue.

### 3.5 Text, zoom, and reflow

- Text must remain usable at 200% zoom.
- Layout should reflow without page-level horizontal scrolling at a 320 CSS-pixel viewport,
  except for content that genuinely requires two-dimensional presentation.
- Long athlete-entered names, workout titles, units, dates, and localized strings must wrap
  or truncate deliberately without hiding essential meaning.
- Do not disable browser zoom.

### 3.6 Motion and timing

Respect `prefers-reduced-motion`.

Animation may reinforce state change but must never be the only signal. Avoid unnecessary
motion in active-workout flows, where the user may already be moving physically.

Timers and timed session behavior must remain understandable without relying on animation,
sound, or color alone.

### 3.7 Forms and validation

- Keep labels visible.
- Identify required input before submission where practical.
- Put validation near the affected field and also expose it programmatically.
- Error copy says what happened and how to recover, in athlete-facing language.
- Preserve valid user input when another field fails.
- Use appropriate `type`, `inputmode`, `autocomplete`, min/max and step constraints.
- Do not block password-manager paste or other accessibility-supporting authentication
  mechanisms.
- Do not make users re-enter information already supplied in the same process when it can
  safely be reused.

## 4. Responsive and mobile interaction standard

### 4.1 Supported widths

Author layouts to remain usable down to **320 CSS px**.

The current visual-regression matrix must continue to include:

- 360 px — narrow Android;
- 390 px — standard mobile baseline;
- 412 px — wider Android;
- desktop.

Add a 320 px automated project when it provides enough value to justify CI/runtime cost; 320
remains the design floor even before it becomes a dedicated screenshot project.

### 4.2 No accidental horizontal page scrolling

The document body must not scroll horizontally at supported mobile widths.

A table, timeline, chart, or other inherently two-dimensional component may use a local
horizontal scroll container when:

- the scroll affordance is discoverable;
- the page itself does not overflow;
- key actions are not hidden off-screen;
- a stacked/mobile representation would materially damage comprehension.

### 4.3 Dynamic viewport and software keyboard

Full-screen overlays, sheets, runners, and fixed/sticky actions must account for the visual
viewport changing as browser chrome or the software keyboard appears.

Prefer dynamic viewport units such as `dvh` (with a safe fallback) over relying solely on
`vh`.

Focused controls and the action needed to continue must remain visible/reachable when the
keyboard is open.

### 4.4 Safe areas

Use `env(safe-area-inset-*)` for mobile controls attached to viewport edges.

Bottom navigation, sticky submit actions, sheets, and full-screen workout controls must not
collide with display cutouts, gesture areas, or home indicators.

### 4.5 Fixed and sticky UI

Fixed/sticky UI must:

- reserve enough layout space that final content remains reachable;
- not hide the currently focused element;
- not cover validation messages or primary actions;
- remain usable at increased text size.

## 5. Navigation and information architecture

### 5.1 Stable labels and destinations

A destination or action with the same meaning should use the same label across desktop,
mobile, menus, headings, and help text.

Use the existing shared navigation definitions rather than duplicating labels.

### 5.2 Platform navigation conventions

Top-level app navigation should cooperate with browser/platform expectations:

- Back returns to the prior meaningful app state before leaving the site when possible.
- Forward restores forward navigation.
- Refresh/deep-link behavior is deliberate for safe top-level screens.
- A history transition must never silently abandon an in-progress workout or destructive
  edit.

Transient overlays should normally close before changing the underlying route.

### 5.3 Information density

Prefer task-based grouping over a flat list of every capability.

A setting that affects safety, training eligibility, or the current recommendation deserves
more prominence than a cosmetic or rarely used preference.

## 6. Status, feedback, and trust

### 6.1 Always communicate meaningful system state

Users should be able to distinguish:

- loading;
- ready;
- pending/syncing;
- saved locally/pending remote sync where relevant;
- success;
- empty/no data;
- unavailable;
- invalid;
- recoverable failure;
- blocked by a safety or product rule.

Do not use a spinner where a more specific state is known.

### 6.2 Plain language before engine language

Athlete-facing copy uses the athlete's vocabulary.

Internal policy names, schema versions, scoring weights, optimizer terms, source enums, and
implementation identifiers belong in diagnostics or explicit advanced detail, not the normal
task flow.

### 6.3 Explain uncertainty honestly

The UI must not claim more certainty than the underlying evidence supports.

When data is missing, immature, observational, stale, invalid, or bounded:

- say so;
- explain the practical consequence;
- offer the relevant recovery action when one exists.

Do not convert an uncertainty state into a confident-looking score merely to simplify the UI.

### 6.4 Safety and training authority remain explicit

UI simplification must never:

- weaken an engine safety gate;
- hide a meaningful restriction;
- present an unavailable harder option as selectable;
- imply that observational telemetry has decision authority;
- invent a diagnosis, prognosis, or causal explanation the engine/evidence does not provide.

The UI is an execution and explanation layer over existing authority, not a second hidden
decision engine.

## 7. Interaction-state requirements

Every meaningful interactive surface should deliberately handle the states that apply to it:

- initial;
- loading;
- empty;
- populated;
- editing;
- validation error;
- service/read failure;
- save/write failure;
- disabled with explanation when needed;
- success/confirmation;
- stale/conflict state when concurrent data can change;
- offline/pending sync where supported.

A state should not disappear merely because it is inconvenient to screenshot or test.

## 8. Design-system consistency

### 8.1 Reuse tokens and primitives

Prefer shared tokens for:

- page gutters;
- card padding;
- section spacing;
- touch target;
- control/card radius;
- colors;
- typography;
- focus treatment;
- elevation/overlay layers.

Do not introduce a new one-off value when an existing token expresses the same design
decision.

### 8.2 Component consistency

Controls with the same role should look and behave alike.

Standardize:

- primary/secondary/tertiary actions;
- destructive actions;
- fields and validation;
- disclosures;
- status badges;
- dialogs/sheets;
- empty/loading/error states;
- navigation active states.

Visual consistency is not a reason to force desktop composition onto mobile.

## 9. Testing and definition of done

UI quality uses several layers because none is sufficient alone.

### 9.1 Component/unit tests

Use for:

- state transitions;
- labels and accessible names;
- validation;
- disclosure behavior;
- keyboard-triggered actions;
- semantic attributes;
- error/success states.

### 9.2 Visual regression

Use the existing Playwright visual harness for representative states at 360/390/412 px and
desktop.

At minimum, relevant UI changes should verify:

- no body-level horizontal overflow;
- correct hierarchy and wrapping;
- fixed/sticky elements do not visually cover content;
- long text and non-happy-path states render;
- mobile and desktop composition both remain intentional.

### 9.3 Browser E2E

Use E2E for behavior screenshots cannot prove:

- complete critical workflows;
- focus movement;
- Back/Forward navigation;
- dialog focus containment/restoration;
- session resume;
- destructive confirmation/undo;
- fixed-footer behavior with reduced viewport height;
- critical mobile hit-target dimensions.

### 9.4 Manual review

For material UI changes, manually review the affected critical flow on a real or faithfully
emulated phone-sized viewport.

Include keyboard-only operation for affected interactive surfaces. When practical, verify with
a screen reader for new custom controls or complex dialog/tab patterns.

### 9.5 UI/UX definition of done

Before calling a user-facing change complete:

- [ ] The main user task is clear and the primary action is obvious.
- [ ] The intended emotional effect is appropriate to the moment: calm/confident/controlled
      by default, with no accidental guilt, alarm, pressure, or false reassurance.
- [ ] Recovery, reduced load, missed work, and imperfect adherence are not framed as moral
      failure or punished through engagement mechanics.
- [ ] Normal and failure states are both designed.
- [ ] No new engine/internal jargon leaks into the primary flow.
- [ ] Keyboard operation works.
- [ ] Focus is visible and not obscured.
- [ ] Mobile actionable targets meet the 44 x 44 project standard.
- [ ] The page does not horizontally overflow at supported mobile widths.
- [ ] Sticky/fixed controls respect safe areas and do not cover content.
- [ ] Color is not the only carrier of state.
- [ ] Safety/uncertainty is not hidden by progressive disclosure.
- [ ] Relevant unit, visual, and E2E coverage has been updated.
- [ ] Current architecture docs are updated when navigation or flow behavior changes.

## 10. Exceptions

Standards need explicit exceptions, not silent erosion.

An exception is acceptable only when the normal rule would materially harm correctness,
comprehension, or an essential interaction. Document:

1. the exact requirement being excepted;
2. why the exception is necessary;
3. the affected components/screens;
4. the compensating accessibility/usability measure;
5. how the exception is tested;
6. whether it is permanent or tracked for removal.

Do not use "the existing component already does this" as justification.

## 11. Relationship to existing UX documents

This standard consolidates durable rules that were previously scattered across:

- `docs/plans/mobile_ux_implementation_plan.md` — useful historical redesign rationale, now
  implemented;
- `docs/analysis/2026-09-16-ux-heuristics-review.md` and follow-up — dated usability
  evidence;
- `docs/architecture/morning-decision-ux.md` — current contracts for the morning decision
  surface;
- `docs/architecture/user-flows.md` — current navigation and flow behavior;
- design tokens and responsive conventions in `app/src/index.css` and component styles.

Those documents remain valuable for their own purposes. For **cross-cutting UI/UX quality
requirements**, this file is the starting point.
