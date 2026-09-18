#!/usr/bin/env bash
# Read-only check: confirms your already-deployed GCP resources exist under the exact
# names/locations deploy-garmin-sync.yml and garmin-token-bootstrap.yml assume. Run this
# from wherever you did the manual deploy (Cloud Shell or a local `gcloud`) -- it changes
# nothing, only reports what it finds.
set -uo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to your GCP/Firebase project id}"
: "${REGION:=europe-central2}"
GARMIN_SYNC_RUN_URI="https://run.googleapis.com/v2/projects/${GCP_PROJECT}/locations/${REGION}/jobs/garmin-sync:run"
verification_failed=0

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

check_output() {
  local desc="$1"; shift
  local output
  if output="$("$@")" && [ -n "${output}" ]; then
    echo "OK    ${desc}"
  else
    echo "MISSING  ${desc}"
  fi
}

check_exactly_one_scheduler_target() {
  local output
  local name
  local uri
  local target_count=0
  local target_names=()

  if ! output="$(gcloud scheduler jobs list --location="${REGION}" \
    --format='csv[no-heading](name,httpTarget.uri)' 2>&1)"; then
    echo "FAILED  Unable to list Cloud Scheduler jobs for Garmin sync target validation"
    return 1
  fi

  while IFS=, read -r name uri; do
    [[ -n "${name}" ]] || continue
    if [[ "${uri}" == "${GARMIN_SYNC_RUN_URI}" ]]; then
      target_names+=("${name}")
      ((target_count += 1))
    fi
  done <<< "${output}"

  if (( target_count == 1 )); then
    echo "OK    Exactly one Cloud Scheduler job targets ${GARMIN_SYNC_RUN_URI}: ${target_names[0]}"
    return 0
  fi

  echo "FAILED  Expected exactly one Cloud Scheduler job targeting ${GARMIN_SYNC_RUN_URI}; found ${target_count}: ${target_names[*]:-none}"
  return 1
}

echo "Checking project: ${GCP_PROJECT}, region: ${REGION}"
echo

check "Token bucket gs://${GCP_PROJECT}-garmin-tokens" \
  gcloud storage buckets describe "gs://${GCP_PROJECT}-garmin-tokens"

check "Token object gs://${GCP_PROJECT}-garmin-tokens/garmin/garmin_tokens.json (bootstrap already ran)" \
  gcloud storage objects describe "gs://${GCP_PROJECT}-garmin-tokens/garmin/garmin_tokens.json"

check "Service account garmin-sync-job@${GCP_PROJECT}.iam.gserviceaccount.com" \
  gcloud iam service-accounts describe "garmin-sync-job@${GCP_PROJECT}.iam.gserviceaccount.com"

check "Service account anthropometry-write-api@${GCP_PROJECT}.iam.gserviceaccount.com" \
  gcloud iam service-accounts describe "anthropometry-write-api@${GCP_PROJECT}.iam.gserviceaccount.com"

check_output "Anthropometry write API has the revoked-token verifier role" \
  gcloud projects get-iam-policy "${GCP_PROJECT}" \
    --flatten="bindings[].members" \
    --filter="bindings.role:anthropometryTokenVerifier AND bindings.members:anthropometry-write-api@${GCP_PROJECT}.iam.gserviceaccount.com" \
    --format="value(bindings.role)"

check "Service account garmin-scheduler-invoker@${GCP_PROJECT}.iam.gserviceaccount.com" \
  gcloud iam service-accounts describe "garmin-scheduler-invoker@${GCP_PROJECT}.iam.gserviceaccount.com"

check "Artifact Registry repo garmin-sync in ${REGION}" \
  gcloud artifacts repositories describe garmin-sync --location="${REGION}"

check "Cloud Run Job garmin-sync in ${REGION}" \
  gcloud run jobs describe garmin-sync --region="${REGION}"

check "Cloud Run Job garmin-push-pending-workouts in ${REGION}" \
  gcloud run jobs describe garmin-push-pending-workouts --region="${REGION}"

check "Cloud Run Job garmin-manual-sync in ${REGION}" \
  gcloud run jobs describe garmin-manual-sync --region="${REGION}"

check "Cloud Run service anthropometry-write-api in ${REGION}" \
  gcloud run services describe anthropometry-write-api --region="${REGION}"

check "Cloud Scheduler job garmin-sync-morning-poll in ${REGION}" \
  gcloud scheduler jobs describe garmin-sync-morning-poll --location="${REGION}"

# The repository-owned name is useful for reconciliation, but it cannot prove uniqueness:
# a duplicate can have any name. Count every Scheduler job whose complete URI targets the
# garmin-sync RunJob and fail this read-only check unless it is exactly one.
if ! check_exactly_one_scheduler_target; then
  verification_failed=1
fi

check "Cloud Scheduler job garmin-push-pending-workouts-poll in ${REGION}" \
  gcloud scheduler jobs describe garmin-push-pending-workouts-poll --location="${REGION}"

check "Cloud Scheduler job garmin-manual-sync-poll in ${REGION}" \
  gcloud scheduler jobs describe garmin-manual-sync-poll --location="${REGION}"

echo
echo "Workload Identity Federation (only relevant once you've run setup-workload-identity.sh):"
check "Workload Identity Pool github-pool" \
  gcloud iam workload-identity-pools describe github-pool --location=global
check "Service account github-deployer@${GCP_PROJECT}.iam.gserviceaccount.com" \
  gcloud iam service-accounts describe "github-deployer@${GCP_PROJECT}.iam.gserviceaccount.com"
check "Service account github-frontend-deployer@${GCP_PROJECT}.iam.gserviceaccount.com" \
  gcloud iam service-accounts describe "github-frontend-deployer@${GCP_PROJECT}.iam.gserviceaccount.com"

echo
echo "Any MISSING line above means re-running docs/ops/setup-workload-identity.sh will create"
echo "it (idempotent) -- deploy-garmin-sync.yml itself no longer provisions infra, only"
echo "deploys against what already exists. A row you expected OK but got MISSING is worth a"
echo "second look: either the manual deploy used a different name/region, or that piece"
echo "genuinely wasn't done."

if (( verification_failed )); then
  echo "FAILED: Cloud Scheduler target uniqueness is not verified. Do not treat a deployment as duplicate cleanup."
  exit 1
fi
