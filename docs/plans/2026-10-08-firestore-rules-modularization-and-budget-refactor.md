# Firestore Security Rules Modularization & Budget Refactoring

**Status**: `In Progress` — local implementation verified; production acceptance pending
**Base**: `89a24a6e` on fetched `origin/main`
**Target Date**: 2026-10-09

## Purpose and evidence boundary

The original proposal addressed a roughly 190 KB monolithic ruleset and deployment failures
reported around PR #1009. Its 6-second gateway explanation, global AST-budget hypothesis,
30–45% AST savings estimate, and sub-3-second cold compilation target were not established
by a reproducible benchmark in this plan. They must not be treated as verified platform limits
or delivered results.

Firebase documents a 256 KB source limit, a 250 KB compiled ruleset limit, and 1,000 evaluated
expressions per request. Rules functions cannot loop or recurse. See the official
[security rules limits](https://firebase.google.com/docs/firestore/quotas#security_rules) and
[custom function constraints](https://firebase.google.com/docs/firestore/security/rules-conditions#custom_functions).
Minification reduces uploaded source bytes; modularization improves ownership. Neither alone
proves a reduction in compiled size or remote compilation time.

## Required security boundaries

- Every client path retains its owner authorization and embedded user identity guards (ADR-0002).
- Immutable recommendation audits, prescriptions, history revisions, and terminal execution
  records retain their existing write lifecycle (ADR-0010).
- Window reservations and execution locks retain transaction bindings, exclusivity, and
  anti-resurrection checks.
- Occurrence and execution state transitions retain their current allowed transitions.
- Existing emulator rejection expectations remain unchanged, including malformed snapshots,
  execution-entry payloads, and bounded collections.

This is a rules/tooling refactor. It changes no recommendation-authority constants, app domain
schemas, or `POLICY_VERSION`.

## Local implementation

### Modular authoring and assembly

The 196 top-level declarations were mechanically extracted without loss and grouped under
`app/rules/`:

| Module | Owns |
|---|---|
| `00-header.rules` | Service/shared scope, ownership, calendar, and shared stimulus/cost helpers |
| `01-users-core.rules` | Goals, journal, settings, fixed activities, provider queues, and core user collections |
| `02-schedule-windows.rules` | Schedule manifests and legacy window rules |
| `03-external-plans.rules` | Imported plans, activation/placement, intent blocks, progression, and overlays |
| `04-session-occurrences.rules` | Definitions, occurrences, state transitions, and window reservations |
| `05-session-executions.rules` | Prescriptions, executions, entries, diary mutations, rest events, and launch locks |
| `06-recommendations.rules` | Recommendations, audits, decision contexts, intraday decisions, and ledgers |
| `07-health-anomalies.rules` | Check-ins, anomaly assessments/outcomes, identity, and health observation rules |
| `08-outcomes-trials.rules` | Performed occurrences, responses, protocols, observations, trials, and outcomes |
| `09-nutrition-anthropometry.rules` | Server-owned nutrition and anthropometry write denials |
| `99-footer.rules` | Closing scopes; unmatched paths remain implicitly denied |

`build-firestore-rules.mjs` assembles numeric modules in lexical order into readable, committed
`app/firestore.rules`. Modules remain in the original shared scope; function visibility and
matching path hierarchy are unchanged. Required-module validation prevents accidental slice
omission. `rules:check-sync` checks the artifact without modifying it, normalizing CRLF/LF
for platform portability. CI, `npm run check`, guarded deployment, and `make verify` run it.

### Minification, deployment, and drift

`minify-firestore-rules.mjs` exposes deterministic `minifyRules`. It removes comments outside
quoted strings, preserves string spelling and escapes, and preserves Rules syntax. Focused
unit tests cover token boundaries, malformed lexical input, repeatability, sync failure, and
temporary-config cleanup. A separate emulator test compiles the upload representation and
exercises owner checks, immutable prescriptions, and interpolated transaction paths.

`deploy-firestore-rules.mjs` checks source sync, retains the explicit confirmation guard,
rollback backup, emulator gate, retries, and post-deploy verification, and deploys an isolated
minified copy through a temporary config. Tracked files are not rewritten during deployment.
`check-firestore-rules-drift.mjs` normalizes both sources with the same minifier; comment or
formatting changes do not cause false drift. Raw source remains in rollback backups.

The existing broad `deploy:all` command gains a sync guard; its existing Firebase behavior
is otherwise unchanged. Production CI uses the guarded rules-only deployment wrapper.

### Behavior-preserving budget pruning

Removed 21 redundant `hasAll` checks from selected plan, source, occurrence, entry, rest-event,
and audit validators. Each removed key remains required by a direct field access, comparison,
type check, or called validator. Missing fields still fail closed. Removed duplicate snapshot
plan-ID type/size checks already guaranteed by equality with the validated plan ID, and the
duplicate revision lower bound; the snapshot revision integer check remains explicit.

Deep pruning in the proposal would conflict with existing malformed-snapshot and entry tests.
Those checks remain. Current snapshots already use shallow container/identity validation;
application validators remain authoritative for deep domain semantics. Bounded array checks
remain because Rules cannot iterate and reducing caps would break supported schedules. The
plan's security invariants and unchanged test expectations take precedence over its savings
estimate. No compiled AST percentage is claimed.

## Verification record

- Baseline: all 32 emulator files and 391 tests passed before changes.
- Added missing-field coverage for all four session-source identities, both occurrence
  references, and every external placement field; the expanded baseline passed 398 tests.
- The local verification contract test failed when the sync gate was absent and passed after
  wiring the gate; all 18 verification-contract tests passed.
- Final rules gate: both emulator shards passed, totaling 33 files and 400 tests, including
  the minified-source compilation/transaction tests. The 391 original assertions remain.
- Focused tooling: 22 tests passed. Independent comparison confirmed all 196 declarations
  and every match body were retained; only 14 validator functions changed. Review caught a
  Windows path-with-spaces issue in the temporary config argument, corrected by passing its
  basename from the existing app working directory.
- Uploaded source: 136,343 bytes versus the 190,350-byte baseline, a 28.4% reduction.
- Firebase CLI 15.32.1 remote `deploy --only firestore:rules --dry-run` passed for both
  baseline-readable and candidate-minified source with zero rules compilation warnings or
  errors. Total CLI durations were 38,764 ms and 8,636 ms, respectively. These sequential
  runs include authentication, API checks, network time, and potentially warm caches;
  they do not establish isolated cold compiler latency or the under-3-second target.
- Read-only drift inspection confirmed production matches normalized baseline source.
  Candidate drift is the intended refactor; no rules release was changed.
- Canonical `make verify` passed in 331 seconds: 1,289 Python tests (one platform skip),
  8,191 frontend unit tests (400 emulator tests run separately), all 400 rules tests,
  48 browser tests, and both performance tests. Hygiene, dependency audit, sync, typecheck,
  lint, registry/catalog validation, build, simulations, and policy drift passed.
- Independent security/code review approved the final implementation with no remaining
  blocking findings after the Windows config-path repair.

## Remaining release acceptance

Local code is reviewable before production changes. Production deployment remains a separate
operator action under the [deployment runbook](../ops/firestore-rules-deployment.md).

- [x] Complete `make verify` and independent security/code review.
- [ ] Measure remote compilation diagnostics and timing against the same baseline and candidate;
  distinguish emulator timings from live service timings and source bytes from compiled bytes.
- [x] Check deployed-source drift with an explicit project and review the difference.
- [ ] After deployment authorization, run the guarded rules-only deploy and verify normalized
  post-deploy identity and first-attempt CI success.

A local test pass cannot establish production cold-compilation latency or first-attempt release
success. The original under-3-second target remains an acceptance target pending measurement.
