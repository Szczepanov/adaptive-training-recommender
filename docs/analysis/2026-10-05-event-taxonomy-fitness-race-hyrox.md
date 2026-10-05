# Event taxonomy recon — fitness-race / HYROX support

| | |
|---|---|
| **Type** | Point-in-time analysis (`docs/analysis`: what is true today) |
| **Scope** | Event categories, event presets/formats, periodization ownership, and first-class HYROX support |
| **Motivating case** | Add HYROX Warsaw on `2027-04-10` as a real training goal rather than encoding it as a running race or generic target |
| **Baseline** | `origin/main` `aaca00d3026511eedc029f205312bb284d00bd66` (2026-10-05) |
| **Architecture sources** | ADR-0007 adaptive multi-sport engine; ADR-0010 decision provenance; ADR-0033 Sports Knowledge Registry; `docs/architecture/sports-knowledge-registry.md` |
| **Implementation plan** | [`2026-10-05-event-taxonomy-fitness-race-hyrox.md`](../plans/2026-10-05-event-taxonomy-fitness-race-hyrox.md) |
| **Policy effect** | This analysis PR: none. P0 implementation: **yes** once demand/objective/taper/ranking behavior changes; bump `POLICY_VERSION`. |
| **Knowledge effect** | P0 implementation must revise the event-demand product-policy claim/coverage because the current claim explicitly governs 19 authored presets. |

## 1. Executive conclusion

The absence of HYROX is not primarily a missing dropdown option. It exposes an event-taxonomy and authority problem.

Today the product has two concepts:

1. `UserEvent.category` — a broad family (`cycling_event`, `running_race`, `triathlon`, `strength_meet`, `general_target`);
2. `UserGoal.eventPreset` — a string selecting a 7-axis demand vector within that family.

In practice, **category still owns more behavior than the preset**. Periodization maps category directly to sport-specific modalities, objective synthesis contains category-specific branches, and taper defaults are category/priority driven. `eventPreset` changes the demand vector but does not fully describe what event-specific training means.

Therefore adding `hyrox` as one more preset under an unrelated category, or adding a top-level `hyrox` category with only a demand vector, would create UI support without honest engine support.

### Recommendation

Adopt `fitness_race` as a broad event family and add HYROX as a format/preset beneath it. Do **not** make the commercial race name the top-level domain type.

P0 should deliver one genuinely supported vertical slice — **HYROX Open Singles** — plus a generic unsupported-event escape hatch. P0 should also establish the metadata boundary needed to add Pro, Doubles, Relay, DEKA, OCR, trail, MTB and other event families without repeating category switches throughout the engine.

The P0 implementation should be backward-compatible with existing persisted goals: keep `eventCategory` + `eventPreset` as the persisted shape for now, enrich preset metadata at runtime, and defer a larger family/format/division schema migration until there is evidence that the existing pair cannot carry the product safely.

## 2. Current taxonomy inventory

`app/src/engine/models.ts` currently defines five event categories:

| Category | Current meaning | Current preset count |
|---|---|---:|
| `cycling_event` | Cycling competition | 5 |
| `running_race` | Running competition | 5 |
| `triathlon` | Swim-bike-run competition | 6 |
| `strength_meet` | Strength competition/test | 2 |
| `general_target` | Dated non-competition target | 1 |

`app/src/engine/eventPresets.ts` currently contains 19 presets:

- cycling: road race, criterium, time trial, gran fondo/sportive, gravel;
- running: 5K, 10K, half marathon, marathon, ultra;
- triathlon: 1/8, 1/4, sprint, Olympic, half/70.3, Iron distance;
- strength: powerlifting, general strength test;
- general: generic target.

Every preset owns only:

```ts
interface EventPreset {
  id: string;
  label: string;
  demandProfile: EventDemandProfile;
}
```

