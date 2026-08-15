# Externally-authored training plans: feasibility analysis

**Date:** 2026-08-15
**Repository state reviewed:** `bfda040522a40214242d160139e8c79f55eb4a14`
**Scope:** The proposal to let the athlete import a training plan authored outside this system (by a general-purpose AI) and narrow this application's role to Garmin ingestion, subjective check-in capture, and per-session advice.
**Method:** Source review of `app/src/engine/`, `app/src/workouts/`, `app/src/services/`, `app/firestore.rules`, and the ADR/architecture set. No code was changed and no tests were run for this document. This is an engineering feasibility assessment, not a physiological or clinical judgement.

---

## Verdict

**Build it — but not as "custom training input."** Framed as a UI feature it is a bolt-on that will fight the engine. Framed correctly it is a **third planning mode**, `externally_planned`, that sits alongside the existing `evergreen` and `event_directed` modes in the `PlanningMode` union, and it fits the architecture's existing seams almost suspiciously well.

The reason is a structural fact about this codebase that the proposal did not have to know about but happens to depend on entirely:

> **The engine already separates "which session" from "is this session safe and correctly dosed today."** Those are different modules, with different inputs, and only one of them is being replaced.

`evaluateReadinessAndSafetyEnvelope`, `eligibility.ts`, `injuryPolicy.ts`, `dose.ts`, `fatigue.ts`, and the strain telemetry in `rules.ts` never ask where a session came from. They are already plan-agnostic. What the external AI replaces is the *selection* half — `optimizer.ts`'s `rankCandidates`, the coverage/allocation machinery, and the evergreen capacity chain. The adjudication half is reusable verbatim.

