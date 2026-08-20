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
# (Cloud Run, Artifact Registry, Cloud Build, Cloud Scheduler). A workflow file compromised
# or added later in this repo therefore cannot use that identity to grant itself broader
# access -- it can deploy Cloud Run Jobs, not touch project IAM.
#
# What this creates:
#   - A Workload Identity Pool + OIDC Provider trusting GitHub Actions tokens, restricted to
#     one exact repository AND its main branch (`assertion.ref == refs/heads/main`) -- a
#     workflow run from any other branch or a fork cannot obtain a token here at all.
#   - The token bucket, Cloud Build's source-staging bucket, the two runtime/scheduler
#     service accounts, the Artifact Registry repository -- everything the two GitHub
#     Actions workflows need to already exist.
#   - A "github-deployer" service account, scoped to deployment actions only (Cloud Run,
#     Artifact Registry push, Cloud Build, Cloud Scheduler, and impersonating -- only --
#     garmin-sync-job to attach it to the Jobs it deploys).
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
  artifactregistry.googleapis.com cloudbuild.googleapis.com \
  firestore.googleapis.com storage.googleapis.com

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

# `gcloud builds submit` (deploy-garmin-sync.yml's image build step) uploads the checked-out
# source as a tarball to this bucket before Cloud Build reads it -- the exact name/naming
# scheme `gcloud builds submit` uses itself when no --gcs-source-staging-dir is given. Ensuring
# it exists here (its IAM binding for github-deployer follows once that SA exists, below)
# means the deploy workflow never needs any storage role of its own: everything it touches is
# prepared once, in this one-time setup.
CLOUDBUILD_STAGING_BUCKET="${GCP_PROJECT}_cloudbuild"
echo "==> Ensuring the Cloud Build source-staging bucket exists"
gcloud storage buckets describe "gs://${CLOUDBUILD_STAGING_BUCKET}" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${CLOUDBUILD_STAGING_BUCKET}" --location="${REGION}"

echo "==> Creating github-deployer service account (skipping if it already exists)"
if ! gcloud iam service-accounts describe "${DEPLOYER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${DEPLOYER_SA_NAME}" \
    --display-name="GitHub Actions deploy identity (WIF, no key)"
fi

# Deliberately narrow: each role is scoped to the one product deploy-garmin-sync.yml touches
# (Cloud Run, Artifact Registry, Cloud Build, Cloud Scheduler) -- none of these grant IAM,
# service-account or API-enablement authority over the project. Firestore access belongs to
# garmin-sync-job (above), never to the deploy identity, which never reads/writes Firestore.
echo "==> Granting github-deployer deployment-only roles"
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/cloudbuild.builds.editor \
  roles/cloudscheduler.admin \
; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
    --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None >/dev/null
done

# Resource-level, not project-wide: the only storage access github-deployer ever gets is
# write access to Cloud Build's own source-staging bucket, created above.
echo "==> Allowing github-deployer to upload build source"
gcloud storage buckets add-iam-policy-binding "gs://${CLOUDBUILD_STAGING_BUCKET}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" --role="roles/storage.objectAdmin" >/dev/null

# Resource-level, not project-wide: github-deployer may act as garmin-sync-job specifically
# (required to attach it to a Cloud Run Job it deploys) and nothing else.
echo "==> Allowing github-deployer to act as garmin-sync-job only"
gcloud iam service-accounts add-iam-policy-binding "${JOB_SA_EMAIL}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

echo "==> Allowing GitHub Actions runs in ${GITHUB_REPO}@main to impersonate github-deployer"
gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

cat <<EOF

==============================================================================
Setup complete. Add these as GitHub repo secrets
(Settings -> Secrets and variables -> Actions -> New repository secret):

  GCP_PROJECT_ID                  = ${GCP_PROJECT}
  GCP_WORKLOAD_IDENTITY_PROVIDER  = ${WIF_PROVIDER}
  GCP_DEPLOYER_SA_EMAIL           = ${DEPLOYER_SA_EMAIL}

You'll also need (see docs/ops/cloud-run-deployment.md for what each is for):

  APP_USER_ID       = your Firebase Auth UID
  GARMIN_EMAIL       = your Garmin Connect email
  GARMIN_PASSWORD    = your Garmin Connect password

Optional, for the Garmin Token Bootstrap workflow (recommended if your Garmin
account has 2FA via an authenticator app -- see that workflow's own notes):

  GARMIN_TOTP_SECRET = the base32 shared secret your authenticator app was
                        given when you enrolled it (not a 6-digit code)

Then run the "Deploy Garmin Sync" workflow from the Actions tab.
==============================================================================
EOF
