# Should the manual AI loop be replaced by the app? (2026-08-16)

**Question asked.** The athlete's current workflow is manual: each morning they report
subjective and objective recovery scores to a general-purpose AI as a prompt, and the AI
returns today's session plus actions for the coming days. Every week or two they reassess
the block with the same AI. With Phase 8 built, should they switch to this app?

**Verdict: not yet — but not because the app is too weak.** Run both in parallel for one
training block first. Switching now would discard the only evidence that can answer the
question, and the cost of collecting that evidence is roughly one screen plus the habit of
using the app daily, which is a prerequisite of switching anyway.

Verified against `origin/main` at `f63b145`, which is PR #50 (Phase 8) merged.

---

## 1. Phase 8 changed what is actually being asked

The original question was "is this engine a better coach than the athlete's AI?" The
answer was no, and
[the feasibility analysis](./2026-08-15-externally-authored-plan-feasibility.md) accepted
that as a premise rather than arguing with it. ADR-0019 then split the engine's two jobs
and gave one of them away:

| Job | Owner after Phase 8 |
|---|---|
| **Selection** — which session, and the macro/meso structure around it | The athlete's AI |
| **Adjudication** — is today the day, at what dose, does it violate a hard constraint | This engine |

That split is not a compromise; it lines up with where each system is actually strong.

**What a fresh AI chat structurally cannot do.** It holds no state between mornings. It
knows the athlete has done three hard sessions in six days only if they remember to say
so, and it cannot decay yesterday's load into today's. The app's `fatigue.ts` accumulates
and decays six dimensions across days from Garmin data plus adherence, and
`microcycle.ts` carries an objective ledger the same way. This is not a modelling
preference — it is memory the conversational loop does not have.

**What the engine structurally cannot do.** It cannot hear "my knee twinged on the last
interval" unless that maps to a check-in field. Free-text nuance reaches the AI and
reaches the engine only as a checkbox.

So the live question is narrower than it was: **is the engine's daily go/no-go trustworthy
enough to replace the daily AI prompt?** Gatekeeping is exactly where deterministic rules
beat a language model, so the prior should be favourable. The rest of this document is
about the one place it is not.

---

## 2. What is genuinely ready

- **Ingestion.** `src/garmin_sync/` is a complete daily sync with backfill, a completeness
  audit, an immutable raw-payload archive (ADR-0005), and a documented Cloud Run + Cloud
  Scheduler deployment (`docs/ops/cloud-run-deployment.md`). Objective scores stop being
  something the athlete transcribes into a prompt.
- **Cross-day state.** Fatigue, objective credit, and completed-training reconciliation all
  persist and replay. `completedTraining.ts` upgrades an adherence-confirmed session's
  evidence tier, so answering the daily adherence prompt measurably improves the next day's
  inputs.
- **Hard gates.** Equipment, environment, time budget, guardrails and injury restrictions
  are enforced in one resolver (`eligibility.ts`), emulator-tested, and cannot be forgotten
  mid-conversation the way a constraint mentioned three prompts ago can be.
- **Auditability.** Every decision persists a compact `RecommendationAudit`, and after
  Phase 8 an external decision names the exact plan revision bytes it was made from and
  fails replay loudly if those bytes changed (ADR-0019 D-IMMUT).

None of that is available in the manual loop at any price.

---

## 3. The gap that should stop an outright switch

**The input the athlete personally supplies every morning is the least-validated thing in
the system.**

Two facts, both checkable:

1. **Nothing baselines subjective scores on the decision path.**
   `mapCheckinToSubjectiveInput` maps one day's check-in to `SubjectiveInput`, and that is
   all any decision sees. `contextBrief.ts` does read check-in history and already computes
   7-day/28-day subjective drift with a coverage gate — but it renders a brief for the
   athlete's AI; nothing feeds it back into `rules.ts`. A reported fatigue of 6/10 is
   therefore treated identically whether the athlete's normal is 2 or 6. This is
   precisely what [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) exists
   to address, and [Phase 9](../plans/phase-9-subjective-baselines.md) is still `Draft`.
