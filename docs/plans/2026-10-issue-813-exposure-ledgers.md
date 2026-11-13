# Issue #813 — Stressor and physical-capability exposure ledgers in the Context Brief

| | |
|---|---|
| **Status** | `Implemented` — read-only ledgers and #803 unilateral delivered exposure (including `distance` working sets) shipped; remaining items closed by owner decision on 2026-11-13 |
| **Source** | [issue #813](https://github.com/Szczepanov/adaptive-training-recommender/issues/813) |
| **Behaviour reference** | [`recommendation-engine.md` § Stressor and physical-capability exposure ledgers](../architecture/recommendation-engine.md) |
| **Authority** | Presentation only. No decision-authority constant, no `POLICY_VERSION` change. |

## Shipped

- `engine/contextBriefExposureLedger.ts` `deriveExposureLedger` / `renderExposureLedger`, wired into
  `engine/contextBrief.ts` for `planning` and `diagnostic` purposes (stressor rows with the engine cost
  vector, then capability status rows), composing the engine-free capability-fact core in
  `derived/exposure/capabilityExposure.ts` (`CAPABILITY_FACT_SPECS`,
  `deriveCapabilityFactEvidence`, #1144 PR1-10).
- #809 session cost and stimulus domain are read from the existing reconciliation; a long easy
  (Z2) ride is listed as "high-dose aerobic — not a high-intensity stimulus", never as a quality
  session.
- Capability confirmation consumes canonical owners: #802 `grantsPowerExposureCredit`, #804
  `grantsMechanicalExposureCredit`, #805 `grantsAthleticCapabilityCredit` plus the caller-supplied
  resolved `CapabilityMaintenanceResult` for `overdue`.
- Tests: `engine/contextBriefExposureLedger.test.ts`,
  `engine/contextBriefExposureLedger.characterization.test.ts`, and
  `derived/exposure/capabilityExposure.test.ts`, including a dedicated long-Z2 test and an
  explicit-`unknown` test for the unmodelled families.

- #803 unilateral lower-body (owner decision 2026-10-17, recorded on #813):
  `sessions/deliveredComposition.ts` `deliveredPatternWork` counts the logged working sets
  whose entries carry `unilateral_lower_body`. `performedTrainingFactsService` attaches the
  count as export-only `deliveredUnilateralLowerBody`, or `deliveredCompositionUnavailable`
  when the entries can't be read. It does this only under `includeDisplayProvenance` plus
  `includeDeliveredComposition`, which `ContextBriefService` sets for planning and diagnostic
  but not morning (morning renders no ledger). So decision snapshots and hashes are
  unchanged. The ledger confirms the row from that
  evidence. Garmin records, imported-plan titles and authored-but-unlogged steps never
  confirm or plan it.
  - This is a reporting rule with no decision authority. It owns no threshold or cadence,
    and no engine path reads it, so no knowledge claim, coverage item or alignment test is
    added (ADR-0033 applies to decision-authority rules).
  - `deliveredPatternWork` is the canonical "delivered" reading for this row. It trusts only
    the entry's own stamp. `workouts/movementComposition.ts`
    `deriveMovementCompositionEvidence` (tests only today) delegates its `performed`
    status to `deliveredPatternWork` and shares its `isWorkingEntry` predicate (2026-10-24,
    extended to `distance` entries with `meters > 0` on 2026-11-13):
    authored step metadata never credits a set, so pre-#845 unstamped, warm-up-only and
    zero-distance logs report `unknown`, and deleted sets carry no evidence. A declared
    `degradedComposition` still reports `degraded` on any logged set.
  - Tests: `deliveredComposition.test.ts`, `sessions/movementComposition.test.ts`, the #803 cases in
    `contextBriefExposureLedger.test.ts`, `performedTrainingFactsService.deliveredComposition.test.ts`,
    and the refreshed golden service artifacts.

## Closure decisions (2026-11-13)

| Item | Resolution | Rationale / disposition |
|---|---|---|
| Distance-dosed working entries (`kind: 'distance'`) | **Implemented** (2026-11-13) | `isWorkingEntry` in `sessions/deliveredComposition.ts` now counts non-deleted `distance` entries with `meters > 0` alongside `repetition` (`reps > 0`, `!isWarmup`), `duration` (`seconds > 0`), and `checkoff` (`completed`), so `deliveredPatternWork` and `deriveMovementCompositionEvidence` credit stamped distance sets (e.g. walking lunges). |
| Step-level `degradedComposition` on catalog swaps | **Closed — intentionally unread** (2026-11-13) | Step-level `degradedComposition` recorded on a catalog swap remains intentionally unread by the brief because delivered exposure trusts only the logged entry's own `compositionPatterns` stamp (`entryCompositionStamp` / `swappedStepComposition`). |
| `long_aerobic_anchor` (#806) | **Parked under ADR-0052 (`#962`)** | #806 owns an engine-authority planning requirement (`weeklyAerobicDose.ts` `resolveWeeklyAerobicDoseEnvelope`). Engine-authority features are parked under ADR-0052 (`#962`), so the row stays explicit `unknown` without a `rules.ts` / `POLICY_VERSION` change. |
| Taper / event-specific suppression | **Parked under ADR-0052 (`#962`)** | Engine-authority suppression outside `#805`; parked under ADR-0052 (`#962`). |
| Hamstring knee-flexion / calf-soleus / grip-carry | **Closed — explicit `unknown` by design** | No canonical model exists; intentionally never inferred from generic strength. |

## Context Brief contract version decision (#894 D3)

**2026-11-13 (#813 `distance` working entries):** counting `kind: 'distance'` (`meters > 0`) in `deliveredPatternWork` leaves the rendered Context Brief format and `unilateral_lower_body` field semantics unchanged, so `CONTEXT_BRIEF_CONTRACT_VERSION` stays unchanged.

**v9 (2026-10-17, #803):** the unilateral lower-body row changes from permanently `unknown`
to evidence-backed `confirmed`, the explanatory paragraph changes, and the row moves next to
strength. Rendered output and row semantics change, so `CONTEXT_BRIEF_CONTRACT_VERSION` is
bumped from v8 to v9. Wiring #806 later will need its own decision.

Earlier decision for the completion slice (superseded by v8 for #941 and v9 above):

`CONTEXT_BRIEF_CONTRACT_VERSION` stayed `2026-10-context-brief-contract-v7`. #894 (D3 and its
contract-change risk mitigation) requires an explicit contract-version decision when required
fields or the semantic meaning of a contract field change. The
#813 completion slice changes no rendered output and no field semantics (tests and
documentation only), so no bump. Wiring #803/#806 later changes the status of two existing
capability rows from permanently `unknown` to evidence-backed values; that change must make
the same decision again at that time.