There is one condition on this verdict, stated up front because it is the only thing that would flip it — see [Import format is the load-bearing decision](#import-format-is-the-load-bearing-decision).

---

## What is actually being proposed, restated

Today the system runs:

```text
Garmin + check-in → readiness → engine selects a session from a 27-template catalog → prescription → advice
```

The proposal is:

```text
Garmin + check-in → readiness → adjudicate the session the external AI already chose → advice
                                 (proceed / scale / substitute / defer / skip)
```

This is not a smaller system. It is the same system with the selection stage inverted: instead of *generating* a candidate and gating it, it *receives* a candidate and gates it. Every gate stays.

---

## The honest case for the idea

Worth naming precisely what the external AI is better at, because it is not "everything," and the plan should exploit the actual asymmetry rather than the vibe.

**What an advanced general AI does better than this engine:**

- **Macro structure and narrative.** Multi-month progressions, block logic, exercise variety, the *rationale* for a week. The engine's plan layer derives objectives from an `EventDemandProfile` and packs them into a `WeeklyBudget`; it produces defensible structure, not interesting structure.
- **Catalog breadth.** `TEMPLATES` holds 27 session families and `WORKOUTS` around 37 detailed definitions. That is a deliberately curated, validated library — and it is also a hard ceiling. An external AI is not bounded by it.
- **Natural-language specificity.** "3×12min at the top of Z3, cadence 85–90, last rep only if the first two felt sub-maximal" is trivial for an LLM to author and is not expressible in `SessionTemplate` at all.

**What this engine does that the external AI structurally cannot:**

- It sees the 7-day and 28-day **baselines** and self-normalised strain (`metricStrain`, HRV/RHR/sleep z-scores against the athlete's own trailing stdev). The external AI sees whatever the athlete pasted into a chat window, once.
- It carries **6-dimensional fatigue state with exponential decay** (`fatigue.ts`) across days, fused with external load from actual completed activities.
- It applies the **injury and tissue-response gate** (`resolveEffectiveInjuryConstraints`), which can only ever *tighten* a standing constraint for a given day and structurally cannot be loosened by a good HRV reading.
- It **reconciles what was actually done** — Garmin activities plus adherence responses — through `reconcileCompletedTrainingEvents` and the `EvidenceTier` ladder.

So the division of labour the proposal implies is the correct one, and it is not a compromise: **external AI owns the macrocycle; this engine owns today.** That is a coherent product, and it is arguably a *better* one than either half alone.

### The weakness of the idea, stated plainly

**A static imported plan goes stale, and nothing currently closes the loop.** The engine's plan layer re-derives itself every evaluation from live history. An imported plan is a frozen artifact. Three weeks in, after two skipped sessions, an illness, and a travel week, the imported plan is describing an athlete who no longer exists — and the app will keep dutifully adjudicating sessions from it.

There are only three answers, and the plan must pick one:

1. **Accept it.** The athlete re-generates the plan from their AI every 2–4 weeks. Manual, but honest, and matches how people actually use these tools.
2. **Export a context brief.** The app generates a compact, paste-ready summary — adherence, completed load, fatigue trend, missed objectives — that the athlete feeds back to their AI for the next block. Cheap to build, and it makes the loop real without any integration.
3. **Auto-adapt the imported plan.** Rejected. This rebuilds the planner we just replaced.

**Recommendation: (1) for v1, (2) as the first follow-up.** Option 2 is genuinely the highest value-per-line item in the whole proposal and should not be treated as optional polish — it is what makes the hybrid a loop instead of a one-shot.

---

## Structural fit: what already exists

This is the part that decides feasibility. Reviewed against the code, not the ADRs.

### Reusable unchanged

| Component | Why it works as-is |
|---|---|
| `rules.ts` `evaluateReadinessAndSafetyEnvelope` | Takes `DailyReadiness` + `UserContext`. Returns mode, envelopes, telemetry. Has no template parameter and no plan parameter. Directly callable. |
| `dose.ts` `resolveExecutionDose` | Already intersects a planned dose with the clinical/readiness ceiling and an athlete adjustment, and fails closed on out-of-contract input. This *is* the "scale the imported session" primitive. |
| `injuryPolicy.ts` / `adapters.ts` `mapContextFromGoalsAndTrainingSettings` | Produces restricted modalities, categories, and guardrails independent of any candidate. |
| `fatigue.ts`, `completedTraining.ts` | Consume completed events, not planned ones. Unaffected by where the plan came from. |
| `checkinService`, `recoverySnapshotService`, the whole Python ingestion package | Untouched. The proposal explicitly keeps these as the core. |
| `safetyCheckin.ts` | The minimum-safety-check-in gate applies identically to an imported session. |

### Needs a contained change

| Component | Change | Size |
|---|---|---|
| `eligibility.ts` | `evaluateTemplateEligibility` reads `durationMin/Max`, `requiredEquipment`, `environment`, `safetyTags` off a `SessionTemplate`. Widen its parameter to a structural `GateableSession` interface that both `SessionTemplate` and an imported session satisfy. | Small — this is the single highest-leverage refactor in the proposal |
| `planningMode.ts` `resolvePlanningContext` | Add the third mode. The function is already the documented single authority for mode resolution, so this is the correct and only place. | Small |
| `models.ts` `PlanningMode` | `'evergreen' \| 'event_directed' \| 'externally_planned'` | Trivial |
| `rules.ts` `evaluateTrainingWithIntent` | Branch: in external mode, adjudicate rather than rank. Still resolve intent — see below. | Moderate |

### The genuinely hard parts

**1. `Recommendation.template` is a non-optional `SessionTemplate`, and everything downstream assumes it.**

`DailyRecommendation` persists `templateId`, `templateTitle`, `category`, `modality`. `RecommendationAudit.candidateScores[]` is keyed by `templateId`. `replay.ts` verifies against it. `resolveWorkoutPrescription` opens with `workoutForTemplate(recommendation.template.id)` — a lookup into the hardcoded `WORKOUTS` array — and returns `null` on a miss, so an imported session with no catalog entry produces **no prescription at all** and the detailed-plan UI has nothing to render.

This is the real cost of the feature and it should not be hand-waved. Two options:

- **(a) Synthetic template shim.** Map each imported session onto a lightweight `SessionTemplate`-shaped record with a reserved id namespace (`ext:{planId}:{sessionId}`), derived `systemicCost`/`costProfile`/`stimulusProfile`, and carry the human-readable detail in a parallel `externalPrescription` field. Everything downstream keeps working; nothing needs widening.
- **(b) Widen `Recommendation` to a union.** Correct in the abstract, and it touches persistence, provenance, replay, adherence, the planner, and the UI.

**Recommendation: (a).** It is not the pretty answer, but it confines the blast radius to one adapter, keeps `POLICY_VERSION` replay coherent, and does not put a union type through the middle of six modules for a feature with one user. Document it as a deliberate shim, not an accident.

**2. Imported sessions have no `stimulusProfile` or `costProfile`, and both are load-bearing.**

`systemicCost` drives the `modify`-mode ceiling and `PLAN_TIER_SYSTEMIC_COST_CEILING`. `costProfile` feeds fatigue projection. `stimulusProfile` feeds objective credit.

The codebase already solved this exact problem in the other direction. Phase 5.5's `EvidenceTier` ladder and `stimulus.ts`'s `CONFIDENCE_CREDIT_WEIGHT` (exact 1.0, inferred 0.75, unknown 0.4) exist precisely for "we have a session but don't fully know what it was," and `DEFAULT_COST_BY_MODALITY` / `DEFAULT_STIMULUS_BY_MODALITY` provide conservative modality×intensity fallbacks. **An imported session is the upstream twin of an unmatched Garmin activity.** It slots into the same ladder: a rich structured import lands near `durationIntensity`, a prose import at `athleteClassification`, and the confidence discount already handles the rest. No new estimation model is needed — reuse the ladder and add one rung for authored-external evidence.

**3. Safety posture must not regress.**

Right now, every session this app displays has passed a hard gate against equipment, environment, injury guardrails, restricted categories, and duration. An imported plan has passed none of that. The non-negotiable rule:

> **An imported session is a candidate, never a prescription.** It goes through `evaluateTemplateEligibility`, the safety envelope, the mode ceiling, and the injury gate exactly as a catalog template does. When it fails, the app says which gate failed and offers the scaled or substituted alternative — it does not display the session and hope.

This is also the answer to the obvious product objection ("why not just read your AI's plan off your phone?"). The answer is: because the app is the thing that tells you *not* to do it today, and why.

**4. The `alreadyTrainedToday` override needs review.**

`evaluateReadinessAndSafetyEnvelope` forces `recover` when `subjective.alreadyTrainedToday` is set or `objective.today_training` is non-null. With an imported plan the athlete is more likely to train first and check in after, which currently yields a `recover` verdict on a session they already completed. Not a blocker, but it needs an explicit decision, and it should be recorded rather than discovered in use.

---

## Import format is the load-bearing decision

Everything above assumes the app receives structured data. How it gets there is the one choice that can kill the proposal.

| Option | Assessment |
|---|---|
| **A. Structured paste against a published schema** — the athlete includes the schema in their AI prompt; the AI emits conforming JSON; the app validates it at the boundary like every other persisted record. | **Recommended.** Zero new infrastructure, no API key, no recurring cost, deterministic, and validatable through the existing `validation.ts` + `firestore.rules` + `test:rules` pattern. The athlete is *already* using a capable AI — asking it to also emit JSON is free. |
| **B. Free-text paste, parsed by an LLM inside the app** | **Defer.** Requires an API key, a server-side proxy (the key cannot ship in a Vite bundle), per-import cost, and — the real problem — it puts a non-deterministic transform at the persistence boundary, which fights ADR-0010's replay contract. If it is ever built, it must parse *to* the Option A schema and present the result for confirmation before saving, never write directly. |
| **C. Manual form entry** | Keep as the **edit** affordance, not the import path. Tedious for a 12-week block, essential for fixing one session. |

**If the athlete is unwilling to have their AI emit JSON, the answer changes from "build it" to "probably not, in this codebase."** Option B alone is a materially different and worse project: more infrastructure, recurring cost, and a direct conflict with the audit/replay guarantees that are among this repository's strongest properties. That is the single question worth answering before any code is written.

---

## What keeps the existing engine investment alive

Phases 2 through 7 — plan intent authority, objective credit V2, weekly allocation, role reservations, evergreen capacity, the deferred beam search — exist to *choose* sessions. If an external AI chooses, those modules stop being decision-makers. There are exactly two futures for them, and the plan must pick deliberately:

- **They become evaluators.** The microcycle ledger, `buildCoverageState`, and the fatigue projection stop generating the week and start *reviewing* the imported one: *"your imported week puts three hard days in four"*, *"projected fatigue exceeds the tier ceiling on Thursday"*, *"no strength-maintenance credit this week"*, *"Tuesday's session violates hard-lower-body spacing after Monday."* Non-blocking, advisory, surfaced in the week-ahead strip.
- **They become dead code** carried at full maintenance cost.

The first is where most of the value of this proposal actually lives, and it is *only* reachable because that machinery already exists. An external AI cannot produce this critique — it has no fatigue state and no completed history. **This is the feature that makes the hybrid better than either half, and it should be treated as core scope, not phase-two polish.**

---

## Proposed shape, if approved

Not a plan — a plan belongs in `docs/plans/` and should be written only after the format question is settled. This is the sequence and the rough shape.

| Phase | Content | Notes |
|---|---|---|
| **A. Import contract** | `ExternalTrainingPlan` / `ExternalPlanSession` types; date-keyed storage at `users/{userId}/external_plan_sessions/{YYYY-MM-DD}` with a plan header doc; `validateExternalPlanSession` following the `validateAuthoredPlanBlock` pattern; owner-scoped `firestore.rules` + emulator coverage; the published JSON schema as a doc the athlete pastes into their AI prompt. | Date-keyed matches every other per-day collection here and avoids the 1 MB document ceiling a 12-week embedded plan would approach. |
| **B. Adjudication** | New `engine/externalSession.ts` exporting an `adjudicateExternalSession` returning `{ decision: 'proceed' \| 'scale' \| 'substitute' \| 'defer' \| 'skip', scaledDose?, substitute?, gateFailures, rationale, telemetry }`. Widen `eligibility.ts` to `GateableSession`. Reuse `evaluateReadinessAndSafetyEnvelope` and `resolveExecutionDose` unchanged. | The core. Pure and synchronous, so it is cheap to test exhaustively. |
| **C. Mode wiring** | Extend `PlanningMode`; teach `resolvePlanningContext`; branch `evaluateTrainingWithIntent`. Intent still resolves (fatigue, periodization, microcycle) because phase D consumes it. No external session for today → fall back to the engine's own pick, **labelled as a fallback**, never silently. | |
| **D. Advisory layer** | The conflict/critique surface described above. | Core scope, not polish. |
| **E. UI** | Import screen (paste → validate → preview → confirm); today's session with its verdict banner and gate explanation; adherence via the existing prompt. | Largest in wall-clock terms, smallest in risk. |
| **F. Provenance** | `RecommendationAudit` gains `externalPlan: { planId, sessionId, contentHash }`. The content hash is not optional — imported plans are mutable by re-paste, and replay must know which version was adjudicated. `POLICY_VERSION` bump (`check-policy-drift.mjs` will enforce it). | Small, non-negotiable under ADR-0010. |

**Explicitly out of scope for v1:** LLM parsing (option B); imported sessions participating in weekly allocation, role reservation, or sequence search; a plan-authoring UI beyond accept/reject/adjust-dose; Garmin workout export for imported sessions; auto-adaptation of an imported plan.

**Decisions to record as an ADR before implementation:** the synthetic-template shim (and why not a union type); the evidence-tier rung for authored-external sessions; the `alreadyTrainedToday` interaction; and the staleness answer (manual re-import vs. context-brief export).

---

## Recommendation

Proceed to a detailed plan, conditional on one answer: **will the plan be supplied as schema-conforming JSON from the athlete's AI (option A)?**

- **Yes** → build it. Phases A–D are a genuinely modest amount of code relative to what is already here, because the adjudication half of the engine is reusable as-is and the hard estimation problem was already solved by the Phase 5.5 evidence ladder. The result is a coherent product: external AI owns the macrocycle, this engine owns today, and the advisory layer is something neither half could produce alone.
- **No, it has to accept prose** → do not build it here yet. Option B's infrastructure and its conflict with the replay contract change the risk profile enough to warrant a separate decision.

Nothing about this proposal requires deleting the existing planner. `evergreen` and `event_directed` remain; `externally_planned` joins them. If the imported-plan experience proves better in practice, the planner quietly becomes the fallback — which is a much cheaper way to find out than a fork.
