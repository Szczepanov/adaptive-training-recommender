# Event taxonomy + HYROX fitness-race implementation plan

| | |
|---|---|
| **Status** | Ready for P0 implementation after review |
| **Source** | Product request: add HYROX `2027-04-10` and reconcile missing event types/formats rather than shipping a one-off dropdown value |
| **Analysis** | [`2026-10-05-event-taxonomy-fitness-race-hyrox.md`](../analysis/2026-10-05-event-taxonomy-fitness-race-hyrox.md) |
| **Baseline** | `origin/main` `aaca00d3026511eedc029f205312bb284d00bd66` (2026-10-05) |
| **Blocked by** | Nothing for the taxonomy/runtime refactor. HYROX numeric demand/taper calibration must pass Sports Knowledge Registry review before becoming decision authority. |
| **Policy effect** | **Yes in P0 implementation.** Event-specific objective, taper, modality and ranking behavior can alter persisted recommendations; bump `POLICY_VERSION`. |
| **Knowledge impact** | **Yes.** Revise/version the existing `policy.event_demand.presets_v1` product-policy claim and coverage/alignment tests. |
| **This PR** | Documentation only. No policy/version/code changes in the planning PR. |

## 1. Goal

Deliver a bounded first-class event-taxonomy slice that lets an athlete create a HYROX Open Singles event and causes the training system to understand enough of that event to plan meaningfully for it.

P0 must also prevent the next missing event from requiring another ad-hoc enum/dropdown patch. It should establish one resolver boundary for event-format semantics while preserving current persisted goals and the existing 19 presets.

At the end of P0:

- the Goals UI can create `fitness_race / hyrox_open_singles`;
- the Goals UI can create `other_event / custom` for unsupported competitions without misclassifying them;
- the planner understands HYROX-specific Running + station/strength requirements;
- at least two weekly specificity objectives distinguish HYROX from a standalone running race;
- the catalog has qualifying sessions for those objectives;
- taper policy does not require manipulating A/B/C priority to express an event-specific window;
- the recommendation audit can attribute the changed behavior to a new `POLICY_VERSION` and reviewed Sports Knowledge Registry lineage;
- all pre-existing event categories/presets preserve their behavior unless a test proves an intentional migration.

## 2. Non-goals

P0 must not:

- redesign the entire goal schema into separate family/format/division/class persistence fields;
- replace the seven-axis `EventDemandProfile`;
- claim full HYROX Pro/Doubles/Relay support without implementing their load/work-sharing differences;
- automatically classify DEKA, Spartan/OCR or CrossFit competitions as equivalent to HYROX;
- hard-code the motivating athlete's priority, race result target or macrocycle into general product policy;
- bypass equipment constraints to force sled/erg/station sessions;
- introduce a separate HYROX-only planner beside the shared weekly objective/optimizer path;
- change safety, injury, readiness or recovery authority;
- change existing event taper semantics except where required to introduce a generic preset-aware resolver with compatibility tests;
- persist calculated demand vectors on `UserGoal` documents.

## 3. Fixed design decisions

### D1 — `fitness_race` is the root event family

Add `fitness_race` to `UserEvent['category']`.

Do not add top-level `hyrox`. The root category describes a stable competition family; HYROX is a format/preset within it.

### D2 — P0 first-class format is `hyrox_open_singles`

P0 guarantees specific planning semantics only for HYROX Open Singles.

Pro Singles, Doubles and Relay may be listed in follow-up work, but should not be selectable as “fully supported” unless their distinct station load/work-sharing semantics are represented. If implementation wants to expose them earlier, it must first add an explicit support-state contract and ensure non-specific variants cannot silently govern training as if they were Open Singles.

### D3 — unsupported competitions get `other_event / custom`

Add a competition-specific generic fallback rather than abusing `general_target`.

`general_target` remains a dated non-competition target. `other_event/custom` receives generic event timing/phase handling only and no fabricated sport-specific modality/objective/taper semantics.

The UI must label this limitation.

### D4 — keep persisted `eventCategory + eventPreset` in P0

