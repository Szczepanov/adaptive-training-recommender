# ADR-0030: Direct Read-Only Eight Sleep Private-API Transport

* **Status:** Proposed
* **Date:** 2026-08-28
* **Deciders:** Core Engineering Team

## Context
ADR-0027 separates provider from transport. Google Health Eight Sleep data was observed but later proved unreliable as authoritative acquisition. Eight Sleep has no supported public developer API and the initial PR #275 used an archived `pyeight` lineage.

## Decision
- **D-8S-DIRECT:** prefer direct read-only ingestion as `provider=eight_sleep`, `transport=eight_sleep_direct`; Google Health remains comparison/fallback evidence only.
- **D-8S-OWN:** own the minimal private protocol instead of taking a community reverse-engineering client as a runtime dependency.
- **D-8S-SECRETS:** copy no mobile/community client credentials; use secure runtime client ID/secret and user credentials.
- **D-8S-READONLY:** auth, identity and recovery trends only; no bed-control writes.
- **D-8S-FAIL-CLOSED:** auth/HTTP/rate-limit/schema failures raise and preserve prior observations; only successful no-target-day responses may reconcile empty.
- **D-8S-NO-AUTHORITY:** ingestion is observation-only; no recommendation/fusion change without source baselines and prospective evidence under ADR-0027.

## Consequences
This removes Google Health from the Eight Sleep critical path and isolates drift behind a small tested adapter, but the private API can still break without notice and requires monitored secure credentials.
