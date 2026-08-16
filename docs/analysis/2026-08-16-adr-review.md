# 2026-08-16 ADR consistency, evidence, and governance review

## Scope

This review covers every Architecture Decision Record currently present in `docs/adr/`
(ADR-0001 through ADR-0020, with ADR-0013 absent), plus the mutable documentation surfaces
that claim ADR status: `docs/README.md`, `docs/plans/README.md`, and the implemented Phase
plans that establish whether a decision is still merely proposed.

The review asks four separate questions:

1. **Decision quality:** is the architectural boundary still defensible?
2. **Implementation alignment:** does current code/planning still match the decision?
3. **Evidence posture:** does an ADR distinguish engineering/product policy from scientific
   evidence rather than presenting a heuristic as physiology?
4. **Governance:** do status, supersession, and amendment practices follow ADR-0001?

This is a point-in-time review. It does not amend accepted ADRs. When an accepted decision
needs to change, ADR-0001's supersession rule should be followed rather than editing history
silently.

## Executive conclusion

The repository does **not** need a broad ADR redesign. The substantive architecture becomes
progressively stronger from ADR-0012 onward: authority is separated, ranking is increasingly
lexicographic, evidence quality is explicit, simulation is treated as regression evidence
rather than clinical validation, and later ADRs are increasingly careful about what is and
is not known.

The important work is narrower:

* **P1 — record the missing structured-injury decision as ADR-0013.** Phase 1 implemented a
  safety-bearing architectural decision but the reserved ADR was never written.
* **P1 — repair ADR status bookkeeping in mutable indexes.** `docs/plans/README.md` still
  places accepted/implemented ADR-0017, ADR-0018, ADR-0019 and now-accepted ADR-0020 under
  "Proposed decisions awaiting acceptance". `docs/README.md` omits ADR-0012 from the list
  despite saying it is listed, still describes ADR-0013 as merely reserved, and carries
  several stale plan/schema statuses.
* **P1 — stop using ADR-0006 as evidence that the engine identifies overtraining.** Its
  telemetry is a product strain/risk signal. Overtraining syndrome is a clinical/exclusion
  diagnosis for which no single generally accepted marker exists; the ADR's phrase
  "accurately distinguishes ... accumulated chronic overtraining" is stronger than the
  model or literature supports.
* **P2 — formalise what an "amendment" to an accepted ADR is allowed to mean.** ADR-0001
  says accepted ADRs are generally immutable and changed decisions require a successor,
  yet several accepted ADRs contain later amendment/addition sections. Some are harmless
  implementation-history notes; others alter the recorded contract. The repository needs
  one explicit rule so future assistants do not edit accepted decisions opportunistically.
* **P2 — keep ADR-0011 Accepted for now, but treat it as historical/partially displaced.**
  The later lexicographic and reservation work replaced the dangerous role of multipliers,
  but current `optimizer.ts` still intentionally contains the anchor boost, adjacency
  suppression and variety tie-break inside lower-priority utility. Marking ADR-0011 wholly
  Superseded would therefore be inaccurate today.

No other accepted ADR needs an emergency status change from this review.

---

## Status review

