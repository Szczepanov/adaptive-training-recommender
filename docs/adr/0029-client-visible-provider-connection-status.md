# ADR-0029: Client-visible provider connection status mirrors

**Status:** Accepted  
**Date:** 2026-08-27

## Context

Provider connection records can contain server-only credentials or identifiers that must not be readable by the web client. Garmin is one example: `garminConnections/{uid}` contains the token-object pointer and identity digest used by backend synchronization, while Coach Preferences only needs to know whether the provider is connected and when the link was established.

Reading the canonical document from the browser would widen the Firestore security boundary. Conversely, showing a connection form without consulting canonical state creates a false-disconnected UX, especially for links created before a client-visible status document existed.

## Decision

For Garmin, keep `garminConnections/{uid}` authoritative and server-only. Project only non-secret connection metadata to:

`users/{uid}/connections/garmin`

The projection contains only:

- `status`
- `identityKind` when available
- `linkedAt`
- `updatedAt`

It must never contain `tokenObject`, `identityDigest`, credentials, session tokens, or provider payloads.

New Garmin links write the canonical record and the client projection in the same Firestore transaction.

Coach Preferences listens to the projection for low-latency UI updates. If the projection is missing or cannot be read, the client calls authenticated `POST /api/garmin/status`. The endpoint verifies the Firebase user ID, reads only that user's canonical Garmin record, and transactionally reconciles the projection. This is a lazy migration path for links that predate the mirror; users do not need to relink.

The reconciliation transaction also deletes a stale active projection when canonical state is absent or not active. Keeping the canonical read and mirror write/delete in one transaction prevents an unlink/relink race from resurrecting stale status.

## Timestamp contract

Backend Firestore writes use server timestamps. Browser Firestore listeners therefore receive `Timestamp` values, not JSON strings. UI code must handle native Firestore `Timestamp` values. The authenticated HTTP fallback serializes `linkedAt` as ISO-8601 JSON.

## Failure semantics

Connection state is tri-state in the UI:

1. connected;
2. disconnected, after canonical verification;
3. unknown, when both mirror observation and canonical verification fail.

An unknown state must not be rendered as disconnected and must not automatically prompt the user to relink, because doing so would recreate the misleading behavior this design is intended to remove.

## Security consequences

- Canonical Garmin token metadata remains server-only.
- The status endpoint requires a valid Firebase ID token and derives the UID from that token; it does not accept an arbitrary UID from the request body.
- The mirror is a deliberately minimal projection and is safe for the existing owner-scoped `users/{uid}/connections/*` read policy.
- The reconciliation function is responsible for an explicit allow-list of projected fields rather than copying the canonical document wholesale.

## Operational consequences

No bulk migration or one-off backfill job is required. Existing linked users are repaired on the first Coach Preferences status check after deployment. New links remain atomic with their mirror write.

## Tests

Regression coverage must verify that:

- an active canonical link backfills the mirror;
- secret canonical fields never enter the mirror;
- a stale mirror is deleted when canonical state is disconnected;
- the status endpoint requires an authenticated app user;
- the frontend accepts both Firestore `Timestamp` and HTTP ISO timestamp representations.
