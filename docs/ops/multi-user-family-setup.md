# Multi-user family setup

The app should use **one Firebase project with one Firebase Authentication account per person**. Do not create a second Firebase project for a spouse. The frontend already scopes user-owned documents by the signed-in Firebase `uid`, and Firestore rules use the same UID ownership boundary.

Garmin is different: every person has a separate Garmin Connect identity/token. Scheduled backend jobs therefore need a list of Firebase UIDs and an isolated Garmin token for each UID.

## Architecture

```text
one Firebase project
├── Firebase Auth user A (uid-A)
│   └── users/uid-A/...
│       └── Garmin token: gs://<bucket>/garmin/users/uid-A/garmin_tokens.json
└── Firebase Auth user B (uid-B)
    └── users/uid-B/...
        └── Garmin token: gs://<bucket>/garmin/users/uid-B/garmin_tokens.json

one set of scheduled Cloud Run Jobs
├── sync-all
├── push-pending-workouts-all
└── poll-manual-sync-all
    └── sequentially creates one GarminSyncService per configured UID
```

Multi-user jobs also isolate the ephemeral local token cache and optional raw archive:

- `.garmin_tokens/<uid>/garmin_tokens.json`
- `garmin/users/<uid>/garmin_tokens.json`
- `.garmin_archive/<uid>`
- `raw/garmin/users/<uid>`

This local-path isolation is intentional. A failed restore for one user must never leave another user's token file available as an accidental fallback.

## Add a spouse / family member

1. In the existing Firebase project, create or sign in the second Firebase Authentication user.
2. Record that user's Firebase `uid` from Authentication > Users.
3. In GitHub, create one Environment per Garmin account, for example `garmin-primary` and `garmin-wife`.
4. In each Environment create:
   - `GARMIN_EMAIL`
   - `GARMIN_PASSWORD`
   - optionally `GARMIN_TOTP_SECRET`
5. Run **Garmin Token Bootstrap** once for the existing user and once for the new user. Supply:
   - `app_user_id`: that person's Firebase UID
   - `garmin_environment`: that person's GitHub Environment
6. Add repository secret `APP_USER_IDS` as a comma-separated list, for example `uid-A,uid-B`.
7. Run **Deploy Garmin Sync**. The three existing Cloud Run Jobs are updated to the `*-all` commands; no additional scheduler jobs are required.
8. Sign into the app as each user and verify that the Data view shows only that user's recovery/activity data.

Scheduled jobs never receive `GARMIN_EMAIL` or `GARMIN_PASSWORD`. Credentials are used only by the manual bootstrap workflow; normal operation restores the persisted OAuth token for that UID.

## Migration from the old single-user token

Before this change the production token default was:

`garmin/garmin_tokens.json`

Multi-user mode intentionally does **not** fall back to that object. Re-run Garmin Token Bootstrap for the existing user so the token is written to:

`garmin/users/<existing-firebase-uid>/garmin_tokens.json`

Then bootstrap the spouse into her own UID path and deploy with `APP_USER_IDS` containing both UIDs. Re-bootstrap is preferred over copying the old blob because it makes the Garmin-account-to-Firebase-UID association explicit.

Legacy/manual commands using `APP_USER_ID` still keep their previous token path behavior. Commands reject an ambiguous multi-user-only configuration instead of silently choosing the first UID.

## Health-first running + yoga profile

The engine already supports this case without inventing a new sport model:

- `TrainingIntentProfile.planningMode`: `evergreen`
- `TrainingIntentProfile.priorities`: `["health"]`
- weekly commitment: start with `minSessions=3`, `targetSessions=4`, `maxSessions=5`
- no dated race goal unless the athlete actually has one
- an optional active `UserGoal` can use `domain="general_fitness"`
- `UserPreferences.preferredModalities`: `["Running", "Mobility"]`
- `UserPreferences.unavailableModalities`: `["Cycling", "Strength", "Field", "Cross Training"]`
- `preferredRecoveryStyle`: `active` or `mixed`
- `conservativeBias`: `true`
- `extraRecoveryMargin`: `true`
- default session time: roughly 30-45 min weekdays and 45-60 min weekends, adjusted to the athlete's real availability

The catalog's canonical modality for yoga/recovery/mobility work is **`Mobility`**. In this profile, treat `Mobility` as the yoga bucket. `unavailableModalities` is the important field: it is a hard exclusion, unlike `avoidedModalities` or `deprioritizedModalities`, which are ranking preferences and can still be selected in fallback situations.

A sensible health-first weekly shape is usually 3 runs plus 1-2 yoga/mobility sessions, with most running easy and no more than one harder running exposure when recovery and recent history support it. The recommender should decide day-to-day dose from readiness rather than forcing a race-performance microcycle.

### Public-health guideline caveat

General adult physical-activity guidance commonly includes both aerobic activity and muscle-strengthening work. This app profile deliberately honors the athlete's stated `running + yoga only` constraint. Some yoga styles provide meaningful strengthening, but the software must not claim that every yoga session automatically satisfies a formal muscle-strengthening guideline.

## Adding a third user

Repeat the Firebase Auth + GitHub Environment + token bootstrap steps, then append the UID to `APP_USER_IDS`. No new Firebase project, Cloud Run Job, or Cloud Scheduler schedule is needed.

## Operational failure behavior

All-user commands process UIDs sequentially. If one account fails, later accounts are still attempted. The command exits non-zero if any user failed so Cloud Run/Scheduler records the execution as unhealthy rather than hiding a partial failure.
