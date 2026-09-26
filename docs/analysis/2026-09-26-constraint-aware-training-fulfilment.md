# Constraint-aware training requirement fulfilment — architecture review

**Date:** 2026-09-26
**Status:** Point-in-time analysis / recommendation
**Scope:** Weekly planning under time, equipment, travel, recovery and tissue constraints; same-day microdosing; multi-stimulus sessions; aerobic-quality cross-credit
**Related:** #801, #802, #803, #804, #805, #806, #813; ADR-0016, ADR-0018, ADR-0033, ADR-0036, ADR-0043

## Executive conclusion

The engine should not try to fulfil every knowledge-library recommendation by scheduling one
standalone workout per requirement. That model fails exactly when the athlete has realistic
constraints: short training windows, limited equipment, injury/tissue restrictions, travel,
competition specificity or a dense week.

The better abstraction is a **constraint-aware stimulus portfolio**:

1. preserve hard safety, clinical, event and recovery constraints;
2. retain **exact programming-role identity** where identity matters;
3. separately recognize the **fractional physiological stimulus** delivered by every session;
4. separately track **accumulated dose and longitudinal capability exposure** where frequency,
   minutes, movement composition or maximum gaps matter;
5. allow compatible requirements to be delivered by one session or by several bounded
   same-day occurrences;
6. use microdoses to preserve a secondary quality when a full development dose does not fit;
7. expose typed shortfalls or intentional suspension when a requirement cannot honestly be met.

This preserves the repository's existing distinction between adaptation credit and exact
weekly coverage rather than replacing it with a looser equivalence system.

A tempo/threshold cycling session is a good example. It is unquestionably aerobic work and may
earn meaningful fractional aerobic-endurance stimulus credit. It should **not automatically
satisfy a low-intensity aerobic-volume role, a weekly aerobic-dose target, or a long-durability
anchor**. Those are different programming questions with different fatigue costs and different
reasons for existing.

Similarly, a 10–20 minute strength microdose can be valuable, especially for maintenance, but
it must not automatically count as a complete primary-strength development session. The engine
should know what movement families, strength/power stimulus and load were actually delivered.

## 1. What the current architecture already gets right

### 1.1 Exact role coverage and adaptation credit are intentionally separate

ADR-0016 and `docs/architecture/canonical-coverage-credit.md` distinguish:

- performed occurrence identity;
- broad performed exposure;
- exact programming-role semantics;
- coverage-state eligibility/dose.

`stimulus.ts` separately computes fractional objective credit from a
`WorkoutStimulusProfile`. This is the right foundation. A future solution should **not**
collapse these ledgers.

The current canonical stimulus axes are:

- `aerobicEndurance`;
- `thresholdPower`;
- `vo2MaxPower`;
- `repeatedSurges`;
- `sprintPower`;
- `fatigueResistance`;
- `maxStrength`;
- `hypertrophy`.

That is already close to a multi-benefit model: one session can contribute to several axes.

### 1.2 The engine already has a cost vector

`WorkoutCostProfile` separates systemic, cardiovascular, lower-body, upper-body,
impact-tissue and neuromuscular cost. Combining requirements should therefore be judged by
**benefit and cost together**, not by how many calendar sessions exist.

### 1.3 Same-day execution has a safe accounting boundary

ADR-0036 already supplies the important mechanics required for doubles:

- explicit training windows;
- one shared daily minute/load ledger;
- occurrence-level reservations;
- post-session reassessment;
- no automatic capacity reset after AM training;
- safety/readiness gates rerun before a later session.

Therefore the missing feature is not "invent doubles." The missing feature is **automatic
constraint-aware packing of compatible secondary work into those already-safe intraday
contracts**.

### 1.4 Recent time-cap work solved symptoms, not the general problem

Issue #744 correctly prevents a purely technical time cap from making a cycling-primary athlete
switch to walking when a valid shortened cycling prescription fits. #757 made the
single-session aerobic coverage floor athlete-relative. #758 added cap-fitting cycling quality.

Those changes are useful but intentionally local. They do not yet answer:

> Given several weekly requirements and insufficient unconstrained slots, which requirements
> can share a session/day, which can be microdosed, which can receive partial cross-credit,
> and which must remain an explicit shortfall?

### 1.5 The open physical-capability issues expose the same missing abstraction

