# Implementation Plans

Plans describe **how a change gets made**. They are mutable working documents with a
status lifecycle, and they are expected to go stale — that is what `Superseded` and
`Archived` are for.

This is deliberately different from [`docs/adr/`](../adr/), which records **what was
decided and why** and is immutable once accepted (ADR-0001). If a plan proposes a
decision, that decision belongs in an ADR; the plan references it.

```text
docs/analysis/   point-in-time audits    "what is true today"    dated, never edited
docs/adr/        decisions               "what we chose, why"    immutable once accepted
docs/plans/      execution               "how we get there"      mutable, status-tracked
docs/architecture/  living reference     "how it works now"      updated with the code
```

---

## Status lifecycle

| Status | Meaning |
|---|---|
| `Draft` | Being written; not agreed. |
| `Ready` | Agreed and actionable. Preconditions listed are met. |
| `In progress` | Work started. |
| `Implemented` | Delivered. Retained for the reasoning, not as instructions. |
| `Superseded` | Replaced by a later plan (link it). |
| `Archived` | No longer pursued. Say why. |

Every plan carries `Status`, `Depends on`, and `Unlocks` in its header so the ordering is
readable without opening all of them.

---

## Current plans

These implement the way forward in
[`docs/analysis/2026-08-08-architecture-review.md`](../analysis/2026-08-08-architecture-review.md)
§7.5. Finding IDs (`F1`, `F16`, …) refer to that document.

All six are **`Ready`** as of 2026-08-08 — every open choice has been decided and recorded
in the register below.

| # | Plan | Status | Addresses |
|---|---|---|---|
| 0 | [Instrumentation & developer baseline](./phase-0-instrumentation.md) | Ready | F11, F14, F15, part of F10 |
| 1 | [Live defects](./phase-1-live-defects.md) | Ready | F1, F2, F6 |
| 2 | [Plan intent is the planning authority](./phase-2-plan-intent-authority.md) | Ready | F16, F17, F9 |
| 3 | [One ranking path](./phase-3-single-ranking-path.md) | Ready | F3, F4, F5 |
| 4 | [Objective credit V2](./phase-4-objective-credit-v2.md) | Ready | F7, F8, F12 |
| 5 | [Sequence planning](./phase-5-sequence-planning.md) | Ready | the cutover proper |

**Phase 0 must land before Phases 3–5.** It builds the only instrument that can tell
whether a heuristic change improved or degraded the plan. Phase 1 is independent of the
rest and should not wait for architectural agreement. Phase 5 is `Ready` as a *sequenced
destination* — see its increment order; it is not the next thing to build.

---

## Decision register

Choices resolved when the plans were approved. Each is argued at the linked location;
this table exists so none of them has to be rediscovered by reading six documents.

| ID | Decision | Where | One-line reason |
|---|---|---|---|
| **D-INJ** | Structured `InjuryConstraint` (Option B), not consolidation onto guardrails (Option A) | [1.1](./phase-1-live-defects.md#two-options-and-the-decision) | Guardrails cannot express a modality exclusion, cannot expire, and Phase 5.4 needs the schema anyway |
| **D-KWD** | The keyword matcher is legacy last-resort only; recognised Garmin sessions get an inferred vector | [1.2](./phase-1-live-defects.md) | Routing to it trades a false negative for double credit on one ride |
| **D-GATE** | Coaching invariants gate CI; the simulation snapshot is a non-blocking semantic diff | [0.1](./phase-0-instrumentation.md) | A byte-exact gate would freeze today's known-bad behaviour and make every improvement look like a regression |
| **D-PHASE** | `EventPlanPhase` is the canonical phase vocabulary; `PhaseWeights.phaseName` becomes a derived label | [2.1 D1](./phase-2-plan-intent-authority.md) | It is what a coach actually names, and it can express `travel`, which days-to-event structurally cannot |
| **D-INT** | `intensityScale` gets a consumer (`PlannedDose.intensity`), it is not deleted | [2.1 D2](./phase-2-plan-intent-authority.md) | Taper is volume down / intensity held; collapsing both into one scalar is why taper has to be reconstructed elsewhere |
| **D-LEX** | Lexicographic priority ordering replaces multiplicative composition | [3.2](./phase-3-single-ranking-path.md) | F3 is the proof: two reasonable multipliers composed into a policy nobody chose |
| **D-TIER** | Build the next-day tier selector; do not settle for a `yellow` default | [3.4](./phase-3-single-ranking-path.md) | All three branches are already computed and paid for; only the control is missing |
| **D-AXES** | Delete the `*0.8` / `*0.7` stimulus derivations; templates declare the axes | [4.2](./phase-4-objective-credit-v2.md) | No citation can justify a repository-wide fixed ratio between per-session properties |
| **D-FUSE** | Fatigue fusion is *measured before chosen*, not prescribed now | [4.3](./phase-4-objective-credit-v2.md) | Prescribing a formula here would repeat exactly the uncited-constant practice F11 criticises |
| **D-BEAM** | Beam search is approved to be **built and measured**, not to be shipped regardless of result | [5 increment order](./phase-5-sequence-planning.md) | Whether it beats greedy is empirical; "it didn't" is a valid, useful outcome |

Two of these (**D-KWD**, **D-GATE**) correct errors in the first draft of the plans and
came out of the PR #5 review.

### Archived

* [Workout library expansion](./0000-workout-library-expansion.md) — `Implemented`
  2026-08-07. Retained because §1.2 is still the fullest written description of the
  two selection paths; its line references are stale (see F9).

---

## Writing a plan

Keep them executable. A plan that cannot be picked up by someone who did not write it is
not finished. Each should have:

1. **Goal** — one or two sentences, no preamble.
2. **Preconditions** — what must be true before starting.
3. **Work items** — numbered, each naming real files and a concrete change.
4. **Tests to add** — named, with the behaviour asserted.
5. **Acceptance criteria** — a checklist that can be verified, not described.
6. **Risks & rollback** — including what to do if the change is wrong.
7. **Out of scope** — the adjacent work this plan deliberately does not do.
8. **Docs to update** — ADRs to write or amend, architecture docs to correct.

Prefer to state the smallest change that closes the finding. Where a plan proposes both a
tactical fix and a structural one, say which unblocks work now and which is the
destination.
