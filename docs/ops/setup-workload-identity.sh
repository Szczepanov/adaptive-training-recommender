#!/usr/bin/env bash
# One-time GCP setup for keyless GitHub Actions deployment (Workload Identity Federation).
#
# Run this ONCE, from Google Cloud Shell (console.cloud.google.com -> Activate Cloud Shell,
# works fine from a phone/tablet browser -- no local machine required) or any machine with
# `gcloud` already logged in as a project Owner/Editor. It is safe to re-run: every step
# either creates-if-missing or is a no-op update.
#
# What this creates:
#   - A Workload Identity Pool + OIDC Provider trusting GitHub Actions tokens, restricted to
#     one exact repository (never a whole GitHub org/user) -- so only workflows running in
#     that repo can ever impersonate the deployer service account below.
#   - A "github-deployer" service account with the (broad-ish, single-athlete-project-scoped)
#     roles the deploy workflow needs: enabling APIs, creating the token bucket and the two
#     runtime/scheduler service accounts, building/pushing the container image, and creating
#     the Cloud Run Jobs + Cloud Scheduler jobs.
#   - The IAM binding letting GitHub Actions runs in that one repo impersonate github-deployer
#     with no long-lived key ever leaving GCP.
#
# After this script finishes, copy its final output into GitHub repo secrets
# (Settings -> Secrets and variables -> Actions) exactly as printed.
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to your GCP/Firebase project id, e.g. export GCP_PROJECT=adaptive-training-recommender}"
: "${GITHUB_REPO:?Set GITHUB_REPO to owner/repo, e.g. export GITHUB_REPO=Szczepanov/adaptive-training-recommender}"

POOL_ID="github-pool"
PROVIDER_ID="github-provider"
DEPLOYER_SA_NAME="github-deployer"
DEPLOYER_SA_EMAIL="${DEPLOYER_SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com"

echo "==> Using project: ${GCP_PROJECT}"
echo "==> Restricting trust to repo: ${GITHUB_REPO}"
gcloud config set project "${GCP_PROJECT}" >/dev/null

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

echo "==> Creating OIDC Provider restricted to ${GITHUB_REPO} (skipping if it already exists)"
if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --location=global \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="GitHub Actions provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}'" \
    --issuer-uri="https://token.actions.githubusercontent.com"
fi

echo "==> Creating github-deployer service account (skipping if it already exists)"
if ! gcloud iam service-accounts describe "${DEPLOYER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${DEPLOYER_SA_NAME}" \
    --display-name="GitHub Actions deploy identity (WIF, no key)"
fi

# Single-athlete personal project: these roles are broader than a multi-tenant deployment
# would want (project-level IAM/service-account admin so the workflow can create the
# job/scheduler service accounts and their bindings itself), but each is still named rather
# than roles/owner or roles/editor.
echo "==> Granting github-deployer the roles the deploy workflow needs"
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.admin \
  roles/cloudbuild.builds.editor \
  roles/cloudscheduler.admin \
  roles/storage.admin \
  roles/iam.serviceAccountAdmin \
  roles/iam.serviceAccountUser \
  roles/resourcemanager.projectIamAdmin \
  roles/serviceusage.serviceUsageAdmin \
  roles/datastore.user \
; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
    --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None >/dev/null
done

echo "==> Allowing GitHub Actions runs in ${GITHUB_REPO} to impersonate github-deployer"
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

Then run the "Deploy Garmin Sync" workflow from the Actions tab.
==============================================================================
EOF
