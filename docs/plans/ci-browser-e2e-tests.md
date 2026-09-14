# CI browser E2E tests for core athlete journeys

**Status:** Implemented
**Blocked by:** —
**Unlocks:** Browser-level regression coverage for the daily decision and structured-session workflows.

## Goal

Run a small, deterministic Chromium suite in pull-request CI against Firebase Auth and
Firestore emulators. The suite must exercise the real browser application rather than the
visual-fixture entry point, while keeping the visual-review harness separate and optional.

## Preconditions

- Firebase Auth and Firestore emulators run under one disposable demo project.
- The browser app connects to those emulators only when an explicit build-time flag is set;
  development and production Firebase behavior remains unchanged.
- Each journey uses a distinct synthetic email identity and never accesses production data.

## Task board

| Work item | Status | Done when |
|---|:---:|---|
| Emulator-aware browser runtime | [x] | A dedicated Playwright config starts the ordinary app against Auth and Firestore emulators without changing the visual harness. |
| Core journeys | [x] | Sign-in, check-in to recommendation, session launch/completion, and duplicate launch protection run through visible UI and assert durable emulator state. |
| CI integration | [x] | The code-path CI job installs Chromium, runs the suite, and uploads Playwright failure artifacts. |
| Documentation and verification | [x] | The app command reference documents local execution and targeted/full checks pass. |

## Implementation plan

1. **Create an opt-in Firebase emulator connection boundary**
   - Files: `app/src/firebase.ts`, `app/firebase.json`, `app/.env.e2e`.
   - Connect the existing singleton Auth and Firestore clients to localhost only when the
     e2e mode explicitly enables it. Add the Auth Emulator alongside the existing Firestore
     Emulator definition.
   - Keep the default configuration unchanged and make duplicate connection attempts
     impossible through the existing singleton initialization.
   - Risk: a broadly enabled emulator switch could accidentally change normal development.
     Mitigation: require the dedicated e2e environment value and use non-production demo
     Firebase configuration.

2. **Add a standalone Playwright E2E harness**
   - Files: `app/playwright.e2e.config.ts`, `app/tests/e2e/support/*`, `app/package.json`.
   - Preserve `playwright.config.ts` for visual capture. The new config targets
     `tests/e2e`, starts Vite in e2e mode, runs Chromium serially, and retains
     screenshots/videos/traces on failure.
   - Add helpers that create unique Auth Emulator identities, sign in through the rendered
     Login screen, dismiss onboarding deliberately, and inspect same-user emulator state
     through an authenticated Firebase client. Reuse the application's Warsaw-local date
     helper so browser tests cannot drift from production calendar-day semantics. Tests do
     not use production credentials or raw health fixtures.
   - Wait for asynchronously mounted onboarding with Playwright's retrying `waitFor`; do not
     rely on `isVisible({ timeout })`, whose timeout is ignored by Playwright.
   - Risk: a UI-only fixture can hide failed persistence. Mitigation: assert durable
     check-in/session execution state after the corresponding browser actions.

3. **Write journeys before the launch guard implementation**
   - Files: `app/tests/e2e/auth.pw.ts`, `app/tests/e2e/daily-decision.pw.ts`,
     `app/tests/e2e/session-lifecycle.pw.ts`.
   - Cover sign-in with a pre-created emulator account; a complete typical check-in that
     returns to a visible recommendation; starting a reviewed fixture and completing it;
     and two rapid attempts to launch the same session, asserting exactly one execution
     persists and that it remains `in_progress`.
   - Make synchronous clock reads distinct while issuing the duplicate clicks. Session ids
     currently include `Date.now()`, so this prevents a same-millisecond document-id
     collision from masking a regressed launch guard.
   - The duplicate-start journey is the browser-level regression for the intraday
     double-start invariant. It complements, rather than replaces,
     `intradayLaunchClaim.emulator.test.ts`'s transaction/rules contention coverage.
   - Risk: React state updates may leave a short double-click window. Mitigation: add a
     synchronous in-flight launch guard in the session runner and reset it on success or
     failure.

4. **Integrate the gate into CI**
   - Files: `.github/workflows/ci.yml`, `app/package.json`, `app/README.md`.
   - Reuse the frontend test job's Node and Java setup and Firebase emulator cache; install
     Chromium with Playwright's system dependencies; run the e2e command after the rules
     suite; and upload the Playwright report/test-results on success or failure as needed
     for diagnosis.
   - Keep the suite Chromium-only to bound pull-request latency. Cross-browser and visual
     review remain non-gating workflows.

## Verification strategy

- First run each new Playwright journey and observe its expected initial failure before the
  launch guard is added.
- Run `npm run test:e2e` from `app/` to verify Auth + Firestore emulator wiring and all
  browser journeys.
- Run `npm run check` from `app/` for type, lint, unit, knowledge, and catalog gates.
- Retain the Firestore rule emulator suite with `npm run test:rules`; run `make check`
  before delivery when local time permits.

## Out of scope

- Replacing the visual-fixture harness or making screenshot refresh a CI gate.
- Cross-browser matrix expansion, production Firebase testing, real Garmin calls, or
  end-to-end validation of every external-plan/H4 placement permutation. The existing
  emulator transaction suite remains the authority for those storage-level permutations.

## Acceptance criteria

- [x] `npm run test:e2e` starts Auth and Firestore emulators and runs the browser suite.
- [x] Browser tests cover sign-in, check-in to a visible recommendation, session completion,
  and a duplicate-start attempt that leaves exactly one active execution total.
- [x] CI runs the new gate for code changes and preserves actionable failure artifacts.
- [x] The visual Playwright commands and default Firebase application configuration retain
  their existing behavior.
