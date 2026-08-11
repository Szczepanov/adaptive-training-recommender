# Firestore Rules Deployment

Production Cloud Firestore rules for `adaptive-training-recommender` are owned by this
repository and deployed by an authenticated local operator. This is intentionally a local
workflow: no GitHub Actions deployment identity or Firebase credential is configured.

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

