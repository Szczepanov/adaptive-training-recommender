# M-plan status and next steps (2026-08-20)

## Question

Where does the `M` capability plan — [Multidomain session authoring, execution and
evidence](../plans/multidomain-session-authoring-execution-and-evidence.md) — stand today, and
what is the correct next unit of work?

This is a dated point-in-time status check, not a new decision. It confirms the
[2026-08-19 cutline review](./2026-08-19-product-scope-cutline-review.md) against the plan's
current task board and recommends the immediate next step.

## What "M" is

`M`, `S`, `G` and `UX` in `docs/plans/README.md` are capability/surface plans, not numbered
engine phases (`Phase 0`–`9`). `M`'s work items carry the `M*` prefix precisely so they aren't
mistaken for the phase sequence. `M` covers: an athlete building or importing a structured
multidomain session, scheduling it with explicit authority, executing it safely on a phone,
recording native performed doses/measurements, and linking response back to the exact
occurrence — while preserving replay, user isolation, existing engine authority and the
repository's default-off evidence policy.

## Current status

The 2026-08-19 cutline's recommended near-term chain,
**M3.7 → bounded M3.8 → M4.3 → M5.1 → M5.2**, is complete end to end. Verified against the
plan's task board (`docs/plans/multidomain-session-authoring-execution-and-evidence.md`):

| Item | Title | Status |
|---|---|:---:|
| M0.1–M0.3 | Contract, fixtures, dependency boundaries | `[x]` |
| M1.1–M1.7 | Strength repair + session-linked response v0 | `[x]` |
| M2.1–M2.7 | Executable session core (definitions, persistence, runner, comparison, v1 read compat) | `[x]` |
| M3.1–M3.8 | Hashing/adapters, replay, authority flow, catalog parity, facets, external v2, import preview/diff, manual builder | `[x]` |
| M4.1–M4.3 | Group execution modes, recorded choices, companion/dedup reconciliation | `[x]` |
| M5.1 | Occurrence-linked response generalization | `[x]` |
| M5.2 | Later-day and next-morning follow-up | `[x]` |
| **M5.3** | **Outcome/override evidence report** | **`[ ]`** |
| M6.1–M6.4 | Speed/field/power specialization | `[ ]` — usage-triggered, not started |
| M7.1–M7.4 | Metric registry/protocols/testing/benchmarks | `[ ]` — usage-triggered, not started |
| M8.1–M8.3 | Evidence-gated policy candidates | `[ ]` — waits on M5/M6/M7 evidence |
| M9.1–M9.3 | Aliases, prose import, device adapters | `[ ]` — each behind its own named trigger |

`app/src/responses/` currently contains `models.ts`, `validation.ts` and
`followupSchedule.ts` (M5.1/M5.2) with no `outcome.ts` and no `ResponseHistory.tsx` — the
code matches the task board exactly; nothing for M5.3 has been started.

**M5.3 is therefore the single unblocked item on the plan's own critical path.** Its
dependency (M5.2) is done, and no other `M*` item is both startable and not already finished.

## Why M5.3 is next, and how it should be scoped

The 2026-08-19 cutline review already adjudicated this item and the plan encodes the verdict
directly: **REDUCE/LATER on UI, build the evidence report now.**

> "Useful for analysis, but a dedicated history UI is not required to start evidence
> collection... First deliver a reproducible export/report if needed; build rich history UI
> only after it is consulted in practice."

The plan's own M5.3 section (`docs/plans/multidomain-session-authoring-execution-and-evidence.md`)
specifies the shape:

* Derive `passed | caution | reactive | unknown` as a **versioned, evidence-only summary**
  from the raw M5.1/M5.2 response windows (`responses/outcome.ts`).
* Record athlete override reason and planned/performed delta — reuse
  `SessionAdjustment.athleteReason` through a source-neutral override record rather than
  inventing a strength-only one.