Issues #801–#806 converge on the same architectural pressure: a second strength/power exposure,
neuromuscular power, unilateral strength composition, impact/running/jumping,
multidirectional skill, and weekly aerobic dose + a long anchor.

Implementing each as "one more weekly workout" would create session-count inflation and make
the planner worse under time constraints.

## 2. Scientific interpretation

### 2.1 Microdosing is plausible and useful — especially for maintenance — but is not universal equivalence

Spiering et al. reviewed reduced-dose maintenance and found that, in general populations,
endurance performance can often be maintained for weeks despite large reductions in volume,
provided intensity is retained; strength and muscle can also be maintained with markedly
reduced weekly resistance volume in younger adults. The authors explicitly note that data are
insufficient for athlete-specific minimum prescriptions.

Nuzzo et al. reviewed minimal-dose resistance strategies and found that single-set and
"resistance snack" approaches can improve strength with little time, but the evidence base is
primarily general/non-athlete populations.

Product implication:

- **microdose is a first-class delivery form**, not a synonym for "full session";
- maintenance and continuity can accept smaller doses than development;
- exact minimums remain product-policy heuristics with explicit evidence limitations;
- a constrained week may switch a quality from BUILD -> MAINTAIN/MICRODOSE instead of
  silently deleting it.

References:
- Spiering BA et al. 2021. https://pubmed.ncbi.nlm.nih.gov/33629972/
- Nuzzo JL et al. 2024. https://pubmed.ncbi.nlm.nih.gov/38509414/
- Androulakis-Korakakis P et al. https://pubmed.ncbi.nlm.nih.gov/31797219/

### 2.2 Same-day strength + endurance is viable, but priority and separation still matter

Concurrent-training evidence does not justify a blanket prohibition on same-day mixed
training. However, trained athletes can show worse lower-body strength development when
resistance and endurance are compressed into the same session, while different-session
concurrent training performs better in that comparison. Sequence effects are generally small
for aerobic outcomes; when strength/power is the priority, strength-first or greater separation
is the more defensible default.

Product implication:

- prefer same-day **separate occurrences/windows** to merging everything into one uninterrupted
  workout when both qualities matter;
- place the current BUILD quality first while fresh;
- use a secondary maintenance microdose later when time/recovery permit;
- do not encode a universal magical separation threshold.

References:
- Petré H et al. 2021. https://pubmed.ncbi.nlm.nih.gov/33751469/
- Zhang F et al. 2026. https://pubmed.ncbi.nlm.nih.gov/41669271/

### 2.3 Splitting quality can reduce acute cost, but does not prove greater adaptation

Talsnes et al. compared the same 60 minutes of moderate/threshold-like work in one session vs
two sessions separated by approximately 6.5 hours. Splitting reduced acute cardiovascular,
metabolic and perceptual drift and next-morning perceived stress. It did **not** demonstrate
superior long-term adaptation from splitting the same work.

Implication:

- use doubles to improve logistics, preserve quality or permit more controlled total work;
- do not award a biological bonus merely because work was split;
- the total performed stimulus/cost ledger remains the authority.

Reference:
- Talsnes RK et al. 2024. https://pubmed.ncbi.nlm.nih.gov/39139482/

### 2.4 Threshold/tempo contributes to aerobic development but does not make low-intensity volume obsolete

Meta-analyses show HIIT can improve VO2max and threshold-related outcomes, sometimes more
quickly than moderate continuous training. This does not establish that threshold/HIIT can
replace the entire low-intensity foundation of an endurance program.

Observational and intervention literature in trained endurance athletes still shows large
low-intensity volumes, commonly with pyramidal or polarized distributions. A 2025 perspective
specifically notes that the exact mechanistic need for very large low-intensity volumes is not
fully resolved, while proposing several practical reasons for them: accumulating work at low
marginal stress, enabling quality sessions, and obtaining incremental adaptation.

Therefore "one threshold minute = N Zone-2 minutes" is not scientifically defensible as a
universal conversion.

Implication:

- a threshold/tempo ride should receive its **real `aerobicEndurance` stimulus credit**;
- its actual aerobic minutes contribute to total weekly training exposure;
- it should not automatically satisfy an exact easy-aerobic role;
- it should not automatically satisfy a long continuous durability anchor;
- no universal intensity multiplier should turn 35 min threshold into 90 min base;
- when the low-intensity/durability target becomes infeasible, report a shortfall or
  intentionally lower the target for the constrained period rather than fabricate equivalence.

