# GCP Cloud Run & Cloud Scheduler Deployment Guide

This guide containerizes the Python Garmin ingestion/sync package and deploys a self-service HTTP API and three scheduled jobs on Google Cloud Platform (GCP):

* **`garmin-account-link`** -- self-service HTTP service used by the web app to establish per-user Garmin tokens (`python -m garmin_sync.account_link_api`)
* **`garmin-sync`** -- multi-user recovery-metrics ingestion (`python -m garmin_sync sync-all`),
  polled every 15 min through a morning wake window rather than run once at a
  fixed time (see step 6) -- most ticks are a free Firestore freshness check,
  not a Garmin call
* **`garmin-push-pending-workouts`** -- polls the Firestore workout queue every 15
  minutes and pushes anything queued by "Sync to Garmin" in the web app
  (`python -m garmin_sync push-pending-workouts-all`)
* **`garmin-manual-sync`** -- polls every 15 minutes for a "Sync Now" request queued by the
  web app's clickable Garmin sync badge in the navigation bar (or the inline sync trigger)
  and runs an immediate forced sync if one is pending
  (`python -m garmin_sync poll-manual-sync-all`)

All four share one container image and one runtime service account. Run the sections below in order.

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
keeps Cloud Run stateless -- no local disk between runs). Separate identities are used
for the scheduled Job, public account-link service, and Cloud Scheduler (least privilege --
the scheduler identity never touches Firestore or GCS directly).

```bash
gcloud storage buckets create gs://${GCP_PROJECT}-garmin-tokens \
  --location=${REGION} --uniform-bucket-level-access
```

```bash
gcloud iam service-accounts create garmin-sync-job \
  --display-name="Garmin sync Cloud Run Job runtime identity"
gcloud iam service-accounts create garmin-account-link \
  --display-name="Garmin account-link Cloud Run service identity"
```

```bash
export JOB_SA_EMAIL="garmin-sync-job@${GCP_PROJECT}.iam.gserviceaccount.com"
export LINK_SA_EMAIL="garmin-account-link@${GCP_PROJECT}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding ${GCP_PROJECT} \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="roles/datastore.user"

gcloud storage buckets add-iam-policy-binding gs://${GCP_PROJECT}-garmin-tokens \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="roles/storage.objectAdmin"
gcloud projects add-iam-policy-binding ${GCP_PROJECT} \
  --member="serviceAccount:${LINK_SA_EMAIL}" --role="roles/datastore.user"
gcloud storage buckets add-iam-policy-binding gs://${GCP_PROJECT}-garmin-tokens \
  --member="serviceAccount:${LINK_SA_EMAIL}" --role="roles/storage.objectAdmin"
```

The public Garmin account-link endpoint uses Firestore transactions for login
admission and also creates/rolls back Firebase Auth users and mints custom sign-in tokens.
Its dedicated runtime identity therefore needs the narrow Firebase Auth user role and
permission to sign as itself in addition to Firestore and token-bucket access. The
idempotent `setup-workload-identity.sh` script creates/updates the custom role and grants
these bindings. For a manual setup, mirror its least-privilege grants:

```bash
export AUTH_USER_ROLE_ID="garminLinkAuthUsers"
export AUTH_USER_ROLE="projects/${GCP_PROJECT}/roles/${AUTH_USER_ROLE_ID}"

if gcloud iam roles describe "${AUTH_USER_ROLE_ID}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  gcloud iam roles update "${AUTH_USER_ROLE_ID}" --project="${GCP_PROJECT}" \
    --title="Garmin Link Auth Users" \
    --description="Create/delete/get Firebase Auth users for Garmin self-service linking" \
    --permissions="firebaseauth.users.create,firebaseauth.users.delete,firebaseauth.users.get" \
    --stage="GA"
else
  gcloud iam roles create "${AUTH_USER_ROLE_ID}" --project="${GCP_PROJECT}" \
    --title="Garmin Link Auth Users" \
    --description="Create/delete/get Firebase Auth users for Garmin self-service linking" \
    --permissions="firebaseauth.users.create,firebaseauth.users.delete,firebaseauth.users.get" \
    --stage="GA"
fi

gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
  --member="serviceAccount:${LINK_SA_EMAIL}" --role="${AUTH_USER_ROLE}"
gcloud iam service-accounts add-iam-policy-binding "${LINK_SA_EMAIL}" \
  --member="serviceAccount:${LINK_SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Provision the HMAC key in Secret Manager once, and grant secret access only to the
account-link identity (never to the scheduled Job identity):

```bash
gcloud secrets create garmin-link-rate-limit-hmac --replication-policy=automatic
openssl rand -base64 48 | gcloud secrets versions add garmin-link-rate-limit-hmac --data-file=-
gcloud secrets add-iam-policy-binding garmin-link-rate-limit-hmac \
  --member="serviceAccount:${LINK_SA_EMAIL}" --role="roles/secretmanager.secretAccessor"
