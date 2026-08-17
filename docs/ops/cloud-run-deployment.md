# GCP Cloud Run & Cloud Scheduler Deployment Guide

This guide containerizes the Python Garmin ingestion/sync package and schedules two
recurring jobs on Google Cloud Platform (GCP):

* **`garmin-sync`** -- daily recovery-metrics ingestion (`python -m garmin_sync sync`)
* **`garmin-push-pending-workouts`** -- polls the Firestore workout queue every few
  minutes and pushes anything queued by "Sync to Garmin" in the web app
  (`python -m garmin_sync push-pending-workouts`)

Both share one container image and one runtime service account; only their
`--args` differ. Run the sections below in order.

---

## 0. Prerequisites
* [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) installed and logged in
  (`gcloud auth login`).
* Your existing **Firebase project** is the GCP project to use -- Firebase projects
  *are* GCP projects, same project ID, same Firestore instance the web app already
  writes to. Find it in the Firebase console or `app/.firebaserc`.
* A Garmin Connect account (email + password) for the one-time token bootstrap.
* No local Docker required -- `gcloud builds submit` builds remotely.

```bash
export GCP_PROJECT="your-gcp-project-id"
export REGION="europe-central2"  # Warsaw
gcloud config set project ${GCP_PROJECT}
```

From the workspace root, build and push the container image to Artifact Registry using Cloud Build (no local Docker required):
```bash
# Submit build to Artifact Registry
gcloud builds submit --tag europe-central2-docker.pkg.dev/adaptive-training-recommender/garmin-sync/garmin-sync:latest .
```

---

## 1. Enable required APIs

```bash
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com \
  firestore.googleapis.com storage.googleapis.com
```

---

## 2. Create the token bucket and service accounts

A private GCS bucket holds the Garmin OAuth token JSON (`GARMIN_TOKEN_STORE=gcs`
keeps Cloud Run stateless -- no local disk between runs). Two service accounts:
one the Jobs run as, one Cloud Scheduler uses to invoke them (least privilege --
the scheduler identity never touches Firestore or GCS directly).

```bash
gcloud storage buckets create gs://${GCP_PROJECT}-garmin-tokens \
  --location=${REGION} --uniform-bucket-level-access
```

```bash
gcloud iam service-accounts create garmin-sync-job \
  --display-name="Garmin sync Cloud Run Job runtime identity"
```

```bash
export JOB_SA_EMAIL="garmin-sync-job@${GCP_PROJECT}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding ${GCP_PROJECT} \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="roles/datastore.user"

gcloud storage buckets add-iam-policy-binding gs://${GCP_PROJECT}-garmin-tokens \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="roles/storage.objectAdmin"
```

```bash
gcloud iam service-accounts create garmin-scheduler-invoker \
  --display-name="Cloud Scheduler -> Cloud Run Jobs invoker"

export SCHEDULER_SA_EMAIL="garmin-scheduler-invoker@${GCP_PROJECT}.iam.gserviceaccount.com"
```
(`SCHEDULER_SA_EMAIL` is granted `roles/run.invoker` per-Job in step 4, after the
Jobs exist.)

---

## 3. Build and push the container image

Container Registry (`gcr.io`) is retired -- this uses Artifact Registry.

```bash
gcloud artifacts repositories create garmin-sync \
  --repository-format=docker --location=${REGION}

export IMAGE_TAG="${REGION}-docker.pkg.dev/${GCP_PROJECT}/garmin-sync/garmin-sync:latest"

gcloud builds submit --tag ${IMAGE_TAG}
```

---

## 4. Bootstrap the Garmin OAuth token

Cloud Run can't handle interactive Garmin MFA/password prompts
(`GARMIN_ALLOW_CREDENTIAL_LOGIN=false` in production), so the first token is
created locally, once, and uploaded to the bucket from step 2. Run from the
workspace root with your own GCP user credentials (needs write access to the
bucket -- project Owner/Editor has this by default):

```bash
uv sync
```

