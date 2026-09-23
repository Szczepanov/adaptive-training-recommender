# Mobile UX remediation: interaction, overlays, and navigation

**Status:** `In progress`
**Blocked by:** manual keyboard/screen-reader and real-device spot checks; PR review
**Unlocks:** implementation and verified closure of GitHub issues [#727](https://github.com/Szczepanov/adaptive-training-recommender/issues/727)–[#732](https://github.com/Szczepanov/adaptive-training-recommender/issues/732)
**Tracking issue:** [#734](https://github.com/Szczepanov/adaptive-training-recommender/issues/734)
**Scope authority:** [`docs/standards/ui-ux.md`](../standards/ui-ux.md)
**Historical baseline:** [`docs/plans/mobile_ux_implementation_plan.md`](./mobile_ux_implementation_plan.md)

## Overview

The original mobile redesign is complete, but a follow-up audit found specific interaction gaps in the current session runner, manual session builder, overlays, shared controls, and browser navigation. This plan coordinates the six existing open GitHub issues and adds a staged verification path. It does not reopen the completed redesign or change training and recommendation policy.

The intended result is that athletes can use critical flows at phone widths with reliable touch targets, visible focus and keyboard behavior, safe Back/Forward semantics, and repeatable interaction-level regression checks.

## Existing issue inventory

| Work item | GitHub issue | Owns |
|---|---|---|
| UX-T | [#732 Mobile E2E projects and interaction regression gates](https://github.com/Szczepanov/adaptive-training-recommender/issues/732) | Reusable mobile browser-test project and assertions; foundation and final integrated coverage |
| UX-SHELL | [#731 Enforce 44 px targets in shared shell and secondary screens](https://github.com/Szczepanov/adaptive-training-recommender/issues/731) | Shared navigation, shell, and non-session controls |
| UX-OVERLAY | [#729 Standardize mobile overlays](https://github.com/Szczepanov/adaptive-training-recommender/issues/729) | Dynamic viewport, safe areas, focus lifecycle, scrolling, and migration of the named dialogs/sheets |
| UX-RUNNER | [#727 Make the structured session runner thumb-safe](https://github.com/Szczepanov/adaptive-training-recommender/issues/727) | Active `SessionRunner` controls and in-session reachability |
| UX-BUILDER | [#728 Redesign manual session authoring for touch](https://github.com/Szczepanov/adaptive-training-recommender/issues/728) | `ManualSessionBuilder` mobile authoring, disclosure, and keyboard visibility |
| UX-NAV | [#730 Integrate navigation with browser history and Back gestures](https://github.com/Szczepanov/adaptive-training-recommender/issues/730) | Stable top-level routes, history transitions, and safe session/check-in behavior |

Repository search found all six issues open and no existing umbrella issue. Their scopes are distinct. The adjacent Strength-session issues [#723](https://github.com/Szczepanov/adaptive-training-recommender/issues/723)–[#726](https://github.com/Szczepanov/adaptive-training-recommender/issues/726) cover separate legacy/gym-floor lifecycle concerns and remain outside this plan; avoid duplicating or transferring their work here.

## Requirements and constraints

- Meet the normative interaction and accessibility requirements in `docs/standards/ui-ux.md`, including effective 44 × 44 CSS-pixel mobile targets, visible/unobscured focus, keyboard access, honest state communication, and explicit safety around navigation.
- Preserve user-scoped data, session persistence/state-machine semantics, recommendation safety gates, and the daily-check-in precedence rule.
- Keep the existing 360/390/412 px visual matrix and add targeted 320 px checks where #731 requires; mobile E2E should use a curated subset to bound emulator/runtime cost.
- Use the existing app shell and session execution paths. Do not introduce a second session runner or routing abstraction without first verifying whether the current stack can satisfy the route contract.
- Keep component tests for local state behavior, visual tests for layout, and emulator-backed E2E for cross-screen behavior; do not treat screenshots as proof of interaction semantics.

## Architecture and ownership boundaries

- Shell and screen selection: `app/src/App.tsx`, `app/src/types/navigation.ts`, `app/src/components/Header.tsx`, `app/src/components/MobileNav.tsx`, and `app/src/components/navigationGroups.ts`.
- Session execution and authoring: `app/src/components/session/SessionRunner.tsx`, `SessionRunner.css`, `ManualSessionBuilder.tsx`, and `ManualSessionBuilder.css`.
- Overlay contract and migrations: `Goals`, `ActivityReclassificationModal`, `schedule/*Modal`, `OnboardingWizard`, and `session/SessionDestinationSheet` components/styles listed in #729.
- Test harness: `app/playwright.e2e.config.ts`, `app/tests/e2e/`, `app/playwright.config.ts`, and shared target/viewport helpers. Keep the visual-review bundle lifecycle (`prepare-visual-review.mjs`, `finalize-visual-review.mjs`) separate from the emulator-backed E2E run.

## Ordered implementation plan

### UX-R0 — establish mobile interaction-test primitives (UX-T / #732)

1. Add one phone-sized Chromium project to `playwright.e2e.config.ts` and define a curated mobile spec list; keep the existing desktop E2E project intact.
2. Add reusable E2E assertions for effective target size, body overflow, focused-element visibility after viewport-height reduction, and dialog focus entry/restoration. Use bounding boxes and the actual clickable area, not just CSS declarations.
3. Add the More-drawer journey (open, focus containment, close, destination navigation) as the first stable mobile interaction baseline, and document how the mobile subset is selected in the npm script/config.
4. Ensure emulator lifecycle, ports, and test data remain isolated from the visual harness.

**Dependency:** none. **Risk:** medium (Playwright project and emulator runtime configuration). **Exit:** mobile project runs deterministically in isolation and the assertions fail against a deliberately undersized/obscured fixture.

### UX-R1 — normalize shared and secondary-screen targets (UX-SHELL / #731)

1. Audit actionable controls against `--touch-target-min` in the shell and non-session screens; classify exceptions by effective hit area rather than glyph size.
2. Fix the confirmed active-session banner, More-drawer close, goal-modal close, Plan import/revise, and physical-work chip fallbacks, then address other audit hits in the same ownership boundary.
3. Use the Phase 0 target assertion for representative controls and verify wrap/overflow at 320, 360, 390, and 412 px.

**Dependency:** Phase 0 for reusable assertions is recommended, not a blocker to sizing work. **Risk:** low/medium (wrapping and layout shifts). **Exit:** targeted shell controls meet 44 × 44 effective bounds, exceptions are documented, and mobile widths remain usable.

### UX-R2 — establish and migrate the mobile overlay contract (UX-OVERLAY / #729)

1. Select a shared CSS utility or focused component contract for dynamic viewport sizing with fallback, safe-area insets, internal scrolling, and background-scroll containment. Avoid abstracting dialog content/business fields.
2. Define reusable focus entry/restoration, Escape dismissal where safe, and close/action target behavior. Preserve destructive-action confirmation and unsaved work.
3. Migrate Goals, one representative scheduling dialog, Activity Reclassification, Onboarding, and Session Destination; then migrate the remaining named schedule overlays using the same contract.
4. Add representative component and mobile E2E coverage for keyboard-reduced viewport, inner scrolling, focus, safe areas, and background lock.

**Dependency:** Phase 0 primitives; the shared contract should be agreed before builder-specific reuse. **Risk:** medium/high (focus lifecycle, nested dialogs, existing CSS divergence). **Exit:** named overlays remain operable at the three issue-specified viewport sizes; no primary action or focused control is obscured.

### UX-R3 — make active structured sessions touch-safe (UX-RUNNER / #727)

1. Measure all enabled controls in `SessionRunner` at 360/390/412 px, including timer-visible, grouped, warm-up, long-history, and completion states.
2. Expand effective hit boxes to 44 × 44 while retaining compact glyphs; keep set logging dominant and reachable, and resolve wrapping/reach issues in secondary controls.
3. Add automated measurements for group progression, rest adjustment, sound, save-template, timer cancel/skip, and exercise navigation.
4. Run existing grouped-session, warm-up, and completion visual journeys and the focused mobile interaction flow.

**Dependency:** Phase 0 target helper. **Risk:** medium (dense active-workout layout). **Exit:** each enabled control meets the target, set logging remains dominant, and no overflow/covered content regression occurs.

### UX-R4 — make manual session authoring comfortable on narrow screens (UX-BUILDER / #728)

1. Replace wrapped desktop editing rows with mobile-first step cards; retain desktop composition at wider widths.
2. Normalize form/control targets and operational text; give destructive controls explicit accessible names.
3. Keep frequent fields visible and progressively disclose advanced values/actions, while keeping any persisted values visible when collapsed content would otherwise hide data.
4. Verify step add/edit/reorder/alternatives/actions/remove, validation recovery, and focused-field visibility with reduced viewport height and a software-keyboard-like viewport.
5. Add visual cases for empty, multi-step, advanced, alternatives/options, and validation-error states.

**Dependency:** Phase 0 assertions; Phase 2 viewport/focus contract should be reused if it fits the builder without coupling the builder to modal semantics. **Risk:** medium (editing density and preservation of existing authored values). **Exit:** full authoring loop works without precision taps or horizontal overflow at 360/390/412 px.

### UX-R5 — make top-level navigation history-aware (UX-NAV / #730)

1. Inventory all `Screen` values, current state transitions, auth gates, daily-decision auto-routing, overlays, and active-session exit/resume behavior.
2. Specify a stable private route mapping and malformed/unauthorized route fallback before implementation; retain the daily check-in precedence rule.
3. Make normal navigation create/replace history intentionally and reconcile `popstate` into app state without reload. Keep transient drawer/modal state out of history unless separately justified.
4. Define and implement an explicit safe active-session history policy that never silently abandons work.
5. Verify Home → Plan → Goals Back/Forward, refresh/deep-link restoration after auth, pending-check-in precedence, invalid routes, active sessions, and correct nav active states in browser E2E.

**Dependency:** navigation mapping and safety contract are reviewed before routing edits; Phase 0 E2E support. **Risk:** high (auth hydration, auto-route ordering, accidental session abandonment). **Exit:** browser Back/Forward is in-app for routed top-level screens, safety precedence is unchanged, and in-progress session state is preserved.

### UX-R6 — integrated mobile acceptance and closeout (UX-T / #732)

1. Complete curated mobile E2E journeys for check-in, start/resume/log session, More drawer, Goals, Plan switcher, overlays, and manual builder; add navigation assertions only after Phase 5.
2. Run component tests for changed components, the mobile E2E subset, the existing desktop E2E suite, and the four-project visual harness.
3. For 360/412 visual captures, use the proper prepare/run/finalize workflow or mark direct `npx playwright test` output as ad hoc; do not treat stale review manifests as current evidence.
4. Review 320 px behavior where issue #731 requires it and perform keyboard/screen-reader spot checks for new focus patterns. Record any explicit exception per `ui-ux.md` §10.
5. Update current architecture documents for changed navigation/flow behavior and update this plan/status board from evidence.

**Dependency:** Phases 1–5. **Risk:** medium (test runtime/flakiness). **Exit:** mobile interaction gates are bounded and stable in CI; desktop behavior, screenshot artifacts, and accessibility checks have recorded results.

## Verification strategy

- Component/regression: focused Vitest files for modified components and navigation helpers.
- Visual: `cd app && npm run visual:refresh` for the finalized desktop/390 px bundle; run narrow/wide projects with explicit review-bundle preparation/finalization before calling those captures finalized.
- E2E: `cd app && npm run test:e2e` plus the documented curated mobile project/spec selector; preserve the existing desktop suite.
- Static quality: `cd app && npm run check` after each coherent implementation PR and `npm run build` for the integrated delivery.
- Manual: phone-sized browser, keyboard-only flow, focus visibility with reduced viewport height, and a real-device check for the active runner/builder where available.
- Repository hygiene: check `POLICY_VERSION` only if a UI change unexpectedly affects recommendation behavior; this plan explicitly forbids that scope expansion.

## Automated delivery evidence (2026-09-23)

- `cd app && npm run check` — passed: typecheck, ESLint, 6,104 Vitest tests, and all
  knowledge/workout validators.
- `cd app && npm run test:e2e` — passed all 18 desktop and mobile journeys, including
  check-in precedence, Back/Forward, persisted session resume, overlays, and runner controls.
- `cd app && npm run visual:refresh` — passed all 76 finalized desktop and 390 px mobile
  captures. The manual builder's 9 Playwright visual cases passed across 360, 390, and 412 px;
  collectively they capture empty, multi-step, expanded advanced, alternatives/options,
  validation-error, and reduced-viewport focus states.
- Focused post-review reruns: MobileNav/builder/route unit tests (10 passed) and the session
  runner completion target E2E (passed).

Manual keyboard/screen-reader and real-device checks remain delivery follow-ups and are not
represented as completed by browser automation.

## Risks and mitigations

- **History integration changes safety precedence.** Add tests before route wiring for check-in auto-routing, auth loading, malformed routes, and active session persistence.
- **A shared overlay abstraction grows too broad.** Keep the contract limited to viewport, safe area, scrolling, focus lifecycle, and dismissal; migrate incrementally.
- **Mobile E2E multiplies runtime or flakes.** Curate high-value journeys, reuse emulator setup, avoid duplicating screenshot assertions, and keep the desktop suite unchanged.
- **44 px sizing creates dense wrapping.** Use larger hit boxes around compact glyphs, measure at 320–412 px, and document only true exceptions.
- **Overlapping sibling issues.** Keep #727 focused on the current `SessionRunner`; issues #723–#726 retain ownership of their distinct Strength-session lifecycle/legacy logger scopes.

## Success criteria

- [ ] Issues #727–#731 meet their own acceptance criteria and are closed only after evidence is linked.
- [ ] #732 provides a curated, stable mobile interaction gate in CI, with explicit runtime cost and supported journeys.
- [ ] The 44 px project target, visible focus, viewport/safe-area, and Back/Forward requirements in `ui-ux.md` are verifiable in affected flows.
- [ ] No recommendation, safety, persistence, or schema behavior changes are introduced by the UX work.
- [ ] Current architecture and this plan reflect shipped behavior; dated analyses remain immutable.
