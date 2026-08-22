# Frontend, Firestore Rules & Indexes Deployment (GitHub Actions)

For ordinary production promotion use **Deploy Production E2E** and follow
[`production-deployment.md`](./production-deployment.md). It validates and promotes one `main`
Git SHA in dependency order: Garmin backend -> Firestore indexes -> Firestore rules ->
Firebase Hosting.

The component workflows documented here remain available for targeted recovery or deliberately
scoped deployments:

- **Deploy Frontend & Firestore Rules** (`.github/workflows/deploy-frontend.yml`)
- **Deploy Firestore Indexes** (`.github/workflows/deploy-firestore-indexes.yml`)

Both authenticate with **Workload Identity Federation**. No service-account JSON key is stored
in GitHub.

## Deployment identities

`github-deployer` is reserved for Garmin Cloud Run, Artifact Registry and Cloud Scheduler.
`github-frontend-deployer` is separate and is limited to the Firebase/Firestore deployment
surface used here:

- `roles/firebasehosting.admin`
- `roles/firebaserules.admin`
- `roles/datastore.indexAdmin`
- `roles/serviceusage.serviceUsageConsumer`

There is one narrow Cloud Run exception inherited from the existing Hosting deployment path:
`app/firebase.json` rewrites `/api/garmin/**` to `garmin-account-link`, and Firebase Hosting
needs `run.services.get` on that service while finalizing the Hosting release.
`setup-workload-identity.sh` therefore grants `github-frontend-deployer` `roles/run.viewer`
**only on that single Cloud Run service**, not at project level. It still cannot deploy or
modify Cloud Run and cannot inspect unrelated services.

Both identities trust the same WIF provider, whose condition is restricted to this repository's
`main` branch. A feature branch or fork cannot authenticate as either deployment identity.

After the E2E/index pipeline is merged, rerun the idempotent setup script once so the existing
frontend deployer receives its Firestore index role and the scoped Cloud Run viewer binding:

```bash
export GCP_PROJECT=adaptive-training-recommender
export GITHUB_REPO=Szczepanov/adaptive-training-recommender
bash docs/ops/setup-workload-identity.sh
```

The `garmin-account-link` binding is applied only when that service already exists. If it has
not been deployed yet, the script prints a `NOTE:`; run **Deploy Garmin Sync** first and rerun
the setup script afterward. In the normal E2E setup this is a one-time bootstrap concern, not
a per-release step.

The script prints the required repository secrets. Hosting builds also need the production
Firebase web config (`VITE_FIREBASE_*`). Those values are client configuration embedded in the
bundle, not a service-account credential. `VITE_HEALTH_ANOMALY_POLICY` is optional and fails
closed to `off` when absent.

## Frontend and Firestore rules

Run **Deploy Frontend & Firestore Rules** when you intentionally need only Hosting, only rules,
or both. Its inputs are:

- `deploy_hosting` — runs the production frontend build and deploys Firebase Hosting.
- `deploy_rules` — runs the Firestore rules safety/deployment flow.
- `confirm_rules_drift` — defaults to `false`; set it only after reviewing an intentional
  production-vs-repository rules mismatch.

The rules path remains fail-closed by default. With no acknowledgement, unexpected production
drift stops the run before changing rules. With `confirm_rules_drift: true`, only that expected
pre-deployment mismatch is acknowledged; the deployment script still saves rollback metadata,
runs the mandatory Firestore emulator suite, deploys only rules, and verifies the deployed
source hash against `app/firestore.rules`.

Hosting deploys are followed by two smoke checks: the Firebase Hosting root must be reachable,
and the `/api/garmin/**` Hosting rewrite must reach the Cloud Run account-link backend. The
rewrite probe uses a credential-free unsupported GET path and expects the backend's JSON 404,
so it does not submit Garmin credentials or consume a login-rate-limit attempt.

For a normal release, do not run Hosting before new backend/index/rules dependencies are ready;
use **Deploy Production E2E**, which always cuts Hosting last.

## Firestore indexes

Run **Deploy Firestore Indexes** for an index-only production change. It deploys
`app/firestore.indexes.json` and then waits for composite-index construction to finish.

The Firebase CLI can return while index construction is still asynchronous, so the workflow
polls Firestore until no composite index is `CREATING`. `NEEDS_REPAIR` fails immediately and a
20-minute readiness timeout also fails the run.

The workflow deliberately omits `--force`. It may add/update repository-owned indexes but does
not silently opt into deleting a production index that is present remotely but absent from the
repository. Treat index deletion as a separate reviewed operator action.

## Rollback

Rules deployment uploads its rollback backup JSON to the workflow run's **Artifacts** section.
For a rules rollback, download it and follow
[`firestore-rules-deployment.md`](./firestore-rules-deployment.md#rollback).

Firebase Hosting keeps release history; roll traffic back from the Firebase console to a prior
Hosting release when needed.

Indexes are not automatically deleted by the pipeline. Review query impact before correcting
or removing an index.
