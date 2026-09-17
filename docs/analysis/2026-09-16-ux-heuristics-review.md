# Adaptive Coach UX Review — Heuristics Evaluation and Usability Audit

**Date:** 2026-09-16
**Method:** live walkthrough of a fresh account against real Firebase auth/Firestore emulators — sign-up, onboarding, daily check-in, the home recommendation, the 7-day plan, Training Setup, and the Data tab — on a 1024×768 desktop layout and a 375×812 mobile viewport.
**Build reviewed:** `main` @ `7675cd21`
**Disposition:** dated, point-in-time audit. Three findings were fixed in [PR #588](https://github.com/Szczepanov/adaptive-training-recommender/pull/588); three others were walked back after tracing them to source (see "Findings that did not hold up"); the remainder are recorded here as unimplemented.

## 1. Usability heuristics evaluation

Scored against Nielsen's ten heuristics, each grounded in something observed on screen.

| Heuristic | Rating | Evidence |
|---|---|---|
| Visibility of system status | Mixed | The check-in progress stepper and Training Setup's live per-toggle text ("Not used in recommendations") are good status feedback. The stepper not visibly reacting to the "feeling normal" quick-fill turned out to be deliberate (see §3). |
| Match between system and real world | Weak | Engine/scoring vocabulary surfaced directly in athlete-facing copy in three places — see §3, finding 1. |
| User control and freedom | Strong | Explicit onboarding skip, partial check-in save, 1-Tap Alternatives, full edit/delete on schedule windows and overlays. |
| Consistency and standards | Mixed | Component shells repeat consistently. Status-communication tone was inconsistent between the Garmin badge and Home's recovery sidebar — see §3, finding 3. |
| Error prevention | Strong | Unanswered check-in sliders stay explicitly "not set" rather than defaulting to a misleading 5/10; hard safety gates are separated from soft preferences with inline copy explaining the difference. |
| Recognition rather than recall | Mixed | Slider anchors and day-strip icons support recognition well. The Data tab requires the reader to already know what a dozen derived-metric labels mean. |
| Flexibility and efficiency of use | Strong | "Feeling normal today? Use typical values" is a genuine expert shortcut that doesn't remove the detailed path underneath it. |
| Aesthetic and minimalist design | Mixed | Home is a good model (primary action prominent, detail behind three disclosure rows). Training Setup is the opposite: seven dense, fully-expanded sections on one long scroll. |
| Help users recognize, diagnose, and recover from errors | Mixed | The Garmin badge's own copy is accurate and actionable; its severity styling didn't match its severity (fixed in PR #588). |
| Help and documentation | Strong | Training Setup explicitly cross-references Coach Preferences by name and explains which one wins in a conflict; "Why today" rationale is shown by default rather than hidden. |

## 2. UX best-practices review

**Information architecture.** The four-item primary nav (Home, Check-in, Plan, More) is a sound split along the athlete's daily loop. The More drawer flattens nine destinations of very different frequency and weight (Sessions next to Sign Out) into one list with no grouping.

**Visual hierarchy.** Strong on Home (one bright primary CTA, two muted secondary actions, three collapsed detail rows). Weak on Training Setup and the Data tab, where every field carries equal visual weight regardless of whether it's a safety gate or a cosmetic preference.

**Accessibility.** Form labels are properly associated throughout (confirmed via the accessibility tree). The one gap found — a clickable list row with a mouse handler and no keyboard path — was in code from the same day's earlier work and was fixed before merge, not a finding against the reviewed build.

**Responsive design.** A genuine strength: the top nav correctly swaps for a thumb-reachable bottom tab bar at 375px, cards restack to a single column, touch targets stay comfortably sized. The wordmark ("Adaptive Coach") wraps to two lines at that width.

**Interaction patterns.** Modals, cards, and disclosure rows follow one consistent shell throughout. Progressive disclosure is used well on Home and not used at all on Training Setup.

**Content clarity.** Coaching-voice copy (check-in helper text, empty states, Training Setup's cross-references) is consistently clear. Engine-voice copy (scoring internals, baseline version gates) was not — see §3.

## 3. Findings fixed in PR #588

**1. Engine scoring internals leaked into the home screen's rationale.** `MorningDecisionCard.tsx` already moved the leading `Coverage tier: X. Benefit score: Y...` sentence into a collapsed "Engine scoring telemetry" detail, but every parenthetical clause `optimizer.ts` appends after it (`Sequence intent: ...`, `Sequence soft preference x...`, `Event-modality coverage: ...`, `Soft penalty applied: ...`, the recovery-placement clauses) stayed inline in the visible narrative. Fixed by generalizing the existing extraction to catch all of them by recognizable phrase, not by stripping every parenthetical — `rules.ts`'s own clauses (e.g. explaining a Rest/Mobility default) are genuinely athlete-relevant and stay visible.

**2. Internal schema-version numbers on the Data tab.** The "Observation-only Candidate Baselines" section showed `N/A (requires baseline v4)` / `v5`, and two Respiration fields showed `(legacy pre-v3)`, whenever an account hadn't been migrated to a newer baseline-computation schema — an internal rollout gate, not a fact about the athlete's own data, and not actionable even to the technical audience that tab is otherwise written for. Fixed by replacing the 8 repeated instances with one shared "Not available yet" constant, keeping the real Median-vs-Avg methodology distinction where it's meaningful.

**3. Garmin "unknown" status reused a genuine-failure's red styling and control semantics.** The `unknown` connection state (the status check itself failed, distinct from `disconnected`, which shows no badge at all) reused `status-failed`'s solid red styling — the same visual severity as a workout that actually failed to sync. This directly contradicted Home's own sidebar card, which describes the identical fact calmly as "wearable optional." Fixed with a dedicated muted-amber `status-unknown` treatment. Follow-up review also replaced the non-actionable disabled button with non-interactive `role="status"` content, kept the refresh-to-retry guidance in its accessible name, and scoped hover/active/focus styles to actual Garmin buttons so the status chip no longer behaves visually like a control.

## 4. Findings that did not hold up

Tracing three more findings to their actual source found they were misreads of the live UI, not bugs. Recorded here rather than silently dropped:

- **"Tomorrow: Optimal/Moderate/Low legend applies to every day, not just tomorrow."** Not a legend — `WeekAheadStrip.tsx`'s interactive tier *selector*, correctly scoped to tomorrow only (`aria-label="Tomorrow's expected readiness tier"`), shown only when tomorrow has multiple forecastable tiers. The colored dot under every day card is a separate, correctly-tooltipped train/recover mode indicator, unrelated to the selector.
- **"Copy AI Context has no explanation."** It does: `title="Copy today's morning briefing for your external AI coach"`. Not hovered during the walkthrough.
- **"Check-in stepper doesn't react to the 'feeling normal' shortcut."** Deliberate, documented behavior. `checkinStepState.ts`: *"entering a value is not the same thing as saving it, and Back/Skip must never make an unsaved draft look persisted."* Making the stepper reflect an unsaved draft would reintroduce the failure mode that comment guards against.

## 5. Findings not yet implemented

Real findings, judged bigger or lower-value than the three fixed in PR #588, filed as issues for a future pass:

- **Training Setup is one long, fully-expanded page.** ([#589](https://github.com/Szczepanov/adaptive-training-recommender/issues/589)) Equipment, safety limits, time/location, recovery preferences, injury constraints, progression review, and a full progression-block authoring form all render open in sequence, with no grouping or collapse. Safety-relevant toggles carry no more visual prominence than cosmetic ones. Suggested fix: collapsible sections with safety pinned open by default; move progression-block authoring to its own destination.
- **Two plan-import entry points on the Plan screen.** ([#590](https://github.com/Szczepanov/adaptive-training-recommender/issues/590)) `Import Plan` (persistent header button) and `Have a coach's plan? Import it` (inline card CTA) appear to route to the same flow. Worth confirming intent before consolidating.
- **Onboarding welcome card sits in an oversized, mostly-empty container** ([#591](https://github.com/Szczepanov/adaptive-training-recommender/issues/591)) with its own scrollbar rather than a normally-centered modal.
- **More drawer's nine destinations** ([#592](https://github.com/Szczepanov/adaptive-training-recommender/issues/592)) (Sessions, Testing, Plan, Goals, Training Setup, Coach Preferences, Data, Export Context for AI, Sign Out) are one flat list; grouping into daily/configure/account clusters would help. Note: `navigationGroups.ts` already defines a `DRAWER_GROUPS` model — the gap may be in rendering, not data.

## 6. Design strengths

- Unanswered check-in sliders never silently default to a misleading midpoint — a real safety-relevant error-prevention win.
- "Why today" shows the recommendation's rationale by default rather than hiding it, a trust builder for an AI-driven plan.
- Home's tiering (one primary action, two secondary, three disclosure rows) is textbook progressive disclosure.
- "Feeling normal today?" fills six sliders at once without removing the detailed per-slider path underneath.
- Training Setup explicitly names Coach Preferences and explains which one wins in a conflict — rare clarity between two similar-sounding screens.
- Clean responsive swap from top nav to bottom tab bar at phone width, with comfortable touch targets throughout.
- Every empty list (goals, schedule blocks, training windows) explains what it's for and offers a direct call to action.