References:
- Wang Z, Wang J. 2024. https://pubmed.ncbi.nlm.nih.gov/38904772/
- Pereira PE et al. 2024. https://pubmed.ncbi.nlm.nih.gov/38842374/
- Rosenblat et al. 2025. https://pubmed.ncbi.nlm.nih.gov/39888556/
- Elite endurance TID review. https://pubmed.ncbi.nlm.nih.gov/37964776/
- Why low-intensity endurance training for athletes? 2025.
  https://pubmed.ncbi.nlm.nih.gov/40576827/

## 3. The missing model: four requirement classes

A single `WeeklyObjective` abstraction is not sufficient for every future physical-capital
requirement. The planner should explicitly classify requirements.

### A. Exact role requirements

Examples: primary strength, event-specific quality, long aerobic/durability anchor, race or
authored key session.

Properties:

- identity/composition matters;
- cross-stimulus credit does not automatically fulfil the role;
- may have minimum dose;
- if infeasible, show a typed shortfall.

### B. Fractional stimulus objectives

Examples: aerobic endurance, threshold power, VO2max, max strength, hypertrophy,
sprint/surge/fatigue-resistance stimulus.

Properties:

- a session may contribute to several axes;
- delivered credit is dose-aware;
- contribution is capped at the outstanding requirement;
- cross-credit is allowed if the authored/observed stimulus profile supports it.

This is already close to what `stimulus.ts` does.

### C. Accumulated dose requirements

Examples: athlete-relative weekly aerobic minutes/range, low-intensity support volume, or
total strength dose when a block needs it.

Properties:

- summed over a window;
- not binary;
- distinguish actual dose from broad stimulus;
- do not use arbitrary intensity-equivalence multipliers unless a reviewed policy owns them.

Issue #806 should become the canonical owner for aerobic dose.

### D. Longitudinal capability exposures

Examples: power, impact/running familiarity, unilateral pattern, landing/deceleration/COD,
field/multidirectional skill.

Properties:

- often maintenance rather than development;
- frequently satisfied by a small embedded module;
- may use rolling horizons/max gaps rather than weekly checkboxes;
- can be intentionally suspended by taper/injury/illness;
- absence must be distinguishable from blocked/suspended.

#802–#805 should become canonical owners for these families.

## 4. Constraint-degradation ladder

When the unconstrained plan does not fit, degrade deliberately instead of dropping whichever
workout happens to rank lowest. The levels below are a proposed product-policy search sequence,
not an evidence-derived physiological hierarchy. If live ordering changes selection, that
ordering needs ADR-0033 lineage and policy-version governance just like any other decision
heuristic.

### Before degradation — recompute canonical residuals

Apply every valid completed and already-committed/projected contribution through its canonical
owner before deciding that more work is needed. A retained threshold ride can therefore reduce
an aerobic-stimulus residual immediately, and a strength/power session can reduce several
explicit capability rows when its canonical metadata says so. This is **accounting**, not a
degradation step. Treating cross-credit as a late fallback would risk scheduling a microdose
for a requirement already covered by retained work.

### Level 0 — full plan
Use normal development doses and preferred standalone sessions for the residual requirements.

### Level 1 — dose compression inside the authored prescription
Shorten a session inside its validated range/variant while retaining exact role only when the
role's minimum dose is still reached. Issues #744/#757 implement part of this.

### Level 2 — consolidate compatible stressors on one day
Use separate intraday windows under ADR-0036. Examples: AM cycling quality + PM compact
strength; AM strength/power + PM easy aerobic; primary strength + a small embedded
power/calf/grip module when composition allows. Shared daily ledger and PM reassessment stay
authoritative.

### Level 3 — convert secondary BUILD work to a maintenance microdose
When a secondary quality cannot retain its full development dose, preserve the smallest
reviewed maintenance exposure rather than silently deleting it. Record
`development -> maintenance/microdose` explicitly.

### Level 4 — safe substitution
If equipment or a local tissue restriction removes a specific exercise/modality, substitute
only where the alternative is explicitly valid for the remaining requirement. Unique blocked
capabilities remain visible rather than "fulfilled by something else."

