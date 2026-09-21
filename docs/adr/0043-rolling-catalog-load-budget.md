# ADR-0043 — Individualized rolling catalog-load budget

**Status:** Accepted

## Context

The engine already models acute six-dimensional fatigue and recent hard-session density. A
week-ahead planner can nevertheless recover below a daily threshold and then allocate more
discretionary work later in the same forecast. Longitudinal training-load monitoring and
stress–recovery evidence support tracking accumulated load against an athlete's own history,
but do not establish a universal physiological points scale or weekly ceiling.

## Decision

Add a versioned, user-history-derived catalog-load envelope to week-ahead planning. The
envelope uses the existing six catalog cost dimensions and the seven future forecast dates
beginning tomorrow; today's confirmed recommendation is not retroactively re-gated. With at
least three completed exposures spanning at least fourteen calendar days in the stable
pre-window, limits are derived from the athlete's own forty-two-day baseline with fifteen
percent headroom, subject to explicit product floors. Sparse history leaves this new gate
inactive; existing fatigue, readiness, clinical, injury, schedule and fixed-activity
authorities remain independently in force.

The operational seven-day history remains the authority for fatigue and microcycle bookkeeping.
Week-ahead planning reads a separate forty-nine-day budget snapshot (42-day baseline plus the
excluded recent seven-day window), so chronic calibration does not widen operational history.
Candidate admission charges the exact dose that the planner will prescribe after automatic
modify-tier or time-cap dose reduction rather than the unreduced authored template.

The limits are product guardrails over normalized catalog costs. They are not physiological
measurements, medical limits, injury probabilities, or claims of a universal dose-response.
The Physiological Identity Passport is not an owner or input to the budget; it remains the
upstream measurement-trust boundary. A single HRV/readiness value or identity score cannot
increase the budget.

## Consequences

- Acute fatigue can decay without replenishing the same fixed forecast envelope.
- A candidate that exceeds the envelope is rejected with `LOAD_BUDGET_EXCEEDED` and the planner
  can fall back to recovery work.
- The profile is deterministic and replayable from policy version plus training history.
- All seven future dates in the week-ahead strip are inside the same fixed envelope; a rest
  day inside that strip does not replenish it.
- Numeric limits require prospective calibration before any future relaxation.
- The knowledge registry records the supporting stress–recovery claim and the product-policy
  limitations separately.

## Verification

The pure evaluator has unit coverage for personal-baseline derivation, sparse-history fallback,
exact-once occurrence accounting, fixed-horizon semantics and budget rejection. Planner tests
verify that the live gate activates only after stable baseline evidence. The plan judge and
simulation suite remain the behavioral regression layer.
