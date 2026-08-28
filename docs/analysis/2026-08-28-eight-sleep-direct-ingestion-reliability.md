# Eight Sleep Direct Ingestion Reliability Follow-up (2026-08-28)

The earlier multisource probe established that Eight Sleep-origin records could appear through Google Health / Health Connect. Subsequent use showed that route is not reliable enough to be the authoritative Eight Sleep acquisition path. Separately, the `mezz64/pyEight` repository behind the initial PR #275 `pyeight` POC was archived on 2026-03-13.

## Conclusion

Use a **direct, read-only Eight Sleep private-API transport** for Eight Sleep observations. Keep Google Health Eight Sleep records only as non-authoritative comparison/fallback evidence. Eight Sleep does not publish a supported public developer API, so this remains an explicitly fragile integration.

Maintained community implementations currently converge on `https://auth-api.8slp.net/v1/tokens`, `https://client-api.8slp.net/v1`, and `GET /users/{userId}/trends`. These are implementation evidence, not an Eight Sleep contract.

## Dependency decision

Active forks are compatibility references, not runtime dependencies. The repository needs only authentication, identity and read-only trends, so owning that small surface makes drift visible and testable.

No community/mobile client credentials are copied into source. Runtime configuration supplies Eight Sleep email/password and client ID/secret through a secret manager/environment. The connector has no bed-control/write methods.

## Semantics

Direct observations use `provider=eight_sleep`, `transport=eight_sleep_direct`. `sleepQualityScore.hrv.current` is mapped as HRV while proprietary `.score` is ignored. Sleeping HR is not mislabeled as daily resting HR. Source-specific baselines remain required before recommendation authority.

## Reliability

A successful response with no target day can be an empty batch. Authentication, HTTP, rate-limit and unrecognized target-schema failures raise so the generic observation reconciler cannot mistake an outage for authoritative absence.

## Rollout

Merge default-off, provision secrets outside Git, run the sanitized probe, collect shadow direct observations, compare direct-vs-Google reliability, then make a separate evidence-backed activation decision. This PR does not alter recommendation policy.
