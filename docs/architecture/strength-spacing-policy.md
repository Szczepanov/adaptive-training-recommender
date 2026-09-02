# Canonical strength spacing policy

**Status:** implemented by ADR-0034 PR2 (`feat/canonical-strength-spacing`)

## Purpose

Prevent the automatic recommender from scheduling another broad full-/lower-body strength session immediately after strength that has already been performed, even when the prior session came from a generic provider activity and therefore cannot receive exact weekly-role credit.

This policy is deliberately separate from weekly coverage semantics:

- **Occurrence fact:** did strength happen? Canonical `PerformedExposureFact` is authoritative in the live recommendation path.
- **Exact role credit:** did the performed session satisfy a specific authored full-body/strength role? That remains a separate semantic-identity decision and is not inferred from generic provider strength.
- **Fatigue/microcycle history:** remains on the existing reconstructed-history path in PR2; later ADR-0034 cutovers migrate those consumers independently.

## Spacing authority

`strengthSpacingPolicy.ts` does **not** define a universal sports-science recovery constant. The candidate supplies its existing planner/workout spacing rule through `resolveMinimumDaysAfterHardLowerBody`; the existing planner fallback remains two athlete-local calendar days where no workout-specific value is defined.

The policy compares athlete-local calendar dates with `getDayDiff`. Therefore a two-day gap means date `D` to date `D+2`; it must not be described as proof that 48 elapsed hours have passed.

This is a conservative product/programming rule, not a claim that every resistance-training session physiologically requires the same recovery interval. Resistance-training frequency recommendations are highly dependent on total volume, training status, exercise selection, goals, and how weekly work is distributed. The purpose here is deterministic duplicate-strength suppression and recovery-aware scheduling using existing planner metadata.

## Candidate behavior

For an automatic recommendation:

1. Any strength occurrence already recorded on the target local date blocks a second automatic strength recommendation on that date (`SAME_DAY_STRENGTH_VIOLATION`).
2. On a later date, an explicitly upper-body-only candidate is the recovery-safe exception.
3. A proven prior upper-body-only exposure does not by itself suppress a fresh broad/full/lower-body candidate.
4. Generic or broad strength is treated conservatively as broad strength for spacing because exact anatomy is unknown.
5. For broad/full/lower candidates, the nearest relevant non-upper strength exposure is compared with the candidate's configured minimum local-day gap. An intervening upper-body session cannot hide an earlier broad exposure that is still inside a longer configured gap.
6. Cycling/running/non-strength candidates are unchanged by this policy.

## Canonical vs projected history

The live recommendation path reads `getPerformedTrainingFactsInRange(...)` and passes canonical exposures into optimizer spacing.

Forecasts intentionally differ. Tomorrow/week projections may inject a hypothetical completion (for example, “assume today's recommendation was completed”) through the existing synthetic `TrainingHistoryProvider`. Because that future occurrence does not yet exist in canonical storage, the spacing gate falls back to that projected history at the simulation boundary.

An explicitly supplied canonical exposure array, including `[]`, is authoritative and must not silently fall back to legacy history. This prevents a dual-read mismatch from resurrecting a legacy strength inference after canonical facts say there was no canonical exposure.

## Incident acceptance case

Given a canonical Strength occurrence on **2026-09-01**, the **2026-09-02** recommender must not choose reduced/full-body or lower-body strength solely because the weekly strength role still appears unfulfilled. Generic Garmin strength can therefore suppress an unsafe/undesired next-day duplicate without falsely claiming exact full-body role completion.

## Test coverage

The regression suite covers:

- Garmin-only strength on `D` suppressing broad strength on `D+1`;
- app-logged structured strength doing the same;
- canonical generic Strength exposure from the reported 77-minute Garmin fixture;
- same-day duplicate strength suppression;
- upper-body-only later-date exception;
- candidate-specific one-day overrides;
- configured longer gaps with interleaved upper-body work;
- canonical `[]` remaining authoritative over conflicting legacy recent strength;
- non-strength candidates remaining unaffected.

## Evidence interpretation

The implementation intentionally avoids encoding a new evidence-derived 48-hour rule. The 2026 ACSM resistance-training position stand synthesizes a large evidence base and emphasizes that prescription depends on goals and training variables rather than one universal interval. Cycling-specific evidence supports retaining strength training but does not establish a single optimal session spacing for all cyclists. Frequency meta-analyses also indicate that much of the apparent frequency effect is explained by how weekly volume is distributed.

Useful background:

- ACSM Position Stand, 2026: https://pubmed.ncbi.nlm.nih.gov/41843416/
- Llanos-Lagos et al., cycling heavy-strength meta-analysis, 2026: https://pubmed.ncbi.nlm.nih.gov/40632222/
- Grgic et al., resistance-training frequency meta-analysis, 2018: https://pubmed.ncbi.nlm.nih.gov/29470825/

The engineering rule should therefore stay configurable, explicit about calendar-date semantics, and subordinate to safety/readiness/tissue gates rather than being presented as a universal physiological law.
