# ADR-0011: Weekly Architecture — Session Anchors & Ranking Modifiers

* **Status:** Accepted
* **Date:** 2026-08-08 (recorded retroactively; implemented 2026-08-07)
* **Deciders:** Core Engineering Team

> **Retroactive record.** `resolveWeeklyAnchors` and optimizer Patches 4–6 shipped
> without an ADR, despite being the largest change to how a week is shaped since
> [ADR-0008](./0008-week-ahead-planning.md) — which they postdate and which does not
> mention them. Identified as finding F10 in
> [the 2026-08-08 review](../analysis/2026-08-08-architecture-review.md).

---

## Context and Problem Statement

[ADR-0008](./0008-week-ahead-planning.md)'s projected planner walks forward one day at a
time, each day choosing the locally highest-utility candidate. Greedy day-by-day
selection cannot express a property that belongs to the *week*:

* **"Which day gets the key session?"** is a weekly question. A greedy loop answers it
  accidentally — whichever day happened to have the most time and the least accumulated
  fatigue when the loop reached it.
* **Freshness for a key session** is a relationship between days. Nothing in per-day
  ranking knows that Friday's heavy squat session will compromise Saturday's
  race-specific ride, because Saturday has not been evaluated yet when Friday is chosen.
* **Variety** degenerates without a tie-break. When two templates in the same category
  score within float noise, a stable sort returns the same one every run, so the athlete
  sees the identical session repeatedly despite an equivalent alternative existing.

---

## Decision Outcome

### 1. A pure, fatigue-independent anchor pre-pass

[`resolveWeeklyAnchors`](../../app/src/engine/planner.ts) runs **once** before the
day-by-day fatigue loop and nominates up to two days:

* **`eventSpecificAnchorDate`** — the weekend-style race-specific / race-simulation day.
* **`qualityAnchorDate`** — the midweek structured threshold / over-under day.

It is deliberately constrained:

* **Scans offsets 2..N only.** Offset 1 (tomorrow) reuses `rules.ts`'s own evaluation,
  which has no anchor concept, so tomorrow can never be nominated.
* **Requires a real focus event.** A Base-phase or eventless athlete gets
  `{ null, null }` and the planner behaves exactly as it did before this existed.
* **Nominates only where the real loop could deliver.** Candidate days are filtered
  through the same `eligibleTemplates` hard gate the loop uses, so an "indoor only"
  setting correctly rules out an outdoor-only race-specific ride rather than nominating
  a day the loop would immediately fall through on.
* **Picks by available time**, and separates the quality anchor from the event-specific
  anchor by `QUALITY_ANCHOR_MIN_GAP_DAYS` (2), relaxing to 1 only if no day qualifies.

It can run ahead of the stateful loop because both of its inputs — time budget and phase
eligibility — are independent of fatigue.

### 2. Named, auditable ranking modifiers

[`optimizer.ts`](../../app/src/engine/optimizer.ts) applies these after safety and
availability filtering:

| Patch | Modifier | Value | Purpose |
|---|---|---|---|
| 4 | Anchor role boost | ×1.35 | Nudges a nominated day toward its designated role |
| 5 | Anchor adjacency suppression | ×0.3 | Suppresses heavy lower-body/full-body strength (`systemicCost >= 0.5`) the day before or after an anchor |
| 6 | Variety tie-break | within 0.05 utility | Among same-modality, same-category near-equivalents, prefers the least recently used |

Patch 5 is scoped to `Lower-body Strength` and `Full-body Strength` only. Upper-body and
power-maintenance work are deliberately untouched: this is concurrent-training
interference management — keep meaningful lower-body loading away from key cycling days —
not a blanket strength ban around anchors.

Patch 4 is scoped to Cycling, matching the event-specific progression the anchor mechanism
was built for.

### 3. Anchors nudge; they do not command

All three are multipliers applied *after* the hard gates. A genuinely infeasible anchor
day falls through to the next-best real option rather than forcing an unsuitable session.
Applied modifiers are emitted in the candidate rationale.

---

## Code References

* [`app/src/engine/planner.ts`](../../app/src/engine/planner.ts) — `resolveWeeklyAnchors`, `WeeklyAnchors`, `isAdjacentDate`
* [`app/src/engine/optimizer.ts`](../../app/src/engine/optimizer.ts) — `ANCHOR_ROLE_BOOST`, `ANCHOR_ADJACENCY_SUPPRESSION`, `VARIETY_TIE_BREAK_GAP`
* [`app/src/engine/simulation/analyze.ts`](../../app/src/engine/simulation/analyze.ts) — anchor placement/fulfilment metrics

---

## Consequences

### Positive

* Which day carries the key session becomes a deliberate weekly decision rather than an
  artefact of loop order.
* A key session's freshness is protected against a choice made the day before it, which
  per-day ranking structurally cannot do.
* Equivalent templates rotate instead of one being re-picked indefinitely.
* Anchor placement and fulfilment are measurable — the simulation harness reports both.

### Negative

* **This is sequence planning expressed as multipliers.** Each modifier is individually
  reasonable, but they compose multiplicatively with the pre-existing anti-stacking,
  strength-suppression, intensity-stacking, event-modality and aerobic-filler terms. The
  aggregate is not something anyone designed, and "why is this the best week?" has no
  answerable form. F3 is the demonstration: a 0.15× anti-stack term composes with a
  1.40× A-event boost to net 0.21× **against** the athlete's own event modality.
* Anchor nomination is gated on any focus event existing, but the boost only applies to
  Cycling templates — a running-race athlete gets anchors nominated that boost nothing.
  Currently inert rather than harmful, but the scoping is inconsistent.
* Each new weekly property tends to arrive as another multiplier. Patches 1–6 exist; there
  is no natural stopping point in this design.

---

## Superseding Direction

This ADR records what exists, and its own Negative section is the argument against
extending it further. The intended replacement is a lexicographic priority model with
hard sequence constraints separated from sort keys, and eventually bounded sequence search
over the horizon — see
[`docs/plans/phase-3-single-ranking-path.md`](../plans/phase-3-single-ranking-path.md) and
[`docs/plans/phase-5-sequence-planning.md`](../plans/phase-5-sequence-planning.md).

**New weekly-shaping behaviour should not be added as Patch 7.** It should wait for that
model, or be introduced as a documented temporary safety fix with a removal condition.
