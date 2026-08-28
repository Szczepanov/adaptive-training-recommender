# ES — Direct Eight Sleep Recovery Ingestion

* **Status:** `In progress (default-off)`
* **Date:** 2026-08-28
* **Blocked by:** runtime secret provisioning + real-account probe for operational activation.
* **Decision authority:** none.
* **Governing ADRs:** ADR-0027 and proposed ADR-0030.

## Goal
Replace unreliable Google Health transport for Eight Sleep with a repository-owned read-only connector emitting existing `CanonicalHealthObservation`s.

| Item | Work | State |
|---|---|---|
| ES0 | Remove archived `pyeight` dependency | implemented in PR #275 |
| ES1 | Explicit secret/config contract, default off | implemented |
| ES2 | Minimal auth/user/trends client | implemented |
| ES3 | Source-aware mapper | implemented |
| ES4 | `RecoveryObservationProvider` adapter | implemented |
| ES5 | Fail-closed transport/schema semantics | implemented |
| ES6 | Sanitized local probe | implemented |
| ES7 | Unit tests | implemented |
| ES8 | Provision secrets + run real-account probe | operational |
| ES9 | Shadow direct-vs-Google comparison | blocked by ES8/history |
| ES10 | Baseline/fusion activation decision | blocked by prospective evidence |

Runtime config: `EIGHT_SLEEP_DIRECT_ENABLED=false`, `EIGHT_SLEEP_EMAIL`, `EIGHT_SLEEP_PASSWORD`, `EIGHT_SLEEP_CLIENT_ID`, `EIGHT_SLEEP_CLIENT_SECRET`, optional `EIGHT_SLEEP_USER_ID`, timezone/retry/timeout overrides. Do not commit values.

Probe: `EIGHT_SLEEP_DIRECT_ENABLED=true python -m garmin_sync.eight_sleep_probe --date YYYY-MM-DD`.

Promotion requires stable real-account auth/schema, source-specific baseline maturity, better reliability than Google Health, replay/prospective evidence and a separate activation review. Rollback is simply `EIGHT_SLEEP_DIRECT_ENABLED=false`; Garmin/recommendation behavior is unchanged.