The demand profile is intentionally resolved at engine time rather than persisted on the goal. That is a useful design property: recalibration does not require rewriting every goal document. The limitation is that the preset cannot currently express event-specific modality, objective, taper or support semantics.

### 2.1 The current seven demand axes

`EventDemandProfile` expresses:

- `aerobicEndurance`
- `thresholdPower`
- `vo2MaxPower`
- `repeatedSurges`
- `sprintPower`
- `fatigueResistance`
- `neuromuscular`

These are useful cross-sport planning dimensions but they are not a complete event ontology. They can express that an event is aerobically demanding, fatigue-resistant or neuromuscular, but cannot distinguish several forms of event specificity that matter for a fitness race: running immediately after loaded work, station execution skill, grip/carry tolerance, transition skill, and local muscular strength-endurance.

The correct conclusion is **not** to immediately replace the seven-axis model. It is stable, broadly consumed and knowledge-governed. P0 should retain it and add narrowly-scoped event-specific metadata/objectives around it.

## 3. What HYROX requires that the current model cannot represent

HYROX's official race description is structurally different from a standalone running race or strength meet: the race alternates eight 1 km runs with eight functional workout stations. The official categories include Open, Pro, Doubles and Relay; Open and Pro Singles share the repeated run/station structure while Pro increases station loads, Doubles athletes run together and split station work, and Relay splits the event across four athletes.

Official reference: <https://hyrox.com/the-fitness-race/> (reviewed 2026-10-05).

That creates at least five planning requirements:

1. **Running durability** — the athlete still needs ordinary run volume and quality.
2. **Compromised running** — running after sled/carry/lunge/erg work is part of the event morphology, not incidental fatigue.
3. **Strength endurance / local muscular endurance** — station work cannot be represented by `neuromuscular` alone.
4. **Station skill and equipment exposure** — sleds, SkiErg, rower, carries, lunges and wall balls impose technique/equipment constraints.
5. **Transitions and race-specific combinations** — a fitness-race-specific session is not simply “run + strength somewhere in the same week.”

A pure 7-axis demand vector can approximate the gross load but cannot prove that these specific exposures will exist.

## 4. Current architecture gaps exposed by HYROX

### 4.1 “Event style” is overloaded

`Goals.tsx` labels the `eventPreset` field **Event style**, but current values mix multiple dimensions:

- distance (`5K`, marathon, 70.3);
- competition morphology (`criterium`, time trial, gravel);
- sport (`powerlifting`);
- and effectively a generic fallback.

For HYROX the ambiguity becomes worse because “Open Singles”, “Pro Singles”, “Doubles”, and “Relay” are format/division variants, not merely styles.

**Recommendation:** rename the UI label to **Event format** in P0. Keep the storage field name `eventPreset` for backward compatibility.

### 4.2 Category still owns modality specificity

`periodization.ts::modalitiesForEventCategory` currently hard-codes:

```text
cycling_event -> Cycling
running_race  -> Running
triathlon     -> Swimming + Cycling + Running
strength_meet -> Strength
general_target -> []
```

A `fitness_race` event needs at least Running + Strength, and likely Cross Training for some authored sessions. Adding another switch branch would work for one event family, but it continues the structural problem: every new family requires changes wherever category switches occur.

**Recommendation:** make the preset registry the canonical resolver for event-specific modalities, with category defaults retained for backward compatibility. Consumers should ask a resolver such as `resolveEventPreset(...)` / `resolveEventModalities(...)`, not reconstruct semantics from a category string.

### 4.3 Objective synthesis is still category-shaped

`objectivesFromDemand` has dedicated logic for triathlon, cycling and running. Generic demand axes produce threshold, surge, Zone 2 and strength-maintenance objectives, but there is no objective that requires a compromised-run exposure or a fitness-race station-strength exposure.

Without new objective semantics, the planner can satisfy a HYROX week using independent runs and ordinary strength sessions while never prescribing the key combined exposure.