* Start with a **deterministic report/export** and a compact inspectable view using existing
  data surfaces. Do not build `components/session/ResponseHistory.tsx` unless the usage
  trigger fires: the athlete repeatedly opens/exports the evidence and has a specific
  question (e.g. comparing responses after a recurring lower-body session) that a dedicated
  surface would answer better.
* **Done when:** every outcome links to source facts and a policy version; missing later/next
  data returns `unknown` (never a fabricated default); the report exposes evidence without
  making injury-prediction claims; and the M0.3 architecture test is extended to prove no
  selection/optimizer module imports the outcome function (same boundary already enforced for
  `sessions/` and `responses/`).

This keeps M5.3 aligned with the same discipline used throughout the plan (D-FUSE, D-STRCOST,
D-SUBJCAL): no coefficient or automated judgment ships ahead of the evidence that would
justify it. `passed/caution/reactive/unknown` is a **summary label over already-recorded
facts**, not a new inference — it must not become a step toward automatic option selection or
progression, which `D-MPOLICY` explicitly keeps as a separate, future, default-off candidate.

## What should not be started yet

Everything past M5.3 remains correctly gated, and nothing in the repository state changes that
today:

* **M6 (speed/field/power cards)** — no recorded trigger. The generic runner's repetition/
  duration/distance/check-off inputs still cover current session fixtures; M6 starts only when
  a real recurring session demonstrably loses decision-relevant context (splits, side,
  validity) that the generic inputs can't represent.
* **M7 (metric registry/testing)** — no recorded trigger. There is no repeated standardized
  testing workflow yet to make a protocol/comparison-series abstraction pay for itself.
* **M8 (evidence-gated policy candidates)** — blocked on real history from M5 (and, if
  independently triggered, M6/M7). M5.3's report is what will make that history usable; M8
  should not be scheduled ahead of it.
* **M9 (aliases, prose import, device adapters)** — each item keeps its own explicit trigger
  (second athlete/durable metadata need, JSON-import friction, owned hardware). None has fired.

## Cross-cutting: Phase 9.0 coordination

M4.3 was decision-affecting (it rewrites `engine/completedTraining.ts` and
`engine/trainingHistory.ts`) and the cutline required it to land before Phase 9.0's shadow
block (9.0.7) opens. M4.3 is now `[x]`, so that constraint is satisfied. Phase 9.0's own board
(`docs/plans/phase-9-0-shadow-mode-and-decision-journal.md`) still shows **9.0.1 (unattended
ingestion) as the open gate** — 9.0.2–9.0.6 are done, but 9.0.7 (run the block) and 9.0.8
(readout) remain not started pending it. This is independent of M-plan work: M5.1/M5.2 are
evidence-only and explicitly safe to run alongside a live shadow block; M5.3 (a pure read/report
over already-recorded data) is the same. Nothing in M5.3 needs to wait on 9.0.1.

## Recommendation

Build **M5.3** next, scoped exactly as the plan and the 2026-08-19 cutline already specify:

1. `responses/outcome.ts` — pure, versioned `deriveSessionOutcome` (or similar) producing
   `passed | caution | reactive | unknown` from a session's M5.1 `SessionResponse` rows plus
   the linked check-in tissue values, with `unknown` as the honest default for any missing
   window.
2. A source-neutral override/delta record (reusing `SessionAdjustment.athleteReason`'s shape)
   capturing athlete override reason and planned-vs-performed delta.
3. A deterministic report/export surface over existing data — not a new dashboard component.
4. Extend `sessions/architecture.test.ts` (or `responses/architecture.test.ts` if that's where
   the M5.1 boundary test landed) to assert no selection/optimizer module imports
   `responses/outcome.ts`.
5. Leave `components/session/ResponseHistory.tsx` unbuilt until the usage trigger in the plan
   fires.

Everything beyond M5.3 stays correctly parked behind its own usage trigger; no other `M*` item
should move before real use (or M5.3's own report) produces the evidence the plan requires.
