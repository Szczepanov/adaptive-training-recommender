# Server-authoritative anthropometry writes — implementation plan

**Status:** Implemented — implementation and deployment verification recorded 2026-09-17
**Blocked by:** none; ADR-0040 is Accepted
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
and focused backend/frontend tests. Completion was verified on 2026-09-17 with 47 focused
backend tests, 51 focused frontend tests, the full frontend gate, and the successful [production
release workflow](https://github.com/Szczepanov/adaptive-training-recommender/actions/runs/35249005688)
at commit `a9d6ccbe`. That release completed the full CI gate, Garmin backend, Firestore indexes,
Firestore rules, and Firebase Hosting jobs. The Hosting deployment's anthropometry rewrite smoke
check passed with the expected authenticated-API 404 contract; direct client writes remain denied
by Rules. Recommendation authority remains zero.
