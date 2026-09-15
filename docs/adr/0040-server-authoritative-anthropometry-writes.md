# ADR-0040: Server-Authoritative Anthropometry Writes

* **Status:** Accepted
* **Date:** 2026-09-15
* **Deciders:** Repository owner
* **Supersedes:** ADR-0039 D-BC-PERSIST's direct-client Firestore write mechanism only
* **Implementation plan:** [Server-authoritative anthropometry writes](../plans/anthropometry-server-authoritative-writes.md)

## Context

ADR-0039 made `users/{userId}/anthropometry_entries/{entryId}` a user-owned, mutable
observation collection. Its original Firestore Rules implementation validated every member of a
bounded ten-measurement payload. A valid maximum payload exhausts Firestore's 1,000 expression
evaluation ceiling, so legitimate client writes fail before a useful protocol verdict can be
returned.

Reducing the Rules contract enough to fit the budget would let a direct SDK client bypass the
measurement protocol. Client-side validation is useful for feedback but cannot be an authorization
boundary, because any authenticated client can call Firestore directly.

## Decision

### D-SAW-AUTH — a verified server is the sole mutation authority

Firestore Rules continue to allow an owner to read their own entries and deny every direct SDK
create, update, and delete. The browser sends mutations to same-origin
`/api/anthropometry/entries` endpoints instead. The Cloud Run handler verifies a Firebase ID token
with revocation checks and derives the Firestore user path from that verified UID; no client-supplied
UID can select another user's document.

The service uses a dedicated runtime service account with only Firestore data access plus the
single Firebase Auth user-read permission required to enforce revoked-token checks. It is publicly
invokable solely so Firebase Hosting can proxy browser traffic; every mutation remains
application-token authenticated in the handler.

### D-SAW-VALIDATE — validate and canonicalize before persistence

The trusted service validates the complete `home_anthropometry@1` contract before writing:

- exact entry/context/measurement field sets and bounded payload size;
- Europe/Warsaw date consistency for `observedAt`;
- metric, unit, laterality, bounds, reading count, repeatability and median semantics;
- duplicate series rejection;
- path/id and verified-UID/user identity consistency.

It canonicalizes persisted protocol values, sets create/update timestamps from server time, and
uses a Firestore transaction to protect correction revisions and immutable `createdAt`. Validation
and API errors expose only structural field paths, never measurements.

### D-SAW-AVAILABILITY — explicit online mutation boundary

Anthropometry reads remain owner-scoped direct Firestore reads. New, corrected, and deleted
measurements require a reachable write API and a current Firebase session. The UI preserves local
validation for immediate feedback and reports a safe retryable connectivity failure when the API is
unreachable; it must not queue an unauthenticated or unvalidated Firestore mutation offline.

### D-SAW-NOAUTHORITY — recommendation isolation remains unchanged

This changes storage authority only. Anthropometry, body mass, and hunger remain observation-only
under ADR-0039 D-BC-AUTH. No recommendation inputs, analytics payloads, raw error logging, or
`POLICY_VERSION` change are introduced.

## Consequences

The ten-element Rules expression failure is eliminated, and a direct Firestore client can no longer
poison persisted anthropometry rows. The validation cost moves to a testable application boundary
with explicit revision conflicts and server timestamps.

This adds a Cloud Run availability dependency to anthropometry mutations and a small operational
surface (Hosting rewrite, deployment, and service account). Routine releases deploy the API before
Rules and Hosting, so the UI is not exposed until its mutation authority exists.

Any future expansion of write routes, input fields, rate limits, or application-attestation policy
must preserve verified-UID ownership and no-raw-value telemetry. Recommendation authority still
requires the separate evidence and activation decision mandated by ADR-0039.
