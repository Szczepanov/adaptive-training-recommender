# Recommender history semantics, repeated-session recommendations, and strength-frequency gap

**Date:** 2026-09-30
**Scope:** recommendation engine, Garmin-completed training semantics, canonical performed-training facts, weekly role coverage, cycling Base-phase planning, and strength/power frequency
**Status:** analysis only; no recommendation policy is changed by this document

## Reported production symptom

A real athlete reported this sequence:

- Sunday: completed cycling tempo, approximately 3 x 15 min.
- Monday: the app recommended tempo cycling again.
- Tuesday: completed approximately 90 min Zone 2 cycling.
- Wednesday: the app recommended Zone 2 again.
- Across the same period, strength/power gym sessions appeared materially less frequently than expected.

The Wednesday Home screen showed:

- Garmin synced successfully;
- recommendation: **Zone 2 Spin**, 30-60 min, Easy Endurance;
- phase explanation: **Base**;
- approximately **312 days** to the A cycling event.

The athlete's current external M01 training contract expects, in a normal week, approximately one controlled cycling-quality exposure and two real strength/power exposures, with the remaining cycling predominantly aerobic. That makes the tempo-after-tempo behavior particularly suspicious. Consecutive Zone 2 days are not inherently wrong, however; they are common in a cycling base phase. The important question is whether the previous Zone 2 work was recognized and credited, not whether every recommendation must be a different modality.

## Executive conclusion

The evidence does **not** point to one simple "Garmin labels activities incorrectly" bug.

There are at least four separate mechanisms, and three are high-confidence code-path findings:

1. **A far-out cycling event can put the engine in event-directed / structured-plan mode while the structured cycling plan has no active block.** The current cycling plan starts only 84 days before the race. At ~312 days out, periodization correctly says Base, but the plan-derived weekly-objective branch returns an empty objective set instead of falling back to Base/evergreen objectives. Coverage is empty for the same reason. When no objectives are unresolved, the optimizer explicitly gives Easy Endurance / Zone 2 a default preference. This is a strong explanation for repetitive Zone 2 behavior and for strength disappearing from weekly programming.

2. **Garmin ingestion now computes a richer physiological classification than the recommendation history consumes.** Issue #809 introduced persisted `stimulusDomain` values such as endurance, tempo, threshold, VO2, race, and strength, plus a separate `sessionCost`. The live completed-training path still builds stimulus primarily from coarse modality x `intensityTag`; it does not consume `stimulusDomain`. A Garmin activity can therefore be classified correctly at sync time and still lose the distinction before recommendation scoring.

3. **Canonical performed-training coverage is deliberately exact-identity only today.** Garmin-only sessions normally have no catalog workout identity, so a 90-minute Garmin endurance ride cannot satisfy the authored `aerobic_volume` role and a Garmin tempo workout cannot satisfy an exact `sustained_quality` role. `semantic_confident` credit exists in the model but is explicitly disabled. This fail-closed design protects role semantics, but it can make the product recommend a role the athlete has clearly already performed outside the app.

4. **Strength frequency has a second policy mismatch.** #801 preserved a second compact strength/power exposure only inside an active cycling **build** block and only when durable intent explicitly includes `strength_muscle`. At ~312 days out there is no active structured cycling block at all, so even that protection is not active. This is not primarily a Garmin classification failure.

The most important immediate fix is therefore **not to retune Garmin classification thresholds**. First fix planning authority outside the 84-day structured event-plan horizon, then preserve performed stimulus semantics end-to-end, then decide where semantic provider evidence is strong enough to satisfy exact weekly programming roles.

---

## 1. Finding A — structured cycling plan shadows Base planning outside its own horizon

### Current authority chain

`evaluatePeriodizationPhase()` keeps a scheduled future event as `focusEvent` regardless of how far away it is. For a race more than 84 days away it returns:

- `phaseName: 'Base'`;
- a Base/event-blended demand vector;
- the future event as `focusEvent`.

That part is coherent.

`resolvePlanningContext()` then selects `event_directed` when:

- an eligible focus event exists; and
- the profile is legacy/null or explicitly `event_directed`.

For a cycling event it also reports `eventStrategy: 'structured_plan'`, because `resolvePlanDefinitionForEvent()` can build a cycling plan.

The problem is that `buildCyclingEventPlan()` only authors these normal training blocks:

- build: race date -84 through -36 days;
- peak: -35 days through taper;
- taper/race/recovery around the event.

There is **no structured Base block** before -84 days.

### Objective consequence

`generateWeeklyObjectives()` checks only whether a `planDefinition` exists and has objectives. Once that is true, it enters the plan-derived branch.

It then searches for an active plan block on today's date. At ~312 days out there is none, so:

- `activeBlock = undefined`;
- `activeBlockIds` is empty;
- every plan objective is filtered out;
- the function returns an empty objective list.

It does **not** continue to the generic `objectivesFromDemand()` Base branch.

This means the existence of a future structured cycling plan suppresses the generic Base objectives even though the plan is not active yet.

### Coverage consequence

`buildCoverageState()` follows the same temporal contract. With a plan definition but no active block, it returns:

- `phase: null`;
- `requirements: []`.

Therefore neither exact weekly cycling roles nor strength roles are available to ranking during this far-out Base period.

### Ranking consequence

In `optimizer.ts`, when `unresolvedObjectives.length === 0`, Easy Endurance / Zone 2 candidates receive a **1.25 multiplier** unless the recent hard-session streak pushes the engine toward recovery.

This creates a direct path from:

> future cycling event exists -> structured plan selected -> no active block -> no objectives/coverage -> Zone 2 default boost.

That matches the reported screenshot unusually well: the UI says **Base, 312 days out**, while the recommendation is the generic Zone 2 default.

### Why this also affects strength

The generic Base objective generator always includes a strength-maintenance objective. The structured plan branch suppresses it outside the plan horizon.

Likewise, #801's second compact strength/power role is authored only into `block_build`, which does not exist on the current date.

So at ~312 days out the current code can have:

- no plan-derived strength objective;
- no primary-strength coverage requirement;
- no second compact-strength support requirement.

This is a more direct explanation for "strength/power is rarely recommended" than Garmin labeling.

### Recommended architecture

Do not let a future structured plan claim authority on dates it does not cover.

Preferred solution:

- introduce one shared resolver that answers **"is there an active authoritative structured block for this date?"**;
- only use plan-derived objectives/coverage when the answer is yes;
- otherwise fall back to the appropriate Base/evergreen authority.

Two implementation shapes are reasonable:

**Option A — explicit Base block**
- Extend the cycling plan with a Base block before -84 days.
- Populate that block from evergreen/durable-intent policy rather than duplicating hard-coded event-build roles.

**Option B — active-plan fallback**
- Keep the event plan intentionally scoped to the final 84 days.
- If no block is active, treat the structured plan as inactive for this date and resolve Base objectives/coverage from evergreen/demand-derived policy.

Option B has the cleaner authority boundary: a plan cannot shadow dates it does not own.

### Required regression tests

- cycling A event 312 days away -> non-empty Base objectives;
- the same date retains strength programming from durable intent;
- -85 days -> still Base/evergreen authority;
- -84 days -> deterministic transition to structured build;
- no objective/coverage discontinuity on the boundary;
- UI reason remains Base while the decision trace reports the actual objective/coverage authority.

---

## 2. Finding B — Garmin classification is richer than the recommender's consumed history

### Ingestion is already capable of distinguishing tempo from endurance

`src/garmin_sync/intensity_classification.py` implements classification version 2 and separates:

- physiological stimulus domain;
- coarse intensity tag;
- total session cost.

The persisted stimulus vocabulary includes:

- recovery;
- endurance;
- tempo;
- threshold;
- VO2;
- anaerobic;
- mixed;
- race;
- strength;
- unknown.

For cycling, the classifier can use:

- intensity factor;
- power-zone high-intensity share;
- HR-zone distribution when appropriate;
- anaerobic Training Effect;
- a legacy fallback only when richer evidence is unavailable.

`mapper.py::normalize_activity()` persists:

- `stimulusDomain`;
- `sessionCost`;
- `intensityEvidence`;
- `intensityClassificationVersion`.

So the first diagnostic question for the Sunday 3 x 15 session should be:

> What did the normalized Garmin activity actually contain?

We should inspect, for that activity:

- activity type;
- `stimulusDomain`;
- `intensityTag`;
- `sessionCost`;
- `intensityEvidence`;
- classification version;
- IF;
- power zones;
- HR zones;
- Training Effect.

Without those fields we should **not** assert that Garmin mislabeled the session.