| ADR | Current status | Review verdict | Notes |
|---|---|---|---|
| 0001 | Accepted | **Keep** | Core governance decision is sound; amendment semantics need a successor/clarification, not an in-place rewrite. |
| 0002 | Accepted | **Keep** | User-scoped Firestore paths remain a foundational isolation invariant. |
| 0003 | Accepted | **Keep** | Warsaw-local dates and D-1 completed-step semantics remain explicit and testable. |
| 0004 | Accepted | **Keep** | Workout-definition/prescription separation remains sound. Later plan-authority notes are compatible extensions. |
| 0005 | Accepted | **Keep** | Raw archive + offline rebuild is an operational architecture decision with clear trade-offs. |
| 0006 | Accepted | **Keep decision; correct future wording via successor/current architecture** | Acute vs longer-term telemetry decomposition is useful; diagnostic "chronic overtraining" language is not justified. |
| 0007 | Accepted | **Keep** | Layered multi-sport architecture remains relevant. Several optimizer details were later constrained by ADR-0012/0016/0018, which is normal evolution. |
| 0008 | Accepted | **Keep** | Confidence-tiered rolling forecast remains the base week-ahead contract; later allocation work extends it. |
| 0009 | Accepted | **Keep** | Evaluation-time, history-seeded intent remains aligned with ADR-0010's immutable history snapshot boundary. |
| 0010 | Accepted | **Keep** | Provenance/replay and fail-closed history semantics remain among the strongest repository invariants. |
| 0011 | Accepted | **Keep, explicitly historical/partially displaced** | Do not mark wholly superseded: anchor/variety lower-tier behavior still exists. Higher-priority sequence safety/allocation has moved to later ADRs. |
| 0012 | Accepted | **Keep** | Authority layering and lexicographic priority remain the architectural backbone. Missing from the docs index is a bookkeeping defect. |
| 0013 | **Missing** | **Write retroactive ADR** | Structured `InjuryConstraint[]` was explicitly chosen and implemented in Phase 1. This is safety-bearing architecture and merits the reserved ADR number. |
| 0014 | Accepted | **Keep** | Strong evidence posture: one credit ledger, honest delivered load, and explicit statement that retained fatigue fusion is not validated merely because an alternative was worse. |
| 0015 | Accepted | **Keep** | Correctly records a decision *not* to adopt measured beam search yet. Historical benchmark numbers should remain historical, not be read as current performance. |
| 0016 | Accepted | **Keep** | Adaptation credit vs programming-role coverage is a clean separation of concepts. |
| 0017 | Accepted | **Keep** | Evidence -> dose -> capacity -> packing boundary is well designed and explicitly distinguishes guidelines, outcome defaults, priors and heuristics. |
| 0018 | Accepted | **Keep** | Deterministic bounded reservation search extends greedy planning without silently adopting beam search; miss semantics are explicit. |
| 0019 | Accepted | **Keep; revisit event medical escalation when richer clinical inputs exist** | External selection vs internal adjudication boundary is strong. Event advice must remain able to surface serious health warnings even though the verdict class is advisory rather than permission. |
| 0020 | Accepted 2026-08-16 | **Keep** | Acceptance approves the tighten-only architecture and experiment, not production activation; estimator details remain measured policy. |

---

## Finding F-ADR-1 — ADR-0013 is missing even though its decision shipped

**Severity: P1 documentation / safety governance.**

`docs/README.md` says ADR-0013 is reserved for structured injury constraints. That work is
not future work. Phase 1 is `Implemented`, and work item 1.1 records an explicit 2026-08-08
decision for **Option B**: canonical structured `InjuryConstraint[]`, with a pure
`resolveInjuryRestrictions` mapping into hard modality/category/guardrail restrictions.

This is more deserving of an ADR than several lower-risk decisions already recorded:

* it changes a persisted safety schema;
* it defines a single source of truth for injury restrictions;
* it separates injury from preference;
* it defines expiry/review semantics;
* it deliberately chooses conservative engineering mappings and records their limitations.

### Recommendation

Write ADR-0013 retroactively, following the precedent of ADR-0010 and ADR-0011. It should
record the already-made decision rather than inventing new policy. The safest title is:

> **ADR-0013: Structured Injury Constraints Are the Canonical Safety Input**

It should explicitly state that region-to-restriction mappings are **conservative
engineering policy, not medical diagnosis or individualized clinical advice**.

---

## Finding F-ADR-2 — mutable status indexes are materially stale

**Severity: P1 documentation correctness.**

`docs/plans/README.md` says the "Proposed decisions awaiting acceptance" section contains
choices that "must not be implemented until the linked ADR is accepted", but that table
currently contains decisions from:

* ADR-0017 — Accepted; Phase 7B Implemented;
* ADR-0018 — Accepted; Phase 7A Implemented;
* ADR-0019 — Accepted; Phase 8 Implemented;
* ADR-0020 — now Accepted; Phase 9 implementation is allowed to proceed behind the
  default-off experimental selector.

This is especially risky for AI-assisted maintenance because the repository explicitly
uses the plan index as the entry point for "what is startable today".

`docs/README.md` has a second set of stale facts:

