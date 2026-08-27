#!/usr/bin/env bash
# One-time GCP setup for keyless GitHub Actions deployment.
#
# Run from Google Cloud Shell (or another gcloud session with project IAM/custom-role admin
# rights). Safe to re-run. Ongoing GitHub Actions/runtime identities stay deliberately
# narrower than the human/operator identity used here.
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to your GCP/Firebase project id}"
: "${GITHUB_REPO:?Set GITHUB_REPO to owner/repo}"
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
AUTH_USER_ROLE_ID="garminLinkAuthUsers"
AUTH_USER_ROLE="projects/${GCP_PROJECT}/roles/${AUTH_USER_ROLE_ID}"

export CLOUDSDK_CORE_PROJECT="${GCP_PROJECT}"

echo "==> Enabling required APIs"
gcloud services enable \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  run.googleapis.com cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com storage.googleapis.com \
  firebasehosting.googleapis.com firebaserules.googleapis.com identitytoolkit.googleapis.com

PROJECT_NUMBER="$(gcloud projects describe "${GCP_PROJECT}" --format='value(projectNumber)')"

echo "==> Creating Workload Identity Pool"
if ! gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --location=global --display-name="GitHub Actions pool"
fi

EXPECTED_CONDITION="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main'"
echo "==> Creating/verifying OIDC Provider for ${GITHUB_REPO}@main"
if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --location=global \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="GitHub Actions provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="${EXPECTED_CONDITION}" \
    --issuer-uri="https://token.actions.githubusercontent.com"
else
  ACTUAL_CONDITION="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" \
    --format='value(attributeCondition)')"
  if [ "${ACTUAL_CONDITION}" != "${EXPECTED_CONDITION}" ]; then
    echo "ERROR: existing provider condition differs from the expected repo@main restriction." >&2
    exit 1
  fi
fi

echo "==> Creating runtime service accounts"
if ! gcloud iam service-accounts describe "${JOB_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create garmin-sync-job \
    --display-name="Garmin sync/link Cloud Run runtime identity"
fi
if ! gcloud iam service-accounts describe "${SCHEDULER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create garmin-scheduler-invoker \
    --display-name="Cloud Scheduler -> Cloud Run Jobs invoker"
fi

# The same bounded runtime identity serves the account-link service and scheduled jobs.
# Firestore stores server-only link metadata plus normal user-scoped training data.
echo "==> Granting runtime Firestore access"
gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="roles/datastore.user" \
  --condition=None >/dev/null

# Self-service Garmin onboarding creates an internal Firebase Auth user only for a genuinely
# new Garmin identity. Keep this narrower than roles/firebaseauth.admin: the runtime may
# create/delete/get Auth users but cannot edit Firebase Auth configuration or other users.
echo "==> Creating/updating least-privilege Firebase Auth user role"
if gcloud iam roles describe "${AUTH_USER_ROLE_ID}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  gcloud iam roles update "${AUTH_USER_ROLE_ID}" \
    --project="${GCP_PROJECT}" \
    --title="Garmin Link Auth User Manager" \
    --description="Create/delete/get Firebase Auth users for Garmin self-service linking" \
    --permissions="firebaseauth.users.create,firebaseauth.users.delete,firebaseauth.users.get" \
    --stage="GA" --quiet >/dev/null
else
  gcloud iam roles create "${AUTH_USER_ROLE_ID}" \
    --project="${GCP_PROJECT}" \
    --title="Garmin Link Auth User Manager" \
    --description="Create/delete/get Firebase Auth users for Garmin self-service linking" \
    --permissions="firebaseauth.users.create,firebaseauth.users.delete,firebaseauth.users.get" \
    --stage="GA" --quiet >/dev/null
fi

gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="${AUTH_USER_ROLE}" \
  --condition=None >/dev/null

# Firebase Admin custom tokens are signed through IAM when running with ADC on Cloud Run.
# Grant the runtime identity signBlob on itself only; this does not let it impersonate other SAs.
echo "==> Allowing runtime identity to sign Firebase custom tokens"
gcloud iam service-accounts add-iam-policy-binding "${JOB_SA_EMAIL}" \
  --member="serviceAccount:${JOB_SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator" >/dev/null

echo "==> Creating token bucket and granting runtime-only token access"
gcloud storage buckets describe "gs://${TOKEN_BUCKET}" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${TOKEN_BUCKET}" \
    --location="${REGION}" --uniform-bucket-level-access

