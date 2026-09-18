---
name: local-app-preview
description: Launch and interactively drive the app/ frontend locally against disposable Firebase Auth+Firestore emulators, with no production data risk. Use when asked to run, preview, click through, or manually test the frontend app (new-user paths, onboarding, check-in, session execution, etc.) rather than run its automated test suite.
---

# Local app preview (disposable Firebase emulators)

`npm run dev` in `app/` needs `.env.local` pointed at a real Firebase project and
runs the full `npm run check` gate via `predev` first. For interactive exploration
(clicking through new-user flows, screenshotting, inspecting Firestore writes) use
this path instead: the same disposable `demo-adaptive-training-e2e` project the
project's own `npm run test:e2e` uses, but started manually so you can drive it
with a browser instead of Playwright.

Nothing here touches production Firebase or a real Garmin account.

## 1. Start the emulators

From `app/`:

```bash
npx firebase --project demo-adaptive-training-e2e emulators:start --only auth,firestore
```

Run this in the background — it's a long-lived process. Wait for
`All emulators ready!` before continuing. Ports (fixed by `app/firebase.json`):

| Emulator | Port |
|---|---|
| Auth | 9099 |
| Firestore | 8080 |

Requires Java (for the Firestore emulator) and `firebase-tools`, both already a
project dependency — no global install needed.

## 2. Start the app in e2e mode

From `app/`, in a second background process:

```bash
npm run e2e:serve
```

This runs `vite --mode e2e --host 127.0.0.1 --port 4173`, which loads
`app/.env.e2e` (the checked-in disposable Firebase config —
`VITE_USE_FIREBASE_EMULATORS=true`, project `demo-adaptive-training-e2e`) and
serves the real app UI at `http://127.0.0.1:4173`. It skips `predev`/`npm run
check`, so it comes up in under a second.

## 3. Open it

Point the browser tool at `http://127.0.0.1:4173`.

## 4. Provisioning a test user

**The UI's "Create Account" form is currently broken against the emulator** — see
Known gotchas below. Until that's fixed, provision users directly via the Auth
Emulator's REST API, then sign in through the real UI:

```bash
curl -s -X POST "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key" \
  -H "content-type: application/json" \
  -d '{"email":"newuser.test@example.com","password":"TestPass123!","returnSecureToken":true}'
```

The response's `localId` is the new user's Firebase UID. Sign in with the same
email/password through the app's normal "Sign In" tab — this exercises the real
sign-in path even though signup was seeded out-of-band.

This mirrors what `app/tests/e2e/support/athlete.ts`'s `provisionAthlete()` does
for the project's own Playwright suite — reuse that file's helpers
(`seedRecoverySnapshot`, `dismissOnboardingIfVisible`, `readSessionExecutions`,
`hasPersistedCheckin`) as reference for what fixtures exist and what a
brand-new-vs-seeded user looks like.

## 5. Inspecting what got written (without relying on the UI)

Sign in via REST to get an ID token, then query Firestore's REST API directly:

```bash
TOKEN=$(curl -s -X POST "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key" \
  -H "content-type: application/json" \
  -d '{"email":"newuser.test@example.com","password":"TestPass123!","returnSecureToken":true}' \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).idToken)")

curl -s "http://127.0.0.1:8080/v1/projects/demo-adaptive-training-e2e/databases/(default)/documents/users/<UID>/session_executions" \
  -H "Authorization: Bearer $TOKEN"
```

Useful for confirming a write actually persisted (e.g. a completed
`SessionExecution`) even when the UI doesn't visibly reflect it — that gap is
sometimes the app behaving correctly against a not-yet-activated read path
(check `docs/plans/README.md` before assuming it's a bug), and sometimes it's a
real defect. This is how to tell the difference quickly.

## Known gotchas

- **Signup form is broken against the emulator.** `emailAuthService.signUp()`
  (`app/src/services/emailAuthService.ts`) unconditionally calls Firebase's
  `validatePassword()`, which hits the real Identity Toolkit `getPasswordPolicy`
  endpoint — unimplemented by the Auth Emulator. Every "Create Account" submit
  fails with `auth/identitytoolkit.getpasswordpolicy-is-not-implemented-in-the-auth-emulator`.
  Use the REST provisioning step above instead. (This is a real product bug, not
  just a test limitation — see the local-testing-setup issue prompts recorded
  alongside this skill's origin, or search for this error string in project
  history.)
- **`/api/garmin/status` returns 502.** Expected — there's no Cloud Run function
  running locally. The UI degrades gracefully to a "Garmin: Status unavailable"
  badge; this is not a bug.
- **Client-side form validation still works even though `validatePassword` is
  broken** — e.g. "Passwords do not match" fires before any network call, so it's
  still testable without a workaround.

## Cleanup

Both processes are long-lived; stop them (e.g. `Ctrl+C`, or kill the background
task) when done. The emulators hold everything in memory — nothing persists
between `emulators:start` runs unless you pass `--export-on-exit`.

## When to use the scripted version instead

For a one-shot automated check rather than interactive exploration, use
`npm run test:e2e` — it starts the same disposable emulators, serves the app,
runs the Playwright journeys in `app/tests/e2e/*.pw.ts`, and tears everything
down automatically. Use *this* skill when a human (or an agent driving a browser)
needs to actually look at and click through the app.
