# Issue #813 — Stressor and physical-capability exposure ledgers in the Context Brief

| | |
|---|---|
| **Status** | `In progress` — the read-only ledgers have shipped; #803 unilateral, #806 long-aerobic-anchor, tissue-specific families and taper/event suppression remain open |
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

## Remaining

| Item | State | What is missing |
|---|---|---|
| `unilateral_lower_body` (#803) | Renders `unknown` ("no canonical exposure model yet") | #803 ships an *authored composition* contract (`sessions/movementCompositionContract.ts`, `workouts/movementComposition.ts`) that is documented as structured movement roles only that do not imply dose or stimulus credit. Canonical performed facts (`PerformedExposureFact`) carry no composition or delivered-step evidence and there is no `grants…Credit` helper for unilateral work. Wiring needs an owner decision on what counts as a delivered unilateral exposure (retained steps, dose floor) — a policy decision, not presentation. |
| `long_aerobic_anchor` (#806) | Renders `unknown` | #806 owns a *planning requirement*: `weeklyAerobicDose.ts` `resolveWeeklyAerobicDoseEnvelope` derives `longAnchor` (workout id + minimum duration) from 28-day history. There is no completed-exposure credit helper, and "was a long anchor completed" depends on that athlete-specific per-run duration, which the brief would have to receive as a resolved result from evergreen planning (as #805 does) — and which this export path does not currently carry. Re-deriving it in the ledger would create a second owner of the threshold. |
| Hamstring knee-flexion / calf-soleus / grip-carry | Explicit `unknown`, no exposure date | No issue or canonical model exists. Intentionally never inferred from generic strength. |
| Taper / event-specific suppression | Deferred | Needs design; not represented outside #805. |

## Context Brief contract version decision (#894 D3)

`CONTEXT_BRIEF_CONTRACT_VERSION` stays `2026-10-context-brief-contract-v7`. #894 (D3 and its
contract-change risk mitigation) requires an explicit contract-version decision when required
fields or the semantic meaning of a contract field change. The
#813 completion slice changes no rendered output and no field semantics (tests and
documentation only), so no bump. Wiring #803/#806 later changes the status of two existing
capability rows from permanently `unknown` to evidence-backed values; that change must make
the same decision again at that time.
