# PR 388 auth and wearable-free review — 2026-09-03

Scope: the PR diff against `main`, its CI/review state, authentication and provider-link
boundaries, recommendation composition, 7-day planning, tests, and the repository's
architecture/ADR contracts.

## Verdict

The feature direction is sound, but the reviewed head was not ready to merge. Its engine
adapter supported an absent recovery snapshot, while one production entry point still
required that snapshot. The new Garmin connection reader also converted missing/unreadable
mirror state directly to disconnected, contrary to ADR-0029, and the auto-sync effect did
not depend on the asynchronous connection transition that enabled it.

The hardened implementation keeps wearable-free support deliberately narrow: it is enabled
only after canonical provider status confirms disconnection. Connected missing-data and
unknown-status cases remain fail-closed, while all existing safety, history, equipment,
availability, and provenance paths continue to run.

## Findings resolved

| Severity | Finding | Resolution |
|---|---|---|
| High | Missing/error Garmin mirrors were treated as disconnected, bypassing ADR-0029 lazy reconciliation and tri-state semantics. | Centralized mirror-first reads with authenticated canonical fallback; failed fallback is `unknown`. |
| High | `PlanView` still required `recoverySnapshot`, so the advertised wearable-free 7-day forecast was unreachable. | Both daily and 7-day composition accept absent telemetry only for a confirmed-disconnected account with a complete safety check-in. |
| High | Any transient missing snapshot could enter subjective-only mode, including a connected Garmin account. | Connected missing-data now offers resync; unknown connection state blocks planning. |
| Medium | Auto-sync could miss `checking -> connected` because the trigger effect omitted connection state from its dependencies. | Shared connection hook plus an explicit dependency; disconnected/unknown accounts install no sync listeners. |
| Medium | Email signup immediately authenticated unverified addresses, reset errors could enumerate accounts, and password validation hard-coded six characters. | Project-policy validation, verification-before-access, generic reset acknowledgement, and non-enumerating signup copy. |
| Medium | Authenticated link endpoints accepted otherwise-valid revoked tokens and disabled users. | Firebase Admin verification now uses `check_revoked=True`; password-provider tokens also require verified email. |
| Low | CRLF churn made `git diff --check` report widespread trailing whitespace and obscured the semantic CSS/test changes. | Normalize touched files to LF and keep the review diff semantic. |

## Evidence basis

Google recommends an email-verification flow and enumeration protection for password
accounts. Firebase documents that `validatePassword` uses the configured project/tenant
policy and that normal ID-token verification does not check revocation unless explicitly
requested. See the official
[password authentication guidance](https://firebase.google.com/docs/auth/web/password-auth),
[email enumeration guidance](https://docs.cloud.google.com/identity-platform/docs/admin/email-enumeration-protection),
[ID-token verification guide](https://firebase.google.com/docs/auth/admin/verify-id-tokens),
and [session revocation guide](https://firebase.google.com/docs/auth/admin/manage-sessions).

For the training-side premise, Saw et al.'s systematic review found subjective well-being
measures responsive to acute and chronic training load and useful either alone or alongside
objective measures. That supports a subjective-only observation path; it does not justify
removing clinical, tissue-response, history, or feasibility gates. See
[Saw et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26869134/).

## Verification contract

- Unit tests cover email verification/password-policy/reset semantics and Garmin mirror
  reconciliation, including unknown state.
- Existing engine tests cover green, modify, and recover subjective-only decisions and now
  distinguish partial wearable evidence from fully absent telemetry.
- Backend tests assert revoked-token checking and unverified password-user rejection.
- Full frontend/backend checks, production build, diff hygiene, and scenario simulations are
  required before merge.
