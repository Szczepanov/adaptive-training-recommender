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

Phases 0–5 are **implemented** as verified on 2026-08-09; Phase 6 is now **In progress**.
The Phase 0–5 task boards are historical implementation records; the
[follow-up analysis](../analysis/2026-08-09-phase-0-5-completion-review.md) records
which original findings are fully closed and which remain ongoing work.

`Status` is a single plan-level lifecycle value from the table above. Because a plan can
be part-startable, **which work items are unblocked is a separate column** — `Ready` at
the plan level would otherwise have to mean "some of it", which is how the earlier
all-`Ready` table became unusable.

| # | Plan | Status | Startable items | Blocked by | Addresses |
|---|---|---|---|---|---|
| 0 | [Instrumentation & developer baseline](./phase-0-instrumentation.md) | **Implemented** | — | — | F11, F14, F15, part of F10 |
| 1 | [Live defects](./phase-1-live-defects.md) | **Implemented** | — | — | F1, F2, F6 |
| 2 | [Plan intent is the planning authority](./phase-2-plan-intent-authority.md) | **Implemented** | — | — | F16, F17, F9 |
| 3 | [One ranking path](./phase-3-single-ranking-path.md) | **Implemented** | — | — | F3, F4, F5 |
| 4 | [Objective credit V2](./phase-4-objective-credit-v2.md) | **Implemented** | — | — | F7, F8, F12 |
| 5 | [Sequence planning](./phase-5-sequence-planning.md) | **Implemented** | — | — | the cutover proper |
| 6 | [Evidence-driven calibration & operational assurance](./phase-6-evidence-and-operational-assurance.md) | **In progress** | none | 6.5 needs Firebase owner/project; 6.7 needs a reproducible undesirable fatigue trajectory | remaining F11, F12, F15 |
| 6.2c | [Recommendation quality & weekly coverage](./phase-6-2c-recommendation-quality-and-weekly-coverage.md) | **Implemented** | none | none | separates adaptation credit from weekly programming-role coverage; not an original review finding |
| 7A | [Weekly allocation & safe role reservations](./phase-7-weekly-allocation-and-role-reservations.md) | **Implemented** | none | none | resolves PR #17's healthy/fresh cycling role-coverage failure without recalibrating recovery |
| 7B | [Training intent, capacity & planning modes](./phase-7-training-intent-and-planning-modes.md) | **Implemented** | none | none | evidence-derived Evergreen dose packed into real capacity, while preserving structured and demand-derived event planning — not an original review finding |

Phases 0–5 are complete; Phase 6 has started with 6.1 baseline ownership and 6.2 (both
Phase 5 correctness carryovers) implemented in PR #17, which bumped `POLICY_VERSION` to
`2026-08-phase6-correctness-carryovers-v1`. 6.2c (adaptation-credit/weekly-coverage
separation, [ADR-0016](../adr/0016-adaptation-credit-and-weekly-coverage.md)) followed to
close a further review finding; its code and dedicated contract tests are complete and
green. [Phase 7A](./phase-7-weekly-allocation-and-role-reservations.md) implemented the
explicit allocation/reservation contract that resolved the historical greedy role-loss and
recovery-share interaction; the affected cycling scenarios now match the reviewed baseline.
The Phase 5.1 beam-search prototype remains
measured but non-production; the live planner stays greedy until ADR-0015 is revisited.

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

### Proposed decisions awaiting acceptance

These decisions are intentionally **not** part of the accepted register above. Their
plans remain Draft and must not be implemented until the linked ADR is accepted.

| ID | Proposal | Where | One-line reason |
|---|---|---|---|
| **D-MODE** | `evergreen` and `event_directed` are first-class modes; event strategy is a separate capability | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Cycling can use a structured plan while other existing event categories retain demand-derived direction |
| **D-DOSE** | Evidence-derived adaptation dose precedes capacity and role packing | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Exercise evidence speaks in dose dimensions; a session is a container, not the physiological requirement |
| **D-CAP** | Real sessions, minutes, and windows constrain dose packing; they do not define the dose | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Three 25-minute sessions and three 90-minute sessions are not equivalent capacity |
| **D-COVSET** | The coverage catalog becomes a named generic-plan registry, not an event-shaped module constant | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Evergreen needs to be a peer plan descriptor, not a fabricated event phase |
| **D-OWNERSHIP** | Each preference field has one persisted authority | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Two live preference models create contradictory valid states with no safe merge rule |
| **D-ORG** | Persist only executable Auto/Adaptive Hybrid policy | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | A valid stored choice must not make normal recommendation generation fail |
| **D-TAPERSCOPE** | Taper requires a real event; a star rating is not one | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | `deriveEventPriority(5) → 'A'` currently grants a dated `general_target` goal a 14-day taper |
| **D-RESERVE** | Allocate exact, eligible minimum coverage roles before support work | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | Anchor modifiers cannot preserve a future role opportunity in a greedy loop |
| **D-FEASIBILITY** | Reuse production eligibility and revalidate reservations after every pick | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | A second planner would drift from safety, spacing, and fatigue gates |
| **D-BOUND** | One deterministic search budget; exhaustion is `unresolved_search_budget`, never a miss | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | A wall-clock cut-off would make identical input plan differently on different devices |
| **D-SUPPORT** | Supporting work may not destroy the last safe allocation | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | Reduced-dose support is useful only when it preserves required role opportunity |
| **D-MISS** | Forecast required-role misses are typed, first-class diagnostics | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | Safety-forced omission must be distinguishable from a scheduling defect |
| **D-NO-BEAM** | Keep production greedy; do not treat this fix as beam-search adoption | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | ADR-0015 deferred adoption for measured latency and coaching-review reasons |

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

## Conventions that exist because they were violated

Both of these were added after a document in this directory misled a reader. They are
cheap to follow and the failure mode is expensive.

### Reference symbols, never line numbers

Write `` `rules.ts` `evaluateEnvelopes` `` or `` `prescription.ts:workoutForTemplate` ``.
Do **not** write `` `rules.ts:544-556` ``.

Line numbers drift within hours of being written. A 2026-08-08 audit of this directory
found 91 line references, and a six-sample spot check found **three already pointing at
the wrong code** — all written the same day. An agent following a stale line reference
lands on unrelated code and either acts on it or burns time reconciling it. Symbol names
survive refactors, are greppable, and fail loudly when renamed rather than silently
pointing somewhere plausible.

### An `Implemented` plan must not read like a work list

When a plan flips to `Implemented`, **strike through or delete its findings, "problems
found", and "fix this" sections**, keeping the outcome summary. Do not leave a
pre-implementation problem statement sitting in the present tense.

This is not hygiene. On 2026-08-08 an already-fixed P1 from
[`0000-workout-library-expansion.md`](./0000-workout-library-expansion.md) §1.3 was
re-reported as a live defect three times — in two PR comments and a summary — because the
archived plan still described it in the present tense with a "fix in Phase 1"
instruction. `Status: Implemented` in the header was not a strong enough signal; the body
read as current, so it was treated as current.

Every archived plan therefore also carries a reader warning at the top stating that it is
a historical record and that its findings must be verified against the code before being
acted on.

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

Reference symbols rather than line numbers (see the convention above).

Each work item should be implementable by someone who has not read the rest of the
document: name the real files, state the current behaviour, state the change, and give a
verifiable *Done when*. If a task needs a decision made first, say so and point at the
decision register rather than leaving the implementer to choose.

Prefer to state the smallest change that closes the finding. Where a plan proposes both a
tactical fix and a structural one, say which unblocks work now and which is the
destination.