* the ADR bullet list skips ADR-0012 even though the following paragraph says it is listed;
* ADR-0013 is described as reserved future work though its underlying decision shipped;
* ADR-0020 is still described as Proposed until the index is updated;
* Phase 9.0 is described as Draft while the plan index says In progress;
* the external-plan schema is described as "Proposed, not implemented" although the schema
  itself says "implemented contract" and Phase 8 is Implemented.

### Recommendation

These are mutable indexes, so fix them directly rather than creating ADRs for them. Move
ADR-0017/18/19/20 decisions into the accepted register (or replace the split register with
one table carrying `Accepted/Proposed/Rejected` status). Add ADR-0012 to the docs index and
replace the ADR-0013 reservation note once the retroactive ADR exists.

---

## Finding F-ADR-3 — ADR-0006 overstates what readiness telemetry can establish

**Severity: P1 evidence wording; no immediate code change required.**

ADR-0006's architectural decomposition is defensible: acute deviations and longer-term
within-athlete drift are useful, separately explainable inputs. The problem is the Positive
consequence claiming the system:

> "Accurately distinguishes between temporary acute fatigue and accumulated chronic overtraining."

That is a diagnostic claim the model cannot support. The ECSS/ACSM consensus on
non-functional overreaching and overtraining syndrome (Meeusen et al., PMID 23247672,
DOI 10.1249/MSS.0b013e318279a10a) describes OTS as difficult to distinguish, dependent on
clinical outcome/exclusion diagnosis, and notes that no marker met all criteria for general
acceptance. HRV/RHR/sleep trends are therefore **signals of strain/recovery state**, not a
diagnosis of overtraining syndrome.

### Recommendation

Do not edit ADR-0006 silently. In the current architecture reference and in any successor
ADR, use language such as:

> "Separates acute deviation from longer-term adverse trend for decision support; it does
> not diagnose non-functional overreaching or overtraining syndrome."

If ADR-0006 is ever superseded for another reason, carry that wording into the successor.

---

## Finding F-ADR-4 — ADR amendment practice conflicts with ADR-0001

**Severity: P2 governance.**

ADR-0001 says accepted ADRs are generally immutable and a changed decision should be
recorded by a new ADR that supersedes the old one. The repository later developed a
practice of adding sections labelled `Amendment`, `Added`, or equivalent to already
accepted ADRs (for example ADR-0004, ADR-0006, ADR-0007, ADR-0008, ADR-0014, and ADR-0019).

Not every such edit is wrong. There are two different categories being conflated:

1. **Non-semantic historical annotation** — e.g. "Phase X later implemented this accepted
   boundary" or "this known gap was closed". This does not change the decision.
2. **Decision amendment** — changes the policy, authority, accepted evidence gate, or
   behavior contract. Under ADR-0001 this should be a successor/superseding ADR.

Without a rule, future editors cannot tell when an accepted ADR may be touched.

### Recommendation

Create a small successor governance ADR (suggested ADR-0021) that preserves immutable
history but explicitly permits **metadata/status and non-semantic implementation notes**.
Require a new ADR for any semantic decision change. It should also define how to mark an
ADR that is only partially superseded.

Do **not** retroactively rewrite the existing amendment history; record the rule going
forward.

---

## Finding F-ADR-5 — ADR-0011 should not be marked fully Superseded yet

**Severity: P2 status clarity.**

ADR-0011 itself says its multiplier-based weekly shaping should give way to lexicographic
priorities and bounded sequence reasoning. Much of that direction landed in Phase 3 and
ADR-0018. However, the current optimizer still intentionally contains lower-tier anchor
and variety behavior:

* `ANCHOR_ROLE_BOOST`;
* `ANCHOR_ADJACENCY_SUPPRESSION`;
* `VARIETY_TIE_BREAK_GAP`;
* anchor timing benefit inside the lower-priority benefit/utility calculation.

At the same time, the dangerous part of the old model has been constrained: hard recovery
and spacing exclusions run before ranking, explicit coverage tier outranks benefit, benefit
tier outranks final utility, and ADR-0018 protects required role allocations statefully.

### Recommendation

Keep ADR-0011 `Accepted` until a successor explicitly removes or rehomes the remaining
anchor/variety semantics. In indexes, describe it as **historical / partially displaced by
ADR-0012 and ADR-0018**, not as the current top-level weekly-planning authority.

