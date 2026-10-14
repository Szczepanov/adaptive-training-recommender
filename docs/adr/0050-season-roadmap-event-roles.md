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
(always equal to `PeriodizationResult.focusEvent`; a test pins this). Every other event has
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
message. Conflicts never reweight a recommendation; they are surfaced.

### D3 — Supporting events change load proportionately (policy bump)

- A scheduled B/B+/secondary-A event inside its own resolved taper applies a bounded
  volume reduction through `PhaseWeights` as a *minimum* with the primary phase, never
  stacked, and never while the primary is itself tapering or recovering. Completed B/B+
  events get a short, bounded recovery. C events apply neither.
- A C event does not contribute its own objectives; an upcoming C race within a short lead
  window reserves one quality slot by reducing the authority's quality requirement by one
  (floor 0), recorded as a typed adjustment. The race itself is performed training credited
  by the normal history path after the date.
- The primary target and its development trajectory are never replaced by a nearer supporting event.

### D4 — Outcomes revalidate, they do not auto-progress

A completed or DNF supporting event inside the 28-day lookback that falls after the active
development block's last review forces the block's executable end to the day after the event
(a reviewed revision is then required), recorded as a development diagnostic. No automatic
progression or success claim is inferred from a result.

### D5 — Explainability

The roadmap and its conflicts are persisted in the recommendation audit and rendered by the
Context Brief as each event's role, not only days to the focus event.

## Consequences

PR 1 adds the roadmap and registry claim with no behavior change. Behavior (D3) bumps
`POLICY_VERSION` and Context Brief contract; D4 follows. Constants (4-star B+, 7-day gap,
28-day lookback, supporting taper/recovery scalars) are uncalibrated product choices
registered as `policy.periodization.season_roadmap_v1`; the evidence found supports no
specific value. Rollback removes the optional audit field and overlay; the roadmap is
recomputable from events.
