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

The generated `app/firestore.rules` is minified for upload. Hosting, functions, data, and indexes are outside
this procedure.

## Authoring and local verification

Edit the numbered domain modules under `app/rules/`, then run from `app/`:

```powershell
npm run rules:build
npm run rules:check-sync
npm run test:rules
```

`rules:build` assembles modules in lexical order into readable, committed
`app/firestore.rules`. The header opens the shared scope; the footer closes it. Keep helpers
used by a single collection inside that collection's `match` block. Only genuinely shared
helpers belong in the documents scope; the tooling test explicitly lists them for review.
Do not edit the generated file directly. Missing required modules and stale output fail the sync check, which also runs
in CI, `npm run check`, and `make verify`.

The guarded rules deployment checks sync before reading production. It minifies the generated
source in memory and uploads it directly through the Firebase Rules REST API; no temporary
Firebase config or rules file is needed. Tracked source and configuration remain readable.
The minifier preserves quoted strings,
escapes, and syntax-sensitive token boundaries. It also shortens helper names, parameters,
and local variables using their declaring scopes. Fields, static path segments, path wildcard
names, free variables, and builtins retain their spelling. Emulator coverage compiles the minified
source and exercises ownership, immutable prescriptions, and transaction path bindings.

## Prerequisites

From this PC, authenticate Application Default Credentials as an operator with Firebase Rules access:

```powershell
gcloud auth application-default login
```

Do not copy a service-account JSON file into the repository or export it to CI. The
root-level `firebase-service-account.json`, if present locally, is ignored and is not used
by these commands. Application Default Credentials read the deployed release, upload and
activate rules, and perform a confirmed rollback. CI uses its existing keyless Workload
Identity Federation credentials for the same API calls.

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
3. creates a ruleset from minified source and patches only the existing `cloud.firestore`
   release to point at it;
4. reads the deployed source again and fails unless its normalized SHA-256 matches
   `app/firestore.rules`.

When the pre-deployment comparison already matches, the upload and activation are skipped;
the emulator gate and final identity check still run.

Drift comparison applies the same minifier to both sources. Comments, line endings, formatting,
and the compactor's binding aliases do not create drift; changed conditions, paths, fields,
and string contents do. Normalization preserves expressions and binding resolution; it does
not claim that differently written conditions are semantically equivalent. The
rollback backup retains the original deployed source and ruleset identity.

Record the command output, commit, deployment time, and resulting ruleset name in the
change review. Firebase Rules releases can take several minutes to propagate, so do not
assume an immediate client request proves the new release is active.

## Rules API failures and retries

`firebase deploy --only firestore:rules` can fail with
`Error: Request to https://firebaserules.googleapis.com/v1/projects/.../releases had HTTP
Error: 409, Requested entity already exists`. This is a known firebase-tools limitation, not
a rules problem: `updateOrCreateRelease` (in firebase-tools' `gcp/rules.js`) always tries to
*update* the existing release first, and on **any** failure from that call -- a transient
timeout or 5xx from the Firebase Rules API included, not only "release doesn't exist yet" --
it falls back to *creating* a release with the same name. Past the very first deploy that
release always already exists, so the fallback then 409s, turning a transient backend hiccup
into a hard failure. Large rulesets have also exhibited intermittent 503 errors during
cloud compilation and ruleset creation, even when emulator validation passes -- see
[firebase-tools#5590](https://github.com/firebase/firebase-tools/issues/5590) and
[firebase-tools#2127](https://github.com/firebase/firebase-tools/issues/2127).

`firestore:rules:deploy` (`app/scripts/deploy-firestore-rules.mjs`) now uses the documented
[ruleset creation](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/create)
and [release PATCH](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/patch)
endpoints directly. Ruleset creation validates syntax and semantics, so the CLI's additional
`:test` compilation is unnecessary after the mandatory emulator suite. A failed activation
retries PATCH against the same uploaded ruleset; it never falls back to creating a release
or recompiling the source. This procedure requires an existing release, as its backup step
already did.

API reads, ruleset creation, and activation each allow six attempts for HTTP 429, 500, 502,
503, and 504, with delays of 15, 30, 60, 120, and 120 seconds. Each request has a 60-second
timeout. Other HTTP errors, network errors, and timeouts fail immediately. Logs identify the
failing API phase and status without printing credentials. The post-deploy hash check still
requires production to match the repository. A POST whose response is lost can leave an
unused immutable ruleset; retries never activate it without a returned identity.
If activation exhausts transient-error retries or loses its response, the command reads the
release identity and accepts success only when it points at the uploaded ruleset. A different
identity or an unsuccessful read preserves the original deployment error. The final source
hash check still follows this reconciliation.

If persistent backend errors exhaust retries, the command fails; no client retry policy can
guarantee recovery from a Firebase outage. Check whether the rules have grown close to the [Firestore
Security Rules size limits](https://firebase.google.com/docs/firestore/quotas#security_rules)
(256 KB source / 250 KB compiled). The command rejects minified source over 256 KiB before
upload. Emulator validation does not prove the production compiled-size budget.

Firebase's [compiler guidance](https://firebase.google.com/docs/rules/rules-language#expression_complexity_and_compiler_limits)
also identifies inherited helper scopes as a source of compiler stack exhaustion (503) and
compiled executable size failures (400). Functions declared at the documents scope are
inherited and compiled into every child match. Splitting source into module files or removing
whitespace does not reduce that duplication. Collection-specific validation families must
live inside their existing match blocks, with shared dependencies kept visible to every caller.
The scope regression test prevents silently restoring collection validators to the root.
Whitespace removal alone also leaves long binding names in the compiled executable. The
upload compactor shortens those names while the authored/generated rules stay readable.
For this remediation, isolated cloud release creation and PATCH succeeded with a compiled
executable below the limit; the temporary releases and rulesets were deleted afterwards.

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
