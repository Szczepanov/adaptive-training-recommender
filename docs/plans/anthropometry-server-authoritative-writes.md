# Server-authoritative anthropometry writes — implementation plan

**Status:** In progress — implementation landed in PR #572; completion/deployment verification remains
**Blocked by:** deployment and delivery-contract verification; ADR-0040 is Accepted
**Unlocks:** reliable ten-measurement saves without Firestore Rules expression-budget failures
**Decision:** [ADR-0040](../adr/0040-server-authoritative-anthropometry-writes.md)

## Delivery contract

1. Preserve owner-scoped direct Firestore reads; close every direct client mutation in
   `firestore.rules` and prove create, update, and delete fail in the emulator.
2. Add a dedicated Python Cloud Run API that verifies Firebase ID tokens with revocation checks,
   derives the document path from the verified UID, accepts only bounded JSON, and never logs raw
   values.
3. Move full protocol validation, Warsaw-date semantics, canonicalization, revision checks, and
   server-generated timestamps to the trusted write path. Validate server responses again in the
   browser before use.
4. Keep client validation as a fast UX check, but replace every anthropometry Firestore mutation
   with authenticated same-origin API calls and safe structured errors.
5. Deploy the API before the fail-closed Rules and Hosting rewrite. Use a dedicated runtime service
   account with `roles/datastore.user` plus a custom Firebase Auth `users.get` verifier role for
   revoked-token checks, add its explicit deploy impersonation binding, and grant the Hosting
   deployer only per-service viewer access.
6. Verify focused backend/unit tests, frontend mutation tests, Rules emulator tests, repository
   static gates, Docker Compose configuration, then the full repository check.

## Completion record

The implementation landed in PR #572, including the authenticated Cloud Run write API,
server/client conformance validation, fail-closed Rules, emulator coverage, deployment wiring,
and focused backend/frontend tests. The plan remains open until the deployment and full
delivery-contract verification evidence is recorded here.