```

Keep this key server-only and stable across deployments. Rotating it changes every HMAC
bucket identifier, effectively resetting all active attempt windows and cooldowns; plan
rotation during a controlled maintenance window. Firestore holds only HMAC bucket IDs,
attempt times, cooldown deadlines, and distinct-account 429 evidence. It holds no Garmin
email, IP, UID, credential, MFA code, token, or provider response. One account's 429
starts a 30-minute cooldown for that account; the provider breaker opens only after
three distinct accounts return 429 within 10 minutes. Configure a Firestore
TTL policy for `garminLoginRateLimits.expireAt` to remove expired throttle documents
([Google Cloud TTL command reference](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/fields/ttls/update)):

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=garminLoginRateLimits --enable-ttl
```

The account-link service fails startup if its Firestore mode or key is missing in Cloud
Run, so this secret and IAM binding are prerequisites for deployment.

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

## 5. Create the Cloud Run services and jobs

Copy `docs/ops/cloud-run-job.env.yaml.example` to `cloud-run-job.env.yaml`
(gitignored) and fill in `GARMIN_TOKEN_BUCKET` (`${GCP_PROJECT}-garmin-tokens`) and `GCP_PROJECT_ID`.
For a newly linked account, `GARMIN_INITIAL_RECENT_DAYS=7` limits the first pass to a
recent slice (allowed 1–14 days). `GARMIN_BACKFILL_CHUNK_DAYS=7` bounds each historical
continuation (allowed 1–14 days), and `GARMIN_BACKFILL_RETRY_SECONDS=1800` delays the
next attempt after a provider throttle (minimum 60 seconds). Add these values to the env
file when deploying manually; the GitHub workflow supplies them. Existing
`GARMIN_BACKFILL_DELAY_MIN` / `GARMIN_BACKFILL_DELAY_MAX` settings pace each Garmin API
call during backfill.
Create an account-link-only copy so the scheduled Jobs do not receive the login limiter
configuration:

```bash
cp cloud-run-job.env.yaml cloud-run-garmin-link.env.yaml
printf 'GARMIN_RATE_LIMIT_STORE: "firestore"\n' >> cloud-run-garmin-link.env.yaml
```

```bash
# Garmin's interactive MFA continuation requires the same in-memory client/session.
# max-instances=1 intentionally preserves that invariant without persisting a password
# or SSO session. If the instance restarts, the short-lived challenge simply expires
# and the user restarts login.
gcloud run deploy garmin-account-link \
  --image=${IMAGE_TAG} --region=${REGION} \
  --service-account=${LINK_SA_EMAIL} \
  --env-vars-file=cloud-run-garmin-link.env.yaml \
  --set-secrets=GARMIN_RATE_LIMIT_HMAC_KEY=garmin-link-rate-limit-hmac:latest \
  --command=python --args=-m,garmin_sync.account_link_api \
  --port=8080 --timeout=300 --concurrency=10 \
  --min-instances=0 --max-instances=1 \
  --allow-unauthenticated
```

```bash
gcloud run jobs create garmin-sync \
  --image=${IMAGE_TAG} --region=${REGION} \
  --service-account=${JOB_SA_EMAIL} \
  --env-vars-file=cloud-run-job.env.yaml \
  --args=sync-all \
  --max-retries=0
```

```bash
gcloud run jobs create garmin-push-pending-workouts \
  --image=${IMAGE_TAG} --region=${REGION} \
  --service-account=${JOB_SA_EMAIL} \
  --env-vars-file=cloud-run-job.env.yaml \
  --args=push-pending-workouts-all \
  --max-retries=0
```

