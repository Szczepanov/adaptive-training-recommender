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

## 🔑 Initial Token Bootstrap

Because Cloud Run cannot handle interactive Garmin MFA or password logins (`GARMIN_ALLOW_CREDENTIAL_LOGIN=false`), initialize the OAuth token locally first:

```bash
# Run local token bootstrap script
uv run python garmin_login.py

# Upload generated local token to GCS bucket manually or via gsutil:
gsutil cp .garmin_tokens/garmin_tokens.json gs://<YOUR_PRIVATE_TOKEN_BUCKET>/garmin/garmin_tokens.json
```