### Level 5 — typed shortfall
If the target cannot fit after valid compression/consolidation/substitution, surface the
requirement, target, delivered/forecast credit, blocking reason, status
(`unmet`/`blocked`/`deliberately_suspended`), and next eligible opportunity.

## 5. Proposed multi-stimulus accounting

### 5.1 Keep exact role credit strict
Do not weaken `CoverageCreditFact`. A workout satisfies a role only through its authoritative
coverage descriptor and dose rules.

### 5.2 Expand structured stimulus/capability metadata; never infer from names

Planned/exact performed work should eventually expose:

```text
stimulus:
  aerobicEndurance
  thresholdPower
  vo2MaxPower
  repeatedSurges
  sprintPower
  fatigueResistance
  maxStrength
  hypertrophy
  [future] neuromuscularPower

capabilities:
  [future] unilateralLowerBody
  [future] kneeFlexionHamstring
  [future] calfSoleus
  [future] impact
  [future] accelerationDeceleration
  [future] multidirectionalCOD
  [future] gripCarry
```

The capability fields should come from canonical #802–#805 work, not be invented ad hoc in
the optimizer.

### 5.3 Cap cross-credit at residual need

Conceptually:

```text
canonicalCredit = deriveObjectiveCreditFromProfile(...)
usableCredit = min(canonicalCredit, residualRequirement)
```

ADR-0014 already owns fractional objective-credit semantics, including delivered-dose handling.
ADR-0033 `KnowledgeClaim.evidenceCertainty` describes the authority and limitations of a
policy claim; it is not a numeric discount on physiological credit. That must not be confused
with the existing ADR-0014 `StimulusConfidence` /
`CONFIDENCE_CREDIT_WEIGHT`, which is a performed-evidence confidence input already applied
inside the canonical objective-credit calculation. The fulfilment layer must neither remove
that discount nor apply it a second time.

If source evidence is insufficient, the canonical fact/credit owner must express that through
its own unknown/no-credit semantics. The missing part here is only using **residual portfolio
value** during weekly packing/allocation.

### 5.4 Residual rows need stable identity and explicit units

One logical requirement may expose more than one semantic row. For example, a long aerobic
requirement could own an exact-role row and a separate aerobic-stimulus/dose row. The
fulfilment view should therefore use:

- one stable `requirementId` for the logical requirement;
- one stable row id per `requirementId + class + dimensionKey`;
- an explicit unit such as count, credit, minutes, sets, exposures or days;
- nullable quantities when the canonical owner cannot establish target/progress.

Sibling rows remain associated without becoming interchangeable. Unknown is `null`/unknown,
not numeric zero, and a blocked requirement keeps its desired target visible rather than
becoming a fabricated zero-target success.

### 5.5 Never use one scalar "training value"

Keep benefit and cost vectors separate. Raw residual values in unlike units are not additive
and must not be compared as though 20 minutes, 0.5 objective credit and one capability
exposure were the same currency. Scalar ranking can remain a late tie-breaker only after
canonical priority/deadline policy and comparable residual semantics have been applied;
feasibility and required coverage remain vector-aware first.

## 6. Proposed microdose model

A microdose should be an authored, validated **module/occurrence**, not a free-text instruction
or an arbitrary truncation of a full workout.

Conceptual shape:

```ts
interface TrainingModule {
  id: string;
  durationMin: number;
  durationMax: number;
  requiredEquipment: string[];
  safetyTags: string[];
  stimulusProfile: Partial<WorkoutStimulusProfile>;
  costProfile: WorkoutCostProfile;
  compositionEvidence?: MovementCapability[];
  eligibleDelivery: ('standalone' | 'embedded' | 'second_window')[];
  phaseIntent: ('develop' | 'maintain' | 'microdose')[];
}
```

Potential future modules: compact heavy-strength maintenance, upper-body/trunk maintenance,
non-fatiguing power, knee-flexion hamstring, calf/soleus, grip/carry, low-contact impact, and
acceleration/deceleration/COD.

Rules:

- normal equipment eligibility applies;
- tissue/injury rules apply at component level;
- same-day load is charged to the same ADR-0036 ledger;
- an embedded module does not double-count as another full session;
- a separate PM occurrence consumes minutes/load normally;
- one module may satisfy several capability exposures only via explicit metadata;
- module metadata does not itself grant an exact programming role;
- after materialization, exact role credit follows the normal active coverage-descriptor and
  dose/phase rules.