```bash
gcloud run jobs create garmin-manual-sync \
  --image=${IMAGE_TAG} --region=${REGION} \
  --service-account=${JOB_SA_EMAIL} \
  --env-vars-file=cloud-run-job.env.yaml \
  --args=poll-manual-sync-all \
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

gcloud run jobs add-iam-policy-binding garmin-manual-sync \
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

## 6. Create the three Cloud Scheduler jobs

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

### Canonical recovery scheduler and duplicate remediation

`garmin-sync-morning-poll` is the sole repository-owned scheduler for the
`garmin-sync` Cloud Run Job. Its contract is:

| Field | Required value |
| --- | --- |
| Scheduler name | `garmin-sync-morning-poll` |
| Schedule | `*/15 5-9 * * *` |
| Time zone | `Europe/Warsaw` |
| Target | `projects/${GCP_PROJECT}/locations/${REGION}/jobs/garmin-sync:run` |
| Invoker | `${SCHEDULER_SA_EMAIL}` |
| Cloud Run Job command | `sync-all`, with no `--force` |

The `Create/update Cloud Scheduler jobs` step in
`.github/workflows/deploy-garmin-sync.yml` reconciles this named job, but it intentionally
does not enumerate or delete Scheduler resources that are absent from the workflow. A legacy
job such as `garmin-sync-daily` therefore cannot be removed by merging or rerunning a
repository deployment; it needs a separately authorized Cloud Console or `gcloud` action.

Before changing a suspected duplicate, run the read-only repository check. It lists every
Scheduler job and fails unless exactly one complete URI targets `garmin-sync:run`; a historical
name alone cannot prove uniqueness.

```bash
GCP_PROJECT=${GCP_PROJECT} REGION=${REGION} \
  bash docs/ops/verify-existing-deploy.sh
```

Then inspect the canonical job with production credentials. Record only the safe summary
fields below with operational evidence; the repository does not prescribe a Scheduler retry
policy, so do not silently change a live one while removing a duplicate.

```bash
gcloud scheduler jobs describe garmin-sync-morning-poll --location=${REGION} \
  --format="yaml(name,state,schedule,timeZone,httpTarget.httpMethod,httpTarget.uri,httpTarget.oauthToken.serviceAccountEmail,httpTarget.oauthToken.scope,retryConfig,lastAttemptTime)"

gcloud run jobs executions list --region=${REGION} --job=garmin-sync --limit=20 \
  --format="table(metadata.name,metadata.creationTimestamp,status.completionTime,status.conditions[0].type,status.conditions[0].status,status.conditions[0].message)"
```

The `httpTarget` must use `POST` and the exact URI in the table above. Its OAuth service account
must be `${SCHEDULER_SA_EMAIL}`. The OAuth scope may be omitted in the stored job when `gcloud`
uses its default; omitted means `https://www.googleapis.com/auth/cloud-platform`. If a scope is
explicitly stored, it must be that value. The expected request has no message body and no
custom credential header. Inspect `httpTarget.headers` and `httpTarget.body` only in a protected
operator terminal: header values or a body may be sensitive, so never paste them into a ticket,
workflow log, commit, or operational evidence. Treat a non-empty body or an unexpected static
`Authorization`/credential header as configuration drift and stop for review.

```bash
# Sensitive local inspection only; do not redirect, upload, or retain this output.
gcloud scheduler jobs describe garmin-sync-morning-poll --location=${REGION} \
  --format="yaml(httpTarget.headers,httpTarget.body)"
```

To attribute a RunJob request, use a read-only Cloud Audit Logs query that includes both the
RunJob method and `authenticationInfo.principalEmail`:

```bash
gcloud logging read \
  'protoPayload.serviceName="run.googleapis.com" AND protoPayload.methodName="/Jobs.RunJob" AND protoPayload.resourceName:"garmin-sync"' \
  --project=${GCP_PROJECT} --limit=20 \
  --format="table(timestamp,protoPayload.methodName,protoPayload.authenticationInfo.principalEmail,protoPayload.resourceName)"
```

Some Cloud Run `system_event` records omit `authenticationInfo.principalEmail`. An empty value
is not evidence of Scheduler authentication; record the limitation rather than attributing the
execution to the Scheduler invoker. This query does not expose `httpTarget` headers or body.

If the full-URI check finds more than one target, pause only the confirmed duplicate first.
Keep the canonical scheduler enabled, preserve its Warsaw schedule, and do not add `--force` to
either the scheduler request or the Cloud Run Job.

```bash
gcloud scheduler jobs pause garmin-sync-daily --location=${REGION}
```

No post-cleanup snapshot-coverage window is complete until its audit is recorded. After a
duplicate is absent or paused, the owner must run the user-scoped audit over a fresh monitored
window and retain its result before declaring this cleanup verified or making a permanent
deletion decision:

```bash
uv run python -m garmin_sync audit --days 7
```