Do not perform a broad schema migration for family/format/division yet. Existing documents remain readable and require no backfill.

Longer-term decomposition can be revisited after at least two structurally different fitness-race formats or division-specific behaviors need independent persistence.

### D5 — one resolver owns event-format semantics

Extend the preset layer so callers can resolve more than a demand vector.

Conceptual API:

```ts
interface ResolvedEventPreset {
  id: string;
  label: string;
  demandProfile: EventDemandProfile;
  specificModalities: SessionTemplate['modality'][];
  objectiveTags: EventSpecificObjectiveTag[];
  supportLevel: 'generic' | 'specific';
  taperPolicyId?: string;
}

resolveEventPreset(category, preset): ResolvedEventPreset;
```

Exact type/function names may differ. The invariant is that periodization, objective synthesis, taper and UI support metadata consume the same canonical resolution instead of growing separate category switches.

Existing presets can initially inherit category defaults so P0 does not require rewriting all 19 definitions in one change.

### D6 — retain the generic seven-axis demand model

Do not add HYROX-only scalar axes to `EventDemandProfile` in P0.

The seven current axes remain the cross-sport demand basis. HYROX specificity that is not representable there is modeled as event-specific weekly objectives/qualification metadata.

### D7 — P0 adds two explicit fitness-race objective keys

Add at minimum:

```ts
'compromised_running'
'station_strength_endurance'
```

These objectives prevent a week consisting only of an independent run and ordinary strength-maintenance session from falsely satisfying HYROX specificity.

Do not split grip, carry, transition and every station into independent weekly objective keys until the optimizer actually needs that granularity. Use qualifying template roles/metadata to cover those details in P0.

### D8 — event-specific taper is distinct from event priority

Priority answers “which event matters more?” Taper policy answers “how should load change near this format?” They must not be conflated.

Keep explicit authored `event.taper.startDate` as highest authority. Add a preset/family taper resolver beneath it and above the legacy priority fallback only after its calibration is registered as product policy.

Do not encode the desired taper by changing a B-like event into A.

### D9 — knowledge and policy version ship atomically with deciding behavior

The implementation PR that first lets HYROX-specific metadata change objectives/candidates/taper/ranking must:

- revise/version the event-demand product-policy claim;
- update knowledge coverage/alignment tests;
- add any additional product-policy taper/objective claims needed;
- bump `POLICY_VERSION`.

A UI-only intermediate state must not claim first-class support.

## 4. P0 work breakdown

## P0.0 — exhaustive event-semantics inventory before edits

**Purpose**

The current known consumers include `models.ts`, `eventPresets.ts`, `periodization.ts`, `taperPolicy.ts`, `Goals.tsx` and the periodization/event-demand knowledge pack. Before changing the enum, enumerate every exhaustive category/preset consumer so no stale switch or validator rejects the new values.

**Search set**

Search at least:

```text
cycling_event
running_race
triathlon
strength_meet
general_target
eventCategory
eventPreset
EVENT_PRESETS
modalitiesForEventCategory
resolveDemandProfile
```

across:

- `app/src/**`
- `app/scripts/**`
- `app/firestore.rules`
- scenario/persona fixtures
- docs/architecture and ADRs whose statements describe the category mapping

**Output**

Capture the final touched-consumer list in the implementation PR description. Any intentionally unchanged consumer must have a reason.

## P0.1 — taxonomy types, validation and backward compatibility

**Primary files**

- `app/src/engine/models.ts`
- goal validation/parser/service files discovered in P0.0
- Firestore rules only if event category/preset values are constrained there
- focused model/validation tests

**Implementation**

1. Extend `UserEvent['category']` with:
   - `fitness_race`
   - `other_event`
2. Preserve all existing enum values.
3. Preserve optional `UserGoal.eventPreset` storage shape.
4. Ensure create/update/read validation accepts the two new categories and rejects arbitrary category strings.
5. Ensure `other_event/custom` is legal only as a dated competition goal under the same event-field coherence rules as current events.
6. Do not persist `EventDemandProfile` or resolver metadata on the goal.
7. Verify old documents with any of the existing five categories parse unchanged.

