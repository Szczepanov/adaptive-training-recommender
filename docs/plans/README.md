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

Status answers **"is the design agreed?"** — separately from **"can work start now?"**,
which is what `Blocked by` answers. Conflating the two made the table unusable: an earlier
revision marked all six phases `Ready` while four of them depended on phases that had not
landed.

| Status | Meaning |
|---|---|
| `Draft` | Being written; design not agreed. |
| `Approved` | Design agreed and decisions taken. **May still be blocked** — check `Blocked by`. |
| `Ready` | Approved **and** every dependency has landed. Work can start today. |
| `In progress` | Work started. |
| `Implemented` | Delivered. Retained for the reasoning, not as instructions. |
| `Superseded` | Replaced by a later plan (link it). |
| `Archived` | No longer pursued. Say why. |

`Approved → Ready` is a mechanical transition: it happens when the last blocker lands, and
requires no new decision.

Every plan carries `Status`, `Blocked by`, and `Unlocks` in its header. **Dependencies are
declared per work item, not only per phase** — a phase can be part-startable, and saying
"depends on nothing" at the header while an individual item requires the Phase-0 harness is
how a plan stops being executable.

---

## Current plans

These implement the way forward in
[`docs/analysis/2026-08-08-architecture-review.md`](../analysis/2026-08-08-architecture-review.md)
§7.5. Finding IDs (`F1`, `F16`, …) refer to that document.

All six are **design-approved** as of 2026-08-08 — every open choice is decided and
recorded in the register below. Only two can be *started* today.

| # | Plan | Status | Blocked by | Addresses |
|---|---|---|---|---|
| 0 | [Instrumentation & developer baseline](./phase-0-instrumentation.md) | **Ready** | — | F11, F14, F15, part of F10 |
| 1 | [Live defects](./phase-1-live-defects.md) | **Ready** (1.1, 1.3) / Approved (1.2) | 1.2 needs Phase 0 | F1, F2, F6 |
| 2 | [Plan intent is the planning authority](./phase-2-plan-intent-authority.md) | Approved | Phase 1 | F16, F17, F9 |
| 3 | [One ranking path](./phase-3-single-ranking-path.md) | Approved | Phase 0, ADR-0012 (Phase 2) | F3, F4, F5 |
| 4 | [Objective credit V2](./phase-4-objective-credit-v2.md) | Approved | Phase 0, Phase 2 | F7, F8, F12 |
| 5 | [Sequence planning](./phase-5-sequence-planning.md) | Approved | Phases 0–4 | the cutover proper |

**Start here: Phase 0, and Phase 1 items 1.1 and 1.3.** Those three are unblocked today.

**Phase 0 gates Phases 3–5 and Phase 1.2.** It builds the only instrument that can tell
whether a heuristic change improved or degraded the plan — so any item that changes
decision behaviour needs it first. Phase 1.2 changes objective crediting for every
existing user, which is exactly that category, despite the rest of Phase 1 being
independent.

Phase 5 is approved as a *sequenced destination* (see its increment order), not as the
next thing to build — and 5.1 specifically is approved to be **measured**, not shipped
unconditionally.

---

## Decision register

Choices resolved when the plans were approved. Each is argued at the linked location;
this table exists so none of them has to be rediscovered by reading six documents.