A module is therefore a compact authoring/delivery form over the existing session, stimulus,
cost and occurrence authorities, not a parallel workout/accounting system.

## 7. Automatic same-day packing

ADR-0036 deferred automatic multi-window packing until ledger/reassessment infrastructure
existed. That infrastructure is now live, so bounded automatic packing is a reasonable next
step.

Candidate weekly algorithm:

1. resolve full requirements and completed/projected credit;
2. reserve fixed activities, exact key/event roles and protected rest;
3. generate primary full-session candidates;
4. recompute residual rows after every canonical contribution already delivered or committed by
   that retained portfolio;
5. for each unused explicit training window, generate eligible full sessions, compact variants
   and microdose modules;
6. consider compatible second-window additions on already-hard days when this protects truly
   easy days, but require any new occurrence to fit the existing weekly session/occurrence
   commitment as well as the daily ledger;
7. compare bounded candidates by policy-ordered **residual** contribution before optional
   surplus; never sum unlike residual units;
8. for every proposed secondary occurrence, reuse ADR-0018 D-SUPPORT's preservation invariant
   and bounded proof. The current allocator's `AllocationAssignment` topology is
   one-session-per-date, so the secondary should be applied as projected support load/history on
   its actual date and the existing required-role feasibility proof rerun against that state,
   not represented as a fictitious second primary reservation on the same date;
9. after an accepted secondary pick, recompute remaining reservations and residuals;
10. keep spacing, rolling-load, injury, readiness and taper gates;
11. mark unresolved/blocked residual requirements explicitly.

Never infer a second window because the athlete "probably has ten minutes at home." An extra
window also does not create extra weekly training commitment. A distinct PM occurrence consumes
the applicable existing occurrence/session capacity; an embedded module remains part of its
containing occurrence while its materialized minutes, cost and stimulus still count normally.

Same-day priority:

- current block BUILD quality gets first claim on freshness;
- secondary MAINTAIN/MICRODOSE work is later by default;
- strength-development blocks may reverse this;
- no universal clock separation is encoded as physiological law;
- later work stays provisional until reassessment.

## 8. Aerobic accounting: does tempo/threshold cover base?

**Partly, but not completely.**

A quality endurance session has at least four planner meanings:

1. **aerobic stimulus** — tempo/threshold can contribute strongly;
2. **total aerobic duration** — its actual aerobic minutes count;
3. **low-intensity support volume** — only genuinely low-intensity portions count;
4. **long continuous durability anchor** — requires its own exact role/definition.

Recommended representation:

```text
A. fractional aerobicEndurance stimulus credit
B. total aerobic minutes by intensity domain
C. low-intensity support minutes/range
D. long continuous anchor role
```

Threshold can advance A and B. It advances C only for work truly in that domain, and D only
when the exact anchor contract says so.

This avoids both under-crediting quality work and pretending high intensity makes low-cost
volume unnecessary. #806 is the right issue to own B–D.

## 9. Injury and tissue constraints

Distinguish:

- contraindicated delivery — do not prescribe it;
- shared stimulus safely attainable elsewhere — cross-credit/substitute;
- `blocked` — the requirement remains active but a current hard constraint prevents delivery
  in this planning window;
- `deliberately_suspended` — the canonical block/event/safety owner intentionally turns the
  requirement off for the relevant window, with no catch-up debt;
- `unknown` — target/progress cannot be established from the authoritative evidence.

If impact is blocked but cycling is safe, cycling can preserve aerobic stimulus; safe strength
patterns can still train strength; but impact/running familiarity is **not fulfilled by
cycling**. The fulfilment layer consumes the canonical status and must not infer suspension
from a missing workout or from modality names.

## 10. Optimization hierarchy

Do not replace ADR-0018's live feasibility hierarchy. Safety/clinical/tissue gates, fixed
commitments/protected rest, the ADR-0043 rolling-load envelope, and exact required-role
reservation/preservation remain incumbent authorities.

Only inside the remaining feasible support space should residual fulfilment add lexicographic
ordering such as:

1. canonical minimum accumulated dose / overdue capability floors;
2. phase-priority BUILD stimulus;
3. secondary MAINTAIN/MICRODOSE residuals;
4. preferred modality and logistics;
5. optional surplus utility.

