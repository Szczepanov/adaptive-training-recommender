# ADR-0045 — Athlete-relative weekly aerobic dose envelope

**Status:** Accepted
**Date:** 2026-09-26
**Related:** ADR-0033, ADR-0044; #757, #758, #802, #806
**Implementation plan:** [Issue #806 — Evidence-backed weekly aerobic dose envelope](../plans/2026-09-26-issue-806-weekly-aerobic-dose.md)

## Context

ADR-0044 defines the shared requirement classes and bounded fulfilment architecture, but
explicitly leaves athlete-relative aerobic-dose formulas to a separate decision. Issue #806
needs that decision without changing exact-role authority, inventing intensity equivalence, or
allowing available schedule time to manufacture training demand.

The engine already has a distinct #757 single-session `aerobic_volume` coverage floor. The
weekly accumulated-dose requirement is a separate contract: it asks how many easy aerobic
minutes should be represented across the week, while #757 asks whether one exact continuous
session is long enough to earn its authored coverage key.

## Decision

### D1 — Use bounded completed history, with a public-health fallback

`resolveWeeklyAerobicDoseEnvelope` uses four fixed seven-day bins from the supplied 28-day
training-history snapshot. Athlete-history semantics require established training evidence and
easy aerobic activity in at least three bins.

When those prerequisites are absent, or when the selected historical maintenance/development
target does not exceed 150 minutes/week, the engine keeps the registered adult-health
150-minute floor, 150-minute initial target and 300-minute upper range.

Availability, current free time and schedule density are not inputs that can raise the
evidence-derived target.

### D2 — Athlete-relative minutes are easy, primary-modality minutes only

When athlete-history semantics are active, only completed easy-endurance / Zone-2-like
continuous work in the dominant evidenced aerobic modality contributes to the weekly envelope.
Threshold, VO2 and other quality minutes are not converted into low-intensity minutes, and no
cross-modality equivalence is inferred.

Under the public-health fallback, actually packed moderate-or-higher aerobic work may
contribute its actual minutes to the general aerobic-health total. No intensity multiplier is
introduced.

### D3 — Resolve floor, target and upper boundary from demonstrated volume

For an active athlete-history envelope:

- floor = max(150 minutes, lower quartile of the four weekly easy-minute totals);
- maintenance target = median of those four totals;
- an endurance or sport-readiness Build/Specificity phase may target the upper quartile;
- target is never below the floor;
- the upper boundary is the demonstrated upper-quartile boundary, never lower than target.

These percentiles are product calibration, not claims of a biological minimum or optimum.

### D4 — Capacity may limit delivery, not rewrite demand

The athlete-relative weekly requirement may use the profile's declared target-session capacity
when its dose cannot fit inside the minimum-session commitment. This is not permission for easy
volume to consume another required adaptation.

Within the required tier, before assigning extra athlete-relative aerobic occurrences, the
packer reserves the full feasible remaining session demand of later co-required required
adaptations. If the target still cannot fit, the aerobic gap remains visible as a typed
shortfall. The engine does not erase a strength floor or another required peer to make the
aerobic number appear satisfied.

The ordinary guideline-fallback path retains the existing minimum-session packing behavior so
#758 short-window quality capacity is not silently redefined by #806.

### D5 — Long aerobic anchor is exact and separately gated

For established endurance or sport-readiness development, at least four primary-modality easy
sessions may nominate one `long_aerobic_anchor`.

Its requested duration is the 75th-percentile historical session duration, bounded by the
matching allocator-executable standard engine-template ceiling and reconciled with the #757
single-session floor during packing. One exact qualifying session must meet the duration;
multiple shorter sessions cannot combine to satisfy it.

The anchor is suspended by adverse recovery, current clinical symptoms, taper/post-event
recovery, or lack of a safe schedule window. Failure to place it produces a typed shortfall
instead of silently weakening the exact role.

### D6 — Completed and planned duration authority remain distinct

Completed history receives duration credit from performed `durationMin` only. A legacy
completed record carrying a stale prescription `durationMax` does not become planned work and
cannot inflate anchor or #757 coverage.

Only explicitly projected/fixed planned exposures may use the upper bound of their prescribed
range for forward coverage reasoning.

### D7 — Knowledge lineage and policy version are mandatory

The product calibration is owned by
`KNOWLEDGE_CLAIM_IDS.weeklyAerobicDoseEnvelopePolicy`, is inventoried in
`knowledgeCoverage.ts`, and is pinned by policy-alignment tests. Consumers reference the
registered constant rather than duplicating the claim-id literal.

Because this policy can change persisted recommendations, the implementation uses
`POLICY_VERSION = 2026-09-weekly-aerobic-dose-envelope-v1` and retains the previous version
in policy history.

## Consequences

- Recent training can maintain or modestly develop demonstrated easy-aerobic volume without
  simply copying the previous week.
- More available time alone cannot create a higher dose target.
- Cycling-primary athletes keep modality specificity when history supports it.
- Required strength or other co-required capability floors remain explicit when aerobic demand
  expands.
- Insufficient capacity is represented as shortfall evidence rather than hidden by substitution.
- The long anchor remains an exact-role durability exposure rather than an accumulated-minute
  accounting trick.

## Non-decisions

This ADR does not define a universal optimal weekly endurance volume, threshold-to-Z2 exchange
rate, partial exact-role credit, new physiological load model, or universal long-session
minimum. It does not supersede safety/readiness, rolling-load, injury/tissue, event, or schedule
authorities.

## Verification

The implementation is accepted only with deterministic coverage for sparse history,
sub-guideline complete history, maintenance/development envelopes, modality specificity,
no-free-time target increase, completed-versus-projected duration authority, long-anchor
packing/shortfall, adverse-state suspension, co-required floor preservation, knowledge-policy
alignment, repository verification and persona/simulation regression gates.
