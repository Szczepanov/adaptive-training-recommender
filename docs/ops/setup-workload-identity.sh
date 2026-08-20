#!/usr/bin/env bash
# One-time GCP setup for keyless GitHub Actions deployment (Workload Identity Federation).
#
# Run this ONCE, from Google Cloud Shell (console.cloud.google.com -> Activate Cloud Shell,
# works fine from a phone/tablet browser -- no local machine required) or any machine with
# `gcloud` already logged in as a project Owner/Editor. It is safe to re-run: every step
# either creates-if-missing or is a no-op update.
#
# Deliberately does ALL infra provisioning here, run once with your own full-privilege
# credentials, rather than in the CI-triggered deploy workflow: the ongoing GitHub Actions
# identity (github-deployer, below) never needs project-IAM-admin, service-account-admin or
# API-enablement power this way, only the bounded per-product roles deploying actually needs
# (Cloud Run, Artifact Registry, Cloud Scheduler). A workflow file compromised or added later
# in this repo therefore cannot use that identity to grant itself broader access -- it can
# deploy Cloud Run Jobs, not touch project IAM.
#
# What this creates:
#   - A Workload Identity Pool + OIDC Provider trusting GitHub Actions tokens, restricted to
#     one exact repository AND its main branch (`assertion.ref == refs/heads/main`) -- a
#     workflow run from any other branch or a fork cannot obtain a token here at all.
#   - The token bucket, the two runtime/scheduler service accounts, the Artifact Registry
#     repository -- everything the GitHub Actions workflows need to already exist.
#   - A "github-deployer" service account, scoped to deployment actions only (Cloud Run,
#     Artifact Registry push, Cloud Scheduler, and impersonating -- only -- garmin-sync-job
#     to attach it to the Jobs it deploys).
#   - A separate "github-frontend-deployer" service account for deploy-frontend.yml, scoped
#     only to Firebase Hosting and Firebase Rules -- kept apart from github-deployer so a
#     compromised/buggy workflow touching one surface (Cloud Run Jobs vs. the web app +
#     Firestore rules) can't reach the other's resources. Both trust the same Workload
#     Identity Pool/Provider above; only which service account a workflow asks to
#     impersonate differs.
#
# After this script finishes, copy its final output into GitHub repo secrets
# (Settings -> Secrets and variables -> Actions) exactly as printed.
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to your GCP/Firebase project id, e.g. export GCP_PROJECT=adaptive-training-recommender}"
: "${GITHUB_REPO:?Set GITHUB_REPO to owner/repo, e.g. export GITHUB_REPO=Szczepanov/adaptive-training-recommender}"
REGION="${REGION:-europe-central2}"

POOL_ID="github-pool"
PROVIDER_ID="github-provider"
DEPLOYER_SA_NAME="github-deployer"
DEPLOYER_SA_EMAIL="${DEPLOYER_SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com"
FRONTEND_DEPLOYER_SA_NAME="github-frontend-deployer"
FRONTEND_DEPLOYER_SA_EMAIL="${FRONTEND_DEPLOYER_SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com"
JOB_SA_EMAIL="garmin-sync-job@${GCP_PROJECT}.iam.gserviceaccount.com"
SCHEDULER_SA_EMAIL="garmin-scheduler-invoker@${GCP_PROJECT}.iam.gserviceaccount.com"
TOKEN_BUCKET="${GCP_PROJECT}-garmin-tokens"

# Process-scoped only -- never mutates a persisted gcloud configuration.
export CLOUDSDK_CORE_PROJECT="${GCP_PROJECT}"

echo "==> Using project: ${GCP_PROJECT}"
echo "==> Restricting trust to repo: ${GITHUB_REPO} (main branch only)"

echo "==> Enabling required APIs"
gcloud services enable \
  iamcredentials.googleapis.com sts.googleapis.com \
  run.googleapis.com cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com storage.googleapis.com \
  firebasehosting.googleapis.com firebaserules.googleapis.com

PROJECT_NUMBER="$(gcloud projects describe "${GCP_PROJECT}" --format='value(projectNumber)')"

echo "==> Creating Workload Identity Pool (skipping if it already exists)"
if ! gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --location=global \
    --display-name="GitHub Actions pool"
fi

echo "==> Creating OIDC Provider restricted to ${GITHUB_REPO}@main (skipping if it already exists)"
if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --location=global \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="GitHub Actions provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main'" \
    --issuer-uri="https://token.actions.githubusercontent.com"
fi

echo "==> Creating runtime service accounts (skipping if they already exist)"
if ! gcloud iam service-accounts describe "${JOB_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create garmin-sync-job \
    --display-name="Garmin sync Cloud Run Job runtime identity"
fi
if ! gcloud iam service-accounts describe "${SCHEDULER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create garmin-scheduler-invoker \
    --display-name="Cloud Scheduler -> Cloud Run Jobs invoker"
fi

echo "==> Granting garmin-sync-job Firestore access"
gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="roles/datastore.user" \
  --condition=None >/dev/null

echo "==> Creating token bucket"
gcloud storage buckets describe "gs://${TOKEN_BUCKET}" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${TOKEN_BUCKET}" \
    --location="${REGION}" --uniform-bucket-level-access

gcloud storage buckets add-iam-policy-binding "gs://${TOKEN_BUCKET}" \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="roles/storage.objectAdmin" >/dev/null

echo "==> Creating Artifact Registry repository"
gcloud artifacts repositories describe garmin-sync --location="${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create garmin-sync \
    --repository-format=docker --location="${REGION}"

echo "==> Creating github-deployer service account (skipping if it already exists)"
if ! gcloud iam service-accounts describe "${DEPLOYER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${DEPLOYER_SA_NAME}" \
    --display-name="GitHub Actions deploy identity (WIF, no key)"
