# Firestore Rules Deployment

Production Cloud Firestore rules for `adaptive-training-recommender` are owned by this
repository. This document is the reference for what a rules deployment actually does and why
-- drift check, mandatory emulator suite, deploy, post-deploy hash verification, rollback
backup -- regardless of whether you run it locally (below) or via the **Deploy Frontend &
Firestore Rules** GitHub Actions workflow (see
[`frontend-deployment.md`](./frontend-deployment.md), which runs this same sequence with a
narrowly-scoped Workload Identity Federation identity, no local machine needed). **Rollback
stays a local-only, deliberate operation either way** -- see [Rollback](#rollback) below;
`frontend-deployment.md` explains how to retrieve the backup file from a CI-driven deploy.

Only `app/firestore.rules` is deployed. Hosting, functions, data, and indexes are outside
this procedure.

## Prerequisites

From this PC, authenticate the two local tools as an operator with Firebase Rules access:

```powershell
firebase login
gcloud auth application-default login
```

Do not copy a service-account JSON file into the repository or export it to CI. The
root-level `firebase-service-account.json`, if present locally, is ignored and is not used
by these commands. The Firebase CLI login performs deployment; Application Default
Credentials only read the deployed Rules API release and perform a confirmed rollback.

## Normal deployment

Review the rules change in source control, then run from `app/`:

```powershell
npm run firestore:rules:drift
npm run firestore:rules:deploy -- --confirm
```

The first command deliberately fails when the deployed source differs from the checked-out
candidate. Treat a difference as a stop-and-review signal: decide whether it is the
intended repository change or an unauthorized/manual production change before confirming a
deployment. The deployment command then:

1. saves the currently active release and ruleset identity under
   `app/artifacts/firestore-rules-rollbacks/` (ignored by Git);
2. reruns the mandatory local `npm run test:rules` emulator suite;
3. deploys exactly `firestore:rules` to `adaptive-training-recommender`;
4. reads the deployed source again and fails unless its SHA-256 matches
   `app/firestore.rules`.

Record the command output, commit, deployment time, and resulting ruleset name in the
change review. Firebase Rules releases can take several minutes to propagate, so do not
assume an immediate client request proves the new release is active.

## Known deploy flakiness: transient 409 on release update

`firebase deploy --only firestore:rules` can fail with
`Error: Request to https://firebaserules.googleapis.com/v1/projects/.../releases had HTTP
Error: 409, Requested entity already exists`. This is a known firebase-tools limitation, not
a rules problem: `updateOrCreateRelease` (in firebase-tools' `gcp/rules.js`) always tries to
*update* the existing release first, and on **any** failure from that call -- a transient
timeout or 5xx from the Firebase Rules API included, not only "release doesn't exist yet" --
it falls back to *creating* a release with the same name. Past the very first deploy that
release always already exists, so the fallback then 409s, turning a transient backend hiccup
into a hard failure. It gets more likely to bite as `firestore.rules` grows -- see
[firebase-tools#5590](https://github.com/firebase/firebase-tools/issues/5590) and
[firebase-tools#2127](https://github.com/firebase/firebase-tools/issues/2127).

`firestore:rules:deploy` (`app/scripts/deploy-firestore-rules.mjs`) retries the `firebase
deploy` call itself (3 attempts, 15s apart) because the command is idempotent and the
post-deploy hash check still fails the run if every attempt leaves production not matching
`app/firestore.rules`. If it still fails after all retries -- in CI or locally -- rerun it;
if it keeps failing, check whether `app/firestore.rules` has grown close to the [Firestore
Security Rules size limits](https://firebase.google.com/docs/firestore/quotas#security_rules)
(256 KB source / 250 KB compiled) and look for removable dead code first (the CLI's own
`[W] ... Unused function: ...` compile warnings, printed during `test:rules` and the deploy
step, point at candidates).

## Drift and remediation

Run `npm run firestore:rules:drift` before any rules deployment and after any suspected
Firebase Console change. A matching result names the active release/ruleset and prints only
source hashes; it does not print credentials or modify production.

On a mismatch, do not overwrite production blindly. Compare the checked-out
`firestore.rules` with the intended reviewed source, restore that source in Git if needed,
and rerun the emulator tests. If the active production ruleset is known-good and the most
recent local deployment produced the mismatch, use the rollback procedure below.

## Rollback

Each local deployment saves a rollback JSON file. To repoint the default Firestore release
at the prior immutable ruleset:

```powershell
npm run firestore:rules:rollback -- --backup artifacts/firestore-rules-rollbacks/<timestamp>.json --confirm
```

Then run `npm run firestore:rules:drift`. If the rollback was intentional, reconcile
`app/firestore.rules` to that restored reviewed source before the next deployment.

The Firebase Rules API changes the release reference rather than recreating a prior
ruleset. The operator needs Firebase Rules Admin access for deployment and rollback; a
read-only audit identity needs Firebase Rules Viewer access.

## Initial verified release

On 2026-08-11, this procedure deployed the repository source to:

```text
projects/adaptive-training-recommender/releases/cloud.firestore
projects/adaptive-training-recommender/rulesets/8564ac3b-05c3-45eb-aa10-0cc4834ac496
```

The deployed and local SHA-256 were both
`f48b3c31d8cf659e63c9fd5d313909945159a020b39d4bb68045490b4bf693e5`.