**Tests**

- all legacy category fixtures still validate;
- `fitness_race` + known preset validates;
- `other_event` + `custom` validates;
- malformed category still fails;
- category change resets/revalidates incompatible preset in UI/service path;
- no migration is required for old goals.

## P0.2 — turn `eventPresets.ts` into the canonical format resolver

**Primary files**

- `app/src/engine/eventPresets.ts`
- `app/src/engine/eventPresets.test.ts`
- any architecture tests asserting category/preset exhaustiveness

**Implementation**

1. Extend `EventPreset`/resolved metadata with the minimum fields required by D5.
2. Add compatibility defaults for the current five categories so old presets preserve current behavior.
3. Add:

```text
fitness_race / hyrox_open_singles
other_event / custom
```

4. HYROX Open Singles:
   - `supportLevel: specific`;
   - specific modalities include Running and Strength;
   - Cross Training may be included only if the qualifying catalog sessions intentionally use that modality;
   - objective tags include `compromised_running` and `station_strength_endurance`;
   - receives a reviewed seven-axis demand vector as product calibration.
5. `other_event/custom`:
   - `supportLevel: generic`;
   - neutral/default demand vector;
   - no specific modalities;
   - no event-specific objective tags;
   - no event-specific taper policy.
6. Preserve deterministic fallback for stale preset ids, but return support/diagnostic metadata so fallback cannot be mistaken for an explicitly selected specific format.

**Important**

Do not silently copy a running or strength preset vector and call it HYROX calibration. Review the vector against the event morphology and register the exact values in Sports Knowledge as product policy.

## P0.3 — UI taxonomy and honest support messaging

**Primary files**

- `app/src/components/Goals.tsx`
- `app/src/components/Goals.css` only if a support note/badge needs styling
- Goals component tests

**Implementation**

1. Add labels:
   - `fitness_race: Fitness race`
   - `other_event: Other event`
2. Rename **Event style** -> **Event format**.
3. Populate formats from the canonical preset registry exactly as today, including the new categories.
4. Show a compact limitation note for `supportLevel: generic`, e.g. “Generic event planning; no sport-specific sessions yet.”
5. Do not show Open Singles as generic once the P0 objective/template support is active.
6. Ensure changing category resets an incompatible `eventPreset` to that category's default rather than preserving a stale id.

**Acceptance case**

The athlete can create:

```text
Title: HYROX Warsaw 2027
Date: 2027-04-10
Event type: Fitness race
Event format: HYROX Open Singles
```

without encoding it as an 8 km running race, strength meet or general target.

## P0.4 — preset-owned specific modalities

**Primary files**

- `app/src/engine/periodization.ts`
- optimizer/training-intent consumers found in P0.0
- focused periodization/optimizer tests

**Implementation**

1. Introduce `resolveEventModalities(event)` (or equivalent) backed by the preset resolver.
2. Preserve the current category mappings as defaults for existing presets.
3. Route current consumers away from direct category interpretation where format-specific semantics are required.
4. HYROX Open Singles resolves to the required modalities without adding a one-off `if (preset === 'hyrox_open_singles')` in each consumer.
5. `other_event/custom` resolves to `[]` specific modalities.

**Regression gate**

Existing cycling/running/triathlon/strength modality-selection tests must remain unchanged in outcome.

## P0.5 — fitness-race weekly objectives

**Primary files**

- `app/src/engine/models.ts` (`ObjectiveKey`)
- `app/src/engine/periodization.ts`
- `app/src/engine/microcycle.ts` if qualification/credit requires changes
- coverage/optimizer modules only where required by the existing objective contract
- focused objective/coverage tests

**Implementation**

1. Add objective keys from D7.
2. When the governing specific preset carries the corresponding tags and the event is in the appropriate specificity/peak horizon, add event-specific weekly objectives.
3. Define qualification through existing `WeeklyObjective.qualification` mechanisms where possible.
4. Do not let an ordinary independent easy run satisfy `compromised_running`.
5. Do not let generic strength maintenance satisfy `station_strength_endurance` unless the authored template explicitly carries the qualifying race-specific role/stimulus.
6. Taper may reduce dose/volume while preserving race-specific freshness; do not require a full simulation in race week.
7. Post-event recovery must suppress event-specific quality objectives consistently with existing race-specific branches.