### The live completed-training path drops the domain

`app/src/engine/completedTraining.ts::candidateEventFromGarmin()` currently derives:

- modality from the Garmin activity type;
- intensity from `intensityTag`;
- fatigue-cost row from `sessionCost`.

But the default estimated stimulus is still:

> `DEFAULT_STIMULUS_BY_MODALITY[modality][intensity]`

The function does not use `activity.stimulusDomain`.

Therefore two cycling sessions with materially different semantics can collapse into similar history:

- endurance ride, moderate tag;
- tempo ride, moderate tag.

Both receive the same generic Cycling/moderate stimulus profile unless a stronger exact/zone path takes over.

The optional direct power-zone stimulus path is policy-gated; the default remains training-effect/coarse-history behavior.

### Why that matters for Sunday tempo -> Monday tempo

Plan objective credit is computed from the `CompletedExposure.stimulusProfile`, not directly from Garmin's persisted `stimulusDomain`.

The generic Cycling/moderate profile contains only modest threshold credit. It can therefore fail a threshold/quality qualification even when the provider classifier already called the real workout `tempo`.

At the same time:

- provider-only history normally has no exact session category such as `Race-Specific Endurance`;
- exact template recency cannot recognize an independently recorded Garmin workout;
- generic sequence logic mostly reasons from hard/key cost and category, not from a preserved "tempo was performed yesterday" fact.

The result can be a same-family recommendation the next day.

### Recommended fix direction

Carry a provider-neutral performed stimulus classification into the canonical/history boundary. Do not re-read raw Garmin payloads in the optimizer.

A useful canonical fact should be able to state, with provenance:

- modality;
- stimulus domain;
- session cost;
- duration;
- evidence tier/source;
- classification version;
- optional exact workout/template identity;
- confidence.

Then map that fact once into:

1. physiological objective credit;
2. sequence/recency features;
3. stress accounting;
4. potentially, under a separately versioned policy, semantic weekly-role coverage.

Do not add another Garmin-specific branch to `optimizer.ts`.

---

## 3. Finding C — canonical performed-training cutover is only partial

`trainingIntent.ts` explicitly documents the current state:

> canonical performed-training facts are used for narrow recency/spacing cutovers, while legacy history remains fatigue/objective/microcycle authority.

That split is visible in production wiring:

- operational history comes from `firestoreTrainingHistoryProvider`;
- that provider reconstructs from raw activities + recommendation adherence;
- canonical `PerformedTrainingFactsSnapshot` is loaded separately;
- canonical facts are currently used for narrow decisions such as strength spacing and coverage identity.

This is an intentional migration state, but it means the engine has two different views of "what happened."

### Provider-only canonical facts are broad

For a provider-only Garmin occurrence, `deriveFactsFromOccurrence()` currently preserves broad modality and provenance, but not the new Garmin `stimulusDomain`.

So even the canonical occurrence layer cannot currently answer:

> This was a cycling tempo exposure.

It can answer:

> This was a cycling exposure with measured/provider evidence.

### Strength is ahead of cycling quality here

`strengthSpacingPolicy.ts` already uses broad canonical strength facts to prevent adjacent broad/full/lower-body strength sessions, even when exact workout identity is unknown.

That is the right architectural pattern:

- broad performed fact can influence safe recency/spacing;
- exact weekly role credit remains stricter.

Cycling quality needs an analogous semantic recency layer rather than relying on exact template identity or generic hard-session heuristics.

---

## 4. Finding D — exact weekly-role coverage makes Garmin-only work invisible to authored roles

`coverage.ts` intentionally separates:

- physiological stimulus credit; and
- programming-role coverage.

That separation should be retained.

However, canonical production coverage currently accepts only `creditKind === 'exact'`.

The code explicitly states that `semantic_confident` is disabled until a separate policy defines its semantics and thresholds.

Consequences:

- a Garmin-only 90-minute endurance ride has no exact `cycling_zone2_standard_01` identity, so it cannot satisfy `aerobic_volume` coverage;
- a Garmin-only tempo/threshold session cannot satisfy exact `sustained_quality` coverage;
- a generic Garmin strength session can prove that strength happened for spacing, but it must not fabricate exact `primary_strength` role completion.

The fail-closed behavior is defensible, but the product needs a way to distinguish:

> "I cannot prove this exact authored role was executed"

from:

