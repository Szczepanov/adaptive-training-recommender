# GCP Cloud Run & Cloud Scheduler Deployment Guide

This guide containerizes the Python Garmin ingestion/sync package and schedules two
recurring jobs on Google Cloud Platform (GCP):

* **`garmin-sync`** -- recovery-metrics ingestion (`python -m garmin_sync sync`),
  polled every 15 min through a morning wake window rather than run once at a
  fixed time (see step 6) -- most ticks are a free Firestore freshness check,
  not a Garmin call
* **`garmin-push-pending-workouts`** -- polls the Firestore workout queue every few
  minutes and pushes anything queued by "Sync to Garmin" in the web app
  (`python -m garmin_sync push-pending-workouts`)

Both share one container image and one runtime service account; only their
`--args` differ. Run the sections below in order.

**No local machine?** See [Deploying from GitHub Actions](#deploying-from-github-actions-no-local-machine)
below instead -- it runs this same sequence as two `workflow_dispatch` workflows you trigger
from the GitHub web UI (works from a phone/tablet browser), authenticating to GCP with no
long-lived key. The sections below remain the reference for what each step does and why.

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

`garmin-sync` runs on a **repeating window, not one fixed time** -- wake time
varies (p95 ~5-7am), and a single fixed cron either fires too early or leaves you
checking in against stale data. This is safe to poll often because
`sync_daily()` checks Firestore freshness (`is_fresh`, gated on
`GARMIN_STALENESS_MINUTES`, default 60) *before* ever calling Garmin: most ticks
in the window find today's snapshot still fresh and return after a single cheap
Firestore read, with **zero Garmin API calls**. Only the first tick each day (no
snapshot yet) and the occasional tick once staleness expires actually hit
Garmin -- roughly 4-5 real calls across the whole window, not one per tick. Do
**not** add `--force` here -- it bypasses that exact freshness gate, defeating
the point.

```bash
gcloud scheduler jobs create http garmin-sync-morning-poll \
  --location=${REGION} \
  --schedule="*/15 5-9 * * *" \
  --time-zone="Europe/Warsaw" \
  --uri="https://run.googleapis.com/v2/projects/${GCP_PROJECT}/locations/${REGION}/jobs/garmin-sync:run" \
  --http-method=POST \
  --oauth-service-account-email=${SCHEDULER_SA_EMAIL}
```

The window's first tick each day (5:00am, no snapshot yet for today) always runs
a real fetch, which includes the normal D-1 lookback resync -- so there's no need
for a separate once-daily "thorough" run; this single schedule covers it. Want
data refreshed sooner than the 60-minute default after you actually wake?
Lower `GARMIN_STALENESS_MINUTES` (e.g. to 20-30) in `cloud-run-job.env.yaml` --
that raises the real-call count to maybe 6-8 across the window, still light.

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

---

## Deploying from GitHub Actions (no local machine)

Two `workflow_dispatch` workflows under `.github/workflows/` cover everything above without
needing `gcloud` installed anywhere -- trigger them from **Actions** in the GitHub web UI
(works from a phone/tablet browser). Both authenticate to GCP with **Workload Identity
Federation**: no service-account JSON key is ever stored as a secret, only a provider
resource name and a service-account email GitHub proves it's allowed to impersonate for that
one run.

### Design: infra setup and routine deploys use different identities

`setup-workload-identity.sh` provisions everything (APIs, buckets, service accounts, Artifact
Registry repo) itself, run once with your own full-privilege `gcloud` session. The
`github-deployer` identity that `deploy-garmin-sync.yml` authenticates as afterward only ever
holds deployment-scoped roles -- Cloud Run, Artifact Registry push, Cloud Build, Cloud
Scheduler, and impersonating (only) `garmin-sync-job` to attach it to the Jobs it deploys --
never project-IAM-admin or service-account-admin. A workflow file added or compromised later
in this repo therefore cannot use it to widen its own access; it can deploy Cloud Run Jobs and
nothing else. The Workload Identity Provider itself additionally only accepts tokens from
`main` (`assertion.ref == 'refs/heads/main'`), so a run from any other branch can't
authenticate at all, even before that role scoping matters.

One consequence: the deploy workflow **assumes the infra already exists** -- it never creates
the bucket/service accounts/Artifact Registry repo itself. Re-run
`setup-workload-identity.sh` (idempotent) if you ever need to recreate something, rather than
expecting the deploy workflow to.

### Already deployed manually? Check names line up first

Before your first CI-driven run, confirm your live resources exist under the exact
names/region the workflows assume: `docs/ops/verify-existing-deploy.sh` read-only-checks this
(`GCP_PROJECT=... REGION=europe-central2 bash docs/ops/verify-existing-deploy.sh`, from
wherever you have `gcloud` -- Cloud Shell or local). If a name doesn't match (different
service account name, different bucket, etc.), either rename the live resource to match, or
just run `setup-workload-identity.sh` -- every step in it is create-if-missing/upsert, so it
will not touch or duplicate a resource that's already there under the name it expects; it only
fills in whatever's genuinely absent.