**Design note**

If the existing `qualification` shape cannot distinguish these objectives without adding ad-hoc template IDs to `periodization.ts`, add a small typed template role/tag rather than hard-coding IDs into objective generation.

Suggested roles, if needed:

```ts
'fitness_race_compromised_run'
'fitness_race_station_endurance'
'fitness_race_simulation'
```

Roles belong to template/catalog metadata; weekly objectives consume roles.

## P0.6 — minimum viable HYROX-specific catalog

**Primary files**

- `app/src/engine/templates.ts` and/or the canonical workout/session catalogue used by current objective qualification
- equipment registry/model/validation paths discovered during implementation
- template/catalog tests

**Required capabilities**

P0 should contain enough authored sessions to make both new objectives satisfiable under realistic equipment availability. A minimal family is:

1. **Compromised running session**
   - repeated run segments alternating with bounded functional work;
   - race-specific role `fitness_race_compromised_run`;
   - meaningful cardiovascular/lower-body/systemic cost.
2. **Station strength-endurance session**
   - representative sled/carry/lunge/wall-ball or equivalent station work based on available equipment;
   - role `fitness_race_station_endurance`.
3. **Erg/station conditioning session**
   - SkiErg/row or available equivalents;
   - can qualify station endurance but must not become a universal fallback when equipment is absent.
4. **Partial race simulation**
   - race-specific category/role;
   - intentionally bounded volume; not a weekly full HYROX race rehearsal.

Reuse existing easy run, quality run and general strength templates rather than duplicating them under HYROX names.

**Equipment contract**

Before authoring, inspect the canonical equipment vocabulary and UI. Add new equipment tokens centrally with validation/UI support. Candidate eligibility must exclude a session when required equipment is unavailable.

**Safety contract**

New templates use the same hard feasibility, injury guardrail, recovery spacing, fatigue and time-cap paths as every other template. No HYROX bypass.

## P0.7 — preset-aware taper policy without priority abuse

**Primary files**

- `app/src/engine/taperPolicy.ts`
- `app/src/engine/eventPresets.ts` or a dedicated event-taper calibration registry if that keeps authority cleaner
- taper tests
- Sports Knowledge files in P0.8

**Precedence**

Use this order:

1. explicit authored `event.taper.startDate`;
2. reviewed event-format/family taper policy when present;
3. existing special legacy behavior (including cycling A behavior) where applicable;
4. current generic A/B/C fallback;
5. no taper.

Do not change existing cycling/running/triathlon/strength results while adding the new path.

**HYROX calibration**

Do not merge an arbitrary hard-coded day count merely because one athlete's manual plan uses a particular taper. The implementation must establish the desired Open Singles default as a product-policy calibration, document its basis/limitations in the Sports Knowledge Registry, and test the exact precedence.

If that review is not ready in the first behavior PR, P0 may rely on an explicit authored taper for HYROX and defer automatic format taper to the next PR; it must not fake it through priority.

## P0.8 — Sports Knowledge Registry + policy provenance

**Primary files**

- `app/src/knowledge/periodizationEventDemandKnowledge.ts`
- `app/src/knowledge/periodizationEventDemandKnowledge.test.ts`
- `app/src/knowledge/knowledgeCoverage.ts`
- `app/src/knowledge/knowledgeCoverage.test.ts`
- `app/src/engine/knowledgeLineage.ts` if new claim IDs must be collected
- `app/src/engine/policy.ts`
- `docs/architecture/sports-knowledge-registry.md` only if the implementation changes the documented consumer contract

**Implementation**

