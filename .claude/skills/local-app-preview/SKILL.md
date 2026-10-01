---
name: local-app-preview
description: Launch and interactively drive the app/ frontend locally against disposable Firebase Auth+Firestore emulators, with no production data risk. Use when asked to run, preview, click through, or manually test the frontend app (new-user paths, onboarding, check-in, session execution, etc.) rather than run its automated test suite.
---

# Local app preview (disposable Firebase emulators)

`npm run dev` in `app/` needs `.env.local` pointed at a real Firebase project and
runs the full `npm run check` gate via `predev` first. For interactive exploration
(clicking through new-user flows, screenshotting, inspecting Firestore writes) use
this path instead: a disposable test environment backed by isolated leased ports,
started so you can drive it with a browser instead of Playwright.

Nothing here touches production Firebase or a real Garmin account.

## 1. Start the preview environment

From `app/`:

```bash
npm run preview:start
```

This acquires an isolated leased port block, writes the generated harness configuration,
starts the Auth + Firestore emulators and Vite in the background, waits for them to be ready,
and writes live connection details to `app/.preview.json`.

Running `npm run preview:start` is safe across concurrent worktrees because every preview
leases ports of its own and gets a disjoint project ID.

## 2. Read ports and URLs from `app/.preview.json`

The generated `app/.preview.json` holds the active endpoints:

```json
{
  "pid": 12345,
  "projectId": "demo-atr-preview-20000",
  "ports": {
    "auth": 20004,
    "firestore": 20000,
    "app": 20005
  },
  "urls": {
    "app": "http://127.0.0.1:20005",
    "auth": "http://127.0.0.1:20004",
    "firestore": "http://127.0.0.1:20000"
  }
}
```

## 3. Open it

Point the browser tool at the App URL from `app/.preview.json` (e.g. `http://127.0.0.1:<appPort>`).

## 4. Provisioning a test user

**The UI's "Create Account" form is currently broken against the emulator** — see
Known gotchas below. Until that's fixed, provision users directly via the Auth
Emulator's REST API using the leased port, then sign in through the real UI:

```bash
AUTH_PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('app/.preview.json')).ports.auth)")

curl -s -X POST "http://127.0.0.1:$AUTH_PORT/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key" \
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

Sign in via REST to get an ID token, then query Firestore's REST API directly using
the leased ports and project ID:

```bash
AUTH_PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('app/.preview.json')).ports.auth)")
FIRESTORE_PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('app/.preview.json')).ports.firestore)")
PROJECT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('app/.preview.json')).projectId)")

TOKEN=$(curl -s -X POST "http://127.0.0.1:$AUTH_PORT/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key" \
  -H "content-type: application/json" \
  -d '{"email":"newuser.test@example.com","password":"TestPass123!","returnSecureToken":true}' \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).idToken)")

curl -s "http://127.0.0.1:$FIRESTORE_PORT/v1/projects/$PROJECT_ID/databases/(default)/documents/users/<UID>/session_executions" \
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
  Use the REST provisioning step above instead.
- **`/api/garmin/status` returns 502.** Expected — there's no Cloud Run function
  running locally. The UI degrades gracefully to a "Garmin: Status unavailable"
  badge; this is not a bug.
- **Client-side form validation still works even though `validatePassword` is
  broken** — e.g. "Passwords do not match" fires before any network call, so it's
  still testable without a workaround.

## Cleanup

From `app/`:

```bash
npm run preview:stop
```

This terminates the supervisor and all child processes (Vite, Firestore emulator,
Auth emulator), cleans up `.preview.json`, and releases the port lease.

If a preview was interrupted abnormally, `npm run harness:status` and
`npm run harness:reap -- --yes` detect and reap stale resources.

## When to use the scripted version instead

For a one-shot automated check rather than interactive exploration, use
`npm run test:e2e` — it starts the same disposable emulators on leased ports, serves the app,
runs the Playwright journeys in `app/tests/e2e/*.pw.ts`, and tears everything
down automatically. Use *this* skill when a human (or an agent driving a browser)
needs to actually look at and click through the app.