gcloud storage buckets add-iam-policy-binding "gs://${TOKEN_BUCKET}" \
  --member="serviceAccount:${JOB_SA_EMAIL}" --role="roles/storage.objectAdmin" >/dev/null

echo "==> Creating Artifact Registry repository"
gcloud artifacts repositories describe garmin-sync --location="${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create garmin-sync \
    --repository-format=docker --location="${REGION}"

echo "==> Creating github-deployer"
if ! gcloud iam service-accounts describe "${DEPLOYER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${DEPLOYER_SA_NAME}" \
    --display-name="GitHub Actions deploy identity (WIF, no key)"
fi

for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/cloudscheduler.admin \
  roles/serviceusage.serviceUsageConsumer \
; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
    --member="serviceAccount:${DEPLOYER_SA_EMAIL}" --role="${ROLE}" \
    --condition=None >/dev/null
done

gcloud iam service-accounts add-iam-policy-binding "${JOB_SA_EMAIL}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

gcloud iam service-accounts add-iam-policy-binding "${SCHEDULER_SA_EMAIL}" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"

echo "==> Creating github-frontend-deployer"
if ! gcloud iam service-accounts describe "${FRONTEND_DEPLOYER_SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${FRONTEND_DEPLOYER_SA_NAME}" \
    --display-name="GitHub Actions frontend/rules/index deploy identity (WIF, no key)"
fi

# datastore.indexAdmin is the predefined least-privilege role for creating, updating,
# listing and deleting Firestore indexes. The index workflow itself deliberately omits
# --force, so it never opts into destructive removal of remote-only indexes automatically.
for ROLE in \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/serviceusage.serviceUsageConsumer \
; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
    --member="serviceAccount:${FRONTEND_DEPLOYER_SA_EMAIL}" --role="${ROLE}" \
    --condition=None >/dev/null
done

# app/firebase.json rewrites /api/garmin/** to the garmin-account-link Cloud Run service, and
# (as of the Google Health account-linking feature) /api/google-health/** to
# google-health-account-link. Finalizing a Hosting version that references either calls
# run.services.get on it, so github-frontend-deployer needs read access there -- but only
# there. Bind roles/run.viewer per-service (not at project level) so this identity still can't
# see or touch any other Cloud Run service, preserving the isolation from github-deployer
# described above.
for SERVICE in garmin-account-link google-health-account-link; do
  if gcloud run services describe "${SERVICE}" --region="${REGION}" >/dev/null 2>&1; then
    gcloud run services add-iam-policy-binding "${SERVICE}" \
      --region="${REGION}" \
      --member="serviceAccount:${FRONTEND_DEPLOYER_SA_EMAIL}" \
      --role="roles/run.viewer" >/dev/null
  else
    echo "NOTE: ${SERVICE} Cloud Run service not found in ${REGION} yet -- run" >&2
    echo "      'Deploy Garmin Sync' first, then rerun this script to grant" >&2
    echo "      github-frontend-deployer read access to it (required for Hosting deploys)." >&2
  fi
done

gcloud iam service-accounts add-iam-policy-binding "${FRONTEND_DEPLOYER_SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

cat <<EOF

==============================================================================
Setup complete. Add these GitHub repository secrets:

  GCP_PROJECT_ID                    = ${GCP_PROJECT}
  GCP_WORKLOAD_IDENTITY_PROVIDER    = ${WIF_PROVIDER}
  GCP_DEPLOYER_SA_EMAIL             = ${DEPLOYER_SA_EMAIL}
  GCP_FRONTEND_DEPLOYER_SA_EMAIL    = ${FRONTEND_DEPLOYER_SA_EMAIL}

Garmin usernames, passwords, MFA secrets and APP_USER_IDS are intentionally NOT
GitHub secrets anymore. Users establish their own Garmin link from the web app.

For Firebase Hosting/Rules also configure the Firebase web app values:

  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID
  VITE_FIREBASE_STORAGE_BUCKET
  VITE_FIREBASE_MESSAGING_SENDER_ID
  VITE_FIREBASE_APP_ID
  VITE_FIREBASE_MEASUREMENT_ID (optional)
  VITE_HEALTH_ANOMALY_POLICY (optional; defaults fail-closed to off)

Recommended production path: run "Deploy Production E2E" from main. The standalone
Garmin, Firestore-index and Frontend/Rules workflows remain available for targeted recovery.
==============================================================================
EOF