> "No equivalent training happened."

Today those can produce the same user-facing consequence: another recommendation for the role.

### Recommended staged policy

Do **not** immediately make every Garmin domain satisfy every exact role.

Stage the cutover:

1. **Semantic recency first**
   Use confident performed domain facts to prevent nonsensical same-family adjacency and to improve decision explanations. This does not grant exact coverage.

2. **Physiological credit second**
   Derive the completed stimulus profile from the persisted domain/evidence instead of coarse modality x intensity.

3. **Selective semantic coverage last**
   Enable `semantic_confident` only for roles with a precise, auditable equivalence rule.

A good first candidate is aerobic-volume coverage, because it can require all of:

- Cycling modality;
- `stimulusDomain === 'endurance'`;
- classification version >= 2;
- sufficiently strong evidence source;
- completed duration >= athlete-relative aerobic-volume floor;
- no contradictory high-intensity structure;
- canonical occurrence is active and deduplicated.

Tempo/threshold quality is more nuanced and should have its own authored equivalence contract.

---

## 5. Finding E — same-session variety logic cannot recognize Garmin-only equivalents

The optimizer has a late variety tie-breaker that tries to avoid recently used templates. It searches raw history text for:

- exact template id;
- exact template title.

A provider-only Garmin activity does not carry either identity, so this tie-breaker cannot know that yesterday's workout was semantically the same as today's candidate.

Separately, the sequence policy reasons about:

- whether the previous session was high intensity;
- days since a key session;
- whether a candidate is key/recovery/long endurance.

A tempo workout can be correctly classified as `tempo` / moderate rather than "hard." If the domain is not carried into history and no exact category exists, it can avoid both the high-intensity and exact-template protections.

### Recommended policy shape

Add one provider-neutral recent-stimulus feature rather than a workout-title heuristic, for example:

- last performed endurance date;
- last performed tempo/sustained-quality date;
- last threshold/VO2 date;
- last race/mixed-hard date;
- last strength date;
- confidence/provenance for each.

Use it as a sequence input.

Important: **do not introduce a blanket "never repeat the same domain on consecutive days" rule.**

- tempo/threshold quality repeated on consecutive days should normally be strongly disfavored unless explicitly authored;
- Zone 2 on consecutive days can be entirely correct;
- the engine should distinguish "valid repeated aerobic volume" from "the previous aerobic session was ignored."

---

## 6. Strength/power frequency: why #801 does not fully solve this case

Issue #801 correctly identified and fixed a planning-mode boundary:

- evergreen hybrid planning may require two resistance exposures;
- the cycling event plan originally authored one primary-strength role;
- #801 added a second compact strength/power **support** role when durable intent explicitly includes `strength_muscle`.

Current code preserves that distinction:

- exactly one `primary_strength` role;
- a second `compact_strength` support role;
- support cannot displace primary cycling anchors.

However, the second role is authored only into `block_build`, and `block_build` starts 84 days before the cycling event.

At ~312 days out, neither the first nor second structured event-plan strength role is active because the plan has no active Base block.

Therefore the current symptom should not be "fixed" by weakening strength-spacing or teaching Garmin to call more activities strength.

The authority gap must be fixed first.

### Current athlete-plan mismatch

The current external M01 plan expects:

- two meaningful strength/power sessions per normal week;
- one controlled cycling-quality session;
- predominantly easy cycling around those exposures.

A far-out A-event should not erase this near-term mesocycle contract.

Long term, the product should have an explicit precedence model such as:

1. safety/tissue constraints;
2. active authored near-term block / mesocycle;
3. durable training intent and physical-capital floors;
4. future event periodization;
5. candidate preference/tie-breaking.

A race 312 days away is context, not sufficient authority to replace the athlete's current Base/reconditioning architecture.

---

## 7. What is probably happening in the reported sequence

### Sunday tempo -> Monday tempo

**High probability of a real recommendation defect.**

Likely contributing mechanisms:

- far-out cycling event creates structured-plan authority but no active block;
- no Base strength/quality objectives survive;
- provider tempo semantics are not carried into the operational history;
- provider-only workout earns no exact sustained-quality role coverage;
- exact-template variety cannot recognize it;
- moderate tempo may not trigger high-intensity adjacency logic.

The correct behavior for the current M01 contract would normally be to recognize Sunday's quality work and avoid immediately prescribing another equivalent quality exposure on Monday unless there is an explicit reason.

