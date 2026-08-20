#!/usr/bin/env bash
# Read-only check: confirms your already-deployed GCP resources exist under the exact
# names/locations deploy-garmin-sync.yml and garmin-token-bootstrap.yml assume. Run this
# from wherever you did the manual deploy (Cloud Shell or a local `gcloud`) -- it changes
# nothing, only reports what it finds.
set -uo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to your GCP/Firebase project id}"
: "${REGION:=europe-central2}"

# Process-scoped only -- never mutates your persisted gcloud configuration.
export CLOUDSDK_CORE_PROJECT="${GCP_PROJECT}"

check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "OK    ${desc}"
  else
    echo "MISSING  ${desc}"
  fi
}

echo "Checking project: ${GCP_PROJECT}, region: ${REGION}"
echo

check "Token bucket gs://${GCP_PROJECT}-garmin-tokens" \
  gcloud storage buckets describe "gs://${GCP_PROJECT}-garmin-tokens"

check "Token object gs://${GCP_PROJECT}-garmin-tokens/garmin/garmin_tokens.json (bootstrap already ran)" \
  gcloud storage objects describe "gs://${GCP_PROJECT}-garmin-tokens/garmin/garmin_tokens.json"

check "Service account garmin-sync-job@${GCP_PROJECT}.iam.gserviceaccount.com" \
  gcloud iam service-accounts describe "garmin-sync-job@${GCP_PROJECT}.iam.gserviceaccount.com"

check "Service account garmin-scheduler-invoker@${GCP_PROJECT}.iam.gserviceaccount.com" \
  gcloud iam service-accounts describe "garmin-scheduler-invoker@${GCP_PROJECT}.iam.gserviceaccount.com"

check "Artifact Registry repo garmin-sync in ${REGION}" \
  gcloud artifacts repositories describe garmin-sync --location="${REGION}"

check "Cloud Run Job garmin-sync in ${REGION}" \
  gcloud run jobs describe garmin-sync --region="${REGION}"

check "Cloud Run Job garmin-push-pending-workouts in ${REGION}" \
  gcloud run jobs describe garmin-push-pending-workouts --region="${REGION}"

check "Cloud Scheduler job garmin-sync-morning-poll in ${REGION}" \
  gcloud scheduler jobs describe garmin-sync-morning-poll --location="${REGION}"

check "Cloud Scheduler job garmin-push-pending-workouts-poll in ${REGION}" \
  gcloud scheduler jobs describe garmin-push-pending-workouts-poll --location="${REGION}"

echo
echo "Workload Identity Federation (only relevant once you've run setup-workload-identity.sh):"
check "Workload Identity Pool github-pool" \
  gcloud iam workload-identity-pools describe github-pool --location=global
check "Service account github-deployer@${GCP_PROJECT}.iam.gserviceaccount.com" \
  gcloud iam service-accounts describe "github-deployer@${GCP_PROJECT}.iam.gserviceaccount.com"

echo
echo "Any MISSING line above means re-running docs/ops/setup-workload-identity.sh will create"
echo "it (idempotent) -- deploy-garmin-sync.yml itself no longer provisions infra, only"
echo "deploys against what already exists. A row you expected OK but got MISSING is worth a"
echo "second look: either the manual deploy used a different name/region, or that piece"
echo "genuinely wasn't done."