---

## Finding F-ADR-6 — later evidence-oriented ADRs are substantially better disciplined

**Severity: positive finding; preserve this pattern.**

ADR-0014, ADR-0017, and ADR-0020 contain patterns worth treating as the standard for new
training-policy ADRs:

* separate physiological/adaptation requirements from session containers;
* label public-health guidance as a guideline target, not a biological minimum;
* label product heuristics and conditional priors as such;
* preserve exact provenance/evidence tier;
* measure alternatives before choosing;
* treat a negative experimental result as valid;
* distinguish simulation/regression evidence from real-world outcome validation;
* make safety fallbacks fail closed or return to already-shipped behavior;
* avoid allowing relative normalization to erase absolute safety warnings.

The WHO adult physical-activity guidance does support 150–300 minutes of moderate aerobic
activity (or 75–150 vigorous-equivalent) plus muscle strengthening on 2+ days/week, while
also making clear that some activity is better than none. The 2026 ACSM resistance-training
position stand (Currier et al., PMID 41843416, DOI 10.1249/MSS.0000000000003897) is
appropriately treated in ADR-0017 as evidence informing dose/implementation rather than a
single universal periodization model.

### Recommendation

Use ADR-0017/0020's evidence vocabulary as the template for future training-policy ADRs.
Do not copy ADR-0006's older diagnostic-sounding language forward.

---

## Finding F-ADR-7 — ADR-0019's event verdict needs a future medical-escalation boundary

**Severity: P3 future safety design, not a current merge blocker.**

ADR-0019 correctly distinguishes **permission** from **advice** for a target event: the
application should not pretend it has authority to cancel an athlete's race. `advisory` is
therefore a reasonable verdict class.

The invariant should not be misread as "the application may never advise against starting."
As richer illness/red-flag/clinical inputs are added, the advisory path must remain capable
of unambiguous safety language and escalation (for example, do not start until medically
assessed) without pretending the app grants or withdraws permission.

### Recommendation

No change now. When clinical/red-flag inputs are expanded, create a focused ADR defining
medical escalation language independently from the event's `advisory` verdict class.

---

## No-change findings worth preserving

### ADR-0010 — provenance/replay

Failing closed on unavailable/corrupt required history, immutable revisions, policy-version
attribution, and normalized audit facts remain strong decisions. Later work should continue
to avoid duplicating raw health payloads into recommendation audits.

### ADR-0014 — objective credit and fatigue-fusion evidence

The ADR correctly records that `max()` fusion was retained because the tested alternative
was worse, **not** because `max()` was scientifically validated. Preserve that distinction.

### ADR-0015 — beam-search adoption deferred

`Accepted` is the right status because the accepted decision is "keep greedy production for
now", not "beam search is accepted". The benchmark numbers are historical evidence from the
recorded corpus, not current performance guarantees.

### ADR-0017 / ADR-0018

The split between evidence-derived dose, real capacity, exact role packing, stateful
allocation, and hard feasibility is coherent. ADR-0018 also correctly treats search-budget
exhaustion as epistemic uncertainty (`unresolved_search_budget`) rather than falsely calling
an occurrence infeasible.

### ADR-0020

Accepted on 2026-08-16 with an explicit acceptance boundary: the repository may implement
and measure the default-off candidate, but a production switch requires prospective evidence
as well as simulation/regression evidence. The estimator remains versioned policy rather
than an immutable physiological claim.

---

## Recommended follow-up order

1. **Write retroactive ADR-0013** from the already-implemented Phase 1 D-INJ decision.
2. **Repair `docs/README.md` and `docs/plans/README.md` status/index drift**, including
   moving ADR-0017/18/19/20 out of the proposed register.
3. **Add a non-diagnostic readiness statement to the living recommendation-engine
   architecture** so readers do not inherit ADR-0006's overtraining wording.
4. **Propose ADR-0021 for ADR amendment/supersession governance**; accept it only after
   explicit owner review.
5. Continue Phase 9 under accepted ADR-0020, keeping the drift selector default-off until
   the Phase 9 go/no-go evidence exists.

No current code behavior was changed by this review.
