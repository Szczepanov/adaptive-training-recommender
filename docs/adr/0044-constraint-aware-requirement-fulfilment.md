# ADR-0044 — Constraint-aware requirement fulfilment and bounded multi-stimulus packing

**Status:** Accepted
**Date:** 2026-09-26
**Related:** ADR-0016, ADR-0018, ADR-0033, ADR-0036, ADR-0043; #801–#806, #813
**Analysis:** [Constraint-aware training requirement fulfilment](../analysis/2026-09-26-constraint-aware-training-fulfilment.md)

## Context

The recommendation engine has deliberately separate authorities for physiological objective
credit, exact weekly programming-role coverage, safety/readiness, rolling load, and intraday
capacity. That separation is correct, but the planner still lacks one explicit answer to a
common constrained-planning problem:

> when the ideal weekly set of sessions does not fit, how should the engine preserve as much
> of the intended adaptation/capability portfolio as possible without inventing equivalence?

Current and planned capability work (#801–#806) increases that pressure. Strength, power,
movement composition, impact, COD, aerobic accumulated dose and long-duration durability
cannot each become an independent mandatory workout without inflating session count.

ADR-0036 already permits several safe authored occurrences on one day using explicit windows,
a shared daily ledger and later-session reassessment. Automatic multi-window packing was
deliberately deferred until those boundaries existed.

## Decision

### D1 — Requirements have four semantic classes

The planner will distinguish:

1. **exact role** — identity/composition matters and exact coverage remains authoritative;
2. **fractional stimulus** — a session may contribute dose-scaled credit to several
   physiological objectives;
3. **accumulated dose** — minutes/sets/other quantity accumulated over a window;
4. **longitudinal capability exposure** — rolling-horizon maintenance/re-entry of a specific
   physical capability.

A requirement may own more than one class, but the classes never silently substitute for one
another.

### D2 — Exact role coverage remains strict

`CoverageCreditFact` and descriptor-scoped role coverage remain the authority for authored
programming roles. Fractional stimulus, accumulated minutes or a related modality cannot
silently promote an exposure into an exact role.

Examples:

- threshold cycling may contribute aerobic stimulus but does not automatically satisfy a long
  aerobic anchor;
- compact resistance work may contribute strength stimulus but does not automatically satisfy
  `primary_strength`;
- cycling may preserve aerobic work while an impact capability remains blocked.

### D3 — Cross-credit is residual, fractional and evidence-bounded

A qualifying session may contribute to every structured stimulus/capability axis it actually
delivers, but the fulfilment layer does not calculate a second physiological credit. Fractional
objective credit reuses ADR-0014's canonical `deriveObjectiveCredit*` path; capability credit
comes from the canonical capability owner as those models land. Before any degradation or
secondary-session search, completed and already-committed/projected sessions contribute through
those canonical owners and the requirement view is recomputed. Cross-credit is therefore
baseline residual accounting, not a late fallback that can trigger work which existing sessions
already satisfy.

Knowledge-claim `evidenceCertainty` under ADR-0033 is provenance for policy, not a numeric
multiplier on delivered training credit. This does **not** remove ADR-0014's existing
`StimulusConfidence` / `CONFIDENCE_CREDIT_WEIGHT` handling for performed evidence: that is
source/delivery confidence inside the canonical objective-credit calculation. The fulfilment
layer applies neither a second scientific-certainty discount nor a second performed-evidence
discount. Marginal contribution is capped at the residual requirement.

No universal intensity-time exchange rate is introduced. In particular, there is no fixed rule
such as "one threshold minute equals N low-intensity minutes."

### D4 — Constraint degradation is explicit and ordered

After safety/event/load feasibility **and after D3 has recomputed residuals from all canonical
completed/projected contributions**, the architecture exposes the following admissible
degradation operations. Their live ordering is policy, not physiology: any ordering or
tie-break that changes selection must have the ADR-0033 lineage required by D10. The proposed
initial search sequence is:

1. full authored dose for still-residual requirements;
2. validated dose compression;
3. compatible same-day consolidation using real windows;
4. conversion of secondary BUILD work to MAINTAIN/MICRODOSE when a registered policy permits;
5. safe equipment/modality substitution for genuinely shared requirements;
6. typed shortfall or deliberate suspension.

Cross-credit is intentionally absent from this list because it is accounting, not degradation:
every accepted or already-committed session immediately updates the canonical residual view
before another candidate is considered. The engine does not claim that all requirements can
always be fulfilled.

### D5 — Microdose is a delivery form, not a coverage loophole

A microdose must be a structured authored module or occurrence with:

- bounded duration/dose;
- explicit equipment and safety requirements;
- structured stimulus/capability metadata;
- normal cost accounting;
- explicit eligible intent (`develop`, `maintain`, `microdose`);
- materialization into the existing session/occurrence and canonical stimulus/cost contracts.

A module has no intrinsic exact-role authority. Exact role credit exists only when the
materialized identity is explicitly mapped by the active coverage descriptor and passes its
dose/phase rules. Free-text fragments and arbitrary truncation do not create microdose
authority.

### D6 — Same-day automatic packing reuses ADR-0036

A future automatic packer may place multiple generated occurrences on one day only when
explicit athlete availability contains distinct usable windows.

It reuses:

- the one shared daily minute/load ledger;
- occurrence reservations;
- common eligibility/readiness/injury gates;
- later-session reassessment;
- atomic launch/admission;
- existing spacing and rolling-load authorities.

The packer does not infer extra availability and does not create a second fatigue or safety
model. A distinct generated secondary occurrence also consumes the athlete's existing
weekly session/occurrence commitment when that commitment applies; an extra window does not
increase weekly commitment, required dose or tolerated-load assumptions. An embedded module
inside one occurrence does not consume another occurrence count, but its materialized minutes,
cost and stimulus remain part of that occurrence.

The packer also does not run as an unconstrained post-processing optimizer: every generated
secondary occurrence must preserve ADR-0018's incumbent maximum achievable required-role
allocation under the projected state (D-SUPPORT), and remaining reservations are recomputed
after each accepted secondary pick. This reuses D-SUPPORT's **preservation invariant and
bounded proof**, not the allocator's current one-session-per-date assignment topology. The
secondary occurrence is applied as projected support load/history on its actual date and the
existing bounded required-role feasibility proof is rerun against that projected state. If a
small adapter is needed to project same-date secondary load into the evaluator, it must reuse
the canonical feasibility/state-transition path rather than introduce a parallel allocator or
second set of gates.

### D7 — Current block priority owns freshness

When compatible work shares a day, the current block's BUILD quality normally receives first
claim on freshness. Secondary MAINTAIN/MICRODOSE work is placed later by default.

A strength-development block may reverse that order. No universal clock-time separation is
declared here; any minimum separation remains an authored/planning constraint and later-session
reassessment still governs execution.

### D8 — Aerobic base is not one scalar checkbox

Aerobic planning must keep separate:

1. fractional aerobic-endurance stimulus;
2. total aerobic duration by intensity domain;
3. low-intensity support volume/range;
4. long continuous aerobic/durability anchor.

Tempo/threshold may advance (1) and (2). It advances (3) only for actual work in the
low-intensity domain and (4) only when the exact anchor definition is satisfied.

Issue #806 is the canonical follow-up for accumulated aerobic dose and the long anchor.

### D9 — Unique blocked capabilities become suspended, not substituted

If a tissue/injury restriction blocks a unique capability such as impact/COD, other safe
training may still receive its genuine shared stimulus credit. The unavailable unique
capability is not marked satisfied.

The status vocabulary is source-owned and has explicit semantics:

- `blocked` — the requirement remains active, but a current hard constraint prevents delivery
  in the planning window; its target/residual remains visible and does not generate an
  inadmissible candidate;
- `deliberately_suspended` — the canonical block/event/safety policy intentionally turns the
  requirement off for the relevant window; it does not create catch-up debt;
- `unknown` — the canonical owner cannot establish the target or progress from available
  evidence; unknown quantities remain unknown rather than becoming zero.

The fulfilment layer consumes those states; it does not infer `blocked` versus
`deliberately_suspended` from a workout name or from missing data.

Completed and projected state remain distinct. Completed/delivered capability or role evidence
comes only from the canonical performed-training authorities; a planned occurrence may reduce a
forecast residual but never confirms that the capability was performed. The fulfilment layer
and the #813 readout consume this distinction rather than creating another completion ledger.

### D10 — Policy constants and selection ordering require knowledge lineage

Any live minimum dose, max-gap, cross-credit threshold, packing preference or BUILD->MAINTAIN
transition rule introduced under this ADR requires:

- a registered ADR-0033 claim;
- explicit evidence/product-heuristic classification;
- limitations;
- a coverage item;
- a policy-alignment test;
- `POLICY_VERSION` bump when recommendation behavior changes.

ADR-0033 knowledge-claim evidence certainty must not be repurposed as a generic physiological
credit multiplier; credit semantics remain owned by the canonical objective/capability model.
ADR-0014's existing performed-evidence `StimulusConfidence` remains part of that canonical
objective-credit model and must not be multiplied a second time by this layer.

## Consequences

### Positive

- constrained athletes can preserve more of the intended training portfolio without inflating
  full-session count;
- quality sessions receive all valid secondary physiological credit;
- microdoses become useful without weakening exact coverage semantics;
- same-day doubles become a controlled allocation tool instead of ad hoc calendar logic;
- injury/equipment constraints degrade honestly;
- #801–#806 can share one fulfilment architecture rather than creating separate special cases.

### Costs

- weekly allocation becomes a multi-dimensional residual-coverage problem;
- capability metadata must become structured;
- microdose modules need catalog/validation support;
- diagnostics must explain partial, blocked and suspended requirements;
- simulation coverage must expand to constrained multi-session cases.

## Non-decisions

This ADR does **not** decide:

- athlete-relative aerobic-dose formulas (#806);
- power frequency/dose (#802);
- unilateral composition rules (#803);
- impact progression/max gaps (#804);
- multidirectional cadence (#805);
- a universal minimum strength microdose;
- a universal same-day separation duration;
- an intensity-equivalence multiplier.

Those remain separate evidence/policy decisions and must not be smuggled into the packer.

### #806 — Weekly aerobic-dose envelope

Issue #806 resolves the aerobic-dose non-decision for an opt-in athlete-history envelope.
`resolveWeeklyAerobicDoseEnvelope` uses four fixed seven-day bins from the supplied 28-day
history. It requires established training evidence and aerobic activity in at least three of
the four bins; otherwise the recommendation falls back to the adult-health guideline range
(150-minute floor, 150-minute initial target, 300-minute upper bound). Complete history alone
does not relabel that public-health floor as an athlete-specific easy-volume obligation: the
athlete-history envelope activates only when the selected maintenance/development statistic
exceeds 150 minutes/week. Otherwise guideline semantics remain authoritative, including broad
aerobic equivalence. When athlete-history semantics are active, the floor is max(150, the lower
quartile of weekly easy-aerobic minutes); maintenance uses the median, and an
endurance/sport-readiness development priority may target the upper quartile. History changes
the target within the athlete's demonstrated range. More free time alone cannot raise it.

Only completed easy-endurance / Zone 2 activity in the dominant evidenced modality enters
the athlete-relative envelope. No intensity conversion is used: threshold or vigorous
minutes do not become low-intensity minutes. Under the guideline fallback, actually packed
quality-session minutes may count toward the general weekly aerobic-health total, without a
multiplier. The existing #757 single-session exact-role duration floor remains separate.

An established athlete with at least four primary-modality easy sessions may also receive a
conditional `long_aerobic_anchor` exact role for endurance or sport-readiness development.
Its duration is the history's 75th-percentile session duration bounded by the matching
allocator-executable standard engine-template ceiling. The packer therefore cannot claim a
harder-dose duration that the weekly allocator has no authority to materialize. One exact
qualifying session must meet that duration; several short sessions cannot combine to satisfy
the anchor, and allocation may reserve it only on a date whose resolved exercise window reaches
the duration gate. Adverse recovery, symptoms, taper/recovery phase, or lack of a matching safe
schedule window suspends the anchor while retaining the weekly aerobic target and reports a
typed shortfall when it cannot be packed. Existing readiness, injury, load and availability
authorities remain controlling.

## Acceptance before status can move to Accepted

1. Owners of #801–#806 agree that their canonical models can map to these four requirement
   classes without duplicating ledgers.
2. A bounded allocation design demonstrates no loss of ADR-0018 exact-role guarantees,
   including D-SUPPORT preservation after every generated secondary occurrence.
3. Automatic intraday packing proves it can reuse ADR-0036's shared ledger and reassessment
   rather than bypassing them.
4. #806 specifies aerobic duration/intensity accounting without threshold-to-Z2 equivalence.
5. A simulation design covers time, equipment, tissue restriction, taper and no-second-window
   cases.
6. The residual-view contract defines stable sibling identity and unit isolation for logical
   requirements that expose more than one semantic class; unknown quantities are never encoded
   as zero.
7. Automatic secondary packing proves that extra intraday windows do not increase weekly
   session commitment and that same-date secondary load preserves ADR-0018 D-SUPPORT without
   changing its exact-role reservation semantics.