1. Update the existing event-demand preset product-policy source/claim so it no longer claims exactly 19 presets after a 20th specific preset exists.
2. Increment the claim version when statement/applicability/preset set changes.
3. Add `fitness_race`/HYROX applicability conservatively.
4. Register exact HYROX demand-vector values as **product calibration**.
5. Add/extend claims for new objective inclusion thresholds or taper defaults when those exact rules are new decision authority.
6. Update coverage inventory and alignment tests so every new policy family has explicit status.
7. Ensure recommendation audit lineage includes the materially consumed claim IDs through the existing knowledge-lineage collector.
8. Bump `POLICY_VERSION` in the same implementation PR that changes persisted recommendation decisions.

**No false certainty**

Official HYROX rules describe the race format. They do not scientifically validate the app's exact normalized 0–1 demand vector, weekly exposure counts or taper day count. Those remain product-policy heuristics unless directly supported by appropriate evidence.

## P0.9 — regression, scenario and acceptance proof

### Unit / architecture tests

Add or update tests covering:

- preset registry exhaustiveness for all categories;
- legacy 19-preset behavior preservation;
- new format resolver fallback semantics;
- category/preset form compatibility;
- `goalToUserEvent` for HYROX and custom event;
- event modality resolution;
- fitness-race objective generation by phase;
- objective qualification/credit;
- taper precedence;
- knowledge claim/version/coverage alignment;
- policy-version expectation if the repository has a decision-policy guard.

### Planner behavior tests

Create deterministic scenarios demonstrating at least:

1. **HYROX specificity** — in the specificity horizon and with equipment available, unresolved `compromised_running`/`station_strength_endurance` can influence candidate benefit and produce qualifying work.
2. **No false independent credit** — a standalone easy run + ordinary maintenance strength do not satisfy both fitness-race-specific objectives.
3. **Equipment degradation** — absent sled/erg/station equipment does not make the plan invalid; impossible candidates are excluded and the rationale/remaining objective makes the gap visible.
4. **Readiness safety wins** — a red/modify/recovery state still suppresses inappropriate race-specific load.
5. **Custom event honesty** — `other_event/custom` does not acquire HYROX modalities/objectives/taper.
6. **Legacy parity** — representative cycling, running, triathlon and strength scenarios are unchanged.
7. **Multi-event coexistence** — an April fitness race can contribute to spring planning without permanently hijacking a later higher-priority cycling A event; governing-event conflict resolution stays under the existing multi-event policy.

### User acceptance scenario

Use a fixture equivalent to:

```ts
{
  title: 'HYROX Warsaw 2027',
  targetDate: '2027-04-10',
  eventCategory: 'fitness_race',
  eventPreset: 'hyrox_open_singles',
  eventLifecycle: 'scheduled',
}
```

The test should prove the goal can be created, resolved into a `UserEvent`, enter periodization, and expose specific fitness-race objectives. Do not bake a user-specific priority into the generic fixture unless the test is explicitly about multi-event conflict resolution.

## 5. P1 — taxonomy expansion after P0 proves the boundary

P1 should use the new resolver rather than adding one-off branches.

Candidate work:

| Family | Proposed direction | Required analysis before first-class support |
|---|---|---|
| HYROX Pro Singles | `fitness_race / hyrox_pro_singles` | station-load scaling and template prescription semantics |
| HYROX Doubles | `fitness_race / hyrox_*_doubles` | shared station work, running remains together, partnership semantics |
| HYROX Relay | `fitness_race / hyrox_relay` | each athlete completes only a subset; goal may be team-role-specific |
| Trail running | new running presets | elevation/surface/technicality/durability metadata |
| MTB/XC/cyclocross | new cycling presets | terrain/technical/anaerobic morphology and equipment context |
| Swimming race/open water | likely `swimming_race` | distance + open-water skill/objective coverage |
| Duathlon/aquathlon | generalized multisport model | avoid assuming triathlon's three modalities |

If adding two or more non-HYROX fitness-race brands exposes a need to store `family`, `format`, and `division` independently, write an ADR before migrating persisted goals.

## 6. P2 — deliberately separate competition semantics

Do not absorb these automatically into `fitness_race`:

- OCR / Spartan-style events — obstacle technique, terrain and grip demands are structural;
- CrossFit competition — event content may be unknown or variable until competition, requiring a different uncertainty/content model;
- arbitrary functional-fitness competitions — use `other_event/custom` until specific support is justified.

