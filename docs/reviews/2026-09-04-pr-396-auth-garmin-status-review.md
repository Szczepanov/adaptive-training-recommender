# PR #396 review — Garmin status for unverified email accounts

**Date:** 2026-09-04  
**PR:** #396 — `fix(auth): allow unverified email accounts to check garmin status for wearable-free mode`

## Problem

Email/password signup is intentionally non-blocking with respect to email verification. A newly created Firebase password account is authenticated immediately and may use UID-scoped app data while the verification email is still pending.

Garmin wearable-free planning, however, needs a canonical answer to a narrower question: **is this authenticated UID linked to Garmin?** The status endpoint previously reused the same helper policy as Garmin credential linking, so an unverified password account received HTTP 401 before the connection state could be reconciled. The frontend therefore retained `unknown` rather than `disconnected` and failed closed instead of entering subjective-only planning.

## Security decision

The fix is intentionally operation-scoped:

- Firebase ID tokens are still verified server-side with `check_revoked=True` before a UID is accepted.
- `POST /api/garmin/status` may accept an authenticated password session whose `email_verified` claim is false because the UID comes only from the validated token and the operation can only reconcile that UID's Garmin connection state/non-secret mirror.
- Garmin credential binding remains stricter: `POST /api/garmin/login`, when linking to an existing authenticated app user, still requires verified email ownership.
- The shared auth helper remains **verification-required by default**. The status handler must opt out explicitly with `require_verified_email=False`; linking opts in explicitly with `True`. This avoids turning the bug fix into a permissive default for future call sites.
- A missing, malformed, expired, disabled, or revoked Firebase session is still rejected. The wearable-free exception is not anonymous access.

This follows the repository's existing trust model from PR #393: email verification is not a global client-side authorization gate, but capabilities that truly bind an external identity may enforce `email_verified` at the backend boundary.

## Regression coverage

The tests now lock down both sides of the policy boundary:

1. `_verified_uid()` rejects an unverified password user by default.
2. The helper permits that user only when email verification is explicitly not required.
3. `/api/garmin/status` explicitly requests the unverified-safe policy and still checks token revocation.
4. The status endpoint returns the reconciled disconnected state for an authenticated newcomer, enabling wearable-free mode.
5. `/api/garmin/login` continues to request verified-email enforcement.

## External references

- Firebase Authentication — Manage user sessions / revoked ID-token verification: https://firebase.google.com/docs/auth/admin/manage-sessions
- Firebase Authentication — Admin Auth / ID-token verification: https://firebase.google.com/docs/auth/admin
- OWASP Authorization Cheat Sheet — least privilege, deny by default, validate authorization on every request: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

## Review conclusion

Allowing an unverified but authenticated Firebase password account to reconcile its own Garmin connection status is appropriate for wearable-free onboarding. The important constraint is to keep that exception local to status reconciliation and preserve verified-email enforcement as the default for external-account linking or other higher-trust operations.