| ID | Decision | Where | One-line reason |
|---|---|---|---|
| **D-INJ** | Structured `InjuryConstraint[]` (Option B), not consolidation onto guardrails (Option A) | [1.1](./phase-1-live-defects.md#two-options-and-the-decision) | Guardrails cannot express a modality exclusion, cannot expire, and Phase 5.4 needs the schema anyway |
| **D-KWD** | The keyword matcher is legacy last-resort only; recognised Garmin sessions get an inferred vector | [1.2](./phase-1-live-defects.md) | Routing to it trades a false negative for double credit on one ride |
| **D-GATE** | Coaching invariants gate CI; the simulation snapshot is a non-blocking semantic diff | [0.1](./phase-0-instrumentation.md) | A byte-exact gate would freeze today's known-bad behaviour and make every improvement look like a regression |
| **D-PHASE** | `EventPlanPhase` is the canonical phase vocabulary; `PhaseWeights.phaseName` becomes a derived label | [2.1 D1](./phase-2-plan-intent-authority.md) | It is what a coach actually names, and it can express `travel`, which days-to-event structurally cannot |
| **D-INT** | `intensityScale` gets a consumer (`PlannedDose.intensity`), it is not deleted | [2.1 D2](./phase-2-plan-intent-authority.md) | Taper is volume down / intensity held; collapsing both into one scalar is why taper has to be reconstructed elsewhere |
| **D-LEX** | Lexicographic priority ordering replaces multiplicative composition | [3.2](./phase-3-single-ranking-path.md) | F3 is the proof: two reasonable multipliers composed into a policy nobody chose |
| **D-TIER** | Build the next-day tier selector; do not settle for a `yellow` default | [3.4](./phase-3-single-ranking-path.md) | All three branches are already computed and paid for; only the control is missing |
| **D-AXES** | Delete the `*0.8` / `*0.7` stimulus derivations; templates declare the axes | [4.2](./phase-4-objective-credit-v2.md) | No citation can justify a repository-wide fixed ratio between per-session properties |
| **D-FUSE** | Fatigue fusion is *measured before chosen*, not prescribed now | [4.3](./phase-4-objective-credit-v2.md) | Prescribing a formula here would repeat exactly the uncited-constant practice F11 criticises |
| **D-BEAM** | Beam search is approved to be **built and measured**, not to be shipped regardless of result | [5 increment order](./phase-5-sequence-planning.md) | Whether it beats greedy is empirical; "it didn't" is a valid, useful outcome |
| **D-LIFE** | Recommendations become append-only revisions; decision fields immutable *per revision* | [1.3](./phase-1-live-defects.md) | Same-day recomputation is a real second decision; naive field-pinning would reject it and leave the audit contradicting the UI |
| **D-RECOV** | `EventPlanPhase` gains a canonical `recovery` member | [2.1 D1](./phase-2-plan-intent-authority.md) | Mapping `Post-Event Recovery → build` would make fitness-developing objectives eligible during recovery |

Five of these — **D-KWD**, **D-GATE**, **D-LIFE**, **D-RECOV**, and the withdrawal inside
**D-FUSE** — correct errors in earlier drafts and came out of PR #5 review rounds rather
than from the original analysis.

### Archived

* [Workout library expansion](./0000-workout-library-expansion.md) — `Implemented`
  2026-08-07. Retained because §1.2 is still the fullest written description of the
  two selection paths; its line references are stale (see F9).

---

## Task status

Every work item inside a plan carries a status marker on its heading and a matching row in
that plan's **Task board**:

| Marker | Meaning |
|:--:|---|
| `[ ]` | Not started |
| `[-]` | In progress |
| `[x]` | Finished |

Update **both** the heading marker and the board row in the same commit — a board that
disagrees with its headings is worse than no board, because it will be trusted.

A task is `[x]` only when its own *Done when* condition holds, not when the code was
written. Where a task's outcome is a measurement rather than a migration (notably Phase
5.1), recording a negative result satisfies it — see D-BEAM.

Phase-level `Status` (`Approved` / `Ready`) is about the *plan*; task markers are about
the *work*. A `Ready` plan can be entirely `[ ]`, and an `Approved (blocked)` plan should
be.

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

Each work item should be implementable by someone who has not read the rest of the
document: name the real files, state the current behaviour, state the change, and give a
verifiable *Done when*. If a task needs a decision made first, say so and point at the
decision register rather than leaving the implementer to choose.

Prefer to state the smallest change that closes the finding. Where a plan proposes both a
tactical fix and a structural one, say which unblocks work now and which is the
destination.