Any rule that promotes a capability/dose residual into the exact required-role tier must be
owned by that canonical family and integrated through ADR-0018 rather than smuggled in as a
ranking bonus. Within a comparable support tier, choose candidates by marginal **residual
requirement contribution** while preserving spacing, quality and the incumbent required-role
witness. Do not compare raw residual magnitudes across unlike units/classes.

Do not expose "benefit per minute" as a universal physiological metric. It is an allocation
heuristic over registered benefits/costs.

## 11. Suggested implementation boundaries

### Reuse
- `stimulus.ts` fractional objective credit;
- canonical coverage for exact role identity;
- `weeklyAllocation.ts` role reservation;
- `weeklyDosePacking.ts` weekly target construction;
- ADR-0036 intraday windows/ledger/reassessment;
- ADR-0043 rolling load budget;
- existing injury/health/readiness authorities.

### Add
- typed requirement classes;
- residual-requirement portfolio view;
- capability/movement metadata from #802–#805;
- explicit microdose modules;
- bounded automatic intraday packing;
- typed shortfall/suspension reporting;
- aerobic accumulated-dose envelope from #806.

### Do not add
- a second fatigue system;
- a second injury system;
- a second performed-training truth;
- free-text stimulus inference;
- a universal threshold-to-Z2 conversion;
- automatic doubles without explicit windows;
- "microdose = full session" shortcuts.

## 12. Recommended sequencing against existing issues

1. Foundation design — accept a constraint-aware fulfilment ADR and requirement classes.
2. #801 + #802 — second strength/power support role + first-class power with embedded
   microdose capability.
3. #803 — composition evidence so microdoses can prove which movement families they preserve.
4. #806 — accumulated aerobic dose + long anchor, separate from stimulus credit.
5. #804 + #805 — longitudinal impact/COD capability ledgers with blocked/suspended states.
6. Automatic intraday packing — consume those canonical models and ADR-0036.
7. Extend the already-landed #813 read-only exposure/stressor ledger to consume canonical
   residual/blocked/overdue state as #802–#806 land; the renderer never owns the policy.

## 13. Future acceptance scenarios

1. **35-min cycling-primary athlete + home gym**
   - cap-fitting cycling quality retained;
   - compact strength microdose can use a second explicit window;
   - no day exceeds minute/load capacity;
   - PM is reassessed after AM;
   - microdose gets only delivered credit.

2. **Threshold + aerobic requirement**
   - threshold earns fractional aerobic stimulus;
   - its duration appears in aerobic totals;
   - an unmet long anchor remains unmet;
   - no hard-coded threshold->Z2 conversion.

3. **Knee/impact restriction**
   - safe cycling preserves aerobic stimulus;
   - impact/COD is blocked/suspended, not falsely satisfied;
   - non-impact power counts only if explicitly qualified.

4. **Equipment-limited travel**
   - bodyweight/kettlebell modules are eligible only when metadata permits;
   - unavailable barbell work remains visible;
   - exact primary-strength status stays honest.

5. **Race week/taper**
   - event specificity can intentionally suppress optional capabilities;
   - suppression is visible and does not create immediate catch-up debt.

6. **No second daily window**
   - automatic packing does not invent a double;
   - the residual requirement moves within the weekly search or becomes typed shortfall.

## 14. Risks and mitigations

- **Over-crediting one "super session":** keep exact roles strict, cap residual cross-credit,
  retain dose/anchor ledgers.
- **Session fragmentation:** microdoses solve residual deficits; add a transition/fragmentation
  preference after hard feasibility rather than creating many tiny tasks.
- **Interference from excessive doubles:** block priority, cost/spacing, explicit windows and PM
  reassessment remain authoritative.
- **Product heuristics presented as science:** every minimum, max gap, cross-credit threshold
  and packing constant gets ADR-0033 lineage + policy-alignment tests.
- **Injury substitution hiding lost capacity:** `deliberately_suspended` is first-class for
  unique blocked capabilities.

## 15. Recommendation

Proceed with this as an architecture layer **above** the existing stimulus and coverage
systems.

> **Preserve the highest-value required training under the real constraints, recognize every
> valid secondary benefit, compress compatible maintenance work aggressively when evidence
> permits, and remain explicit about what was not delivered.**

That gives the knowledge library more authority under constraints, not less: requirements are
no longer discarded when a canonical full workout cannot fit, but neither are they satisfied
by invented equivalences.
