# Issue #813 — Stressor and physical-capability exposure ledgers in the Context Brief

| | |
|---|---|
| **Status** | `In progress` — the read-only ledgers and #803 unilateral delivered exposure have shipped; #806 long-aerobic-anchor, tissue-specific families and taper/event suppression remain open |
| **Source** | [issue #813](https://github.com/Szczepanov/adaptive-training-recommender/issues/813) |
| **Behaviour reference** | [`recommendation-engine.md` § Stressor and physical-capability exposure ledgers](../architecture/recommendation-engine.md) |
| **Authority** | Presentation only. No decision-authority constant, no `POLICY_VERSION` change. |

## Shipped

- `contextBriefExposureLedger.ts` `deriveExposureLedger` / `renderExposureLedger`, wired into
  `contextBrief.ts` for `planning` and `diagnostic` purposes (stressor rows with the engine cost
  vector, then capability status rows).
- #809 session cost and stimulus domain are read from the existing reconciliation; a long easy
  (Z2) ride is listed as "high-dose aerobic — not a high-intensity stimulus", never as a quality
  session.
- Capability confirmation consumes canonical owners: #802 `grantsPowerExposureCredit`, #804
  `grantsMechanicalExposureCredit`, #805 `grantsAthleticCapabilityCredit` plus the caller-supplied
  resolved `CapabilityMaintenanceResult` for `overdue`.
- Tests: `contextBriefExposureLedger.test.ts`, including a dedicated long-Z2 test and an
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
    the entry's own stamp. The older `workouts/movementComposition.ts`
    `deriveMovementCompositionEvidence` (tests only today) also trusts step metadata when
    the exercise matches, so it would count pre-stamp entries (before #845). Converge on one
    owner before either drives credit.
  - Tests: `deliveredComposition.test.ts`, the #803 cases in
    `contextBriefExposureLedger.test.ts`, `performedTrainingFactsService.deliveredComposition.test.ts`,
    and the refreshed golden service artifacts.

## Remaining

| Item | State | What is missing |
|---|---|---|
| `long_aerobic_anchor` (#806) | Renders `unknown` | #806 owns a *planning requirement*: `weeklyAerobicDose.ts` `resolveWeeklyAerobicDoseEnvelope` derives `longAnchor` (workout id + minimum duration) from 28-day history. There is no completed-exposure credit helper, and "was a long anchor completed" depends on that athlete-specific per-run duration, which the brief would have to receive as a resolved result from evergreen planning (as #805 does) — and which this export path does not currently carry. Re-deriving it in the ledger would create a second owner of the threshold. **Blocker (2026-10-17):** the clamped duration exists only inside `aerobicPackingForFloor` and is never exposed. The only transport, a runtime-only readout on `Recommendation` beside `capabilityMaintenance`, means an executable change to `rules.ts`, and `check-policy-drift.mjs` then requires a `POLICY_VERSION` bump with no recommendation change behind it. Options are recorded on #813. |
| #803 evidence coverage | Mostly closed | Catalog tagging (2026-10-18): `split_squat`, `reverse_lunge`, `lateral_lunge`, `step_down` and `single_leg_hip_thrust` now carry `unilateral_lower_body`, so their logged sets (including the re-entry strength split-squat step and swaps to them) confirm the row. Unilateral hops stay #804 impact work, and single-leg calf work belongs to the unmodelled calf family. The runner stamp and swap logic now live in pure `sessions/compositionStamping.ts` (`entryCompositionStamp`, `swappedStepComposition`) with unit tests. Manual authoring (2026-10-20): `ManualSessionBuilder` and `sessionDraft.ts` `createDraftAlternative` now copy the chosen catalog exercise's `compositionPatterns` onto steps and alternatives through `compositionStamping.ts` `authoredComposition`. Changing the movement replaces the stamp; a free-text movement stays untagged even when its name matches a catalog exercise; renaming an alternative keeps its stamp. An alternative that does not preserve a component its step names declares an explicit degradation, and editing a template relaxes a required component that no step still evidences (`relaxUnevidencedRequirements`, shared with saving as a template). JSON import (2026-10-21): `SessionJsonImport` now stamps catalog exercise `compositionPatterns` onto steps and alternatives at import through `compositionStamping.ts` (`stampImportedSessionComposition` using `authoredComposition`). Tags the JSON carries itself are kept; free-text movements stay untagged. Alternatives that do not preserve a step's component declare an explicit `degradedComposition`, and `relaxUnevidencedRequirements` relaxes unevidenced required components. The re-entry workout's unloaded warm-up reverse lunge is now tagged too; it stays out only because warm-up blocks pre-tick `isWarmup`, so an athlete who unticks it would confirm the row (athlete-asserted, low risk). Still open: distance-dosed sets (`distance` entries) never count; a catalog session without an authored requirement treats the step's own patterns as required, so a swap now records an unread `degradedComposition`; entries logged before #845 carry no stamp; and the tests-only `workouts/movementComposition.ts` `deriveMovementCompositionEvidence` should converge on `deliveredPatternWork` before either drives credit. |
| Hamstring knee-flexion / calf-soleus / grip-carry | Explicit `unknown`, no exposure date | No issue or canonical model exists. Intentionally never inferred from generic strength. |
| Taper / event-specific suppression | Deferred | Needs design; not represented outside #805. |

## Context Brief contract version decision (#894 D3)

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