### Tuesday 90 min Zone 2 -> Wednesday Zone 2

**Not sufficient evidence of a bug by itself.**

Back-to-back easy cycling can be appropriate during Base.

But there are two possible defects hidden inside the apparently reasonable recommendation:

1. Tuesday's 90 minutes may not have received exact aerobic-volume role credit because it was Garmin-only.
2. The Wednesday explanation may therefore be based on "aerobic role still missing" / generic defaulting rather than an informed decision to add another low-cost aerobic dose.

The fix is not forced modality rotation. The fix is to make the engine know that Tuesday's endurance ride happened and explain why more endurance is still appropriate.

### Rare strength/power

**High probability of an authority/frequency problem, not primarily a Garmin-label problem.**

At 312 days out the structured event plan has no active block; the generic Base strength objective is shadowed; #801 support strength is inactive outside build.

---

## 8. Diagnostics we should add before changing classification thresholds

Add a bounded "performed training interpretation" section to engine scoring telemetry / Copy AI Context.

For each recent canonical occurrence, expose diagnostic fields such as:

- local date;
- occurrence id;
- source kinds;
- modality;
- exact workout/template identity when present;
- Garmin `stimulusDomain`;
- `intensityTag`;
- `sessionCost`;
- evidence source;
- classification version;
- canonical coverage credits;
- derived physiological stimulus credit;
- whether it counted as a recent key/quality/strength exposure;
- whether it satisfied any weekly coverage role.

For a selected recommendation, include:

- active planning mode;
- periodization phase;
- active structured block id or **none**;
- objective authority: structured / evergreen / generic fallback;
- unresolved objectives;
- unmet coverage roles;
- performed stimulus recency used by sequence logic;
- why the previous day's session did or did not count.

This turns the current debugging question from speculation into an auditable trace.

---

## 9. Proposed implementation sequence

### P0 — fix plan authority outside structured-plan coverage

Goal: eliminate the Base objective/coverage vacuum.

- Introduce an active-block-aware authority resolver.
- A structured event plan affects today's objective/coverage decision only when it owns today's date.
- Otherwise resolve Base/evergreen objectives and coverage.
- Preserve the future event for periodization context and UI explanation.
- Add boundary tests at >84, 85, 84, 36, 35 days.

This is the smallest fix with the largest expected effect on the current screenshot.

### P1 — preserve stimulus-domain semantics through canonical performed facts

- Extend performed exposure facts with provider-neutral stimulus domain / session cost / provenance.
- Structured execution remains semantic authority when it exists.
- Garmin supplies measured provider semantics when structured semantics are absent.
- Do not persist duplicate recommendation-specific interpretations into the occurrence record; derive versioned facts.

### P2 — use domain-aware history for objective credit and sequence decisions

- Replace coarse modality x intensity stimulus estimation when versioned domain evidence is available.
- Feed canonical performed semantic recency into sequence logic.
- Preserve legacy behavior for records without classification version/evidence.
- Avoid direct provider dependencies in optimizer.

### P3 — selective semantic coverage

- Define an explicit ADR/policy for `semantic_confident`.
- Start with narrowly provable roles such as sufficiently long endurance/aerobic volume.
- Keep exact primary strength and complex quality roles strict until equivalent evidence rules are authored.
- Record why semantic credit was accepted/rejected.

### P4 — align Base hybrid strength/power frequency with durable intent / active mesocycle

- Ensure two resistance/power exposures survive when the athlete's durable/current plan calls for them and capacity/recovery permit.
- Reuse #801's primary-vs-support distinction.
- Do not create a second heavy-lower-body mandate.
- Keep the second support exposure removable for recovery, hard cycling anchors, taper, time caps, or tissue constraints.

---

## 10. Acceptance-test matrix

### Planning authority

- [ ] Cycling A event ~312 days away + event-directed profile produces non-empty Base objectives.
- [ ] Same case produces explicit strength programming from durable/current intent.
- [ ] No structured coverage state is presented as active before its first block.
- [ ] Transition at -84 days is deterministic and does not duplicate objectives.
- [ ] The UI can still say "312 days to A event / Base" without giving that inactive event plan false day-level authority.

### Garmin semantic history

