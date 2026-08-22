# End-to-End Production Deployment

The recommended way to promote a repository revision to production is the GitHub Actions
**Deploy Production E2E** workflow (`.github/workflows/deploy-production.yml`). It releases one
`main` commit through the full validation and deployment chain without relying on a local
machine.

The release is intentionally manual (`workflow_dispatch`). Firestore security rules already
have a fail-closed production-drift gate that can require an explicit operator acknowledgement;
a merge to `main` must not silently turn that acknowledgement into an unattended deployment.

## Release order and safety model

A production run promotes one Git SHA in dependency order:

1. **Full CI release gate** — Python 3.12/3.14 tests, lint/type checks, frontend tests and
   Firestore rules emulator suite, simulations, production frontend build, dependency audits,
   and Docker build.
2. **Garmin backend** — build and push the SHA-tagged image, deploy `garmin-account-link`, the
   three Cloud Run Jobs and their Scheduler jobs, then verify the account-link `/health`
   endpoint. The optional live `garmin-sync` execution remains opt-in because it calls Garmin.
3. **Firestore indexes** — deploy `app/firestore.indexes.json` and wait until every composite
   index is usable. A `NEEDS_REPAIR` state or a 20-minute readiness timeout fails the release.
4. **Firestore security rules** — run the existing drift/backup/emulator/deploy/hash-verification
   sequence. Unexpected drift fails closed by default.
5. **Firebase Hosting** — build with production Firebase configuration, deploy the frontend,
   verify the Hosting URL, then verify the `/api/garmin/**` Hosting rewrite reaches the Cloud
   Run account-link service.

Hosting is deliberately last. A new client therefore cannot be exposed before the server-side
Garmin API, indexes and security rules it may depend on are live.

The top-level release and every mutable component workflow use non-cancelling concurrency
groups. A second release queues rather than overtaking a deployment already in progress.

## One-time setup change

The existing Workload Identity Federation design remains in place and remains restricted to
this repository's `main` branch. Re-run the idempotent setup script once after this pipeline is
merged:

```bash
export GCP_PROJECT=adaptive-training-recommender
export GITHUB_REPO=Szczepanov/adaptive-training-recommender
bash docs/ops/setup-workload-identity.sh
```

This adds `roles/datastore.indexAdmin` to `github-frontend-deployer`, which is the predefined
Firestore index-management role used by the new index deployment unit. No service-account key
is created or stored.

The repository secrets printed by the setup script plus the existing `VITE_FIREBASE_*` build
configuration are consumed by the component workflows. `VITE_HEALTH_ANOMALY_POLICY` remains
optional and fails closed to `off` when absent.

## Running a production release

From GitHub:

1. Open **Actions** -> **Deploy Production E2E** -> **Run workflow**.
2. Select the `main` branch. The workflow also checks this explicitly before any deployment;
   the WIF provider itself rejects other refs as a second guard.
3. Keep `region` at `europe-central2` unless the deployed Garmin resources were intentionally
   moved.
4. Leave `confirm_rules_drift` off for the first attempt.
5. Leave `run_garmin_sync_smoke_test` off for an ordinary release. The account-link service
   still receives a credential-free health check on every backend deployment.

If the rules stage stops because production differs from `app/firestore.rules`, review the
mismatch. If the repository version is the intended reviewed production ruleset, rerun the
same `main` release with `confirm_rules_drift: true`. That acknowledgement bypasses only the
pre-deployment mismatch stop; rollback backup creation, emulator tests, deployment and
post-deploy source-hash verification still run.

## Firestore index behavior

The index workflow deliberately does **not** pass Firebase CLI `--force`. It may add or update
repository-owned indexes, but it will not silently opt into deleting a remote-only production
index. Remove obsolete production indexes only as a separate reviewed operator action.

Firebase accepts index creation asynchronously, so a successful CLI invocation alone is not a
release-ready signal. The workflow polls composite-index state and blocks the rules/Hosting
stages until creation settles.

## Targeted recovery workflows

The component workflows remain manually runnable when a full release is unnecessary:

- **Deploy Garmin Sync** — backend/jobs/schedulers only.
- **Deploy Firestore Indexes** — indexes only, including readiness wait.
- **Deploy Frontend & Firestore Rules** — Hosting and/or rules only.

Use these for recovery or a deliberately scoped operational change. Normal production
promotion should use **Deploy Production E2E** so ordering and single-SHA traceability are
preserved.

## Failure and rollback

A failed stage stops every dependent later stage. For example, index or rules failure means no
new Hosting release is cut.

- **Garmin backend:** redeploy the previous known-good Git SHA through the backend workflow or
  restore the previous Cloud Run image revision/job spec according to
  `cloud-run-deployment.md`.
- **Firestore rules:** the rules deployment uploads its pre-change rollback metadata as a
  workflow artifact. Follow `firestore-rules-deployment.md` for the deliberate rollback
  command.
- **Firestore indexes:** index deletion is not automated by this pipeline. Correct or remove a
  failed/obsolete index only after reviewing the production query impact.
- **Firebase Hosting:** use Firebase Hosting release history to roll traffic back to a previous
  release.

The E2E workflow is a deployment orchestrator, not a substitute for the component runbooks;
those remain authoritative for component-specific recovery details.
