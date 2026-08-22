# Self-service Garmin accounts and family setup

The app uses **one Firebase project and one Firebase UID per person**. Firebase is the internal identity/data boundary; users do not need to understand or provision Firebase accounts themselves.

Garmin linking is an application flow, not an operations workflow:

```text
web app
  -> Continue with Garmin / Connect Garmin
  -> Garmin credentials (+ MFA when required)
  -> garmin-account-link Cloud Run service
  -> resolve stable Garmin identity
  -> reuse existing Firebase UID or create a new Firebase user
  -> persist Garmin session token at garmin/users/<uid>/garmin_tokens.json
  -> write server-only garminConnections + garminIdentities metadata
  -> return Firebase custom token
  -> browser signs in as that UID
```

Scheduled jobs then discover `garminConnections` with `status=active`; there is no `APP_USER_IDS` deployment setting.

## Security boundary

This integration currently uses the unofficial `garminconnect` login flow. It is appropriate for this private/family deployment, but it should not be presented as the final authentication architecture for a public SaaS. A public product should prefer an approved Garmin Developer Program / OAuth integration.

The self-service implementation follows these rules:

- Garmin passwords are submitted over HTTPS and are **never written to Firestore, GCS, GitHub, logs or environment variables**.
- A non-MFA login discards the password after authentication and stores only the refreshable Garmin token artifact.
- Garmin MFA continuation requires the same live Garmin client/session. The account-link service therefore runs with `max-instances=1` and keeps a short-lived challenge in memory only.
- As soon as Garmin accepts the first factor, the service clears the plaintext password from the retained Garmin object. Only the live SSO/MFA session remains in memory.
- An instance restart invalidates an MFA challenge; the user restarts login. The service never persists a password or pending SSO session just to make MFA survive a restart.
- Login starts are rate limited in memory. Garmin's own rate limiting still applies.
- A stable Garmin identity is derived from `garminGUID`, then `profileId`, with `displayName` only as a compatibility fallback. The raw identifier is not stored in the mapping document; its typed value is SHA-256 hashed.
- `garminIdentities/{digest}` enforces one Garmin identity -> one Firebase UID.
- `garminConnections/{uid}` enforces one active Garmin identity -> one app user.
- Those two top-level collections are intentionally server-only: browser Firestore rules contain no allow rule for them. Firebase Admin/Cloud Run owns them.
- User training data remains under `users/{uid}/...`, retaining the existing ownership rules.

## New user: Continue with Garmin

1. Open the app and choose **Continue with Garmin**.
2. Enter Garmin email/password.
3. If Garmin requests MFA, enter the code in the app.
4. The backend checks whether this Garmin identity is already linked.
5. If it is already linked, the existing Firebase UID is reused and the user is signed into that account.
6. If it is new, Firebase Authentication creates an internal user, the Garmin token is stored under that UID, and the browser receives a Firebase custom token for the new UID.
7. No GitHub secret, Firebase Console user creation, Cloud Run deployment or scheduler change is required.

Returning users can therefore use Garmin as their app sign-in without maintaining a separate app password.

## Existing single-user account migration

Do **not** sign in with Garmin first if the existing account already has training history under a Firebase UID; doing that would correctly create a new UID because no Garmin identity mapping exists yet.

Migration is deliberately explicit once:

1. Deploy the new Garmin service and frontend.
2. On the login screen choose **Use existing app login** and sign into the existing Firebase account.
3. Open **Preferences -> Garmin account**.
4. Choose **Connect Garmin** and complete Garmin MFA if requested.
5. The browser sends the existing Firebase ID token with the Garmin login. The backend therefore binds that Garmin identity to the **existing UID** rather than creating a new user.
6. The new token is stored at `garmin/users/<existing-uid>/garmin_tokens.json`.
7. From then on, sign out and use **Continue with Garmin**. It resolves back to the existing UID and all historical data remains in place.

The previous shared object `garmin/garmin_tokens.json` is intentionally not used as a fallback. Explicit re-linking prevents a stale/shared token from being silently associated with the wrong Firebase user.

## Spouse / family member

After the existing-user migration, adding another person is entirely self-service:

1. Sign out.
2. The family member chooses **Continue with Garmin**.
3. She authenticates her own Garmin account and completes MFA if needed.
4. A new internal Firebase user is created automatically because the Garmin identity has no mapping yet.
5. Her data is stored only under her new UID and her token only under `garmin/users/<her-uid>/...`.

Adding a third or tenth user is the same flow. No static UID list exists.

## Health + Running + Yoga preset

Preferences includes **Apply Health + Running + Yoga**. The preset writes existing engine primitives rather than introducing a second planning engine:

- `planningMode: "evergreen"`
- `priorities: ["health"]`
- weekly commitment: `minSessions=3`, `targetSessions=4`, `maxSessions=5`
- `preferredModalities: ["Running", "Mobility"]`
- `unavailableModalities: ["Cycling", "Strength", "Field", "Cross Training"]`
- `preferredRecoveryStyle: "mixed"`
- `conservativeBias: true`
- `extraRecoveryMargin: true`
- default time: 40 minutes weekdays, 50 minutes weekends

`Mobility` is the current catalog bucket for yoga/mobility/recovery sessions. `unavailableModalities` is a hard exclusion; `avoidedModalities` and `deprioritizedModalities` are only ranking preferences.

A health-first user should normally have no dated race event unless she actually has one. An optional active goal can use `domain="general_fitness"`.

### Public-health caveat

General adult physical-activity guidance includes aerobic activity and muscle-strengthening activity. The preset deliberately honors a user's Running + Yoga constraint. Some yoga sessions can provide meaningful strengthening stimulus, but the app must not claim every yoga session automatically satisfies a formal muscle-strengthening recommendation.

## Scheduled jobs

`sync-all`, `push-pending-workouts-all`, and `poll-manual-sync-all` now:

1. read active server-side `garminConnections` documents;
2. create isolated settings for each owner UID;
3. restore `garmin/users/<uid>/garmin_tokens.json`;
4. process users sequentially;
5. continue to later users if one fails;
6. return non-zero if any linked user failed.

Per-user ephemeral/archive paths remain isolated:

- `.garmin_tokens/<uid>/garmin_tokens.json`
- `garmin/users/<uid>/garmin_tokens.json`
- `.garmin_archive/<uid>`
- `raw/garmin/users/<uid>`

A failed restore for one UID can therefore never expose another user's local token as a fallback.

## Deployment / one-time IAM update

Run `docs/ops/setup-workload-identity.sh` once again after merging this change. It now grants `garmin-sync-job@...` permission to sign Firebase custom tokens **on itself only**, which Firebase Admin needs when using Cloud Run Application Default Credentials.

Then deploy in this order:

1. **Deploy Garmin Sync** — deploys the account-link HTTP service plus the three scheduled jobs.
2. **Deploy Frontend & Firestore Rules** — deploys the Firebase Hosting rewrite `/api/garmin/** -> garmin-account-link` plus the web UI.
3. Perform the existing-user migration above.
4. Sign out and onboard the spouse with **Continue with Garmin**.
5. Run a manual/smoke sync and verify each login sees only its own data.

GitHub no longer needs `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `GARMIN_TOTP_SECRET`, `APP_USER_IDS`, or the old per-user Garmin Environments. Legacy `APP_USER_ID` remains supported only for explicit local/manual single-user CLI operations.