**Recommendation:** P0 adds a bounded fitness-race specificity layer rather than expanding every generic axis. At minimum:

- `compromised_running`
- `station_strength_endurance`

Station skill, grip/carry and transition requirements can initially be represented by qualification metadata/template roles under those objectives. Split them into additional objective keys later only if the optimizer needs independent weekly accounting.

### 4.4 The catalog lacks a truthful fitness-race-specific session family

`templates.ts` contains ordinary Running, Cycling and Strength work and one fallback `Cross Training` aerobic circuit. It does not currently provide a meaningful HYROX-specific family covering run-to-station combinations and station exposure.

A dropdown without qualifying templates would be cosmetic.

P0 should add a minimum usable library rather than attempting to model every possible HYROX workout. Required capabilities are:

- compromised run + functional station combination;
- station strength-endurance session;
- erg/station conditioning session when equipment is available;
- partial race simulation / specificity session;
- existing easy/quality running and general strength remain reusable.

The implementation must use the repository's canonical equipment vocabulary. Do not invent sled/SkiErg/rower/wall-ball tokens inside templates until the equipment model and validation paths are checked and extended coherently.

### 4.5 Taper semantics are coupled to priority

`taperPolicy.ts` currently uses an authored taper start first, then a cycling-A special case, then the generic non-general-target fallback:

- A -> 14 days
- B -> 5 days
- C -> 0 days

This means an athlete can only change the default taper by changing priority or manually authoring a date. Priority and taper duration are different concepts. A secondary event should not have to be promoted to A solely to get a longer event-appropriate taper.

**Recommendation:** add preset/event-family taper calibration as a separate authority beneath explicit authored taper and above the legacy priority fallback. The exact HYROX default window is a product-policy value that must be reviewed and registered, not guessed from the event label.

### 4.6 Knowledge governance explicitly covers the preset set

`periodizationEventDemandKnowledge.ts` contains the active product-policy claim `policy.event_demand.presets_v1`, whose statement explicitly says the product has **19 authored event presets** with specific seven-axis vectors.

Adding HYROX demand behavior without changing that claim would make code and registered policy disagree.

P0 implementation therefore needs all of:

- updated product-policy source/claim wording and version;
- applicable sport/context metadata for fitness racing;
- knowledge coverage/alignment tests;
- a `POLICY_VERSION` bump when recommendation behavior changes, per ADR-0010.

The exact HYROX vector and any exact taper values must be labelled product calibration unless a source directly validates those exact product-scale numbers (unlikely).

## 5. Taxonomy options considered

| Option | Assessment |
|---|---|
| **A. Add top-level `hyrox` category** | **Reject.** Fastest local fix, but it makes a commercial format a root ontology node and invites `deka`, `spartan`, etc. as peer enums. It does not solve preset ownership. |
| **B. Add `fitness_race` category, HYROX formats beneath it** | **Recommend.** Describes the competition family, supports HYROX now and can host genuinely similar formats later without claiming they are identical. |
| **C. Add `hybrid_fitness` category** | Viable but less precise. “Hybrid fitness” can describe general training style rather than a competition family and encourages accidental inclusion of formats with materially different semantics. |
| **D. Encode HYROX as `running_race`** | **Reject.** Preserves run modality but loses the station workload and combined specificity that makes the event distinct. |
| **E. Encode HYROX as `strength_meet`** | **Reject.** Loses the repeated running demand and race morphology. |
| **F. Encode HYROX as `general_target`** | **Reject.** `general_target` is deliberately treated as a dated non-competition target in taper policy and carries no sport-specific modalities. |

## 6. Recommended bounded model

### 6.1 Persisted P0 shape remains backward-compatible

Keep:

```ts
UserGoal.eventCategory?: UserEvent['category'] | null;
UserGoal.eventPreset?: string | null;
```

Add:

```ts
UserEvent['category'] += 'fitness_race' | 'other_event';
```

