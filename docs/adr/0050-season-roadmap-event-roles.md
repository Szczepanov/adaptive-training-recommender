# ADR-0050: Season roadmap — event roles, date authority and conflicts

- **Status:** Accepted
- **Date:** 2026-10-14
- **Related:** ADR-0003, ADR-0010, ADR-0012, ADR-0033, ADR-0049, issues #925, #927, #928 and #929

## Context

`evaluatePeriodizationPhase` selects one governing event (priority → proximity → planning
date → id). Other events only contribute objectives inside a 35-day window
(`resolveMultiEventObjectives`), taper authority is singular, and ADR-0049 explicitly
excluded a season roadmap. For an athlete with an A event plus earlier B/C events this does
not say what role each event plays, lets a near B/C race be invisible to volume and recovery,
layers a C race's objectives on top of the plan, and never explains conflicts.

## Decision

### D1 — A pure roadmap classifies roles; it grants no execution authority

`resolveSeasonRoadmap(events, asOfDate)` (`seasonRoadmap.ts`) is a pure function. The first
upcoming scheduled event in the existing authority order is the **primary season target**
(equal to `PeriodizationResult.focusEvent` whenever the focus is an upcoming scheduled event; in the 3-day post-event window the just-completed event is the focus and the roadmap primary is the next upcoming one; both sort with `compareEventAuthority`). Every other event has
exactly one role:

| Role | Source | Meaning |
|---|---|---|
| `primary_peak` | first in authority order | owns macrocycle, taper and ADR-0049 development |
| `benchmark_peak` | another A event, or B with ≥ 4 stars (B+) | mini-peak, proportionate taper, then back to the current block |
| `benchmark` | other B | checkpoint, limited taper |
| `train_through` | C | race craft; replaces a key session; never tapers |

B+ is derived from the existing 1–5 star control (`UserEvent.starPriority`, set by
`goalToUserEvent`); no new persisted priority exists. There are not multiple planners and
requirements are never summed across events.

### D2 — One owner per date; typed conflicts, not blending

Exactly one event owns a planning date (authority order). The roadmap emits typed
`SeasonConflict`s — `same_day_authority`, `inside_peak_taper`, `insufficient_peak_recovery`
(fewer than 7 days, the policy-owned post-event recovery length, between one peak and the
next peak's taper start) — each with `blocking`/`advisory` severity and an athlete-facing
message. A same-day conflict is advisory only when every yielding event is train-through;
an event inside a peak taper is advisory only if it is train-through; a peak with no resolved
taper is prepared up to its date for the recovery-gap check. Conflicts never reweight a recommendation; they are surfaced.

### D3 — Supporting events change load proportionately (policy bump)

- A scheduled B/B+/secondary-A event inside its own resolved taper applies a bounded
  volume reduction through `PhaseWeights` as a *minimum* with the primary phase, never
  stacked, and never while the primary is itself tapering or recovering. Completed B/B+
  events get a short, bounded recovery. C events apply neither.
- A C event does not contribute its own objectives; an upcoming C race within a short lead
  window reserves one quality slot by reducing the authority's quality requirement by one
  (floor 0), recorded as a typed adjustment. The replacement applies only to dates whose
  executable week is built from objectives (structured plan and demand-derived programming);
  evergreen-programmed dates (before the structured build, e.g. a distant A) rebuild the week
  from capacity-packed coverage roles, so no replacement is applied or recorded there and a
  C race still stops layering its own objectives. Replacing an evergreen quality role is a
  separate follow-up. The race itself is performed training credited
  by the normal history path after the date.
- The primary target and its development trajectory are never replaced by a nearer supporting event.

### D4 — Outcomes revalidate, they do not auto-progress

A completed or DNF supporting event inside the 28-day lookback that falls inside the active
development block and after its last confirmed review (inferred as `nextReviewDate` minus
`reviewCadenceDays`) withholds the block with a `supporting_outcome_review_due:<eventId>`
diagnostic until a reviewed revision exists (Evergreen fallback meanwhile). Results older than
the lookback are not visible, so a review cadence longer than 28 days can miss an old result. No automatic
progression or success claim is inferred from a result.

### D5 — Explainability

The roadmap and its conflicts are persisted in the recommendation audit and rendered by the
Context Brief as each event's role, not only days to the focus event.

## Consequences

PR 1 adds the roadmap and registry claim with no behavior change. Behavior (D3) and the
D5 audit/brief exposure bump `POLICY_VERSION` and the Context Brief contract (v7); D4 follows. Constants (4-star B+, 7-day gap,
28-day lookback, supporting taper reductions 0.15/0.25, recovery 1 day at 0.8 and 2 days at 0.6,
3-day C-race lead) are uncalibrated product choices
registered as `policy.periodization.season_roadmap_v1`; the evidence found supports no
specific value. Rollback removes the optional audit field and overlay; the roadmap is
recomputable from events.