The generic fallback exists specifically so the product does not need to lie while these models are absent.

## 7. Suggested implementation sequence

Use separate commits/work packages so behavior changes remain reviewable.

1. **WP0 — taxonomy/resolver foundation**
   - enum additions;
   - preset metadata/resolver;
   - custom generic event;
   - UI label/support state;
   - no new decision behavior beyond generic custom handling where possible.
2. **WP1 — HYROX demand + objective semantics**
   - Open Singles preset calibration;
   - modality resolution;
   - objective keys/generation/qualification.
3. **WP2 — catalog support**
   - equipment vocabulary;
   - qualifying templates/session roles;
   - catalog tests.
4. **WP3 — taper + knowledge/provenance**
   - reviewed taper policy if ready;
   - SKR claims/coverage/alignment;
   - `POLICY_VERSION` bump.
5. **WP4 — scenario/persona regression**
   - HYROX specificity fixture;
   - custom-event fixture;
   - legacy/multi-event parity;
   - docs/architecture amendment if the canonical authority boundary changed materially in code.

WP0–WP4 may ship in one implementation PR if the diff remains reviewable. Do not merge a state where UI advertises “specific” HYROX support before WP1/WP2 are present.

## 8. CI / verification gates

Before merge of the behavior implementation:

1. run the repository's focused unit tests for each touched engine/UI/knowledge module;
2. run `npm run check` from `app/` (includes Sports Knowledge validation/coverage per the registry architecture docs);
3. run deterministic planner/scenario suites affected by event periodization and optimizer ranking;
4. run persona/plan-judge build/invariants if event-objective changes touch general ranking behavior;
5. inspect generated diffs for representative legacy event cases, not only pass/fail counts;
6. verify `POLICY_VERSION` changed exactly once for the coherent deciding-policy change;
7. verify recommendation knowledge lineage resolves every newly material claim;
8. verify no Firestore validation/rule enum remains stale.

If scenario/persona output changes outside the intended fitness-race cases, explain each change in the implementation PR rather than accepting baseline churn mechanically.

## 9. Acceptance criteria

P0 is done when all are true:

- [ ] `fitness_race` and `other_event` are valid event categories.
- [ ] `hyrox_open_singles` is a specific supported format.
- [ ] `other_event/custom` exists and is visibly generic/limited.
- [ ] “Event style” is renamed “Event format”.
- [ ] Existing 19 presets preserve their intended behavior.
- [ ] One canonical resolver owns format demand + specific modality/objective/support metadata.
- [ ] HYROX Open Singles produces Running + station/strength specificity rather than behaving like a plain running race.
- [ ] `compromised_running` and `station_strength_endurance` are real weekly objectives with deterministic qualification.
- [ ] The catalog contains feasible sessions that can satisfy those objectives.
- [ ] Missing equipment does not select impossible sessions.
- [ ] Readiness/injury/recovery constraints retain higher safety authority.
- [ ] Priority is not abused as a proxy for HYROX taper duration.
- [ ] Any automatic HYROX taper is reviewed and registered as product policy before activation.
- [ ] Sports Knowledge event-demand claim/coverage matches the new preset/policy set.
- [ ] `POLICY_VERSION` is bumped for the deciding behavior change.
- [ ] Existing goal documents need no migration.
- [ ] The motivating `2027-04-10` HYROX goal can be created and enters the normal multi-event planner.
- [ ] Full repository check and affected planner/scenario suites pass.

## 10. Expected implementation PR notes

The implementation PR description should explicitly report:

- complete category/preset consumer inventory from P0.0;
- final `EventPreset`/resolver contract and why it is backward-compatible;
- exact HYROX Open Singles demand calibration and its Sports Knowledge claim/version;
- exact new objective qualification rules;
- new equipment tokens/templates and their safety/cost annotations;
- taper decision and evidence/product-policy status;
- `POLICY_VERSION` before/after;
- focused test results + `npm run check`;
- scenario/persona diffs, including confirmed unchanged legacy cases;
- deferred P1/P2 formats so reviewers can distinguish intentional scope from omissions.