Do not migrate existing goal documents. Old values remain valid and resolve exactly as before.

### 6.2 Enrich the runtime preset definition

Conceptually:

```ts
type EventSupportLevel = 'generic' | 'specific';

type EventSpecificObjectiveTag =
  | 'compromised_running'
  | 'station_strength_endurance';

interface EventPreset {
  id: string;
  label: string;
  demandProfile: EventDemandProfile;
  specificModalities?: SessionTemplate['modality'][];
  objectiveTags?: EventSpecificObjectiveTag[];
  supportLevel?: EventSupportLevel;
  taperPolicyId?: string;
}
```

Exact names are implementation details; the authority boundary is the decision:

> Event-format semantics live behind one preset resolver. Engine consumers do not grow independent category/preset switch statements.

Existing presets may omit the new fields and inherit their current category behavior during migration. P0 should not force a high-risk all-at-once rewrite of all 19 presets.

### 6.3 P0 HYROX format

First-class P0 target:

```text
fitness_race
└── hyrox_open_singles   [specific]
```

Do not claim Pro/Doubles/Relay as first-class merely because their labels are known. They materially change station load or work sharing. Add them only when the engine has an explicit support contract for the difference.

A later extension can become:

```text
fitness_race
├── hyrox_open_singles
├── hyrox_pro_singles
├── hyrox_open_doubles
├── hyrox_pro_doubles
├── hyrox_relay
└── deka_* / other genuinely compatible formats
```

### 6.4 Generic unsupported-event escape hatch

Add:

```text
other_event
└── custom
```

This is deliberately **generic support**, not pretend event-specific coaching:

- stores the competition date/priority/lifecycle;
- participates in generic event timing/phase handling;
- uses a neutral/default demand profile;
- has no event-specific modality qualification;
- has no implicit sport-specific objective or synthetic event-specific taper;
- UI states that planning is generic/limited.

This is preferable to misusing `general_target`, whose semantics explicitly mean a non-competition dated target.

## 7. Recon of missing event families

The goal is not to put every sport into P0. The goal is to define where each missing family belongs and avoid repeating this architecture exercise.

| Priority | Missing family | Recommended taxonomy direction | Why not all in P0 |
|---|---|---|---|
| **P0** | HYROX Open Singles | `fitness_race / hyrox_open_singles` | Immediate real use case; clear race morphology; needs genuine engine support. |
| **P0** | Unsupported competition | `other_event / custom` | Prevents users from lying to the model by selecting the wrong sport. |
| **P1** | Trail running | presets under `running_race` | Surface/vertical/technical demands need metadata beyond road distance. |
| **P1** | MTB / XC / cyclocross | presets under `cycling_event` | Existing cycling family fits, but morphology differs from road/gravel. |
| **P1** | Swimming races / open water | likely new `swimming_race` | Swimming already exists as modality but has no event family. |
| **P1** | Duathlon / aquathlon | generalized multisport taxonomy or explicit categories | Current `triathlon` name is too specific; avoid forcing swim/bike/run assumptions. |
| **P1** | HYROX Pro / Doubles / Relay | formats under `fitness_race` | Need explicit load/work-sharing semantics before claiming specificity. |
| **P2** | DEKA-style fitness racing | `fitness_race` if demand review confirms compatibility | Similar family, but should not inherit HYROX calibration automatically. |
| **P2** | OCR / Spartan | likely separate obstacle-race family | Technical/terrain/grip/obstacle skill differs materially. |
| **P2** | CrossFit competition | separate competition model unless analysis proves otherwise | Event content can be unknown until competition; not equivalent to a fixed-format fitness race. |
| Later | Rowing / ski races | dedicated family/preset when demand + catalog support exist | No value in UI taxonomy without planning behavior. |

Rule for future additions:

> A named event is not “supported” merely because it can be selected. First-class support requires a reviewed demand profile, relevant specific modalities/objectives, qualifying catalog sessions, and tests proving those semantics affect planning as intended.