This audit is read-only with respect to recovery snapshots; it must use the intended user's
production configuration and does not justify `--force`. The immediate rollback for a paused
duplicate is reversible:

```bash
gcloud scheduler jobs resume garmin-sync-daily --location=${REGION}
```

Delete a paused duplicate only through a separately approved operator change after capturing
its configuration and the monitored audit evidence. Do not add a broad deletion step to the
deployment workflow: it would turn an external-infrastructure cleanup into an unreviewed
release-side effect.

The window's first tick each day (5:00am, no snapshot yet for today) always runs
a real fetch, which includes the normal D-1 lookback resync -- so there's no need
for a separate once-daily "thorough" run; this single schedule covers it. Want
data refreshed sooner than the 60-minute default after you actually wake?
Lower `GARMIN_STALENESS_MINUTES` (e.g. to 20-30) in `cloud-run-job.env.yaml` --
that raises the real-call count to maybe 6-8 across the window, still light.

```bash
gcloud scheduler jobs create http garmin-push-pending-workouts-poll \
  --location=${REGION} \
  --schedule="10,25,40,55 * * * *" \
  --time-zone="Europe/Warsaw" \
  --uri="https://run.googleapis.com/v2/projects/${GCP_PROJECT}/locations/${REGION}/jobs/garmin-push-pending-workouts:run" \
  --http-method=POST \
  --oauth-service-account-email=${SCHEDULER_SA_EMAIL}
```

`garmin-manual-sync` polls all day (not just the 5-9am window) at a 15-minute
cadence, staggered 5 minutes apart from the workout-queue poll (at minutes `:05`, `:20`, `:35`, `:50`),
so clicking **Sync Now** in the web app -- e.g. because you're up before the morning window, or
just want the latest numbers mid-afternoon -- reaches Garmin within 15 minutes instead of waiting
for the next `garmin-sync-morning-poll` tick. Same cheap-Firestore-read-first shape: most ticks find
no pending request and never call Garmin.

The 5-minute offset between `garmin-sync-morning-poll` (`:00`, `:15`, `:30`, `:45`),
`garmin-manual-sync-poll` (`:05`, `:20`, `:35`, `:50`), and `garmin-push-pending-workouts-poll`
(`:10`, `:25`, `:40`, `:55`) ensures that concurrent runs never contend for the shared per-user
Firestore `GarminExecutionLease`.

```bash
gcloud scheduler jobs create http garmin-manual-sync-poll \
  --location=${REGION} \
  --schedule="5,20,35,50 * * * *" \
  --time-zone="Europe/Warsaw" \
  --uri="https://run.googleapis.com/v2/projects/${GCP_PROJECT}/locations/${REGION}/jobs/garmin-manual-sync:run" \
  --http-method=POST \
  --oauth-service-account-email=${SCHEDULER_SA_EMAIL}
```

Cloud Scheduler's free tier is 3 jobs **per billing account**, not per project --
these three exactly use it up, so a billing account already running other Scheduler
jobs elsewhere (a different project, an unrelated app) will incur Scheduler's
per-job charge on top. Cloud Run Jobs bill each execution for at least one minute,
so the 15-minute cadence bounds recurring job spend while keeping user-triggered
work responsive enough for this asynchronous workflow.

---

## 7. End-to-end check

1. In the web app, open a workout and click **Sync to Garmin Connect** -- this
   writes `status: 'pending'` to `users/{uid}/garmin_workout_queue/{date}`.
2. Either wait up to 15 minutes for the next poll, or trigger it immediately:
   `gcloud scheduler jobs run garmin-push-pending-workouts-poll --location=${REGION}`.
3. Confirm the queue doc flips to `status: 'synced'` with a `garminWorkoutId`, and
   the workout shows up on your Garmin Connect calendar for that date.

`push_workout`'s status check (see `src/garmin_sync/service.py`) makes repeated
polls -- and any overlap with a manual `push-workout` run -- idempotent: an
already-`synced` item is skipped, never re-uploaded. Queue items older than
`--max-age-days` (default 14, configurable on `push-pending-workouts`) are left
pending rather than pushed, so an abandoned entry doesn't resurface on Garmin
weeks later.

4. On the Home screen, click **🔄 Sync now** in the "Today's Recovery" card -- this
   writes `status: 'pending'` to `users/{uid}/garmin_sync_requests/latest`.
5. Either wait up to 15 minutes for the next poll, or trigger it immediately:
   `gcloud scheduler jobs run garmin-manual-sync-poll --location=${REGION}`.
