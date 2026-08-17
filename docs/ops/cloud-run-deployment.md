# GCP Cloud Run & Cloud Scheduler Deployment Guide

This guide describes how to containerize, deploy, and schedule the Python Garmin ingestion job on Google Cloud Platform (GCP).

---

## 🐳 1. Building and Pushing Container Image

From the workspace root, build the Docker container image:

```bash
# Define target GCP project and image tag
export GCP_PROJECT="your-gcp-project-id"
export IMAGE_TAG="gcr.io/${GCP_PROJECT}/garmin-sync:latest"

# Build container
docker build -t ${IMAGE_TAG} .

# Push to Container Registry / Artifact Registry
docker push ${IMAGE_TAG}
```

---

## ☁️ 2. Cloud Run Job Configuration

Create a Cloud Run Job executing `python -m garmin_sync sync`:

* **Execution Mode**: Cloud Run Job (One-off task trigger)
* **Tasks**: 1 task per execution
* **Service Account**: GCP IAM service account with roles:
  * `roles/datastore.user` (Firestore Write access)
  * `roles/storage.objectAdmin` (GCS Token & Archive bucket access)

### Required Environment Variables

| Variable | Recommended Cloud Run Setting | Notes |
|---|---|---|
| `APP_USER_ID` | `<TARGET_FIREBASE_UID>` | Firebase Auth UID for user snapshot paths |
| `APP_TIMEZONE` | `Europe/Warsaw` | Application timezone |
| `GARMIN_TOKEN_STORE` | `gcs` | Enforces stateless GCS token persistence |
| `GARMIN_TOKEN_BUCKET` | `<YOUR_PRIVATE_TOKEN_BUCKET>` | Dedicated GCS bucket storing token file |
| `GARMIN_TOKEN_OBJECT` | `garmin/garmin_tokens.json` | GCS object path for Garmin OAuth token |
| `GARMIN_ALLOW_CREDENTIAL_LOGIN` | `false` | Cloud runs MUST set `false` (token-only authentication) |
| `GARMIN_ARCHIVE_ENABLED` | `true` (optional) | Opt-in raw payload archiving in GCS |

---

## ⏰ 3. Cloud Scheduler Setup

Set up a Google Cloud Scheduler job to trigger the Cloud Run Job daily:

* **Frequency**: `0 6 * * *` (06:00 AM every day) or `15 6 * * *` (06:15 AM)
* **Timezone**: `Europe/Warsaw`
* **Target**: HTTP target calling Cloud Run Job Execution API endpoint:
  ```text
  POST https://run.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/jobs/{JOB_NAME}:run
  ```
* **Auth**: OAuth Token with Cloud Run Invoker role.

---

---

## ⚡ 4. Automating Garmin Workout Sync (Queue Polling)

Clicking "Sync to Garmin" in the web app only writes a `pending` doc to
`users/{userId}/garmin_workout_queue/{date}` (see `garminWorkoutQueueService.ts`) --
direct browser-to-Garmin uploads are blocked by Garmin's CORS policy, so something
server-side has to pick that doc up and push it. `push_pending_workouts` closes that
loop: it polls the queue for every `status == 'pending'` item and uploads/schedules
each one via `push_workout`'s shared `_upload_and_schedule` path, then marks it
`synced`.

Wire it up as a **second** Cloud Scheduler job hitting the same Cloud Run Job image
you already deploy for `sync` -- no new IAM, no new container:

* **Command override**: `python -m garmin_sync push-pending-workouts`
* **Frequency**: every 2-5 minutes, e.g. `*/3 * * * *`
* **Timezone**: `Europe/Warsaw`
* **Target**: same `projects.locations.jobs.run` endpoint as the daily sync job, with
  a `containerOverrides.args` override of `["push-pending-workouts"]`
* **Auth**: same OAuth Token / Cloud Run Invoker role as the daily sync scheduler

This is a deliberate poll (not an instant Firestore-triggered function): it reuses
100% of the existing Job/Scheduler infra instead of adding Eventarc + a separate
Cloud Function + its own IAM surface, at the cost of a couple minutes of latency
between the click and the Garmin push. `push_workout`'s status check makes repeated
polls (and any overlap with a manual `push-workout` run) idempotent -- an
already-`synced` item is skipped, never re-uploaded. Queue items older than
`--max-age-days` (default 14) are left pending rather than pushed, so an abandoned
entry doesn't resurface on Garmin weeks later.

---

## 🔑 Initial Token Bootstrap

Because Cloud Run cannot handle interactive Garmin MFA or password logins (`GARMIN_ALLOW_CREDENTIAL_LOGIN=false`), initialize the OAuth token locally first:

```bash
# Run local token bootstrap script
uv run python scripts/bootstrap_garmin_tokens.py --bucket <YOUR_PRIVATE_TOKEN_BUCKET>
```