## 8. P0 architecture contract

P0 is complete only when all of the following are true.

### P0-A — taxonomy and compatibility

- `fitness_race` is a valid event category.
- `other_event` is a valid generic competition category.
- existing five categories and 19 presets remain byte/behavior compatible unless explicitly changed.
- existing goal documents require no migration.
- stale/unknown preset fallback remains deterministic and safe.

### P0-B — preset authority

- one canonical resolver returns demand profile plus event-specific metadata;
- HYROX Open Singles resolves to Running + Strength (and only uses `Cross Training` when an authored qualifying session intentionally does so);
- callers no longer need a new category switch merely to discover HYROX-specific modalities/objectives;
- category defaults remain a compatibility layer for the existing preset set.

### P0-C — event-specific objectives

- a HYROX Open Singles specificity week cannot be fully satisfied by an unrelated run plus ordinary strength maintenance alone;
- at least one objective requires compromised running;
- at least one objective requires station-oriented strength endurance;
- objective credit remains deterministic and auditable through the existing weekly objective/coverage model.

### P0-D — usable catalog

- enough templates exist to satisfy the new objectives when required equipment is available;
- equipment limitations degrade to safe/general training rather than selecting an impossible station session;
- template stimulus/cost annotations reflect the existing 6D fatigue architecture;
- no new template bypasses safety/recovery constraints.

### P0-E — taper and priority separation

- explicit authored taper remains highest authority;
- fitness-race taper defaults, if introduced, are preset/family policy rather than inferred by promoting event priority;
- `other_event/custom` does not receive a false event-specific taper;
- existing event taper behavior remains unchanged outside the new family.

### P0-F — knowledge and provenance

- event-demand product-policy claim is revised/versioned;
- any new exact product calibration is explicitly labelled heuristic/product policy;
- knowledge coverage/alignment tests pass;
- behavior-changing implementation bumps `POLICY_VERSION`.

### P0-G — UI honesty

- “Event style” becomes “Event format”;
- HYROX Open Singles is selectable under Fitness race;
- generic custom event is selectable under Other event;
- generic support is visibly distinguished from specific support so the UI does not overclaim coaching specificity.

## 9. Compatibility, migration and failure behavior

### 9.1 Persisted goals

The proposed P0 is additive. Existing `eventCategory` and `eventPreset` values remain legal. Because demand profiles are resolved at runtime, no backfill of persisted demand vectors is required.

### 9.2 Unknown/stale presets

The current `resolveDemandProfile` intentionally falls back to the category default for an unknown preset id. Preserve graceful handling, but expose enough diagnostic/support metadata that an unknown HYROX/custom value cannot silently masquerade as a specifically supported format.

### 9.3 Generic custom events

A custom competition must fail **open only to generic planning**, not to a fabricated sport-specific plan. Its limitations should be explicit in the UI and decision trace where relevant.

### 9.4 Recommendation replay

Any P0 change that can change candidate eligibility, weekly objective benefit, taper state or final ranking is policy-changing under ADR-0010. The implementation PR must bump `POLICY_VERSION`; this docs-only PR must not.

## 10. Decision

Proceed with the P0 implementation described in the paired plan.

The critical design decisions are:

1. root family = `fitness_race`, not `hyrox`;
2. first-class P0 format = `hyrox_open_singles`;
3. unsupported competitions get a truthful `other_event/custom` path;
4. the preset resolver becomes the home for event-format semantics while current category defaults remain compatible;
5. retain the seven generic demand axes in P0 and add narrow fitness-race objective semantics rather than redesigning the entire demand model;
6. no event is labelled first-class until objective + catalog + taper/periodization + test behavior exists;
7. Sports Knowledge Registry and `POLICY_VERSION` changes ship with the behavior-changing implementation, not with this analysis PR.
