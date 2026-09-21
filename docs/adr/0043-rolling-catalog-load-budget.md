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
Planned fixed-activity and schedule-overlay expected costs reserve the same horizon envelope
without being reclassified as completed training. Candidate admission charges the exact dose
that the planner will prescribe after automatic modify-tier or time-cap dose reduction rather
than the unreduced authored template.

The rolling envelope tracks all six cost dimensions independently. A pre-existing exceedance
remains visible in budget diagnostics, but it does not by itself veto a candidate with
non-participating contribution in that dimension (candidate cost within 1e-9 floating-point tolerance).
A candidate is rejected when any dimension to which it contributes positive catalog cost (> 1e-9)
has remaining capacity after admission below -1e-9. Zero is structural non-participation subject
only to floating-point tolerance; no non-zero "de minimis" threshold is implied.

The limits are product guardrails over normalized catalog costs. They are not physiological
measurements, medical limits, injury probabilities, or claims of a universal dose-response.
The Physiological Identity Passport is not an owner or input to the budget; it remains the
upstream measurement-trust boundary. A single HRV/readiness value or identity score cannot
increase the budget.

For weekly role allocation, this envelope is a hard feasibility boundary rather than an
anchor-placement preference. The hierarchy is committed fixed/overlay load, hard rolling
envelope, required-role allocation inside remaining capacity, anchor placement, then
ranking preferences. ADR-0018's D-SUPPORT viability proof protects a real required-role
witness within that remaining capacity; it does not bypass the envelope. Extra Recovery
Margin is not a budget-protection switch. A modify-tier dose may legitimately change the
charged candidate cost, but the budget policy and limits remain preference-independent.

## Consequences

- Acute fatigue can decay without replenishing the same fixed forecast envelope.
- A candidate that exceeds the envelope in any dimension to which it contributes positive load (> 1e-9)
  with remaining capacity below -1e-9 is rejected with `LOAD_BUDGET_EXCEEDED` and the planner can
  fall back to recovery work.
- Pre-existing overage in an unrelated dimension does not lock out candidates with non-participating
  cost (<= 1e-9) in that dimension, while diagnostics preserve the full overage state
  (`exceededDimensionsBefore`, `exceededDimensionsAfter`, `blockingDimensions`).
- A candidate scheduled outside the budget horizon is not gated or rejected by the horizon envelope.
- The profile is deterministic and replayable from policy version plus training history.
- The fixed accounting envelope spans all seven future dates. Day 1's already-computed
  provisional recommendation is charged to it but is not re-selected by the planner; generated
  day-2+ candidates are gated against the remaining envelope. A rest day inside the strip does
  not replenish it.
- Numeric limits require prospective calibration before any future relaxation.
- The knowledge registry records the supporting stress–recovery claim and the product-policy
  limitations separately.

The weekly allocator reports a committed-load role miss as `rolling_load_budget`, distinct
from `unresolved_search_budget` when bounded allocation cannot prove a result. See
[ADR-0018](./0018-weekly-allocation-and-role-reservations.md) for reservation, support
viability, movement, and typed-miss semantics.

## Verification

The pure evaluator has unit coverage for personal-baseline derivation, sparse-history fallback,
exact-once occurrence accounting, fixed-horizon semantics and budget rejection. Planner tests
verify that the live gate activates only after stable baseline evidence. The plan judge and
simulation suite remain the behavioral regression layer.