6. Confirm the request doc flips to `status: 'completed'` and today's recovery
   snapshot refreshes in the app.

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
holds deployment-scoped roles -- Cloud Run, Artifact Registry push, Cloud Scheduler, and
`roles/iam.serviceAccountUser` on the bounded runtime identities it must attach to deployed
services/jobs (`garmin-sync-job`, `garmin-account-link`, the anthropometry writer, and the
scheduler invoker) -- never project-IAM-admin or service-account-admin. A workflow file added or compromised later
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
   `main` branch), the token bucket, the Garmin sync, Garmin account-link, scheduler, and dedicated
   anthropometry runtime service accounts, the Garmin login-throttle HMAC secret/TTL policy,
   the Artifact Registry
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
   | `GOOGLE_HEALTH_CLIENT_ID` / `GOOGLE_HEALTH_CLIENT_SECRET` | optional -- deploys `google-health-account-link` only when both are set |
   | `EIGHT_SLEEP_EMAIL` / `EIGHT_SLEEP_PASSWORD` / `EIGHT_SLEEP_CLIENT_ID` / `EIGHT_SLEEP_CLIENT_SECRET` | optional -- deploys `eight-sleep-direct-sync` plus its daily Scheduler job only when all four (and the `APP_USER_ID` above) are set (see below) |

### Deploy

Run the **Deploy Garmin Sync** workflow (Actions tab -> select it -> Run workflow). This
builds the container with plain `docker build`/`docker push` against Artifact Registry (not
Cloud Build -- see the workflow's own comments for why), redeploys `anthropometry-write-api`, and
redeploys all three Cloud Run Jobs against the infra `setup-workload-identity.sh` already created.
Leave `run_smoke_test` off (its default) until
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

Run **Deploy Garmin Sync** again -- it rebuilds the image, redeploys the anthropometry write API,
and redeploys all three Jobs (`gcloud run jobs deploy` upserts) without touching anything already
configured.

### Optional: `eight-sleep-direct-sync` (ES9, daily-scheduled)

If (and only if) `EIGHT_SLEEP_EMAIL`, `EIGHT_SLEEP_PASSWORD`, `EIGHT_SLEEP_CLIENT_ID`,
`EIGHT_SLEEP_CLIENT_SECRET`, and `APP_USER_ID` are all set as repo secrets, **Deploy Garmin
Sync** also deploys a fourth Job, `eight-sleep-direct-sync`, plus a fourth Cloud Scheduler
job, `eight-sleep-direct-sync-daily` (`0 8 * * *` Europe/Warsaw -- once a day, not a polling
window: there's no cheap Firestore freshness pre-check here the way `sync_daily` has, so
every tick is a real Eight Sleep API call).

`APP_USER_ID` is required for this one Job specifically -- unlike the three multi-tenant
Garmin Jobs above (which discover linked users from Firestore at runtime and deliberately
carry no static user ID), Eight Sleep direct authenticates as exactly one fixed account (no
self-service linking flow exists for it), so its observations need exactly one fixed user to
persist under.

The Job's baked-in default is `backfill-eight-sleep-direct --days=7` -- a small trailing
window sized for a **daily** run (catches late corrections within the past week without
repeating a full historical fetch every tick; each tick is roughly 7 Eight Sleep API calls,
not one). This still only ever writes to the shadow `health_observation_days` collection --
`EIGHT_SLEEP_DIRECT_ENABLED` stays production-inert; nothing here changes recommendation
behavior.

For a one-off larger backfill (e.g. bootstrapping history the first time, or before running
the comparator) or to run the comparator itself, override `--args` at execution time --
matching ranges so the comparison covers what was actually backfilled:

```bash
# One-time: backfill 60 trailing days to match compare-eight-sleep-transports's own 60-day
# default below, rather than waiting ~60 daily 7-day ticks to reach the same coverage
gcloud run jobs execute eight-sleep-direct-sync --region=${REGION} \
  --args=backfill-eight-sleep-direct,--days=60 --wait

# Compare against the pre-existing Google Health Eight Sleep path over the same range
gcloud run jobs execute eight-sleep-direct-sync --region=${REGION} \
  --args=compare-eight-sleep-transports,--days=60 --wait
```

`gcloud run jobs logs read eight-sleep-direct-sync --region=${REGION}` shows each run's
output (daily-scheduled or manual). Cloud Scheduler's free tier is 3 jobs per billing account
(see the note in step 6 above) -- this fourth scheduled job means a billing account without
spare free-tier headroom incurs Scheduler's per-job charge on top of the three Garmin ones.
