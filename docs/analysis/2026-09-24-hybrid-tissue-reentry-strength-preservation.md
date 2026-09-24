# Hybrid tissue re-entry and weekly strength preservation

**Date:** 2026-09-24
**Status:** Implemented on the feature branch for review
**Scope:** Cycling-primary hybrid weekly planning after a short local tissue interruption

## Problem

The repository already had the safety pieces needed for a shoulder/back flare:

- #680 / PR #691 aligned strength templates with shoulder/spinal guardrails and added the one-day pending-recheck carry;
- #736 / PR #741 added a low-load `str_low_load_maint_01` / `strength_low_load_trunk_01` fallback and improved preferred-modality behavior.

The remaining failure mode was at the weekly-planning boundary. The low-load fallback is deliberately not one of the exact `evergreen_general:primary_strength` workout identities. That is correct: a reduced symptom-compatible session must not be silently treated as equivalent to the normal full-body strength role.

However, exactness also meant that the fallback received coverage tier 3 even while `primary_strength` was still below its weekly minimum. A safe, preferred Strength session could therefore remain eligible yet repeatedly lose to other covered work. The athlete could see a cycling-only forecast without a clear whole-horizon explanation of whether strength was preserved, blocked, or simply displaced.

## Decision

Keep exact coverage strict and add a separate **degraded support** signal.

When all of the following are true:

1. the active coverage state has an unmet `primary_strength` minimum;
2. the candidate is explicitly marked `guardrailFallbackRole: shoulder_spinal_strength`; and
3. an active `avoid_heavy_spinal_loading` or `avoid_overhead_pressing` guardrail makes that fallback relevant,

the candidate receives **coverage tier 2** for ranking only.

It does not receive `primary_strength` coverage credit, does not fulfill an authored occurrence, and does not clear the weekly shortfall. Exact primary-strength candidates retain tier-1 authority when safe and feasible.

This makes the ordering intentional:

```text
exact required primary strength (tier 1)
    > symptom-compatible strength support (tier 2)
    > unrelated generic/discretionary work (tier 3)
```

Normal safety, readiness, fatigue, time, equipment, spacing, event/taper, rolling-load and daily-ledger gates still run first.

## UI visibility

`WeekAheadStrip` now summarizes primary-strength allocation across the whole forecast horizon. The summary reports how many authored strength roles are planned, blocked, or still unresolved. It is derived directly from `allocationReport`; the UI does not reconstruct coverage from displayed modalities.

This addresses a usability ambiguity: an easy cycling recommendation today can be reasonable while strength is still intentionally reserved later in the week. Conversely, if strength is not schedulable, the athlete sees the typed allocation reason instead of interpreting a row of cycling tiles as an unexplained planner preference.

## Judge coverage

No new persona is added. The existing `cycling_primary_hybrid_advanced` identity is reused in a new targeted family, `persona_hybrid_tissue_reentry`.

The four matched cases hold athlete identity, synthetic 28-day history and weekly commitment constant while changing only the local tissue/re-entry state:

1. active lumbar-loading guardrail with local symptoms;
2. favorable global recovery while the local restriction remains pending re-check;
3. explicit settled state with the temporary restriction removed;
4. stacked spinal + overhead guardrails that require the low-load symptom-compatible fallback.

The start date is moved beyond the most recent synthetic strength exposure so the weekly strength requirement is genuinely open in every case.

Deterministic assertions cover two distinct contracts:

- after the settled state, the planner restores at least one exact `primary_strength` allocation and Strength selection;
- under stacked guardrails, `str_low_load_maint_01` is selected as useful resistance support while exact `primary_strength` remains unfulfilled.

The second assertion is essential: a judge score must never be improved by inventing coverage equivalence.

## Non-goals

This change does **not**:

- diagnose back/shoulder pathology;
- prescribe strength on the current day regardless of symptoms;
- convert the low-load fallback into full primary-strength credit;
- create missed-session catch-up debt;
- weaken the one-day pending-recheck safety gate;
- weaken any hard safety, recovery, load, taper, spacing, equipment or time constraint;
- change imported/external-plan authority;
- infer that favorable HRV/sleep clears a local tissue restriction.

## Policy/replay impact

Candidate ordering can change, so `POLICY_VERSION` is bumped to
`2026-09-symptom-compatible-strength-weekly-support-v1` and the previous version is retained in `HISTORICAL_POLICY_VERSIONS`.

No persistence schema or migration is required.
