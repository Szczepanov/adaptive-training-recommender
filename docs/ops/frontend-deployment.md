# Frontend & Firestore Rules Deployment (GitHub Actions)

Deploys the web app (`app/`) to Firebase Hosting and/or `app/firestore.rules` to Cloud
Firestore, entirely from the GitHub web UI -- no local machine or `gcloud`/`firebase` CLI
needed. This is the **`Deploy Frontend & Firestore Rules`** workflow
(`.github/workflows/deploy-frontend.yml`), triggered as `workflow_dispatch` (works fine from a
phone/tablet browser).

It authenticates the same way `deploy-garmin-sync.yml` does -- **Workload Identity
Federation**: no service-account JSON key is ever stored as a secret, only a provider resource
name and a service-account email GitHub proves it's allowed to impersonate for that one run.

Firestore **indexes** are out of scope here, same as the local `npm run firestore:rules:deploy`
procedure this mirrors -- use `make deploy-indexes` locally for those (rare enough not to need
its own CI path yet).

## Design: a separate identity from garmin-sync's

`github-deployer` (used by `deploy-garmin-sync.yml`) and `github-frontend-deployer` (used
here) are two different service accounts, both provisioned by the same one-time
`docs/ops/setup-workload-identity.sh`, both trusting the same Workload Identity Pool/Provider
(restricted to this repo's `main` branch -- a run from any other branch or a fork can't
authenticate as either at all). `github-frontend-deployer` only ever holds
`roles/firebasehosting.admin` and `roles/firebaserules.admin` -- nothing about Cloud Run,
Artifact Registry, Cloud Scheduler, or general Firestore data/index access. A workflow file
compromised or added later in this repo therefore can't use it to reach garmin-sync's
infrastructure, or vice versa: each identity can only touch the one surface it's scoped to.

## One-time setup

If you've already run `docs/ops/setup-workload-identity.sh` for `deploy-garmin-sync.yml`,
rerun it (idempotent -- it only fills in what's missing, including the new
`github-frontend-deployer` identity this workflow needs):

```bash
export GCP_PROJECT=adaptive-training-recommender   # your Firebase/GCP project id
export GITHUB_REPO=OWNER/REPO                       # e.g. Szczepanov/adaptive-training-recommender
bash docs/ops/setup-workload-identity.sh
```

Add the printed `GCP_FRONTEND_DEPLOYER_SA_EMAIL` as a repo secret (alongside
`GCP_PROJECT_ID` and `GCP_WORKLOAD_IDENTITY_PROVIDER`, already added if you set up
`deploy-garmin-sync.yml` -- both workflows share those two).

You also need your **production Firebase web app config** as repo secrets -- this is the
public client-side config embedded in the built bundle (not a credential), found in the
Firebase console under Project settings -> General -> Your apps:

| Secret | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | from the Firebase console |
| `VITE_FIREBASE_AUTH_DOMAIN` | from the Firebase console |
| `VITE_FIREBASE_PROJECT_ID` | from the Firebase console |
| `VITE_FIREBASE_STORAGE_BUCKET` | from the Firebase console |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | from the Firebase console |
| `VITE_FIREBASE_APP_ID` | from the Firebase console |
| `VITE_FIREBASE_MEASUREMENT_ID` | optional, only if you use Analytics |

These are the same values your local `.env` (gitignored) already has, if you've deployed the
frontend from a local machine before.

## Deploy

Run the **Deploy Frontend & Firestore Rules** workflow (Actions tab -> select it -> Run
workflow). Two independent inputs, both default on:

* `deploy_hosting` -- runs `npm run build` (which runs the full `npm run check`: typecheck,
  lint, unit tests, workout-catalog validation -- never deploys a build that hasn't passed
  those) then `firebase deploy --only hosting`.
* `deploy_rules` -- mirrors the local procedure in
  [`firestore-rules-deployment.md`](./firestore-rules-deployment.md): a drift check first
  (fails closed if the deployed rules don't match `app/firestore.rules` -- investigate rather
  than override, same as the local flow), then the emulator test suite, then the deploy, then
  a post-deploy hash re-check.

Turn either off to deploy just one side -- e.g. `deploy_rules: false` for a frontend-only
change, or `deploy_hosting: false` to ship a reviewed rules change without also cutting a new
Hosting release.

## Rollback stays local

`deploy_rules` uploads its rollback backup JSON as a workflow run artifact (the runner itself
is thrown away after the job, and the local procedure's `app/artifacts/firestore-rules-rollbacks/`
is gitignored) -- download it from the run's **Artifacts** section if you ever need it. Rolling
back is still a deliberate local operation, unchanged from
[`firestore-rules-deployment.md`](./firestore-rules-deployment.md#rollback): download the
backup, then from `app/` with `gcloud auth application-default login` done once,

```bash
npm run firestore:rules:rollback -- --backup <downloaded-file>.json --confirm
```

Hosting releases don't need this: Firebase Hosting keeps prior releases browsable in the
console, and rolling back (Hosting -> your site -> release history -> **Rollback** on any
prior release) repoints traffic to it directly -- no separate backup file to manage. There is
no `firebase hosting:rollback` CLI command; the console is the only supported way to do this.