- [ ] Cycling activity classified `tempo` at ingestion remains identifiable as tempo at the recommendation-history boundary.
- [ ] Cycling `endurance` and `tempo` with the same coarse intensity tag no longer collapse to identical performed semantics.
- [ ] Legacy/unversioned activities keep explicit fallback behavior; they are not silently reinterpreted.
- [ ] Athlete override provenance remains stronger than provider inference.
- [ ] Structured execution + Garmin activity reconciles to one occurrence and is counted once.

### Repetition behavior

- [ ] A confident performed tempo/sustained-quality exposure can influence next-day sequence decisions without requiring exact template identity.
- [ ] Next-day equivalent tempo is strongly deprioritized/blocked according to the sequence policy when no explicit plan calls for it.
- [ ] Consecutive Zone 2 remains possible when the weekly volume plan justifies it.
- [ ] When consecutive Zone 2 is selected, rationale can state that the prior endurance dose was recognized and why additional volume is still useful.
- [ ] Exact-template variety remains a secondary tie-breaker, not the only way to detect repeated stimulus.

### Coverage

- [ ] Garmin-only sessions do not fabricate exact workout identity.
- [ ] Exact structured completion continues to earn exact role coverage.
- [ ] If semantic aerobic-volume credit is activated, it requires versioned/high-confidence evidence and the athlete-relative duration floor.
- [ ] Semantic-credit decisions are visible in the decision trace.

### Strength/power

- [ ] Far-out Base phase does not silently lose the general strength objective.
- [ ] A hybrid athlete whose current/durable contract requires two weekly resistance/power exposures receives one primary plus one support exposure when feasible.
- [ ] Generic Garmin strength can block an unsafe/consecutive strength recommendation without falsely claiming exact primary-strength role completion.
- [ ] Taper, adverse recovery, capacity and anchor constraints can still reduce/defer the support exposure.

---

## 11. Related existing work

This analysis intersects existing work rather than replacing it:

- **#809** — correctly split stimulus intensity/domain from total session cost. The remaining gap is downstream consumption of that richer classification.
- **#801** — preserves a second strength/power support role inside cycling build when durable intent calls for it. The remaining gap is Base authority outside the 84-day structured horizon.
- **ADR-0034** — establishes one physical workout = one canonical occurrence and structured-vs-provider source authority. This analysis should continue that cutover rather than add a parallel history model.
- **#895** — canonical/lossless structured execution and provider enrichment. The recommendation-history cutover should use the same occurrence authority.
- **#813** — proposes lower-body stress and physical-capital ledgers. A canonical stimulus-domain fact is shared infrastructure, but recommendation policy should remain owned by the engine rather than the context exporter.
- `docs/analysis/strength-recommendation-occurrence-credit-gap-2026-09-02.md` — previous analysis of completed strength being visible to the user but invisible to recommendation authority. The current code has improved broad strength spacing, but the same class of "performed work exists but the relevant planner ledger cannot consume it" remains for cycling semantics/coverage.

---

## 12. Policy/versioning notes

Several proposed fixes are recommendation-affecting and must follow existing policy governance:

- P0 changes planning authority and therefore recommendation behavior.
- P2 changes how performed provider evidence earns objective/sequence effect.
- P3 changes exact/semantic coverage semantics.
- P4 may change weekly strength frequency.

Each must review `POLICY_VERSION`, deterministic replay, decision trace, policy-alignment tests, and simulation/persona expectations under the repository's existing ADR rules.

Do not bundle all phases into one opaque behavioral change. The Base-plan authority fix can be isolated and regression-tested before semantic-credit policy is activated.

---

## Recommended decision

Treat this report as **two confirmed architecture defects plus one deliberate-but-user-visible policy gap**:

1. **Confirmed:** an inactive future cycling structured plan can shadow Base objectives/coverage.
2. **Confirmed:** persisted Garmin `stimulusDomain` is not consumed by the default completed-training stimulus path.
3. **Deliberate current policy, but incomplete product behavior:** canonical role coverage is exact-only, so Garmin-only equivalent sessions cannot close authored roles.

Fixing only Garmin labels would leave the first and third problems intact. Fixing only the far-out Base plan would improve strength frequency but still allow semantic repetition after independently recorded Garmin sessions.

The end state should be:

> one canonical performed occurrence, one preserved provider-neutral stimulus interpretation, one physiological-credit ledger, one programming-role ledger, and a date-local planning authority that never lets an inactive future plan erase current Base training.