2. **The corpus that would measure it cannot.** `simulation/scenarios.ts` builds nearly
   every scenario from `stableReadiness()`, which returns a constant subjective vector. The
   synthetic athletes have **zero subjective variance**. A calibration run today would
   report "no effect" for a structural reason, not an empirical one — Phase 9's own plan
   flags this and makes 9.5 a hard precondition of 9.6.

The existing calibration evidence is honest about its own boundary
([Phase 6.4](./2026-08-10-phase-6-calibration-corpus.md)):

> This is deterministic policy-regression evidence, not physiological or clinical
> calibration. A frequently activated rule is a review signal, not a recommendation to
> change a threshold.

So: the objective half of readiness is baselined against the athlete's own 7-day and 28-day
history (`metricStrain` in `rules.ts` z-scores it). The subjective half is not baselined at
all. The AI, whatever else it does badly, reads a 6/10 with the memory of what the athlete
usually reports.

**This is the single largest behavioural difference between the two loops**, and it sits on
the input the athlete cares most about.

---

## 4. What is missing that is not a code gap

Nothing in this repository has ever compared an engine verdict to the athlete's own verdict
on the same day. There is no disagreement log, no outcome measurement, and no record of a
day where the two loops would have diverged. Every piece of evidence the project holds is
deterministic self-consistency: does the engine reproduce itself, does a change move a
synthetic baseline.

That is the right kind of evidence for refactoring. It is the wrong kind for deciding
whether to hand over the daily decision.

**A switch made now would be made on taste, and would also destroy the counterfactual** —
once the AI is out of the loop there is nothing to compare against.

---

## 5. Recommendation

**Shadow, don't switch.** For one block (4–6 weeks):

1. Use the app daily — check-in, read the verdict, answer the adherence prompt.
2. Keep prompting the AI as today.
3. Record all three each day: the engine's verdict, the AI's verdict, and what was actually
   done.

This yields three things at once:

- **The disagreement log**, which is the actual answer to the question asked.
- **A real subjective corpus** — 4–6 weeks of the athlete's own check-ins, with real
  variance. This is a by-product of using the app at all; the check-ins already persist to
  `users/{uid}/daily_subjective_checkins/{date}`.
- **The habit**, which any switch requires regardless of the outcome.

The corpus is the part worth emphasising. Phase 9.5 currently reads "give the scenario
corpus realistic subjective variance," which today means *inventing* it. After a shadow
block it means *sampling the one athlete who matters*. That converts Phase 9 from
"measure a term we invented, on fixtures we also invented" into "measure it on the person
who will use it" — and largely dissolves the chicken-and-egg the plan opens by describing.

**Sequenced:**

| Step | Why it is first |
|---|---|
| Deploy the sync unattended, plus a 56-day backfill | Shadowing against data gaps measures the ingestion, not the engine |
| [Phase 9.0 — shadow mode and decision journal](../plans/phase-9-0-shadow-mode-and-decision-journal.md) | Produces the disagreement log and the real corpus |
| Run the block | The gate is data volume, not code |
| [Phase 9](../plans/phase-9-subjective-baselines.md), re-scoped | 9.5 now samples real check-ins instead of inventing variance |
| Decide | From the log, not from taste |

### Explicitly not next

- **More engine features.** Phases 2–7 are implemented and Phase 8 is in review. The
  binding constraint is evidence, not capability.
- **Threshold tuning.** Any tuning done before the shadow block is tuning against synthetic
  athletes with a constant subjective vector.
- **An in-app model call.** ADR-0019 D-NOPARSE excluded it deliberately, and the paste
  workflow already round-tripped a real 21-session plan with no hand-editing.

---

## 6. Answering the question directly

**Is it good enough?** For the daily go/no-go, close — because Phase 8 narrowed the job to
gatekeeping, and the gates are real, tested and stateful in a way the manual loop is not.
The reservation is not the engine's architecture; it is that the athlete's own subjective
scores enter it unnormalised and unmeasured.

**Should the athlete switch?** Not in one step, and not yet. Run both for a block. If the
disagreement log shows the engine and the AI mostly agreeing, the switch is safe and the
evidence to make it will exist. If they disagree often, that log is worth more than any
further engine work — it will say exactly where.
