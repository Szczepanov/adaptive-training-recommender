# Context Brief export contract

The Context Brief is the read-only handoff between the athlete record and an external coach.
It is treated as a versioned API even though the wire format remains human/LLM-readable
Markdown.

This document describes the v3 contract defined under issue #894. The export exposes
purpose/version/window identity, source state and currency, canonical performed training,
and purpose-specific bounded telemetry. The final artifact remains Markdown; JSON is a
versioned transport envelope around that same content.

## Export boundary

`ContextBriefService.build` is the complete export boundary. It owns data reads, chooses the
purpose from the requested preset, injects the generation timestamp, builds the retrospective
brief, adds the planning/morning handoff, and verifies that the rendered artifact still carries
the expected identity metadata.

The engine renderers stay pure:

- `buildContextBrief` renders planning/diagnostic retrospective content;
- `buildMorningCoachBrief` renders the daily closed-loop coaching artifact;
- `briefContractHeaderLines` renders the versioned contract block;
- `assertRenderedBriefContract` fails closed at the service boundary if version, purpose,
  as-of date, generation timestamp or required source-state sections are missing.

Pure builders may omit `generatedAt` in unit tests. A service-level export may not.

### File/transport envelopes

Markdown export is the canonical rendered contract. JSON export is a transport envelope around
that same Markdown and has its own, separate schema version:

- `CONTEXT_BRIEF_CONTRACT_VERSION` versions the semantic Context Brief contract;
- `CONTEXT_BRIEF_EXPORT_SCHEMA_VERSION` versions the JSON wrapper shape.

JSON transport schema `context_brief_export_v2` exposes `contractVersion` explicitly at the
top level as well as inside the Markdown content. This prevents a JSON consumer from confusing
transport-envelope versioning with Context Brief semantic versioning. The v1 → v2 bump is an
explicit schema decision because the envelope gained a required semantic-contract field.

## Purpose mapping

The existing UI presets remain compatibility names with one semantic purpose each:

| Preset | Purpose | Retrospective detail |
|---|---|---|
| `daily` | `morning` | today + D-1 |
| `full` | `planning` | caller-selected planning window, normally 14 days |
| `diagnostic` | `diagnostic` | caller-selected forensic window |

Purpose changes presentation only. It does not grant the exporter recommendation authority or
create a second planning engine.

## Contract identity block

Contract version `2026-09-context-brief-contract-v3` currently exposes one field per line so
each field is independently machine-readable:

- `Contract version`;
- `Purpose`;
- `As-of date` using the Europe/Warsaw calendar date;
- `Retrospective detail window`;
- `Subjective baseline window`;
- `Recovery timeline`;
- `Sensor evidence horizon`;
- `Engine policy version`;
- `Generated at`.

A horizon that the selected renderer does not use is written explicitly as
`not used by this export`; it is not populated merely because the service happened to fetch a
wider source range. In particular, the morning artifact uses the 7-day recovery timeline but
does not claim the longer planning/diagnostic subjective-baseline or sensor-evidence sections.

The source-state section identifies the relevant recovery snapshot and wearable metric dates,
check-in date, Garmin activity read, canonical completed-training read, current plan inputs,
and comparison evidence state. It distinguishes measured, missing, unavailable, invalid,
unsupported/not collected, and not applicable; a measured zero remains a value, not missingness.
Where source data has a semantic date, the brief reports its age against the as-of date and
flags a date older than the expected day as stale. Transport sync/update timestamps are
provenance only; they do not establish measurement freshness. A late-arriving source never
changes the explicit as-of date.

`Engine policy version` is the current `POLICY_VERSION` bundled with the application build.
It identifies the engine-policy build present when the export was generated. It must not be
read as the historical decision policy of every persisted recommendation in the retrospective
window; decision-specific provenance remains on `DailyRecommendation.recommendationAudit`.
Source schema, baseline-computation, activity-response derivation and imported-plan revisions
are included where they materially qualify a rendered value.

## Completed-training authority

Planning, diagnostic and morning D-1 completed-training sections prefer ADR-0034 canonical
performed-training facts. One canonical occurrence renders once even when a structured execution
and Garmin activity are linked to the same physical workout. Structured-only occurrences remain
visible; in-progress, abandoned, completed, readiness-modified, partial, inferred and otherwise
unverified facts are labelled rather than dropped. Morning may show linked Garmin telemetry as
evidence under the canonical occurrence, never as another workout. If canonical facts cannot be
read, the morning fallback is explicitly non-canonical and adherence is reported as unknown where
the available evidence cannot establish it.

Duration missingness is preserved through aggregates: an occurrence with unknown duration is not
silently treated as zero minutes in totals, discipline summaries or rolling buckets.

If canonical facts are unreadable, the renderer does not assert an empty window. Raw provider
activities may be shown as an explicitly non-canonical fallback with a double-count warning; when
there are no raw fallback rows either, completed training is reported as indeterminate. If the
canonical set is empty while raw provider rows exist, the export calls out possible pending
reconciliation.

Diagnostic mode may additionally show raw provider activity rows as provenance. Those rows are
never added to canonical totals. A count mismatch between canonical occurrences carrying provider
evidence and raw provider rows is not independently interpreted as an extra or missing physical
workout because one canonical occurrence can legitimately have zero or multiple provider records.

The canonical training authority change advanced the contract from v1 to v2. Required source
state/currency semantics advanced it to v3. Provider activity IDs and structured execution state
are brief/export provenance and are opt-in at the performed-facts service boundary; default
performed-training facts used by recommendation/audit/replay paths retain their prior shape and
content-hash inputs. The engine `POLICY_VERSION` is unchanged because recommendation selection
and safety policy did not change.

## Information bounds

The morning export caps provider fallback/detail at six D-1 rows. Planning keeps at most 12
recent activity details, with no more than 20 quality-session laps or semantic segments per
activity. Diagnostic keeps at most 30 detailed activities and 100 laps/response rows per
activity. Omitted detail is counted and labelled. Service-level regressions cap representative
Markdown artifacts at 24,000 characters for morning, 65,000 for planning and 90,000 for
diagnostic. These limits apply to optional detail; authority and safety sections are rendered
outside the activity-detail selection.

## Determinism

For identical persisted inputs, explicit `asOfDate`, purpose and contract version, semantic
output is expected to be deterministic. `Generated at` is intentionally ephemeral and may
differ between exports. Tests compare semantic output after
`stripBriefContractEphemeral` removes only that line.

Date-window calculations use local-date helpers rather than UTC timestamp slicing, preserving
ADR-0003's Europe/Warsaw date semantics.

## Authority and safety boundaries

The contract block is metadata only. It does not alter:

- `briefPlanAuthority`, which resolves one actionable authority for the current date;
- engine recommendation policy;
- imported-plan adjudication;
- safety gating;
- canonical performed-training authority.

Current engine/replay policy provenance remains governed by ADR-0010. Canonical performed
training remains governed by ADR-0034. The Context Brief must describe those authorities; it
must not recreate them.

## Version discipline

A semantic change to an existing contract field, purpose mapping, date/window meaning, or
whether a field is authoritative versus observational requires an explicit contract-version
decision. Do not silently repurpose an existing label.

Adding or changing body sections also requires checking #894's contract requirements so that
missingness, provenance, authority and information-budget guarantees are not weakened.

Contract identity is asserted on every service-built artifact, and fixed-date semantic tests
exclude only the generation timestamp. JSON's `context_brief_export_v2` transport version is
independent of semantic contract v3. No recommendation authority is added by this export.
