# ADR-0049: Explicit event-bound development authority

- **Status:** Accepted
- **Date:** 2026-10-14
- **Related:** ADR-0010, ADR-0016, ADR-0017, ADR-0037, ADR-0044, issues #927 and #928

## Decision

An authored `IntentBlock` can explicitly bind to the event's ID, date, demand vector and
optional phase horizons. This optional snapshot distinguishes event-directed development
from an unrelated imported block. `IntentBlockService.save` uses `manual-intent-block-v2`
for these records; unbound manual records retain v1. The canonical treatment-intent payload
includes the binding only when present, preserving legacy hash bytes and import contracts.

`resolvePlanningContext` selects exactly one validated active, review-current bound block
before the cycling event's structured build. Structured event/travel, taper and recovery
authority take precedence. Review dates are inclusive; a later date requires a reviewed
revision. Changed event date/demand/horizons, competing blocks, unsupported mappings or
unmet authored prerequisites retain Evergreen fallback with diagnostics. Future blocks
have authority only when resolving their own dates.

The existing Evergreen evidence, capacity and packing pipeline consumes supported authored
dose envelopes. Productive aerobic-volume intent removes generic quality priors. VO2 has
one exact development-only template alias for the existing cycling 6×3 prescription,
because the legacy hard-bike family resolves to over-under work. That alias is unavailable
without exact development authority. No new physiological dose multiplier is introduced.
Strength maintenance remains a support role; power and mechanical capability requirements
use existing embedded delivery, establishment, tissue and progression gates. Explicit
support intent can request those gates independently of the profile's broad priorities.
The profile still owns weekly commitment and the normal safety ladder still owns admission.

Only existing supported mappings are executable: cycling VO2/threshold quality,
cycling/cross-training aerobic minutes, strength sessions, and embedded power/mechanical
session counts. Duplicate adaptation mappings, unsupported units, protected session
references and substitution rules fail closed. Numerical conversions and new sport
prescriptions require a later evidence-backed mapping. Completed exposure supports process
assessment; it does not prove adaptation success or follow-up tolerance. Comparable
benchmark gaps remain explicitly unverified without suitable assessment/response evidence.

Packing stops at the block end, review checkpoint, next travel overlay or policy-owned
structured build boundary. Forecast owners include block identity/revision. Development
objectives have distinct identities across handoffs; exact coverage is reprojected from
canonical performed identities under the active descriptor without creating occurrences.

Same-day decision context pins the full behavior-affecting block input and history reads.
Replay consumes captured inputs and never fetches the latest block. The compact audit and
Context Brief v6 expose the target, active authority, purpose/dose, dates, review checkpoint,
completed-exposure limitations and fallback reasons. Briefs render persisted authority;
the exporter does not become another planner.

## Consequences

No migration, automatic progression, clinical clearance, season roadmap or new editor is
required. Existing manual/service authoring can save an explicitly bound block. Rollback
removes the optional authority path; historical records and legacy imports remain readable.