```bash
GARMIN_EMAIL="you@example.com" GARMIN_PASSWORD="your_password" \
  uv run python scripts/bootstrap_garmin_tokens.py \
  --bucket ${GCP_PROJECT}-garmin-tokens
```

It prompts for an MFA code interactively if your Garmin account has 2FA enabled.

---

## 5. Create the two Cloud Run Jobs

Copy `docs/ops/cloud-run-job.env.yaml.example` to `cloud-run-job.env.yaml`
(gitignored) and fill in `APP_USER_ID` (your Firebase Auth UID),
`GARMIN_TOKEN_BUCKET` (`${GCP_PROJECT}-garmin-tokens`), and `GCP_PROJECT_ID`.

```bash
gcloud run jobs create garmin-sync \
  --image=${IMAGE_TAG} --region=${REGION} \
  --service-account=${JOB_SA_EMAIL} \
  --env-vars-file=cloud-run-job.env.yaml \
  --args=sync \
  --max-retries=0
```

```bash
gcloud run jobs create garmin-push-pending-workouts \
  --image=${IMAGE_TAG} --region=${REGION} \
  --service-account=${JOB_SA_EMAIL} \
  --env-vars-file=cloud-run-job.env.yaml \
  --args=push-pending-workouts \
  --max-retries=0
```

Grant the scheduler identity permission to run each Job:

```bash
gcloud run jobs add-iam-policy-binding garmin-sync \
  --region=${REGION} --member="serviceAccount:${SCHEDULER_SA_EMAIL}" \
  --role="roles/run.invoker"

gcloud run jobs add-iam-policy-binding garmin-push-pending-workouts \
  --region=${REGION} --member="serviceAccount:${SCHEDULER_SA_EMAIL}" \
  --role="roles/run.invoker"
```

Smoke-test before scheduling anything:

```bash
gcloud run jobs execute garmin-sync --region=${REGION} --wait
```

```bash
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=garmin-sync" \
  --limit=50 --format="value(textPayload)"
```

---

## 6. Create the two Cloud Scheduler jobs

```bash
gcloud scheduler jobs create http garmin-sync-daily \
  --location=${REGION} \
  --schedule="15 6 * * *" \
  --time-zone="Europe/Warsaw" \
  --uri="https://run.googleapis.com/v2/projects/${GCP_PROJECT}/locations/${REGION}/jobs/garmin-sync:run" \
  --http-method=POST \
  --oauth-service-account-email=${SCHEDULER_SA_EMAIL}
```

```bash
gcloud scheduler jobs create http garmin-push-pending-workouts-poll \
  --location=${REGION} \
  --schedule="*/3 * * * *" \
  --time-zone="Europe/Warsaw" \
  --uri="https://run.googleapis.com/v2/projects/${GCP_PROJECT}/locations/${REGION}/jobs/garmin-push-pending-workouts:run" \
  --http-method=POST \
  --oauth-service-account-email=${SCHEDULER_SA_EMAIL}
```

Both fit inside Cloud Scheduler's free tier (3 jobs/project/month); Cloud Run Jobs
bill per second of actual execution, which for this workload is pennies a month.

---

## 7. End-to-end check

1. In the web app, open a workout and click **Sync to Garmin Connect** -- this
   writes `status: 'pending'` to `users/{uid}/garmin_workout_queue/{date}`.
2. Either wait up to 3 minutes for the next poll, or trigger it immediately:
   `gcloud scheduler jobs run garmin-push-pending-workouts-poll --location=${REGION}`.
3. Confirm the queue doc flips to `status: 'synced'` with a `garminWorkoutId`, and
   the workout shows up on your Garmin Connect calendar for that date.

`push_workout`'s status check (see `src/garmin_sync/service.py`) makes repeated
polls -- and any overlap with a manual `push-workout` run -- idempotent: an
already-`synced` item is skipped, never re-uploaded. Queue items older than
`--max-age-days` (default 14, configurable on `push-pending-workouts`) are left
pending rather than pushed, so an abandoned entry doesn't resurface on Garmin
weeks later.