fi

# Deliberately narrow: each role is scoped to the one product deploy-garmin-sync.yml touches
# (Cloud Run, Artifact Registry, Cloud Scheduler) -- none of these grant IAM, service-account
# or API-enablement authority over the project. Firestore access belongs to garmin-sync-job
# (above), never to the deploy identity, which never reads/writes Firestore.
#
# The image build was originally `gcloud builds submit` (Cloud Build, uploading source to an
# auto-managed GCS staging bucket). That repeatedly failed against github-deployer's
# Workload-Identity-Federation-derived credentials with a "forbidden" error, regardless of
# which storage role was granted on the bucket (storage.objectAdmin, then storage.admin --
# both tried live, neither fixed it) -- a gsutil/WIF external_account-credential
# compatibility issue, not an authorization gap. deploy-garmin-sync.yml now builds with plain
# `docker build`/`docker push` instead, which only needs roles/artifactregistry.writer
# (already below) and sidesteps Cloud Build entirely -- no staging bucket, no Cloud Build
# role, no cloudbuild.googleapis.com dependency.
#
# roles/serviceusage.serviceUsageConsumer is NOT roles/serviceusage.serviceUsageAdmin (that
# one grants enabling/disabling APIs and other IAM-adjacent power -- a real
# privilege-escalation surface, deliberately omitted). Consumer only grants
# serviceusage.services.use: permission for this identity's billed API calls to be
# attributed to the project at all. Kept as defensive good practice even though it turned
# out not to be the fix for the Cloud Build issue above.
echo "==> Granting github-deployer deployment-only roles"
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/cloudscheduler.admin \
  roles/serviceusage.serviceUsageConsumer \
; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
    --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None >/dev/null
done

# Resource-level, not project-wide: github-deployer may act as garmin-sync-job specifically
# (required to attach it to a Cloud Run Job it deploys) and nothing else.
echo "==> Allowing github-deployer to act as garmin-sync-job only"
gcloud iam service-accounts add-iam-policy-binding "${JOB_SA_EMAIL}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

# Also resource-level, not project-wide: Cloud Scheduler requires the identity creating (or
# updating the OAuth target of) an HTTP job to be able to actAs the service account named in
# --oauth-service-account-email -- confirmed live: `gcloud scheduler jobs create http ...
# --oauth-service-account-email=garmin-scheduler-invoker@...` failed with
# `PERMISSION_DENIED: ... lacks IAM permission "iam.serviceAccounts.actAs" for the resource
# "garmin-scheduler-invoker@..."` before this binding existed. Distinct from the Cloud Build
# staging-bucket saga above -- this one really was a missing grant, not a WIF quirk.
echo "==> Allowing github-deployer to act as garmin-scheduler-invoker only"
gcloud iam service-accounts add-iam-policy-binding "${SCHEDULER_SA_EMAIL}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

echo "==> Allowing GitHub Actions runs in ${GITHUB_REPO}@main to impersonate github-deployer"
gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"

echo "==> Creating github-frontend-deployer service account (skipping if it already exists)"
if ! gcloud iam service-accounts describe "${FRONTEND_DEPLOYER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${FRONTEND_DEPLOYER_SA_NAME}" \
    --display-name="GitHub Actions frontend/rules deploy identity (WIF, no key)"
fi

# Deliberately just these two: Firebase Hosting releases and Firebase Security Rules
# (Firestore rules) are the only two things deploy-frontend.yml touches. No Cloud Run,
# Artifact Registry, Cloud Scheduler, or Firestore data/index access -- see that workflow's
# own comments and docs/ops/frontend-deployment.md.
echo "==> Granting github-frontend-deployer deployment-only roles"
for ROLE in \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
    --member="serviceAccount:${FRONTEND_DEPLOYER_SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None >/dev/null
done

echo "==> Allowing GitHub Actions runs in ${GITHUB_REPO}@main to impersonate github-frontend-deployer"
gcloud iam service-accounts add-iam-policy-binding "${FRONTEND_DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

cat <<EOF

==============================================================================
Setup complete. Add these as GitHub repo secrets
(Settings -> Secrets and variables -> Actions -> New repository secret):

  GCP_PROJECT_ID                    = ${GCP_PROJECT}
  GCP_WORKLOAD_IDENTITY_PROVIDER    = ${WIF_PROVIDER}
  GCP_DEPLOYER_SA_EMAIL             = ${DEPLOYER_SA_EMAIL}
  GCP_FRONTEND_DEPLOYER_SA_EMAIL    = ${FRONTEND_DEPLOYER_SA_EMAIL}

You'll also need (see docs/ops/cloud-run-deployment.md for what each is for):

  APP_USER_ID       = your Firebase Auth UID
  GARMIN_EMAIL       = your Garmin Connect email
  GARMIN_PASSWORD    = your Garmin Connect password

Optional, for the Garmin Token Bootstrap workflow (recommended if your Garmin
account has 2FA via an authenticator app -- see that workflow's own notes):

  GARMIN_TOTP_SECRET = the base32 shared secret your authenticator app was
                        given when you enrolled it (not a 6-digit code)

For the "Deploy Frontend & Firestore Rules" workflow (see
docs/ops/frontend-deployment.md), also add your production Firebase web app
config -- Project settings -> General -> Your apps in the Firebase console:

  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID
  VITE_FIREBASE_STORAGE_BUCKET
  VITE_FIREBASE_MESSAGING_SENDER_ID
  VITE_FIREBASE_APP_ID
  VITE_FIREBASE_MEASUREMENT_ID (optional -- only if you use Analytics)

Then run the "Deploy Garmin Sync" and/or "Deploy Frontend & Firestore Rules"
workflows from the Actions tab.
==============================================================================
EOF