It's still worth knowing before that first CI-driven redeploy: **`gcloud run jobs deploy`
replaces the whole Job spec** with whatever `deploy-garmin-sync.yml` passes -- any env var or
setting your manual deploy added beyond `docs/ops/cloud-run-job.env.yaml.example`'s fields
will be dropped on that first run.

### One-time setup

1. Open **Cloud Shell** at [console.cloud.google.com](https://console.cloud.google.com)
   (top-right terminal icon -- runs entirely in the browser, no local install) and clone this
   repo, or paste the script directly.
2. Run:
   ```bash
   export GCP_PROJECT=adaptive-training-recommender   # your Firebase/GCP project id
   export GITHUB_REPO=OWNER/REPO                       # e.g. Szczepanov/adaptive-training-recommender
   bash docs/ops/setup-workload-identity.sh
   ```
   This creates the Workload Identity Pool + OIDC Provider (restricted to that one repo's
   `main` branch), the token bucket, both runtime service accounts, the Artifact Registry
   repo, and the narrowly-scoped `github-deployer` identity the workflows authenticate as. It
   prints three values at the end.
3. Add those three, plus your Firebase UID and Garmin credentials, as **repo secrets**
   (Settings -> Secrets and variables -> Actions -> New repository secret):

   | Secret | Value |
   |---|---|
   | `GCP_PROJECT_ID` | printed by the script |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | printed by the script |
   | `GCP_DEPLOYER_SA_EMAIL` | printed by the script |
   | `APP_USER_ID` | your Firebase Authentication UID |
   | `GARMIN_EMAIL` | your Garmin Connect email |
   | `GARMIN_PASSWORD` | your Garmin Connect password |
   | `GARMIN_TOTP_SECRET` | optional -- see Bootstrap section below |

### Deploy

Run the **Deploy Garmin Sync** workflow (Actions tab -> select it -> Run workflow). This
builds the container via Cloud Build and redeploys both Cloud Run Jobs against the infra
`setup-workload-identity.sh` already created. Leave `run_smoke_test` off (its default) until
you've confirmed a Garmin token already exists in the bucket
(`docs/ops/verify-existing-deploy.sh` checks this) -- otherwise the smoke test fails for lack
of one, which is expected on a first deploy.

### Bootstrap the Garmin token

Run the **Garmin Token Bootstrap** workflow once, after the deploy above:

* **No 2FA on your Garmin account:** leave everything blank and run it. Done.
* **2FA via an authenticator app:** add a `GARMIN_TOTP_SECRET` repo secret -- the base32
  "manual entry key" your app was given when you first enrolled it, not a 6-digit code (if you
  don't have it anymore, re-enrolling the authenticator on Garmin's side gives you a fresh
  one). The workflow then computes a fresh code live, at the exact moment Garmin's login flow
  actually asks for one, so no manually-entered code can go stale. This is the recommended
  path if it's available to you.
* **No TOTP secret configured:** `mfa_code` is a manual fallback -- generate a code from your
  authenticator app, then *immediately* trigger the workflow with that code as `mfa_code`. The
  workflow is kept short specifically to shrink the gap between code and consumption, but it's
  still a real race against a typically 30-60s window.
* **SMS/email-triggered code:** neither of the above works -- Garmin only sends that code once
  a login attempt starts, and GitHub Actions can't pause a run mid-flight to collect a second
  input. Temporarily disable 2FA on your Garmin account, run this workflow once, then
  re-enable it -- the resulting OAuth token keeps working regardless of your account's current
  2FA setting.

Re-run **Deploy Garmin Sync** afterward with `run_smoke_test` on to confirm `garmin-sync`
actually logs in and pulls data end to end.

### Re-deploying after a code change

Run **Deploy Garmin Sync** again -- it rebuilds the image and redeploys both Jobs
(`gcloud run jobs deploy` upserts) without touching anything already configured.
