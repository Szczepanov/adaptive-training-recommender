# Issue #894 — Context Brief versioned contract implementation plan

| | |
|---|---|
| **Status** | **Implemented** — delivered by PR #922 on 30 September 2026; retained as the historical execution record |
| **Source** | [Issue #894](https://github.com/Szczepanov/adaptive-training-recommender/issues/894) |
| **Baseline** | Historical starting point: contract v2 with service-level identity validation and canonical planning/diagnostic completed-training rows |
| **Blocked by** | None; D1 and D2 are fixed below for this implementation |
| **Unlocks** | A regression-tested external-coach export contract across morning, planning and diagnostic purposes |
| **Policy effect** | None expected. The brief remains descriptive and must not gain recommendation authority or change `POLICY_VERSION`. |

> **Historical implementation record:** all work packages and acceptance criteria below are
> complete. Imperative wording documents the delivered design sequence and is not a live work
> queue. The living behavior contract is `docs/architecture/context-brief-contract.md`.

## Goal

Make each Context Brief a deterministic, bounded, source-honest handoff whose authority, provenance, date/window meaning, and missingness can be checked from the final rendered artifact. Preserve Markdown as the canonical content and JSON as its versioned transport envelope.

## Preconditions and baseline

- `ContextBriefService.build` remains the complete export boundary; keep renderers pure and use existing service reads.
- Contract identity/versioning is implemented in `contextBriefContract.ts`; planning and diagnostic completed training already uses canonical performed facts. Do not rebuild those paths.
- `briefPlanAuthority.ts` remains the sole brief authority resolver. The exporter reports its outcome and never recreates recommendation or imported-plan authority.
- ADR-0034 `PerformedTrainingFacts` remains the identity source when available. Raw provider rows remain diagnostic evidence or an explicitly labelled fallback.
- Existing `DataState` semantics (`AVAILABLE`, `MISSING`, `INVALID`, `UNAVAILABLE`) and response comparability/confidence contracts should be reused where they fit; do not create parallel meanings.

## Decisions recorded for implementation (historical)

- **D1 — Staleness policy:** compare each decision-critical record's semantic source date with the date the brief is describing (today for recovery/check-in/current plan authority; D-1 for completed training/adherence). Flag records whose source date predates that expected date as stale and always render source date/age. A failed read is unavailable, not stale; do not infer upload time or shift `asOfDate` from a late source.
- **D2 — Output budgets:** use deterministic, character-based limits checked against representative fixtures; retain existing per-activity segment/lap caps and add any missing aggregate cap needed by those fixtures. Keep decision-critical authority/safety fields outside optional-detail truncation. Diagnostic retains full supported provenance under an explicit hard output limit and omission count.
- **D3 — Semantic version:** the existing v2 contract covers identity and canonical planning/diagnostic rows. New required source-state/currency semantics advance the semantic contract to v3; keep JSON transport schema version independent.

## Task board

| Work package | Status | Current boundary |
|---|---|---|
| WP0 Contract identity, provenance and freshness | `[x]` | v3 semantic metadata and per-source state/currency are rendered and asserted |
| WP1 Missingness and authority semantics | `[x]` | Rendered source states distinguish value, zero, missing, invalid and unavailable; existing authority resolver remains canonical |
| WP2 Canonical D-1 adherence and response evidence | `[x]` | Morning uses canonical D-1 facts, handles provider date skew, and reports comparison lineage/confidence |
| WP3 Purpose bounds and deterministic rendering | `[x]` | Purpose-specific detail caps preserve authority/safety content; dense fixtures assert aggregate limits |
| WP4 Fixture matrix, end-to-end gate and documentation | `[x]` | Issue scenarios, purpose snapshots, service-built Markdown/JSON assertions and architecture docs are updated; `make verify` passes |

## Implemented work items (historical)

### WP0 — Version identity and source currency

1. **Extend contract metadata** (Files: `app/src/engine/contextBriefContract.ts`, `app/src/engine/contextBrief.ts`, `app/src/services/contextBriefService.ts`)
   - Action: Add only interpretation-relevant source/knowledge version metadata not already available at the export boundary. Include per-source dates/ages and the D1 stale status for decision-critical current state and plan/completed-training freshness. Keep `asOfDate` on Europe/Warsaw local-date helpers and generation time ephemeral.
   - Why: An external coach must be able to distinguish the day described from when each source was last updated and which material source/policy definitions were used.
   - Dependencies: D1 and D3.
   - Risk: Medium; ambiguous freshness rules can label valid history stale or hide late arrivals.
   - Done when: Contract parser/assertion requires the agreed fields; same persisted inputs and explicit purpose/as-of date render the same semantic metadata; version change is explicit and transport schema remains separately versioned.

### WP1 — Honest missingness and one authority

2. **Render source states explicitly** (Files: `app/src/engine/contextBrief.ts`, `app/src/engine/contextBriefPlanningHandoff.ts`, `app/src/services/contextBriefService.ts`)
   - Action: Project source results to measured value, explicit zero, missing, unavailable/read failure, invalid, unsupported/not collected, or not applicable in one concise rendered inventory. Reuse `DataState` at source boundaries; add only the distinctions it cannot represent. Preserve existing useful source-specific warnings and ensure empty sections do not imply absence when reads failed.
   - Why: “No activity” and “could not read activities” have different coaching meanings.
   - Dependencies: None; coordinate labels with WP0.
   - Risk: Medium; loaders currently expose different result shapes.
   - Done when: Rendered fixtures distinguish every required state, and unavailable/invalid data never renders as zero, normal, no issue, or an implied empty result.

3. **Pin one actionable authority per date** (Files: `app/src/engine/briefPlanAuthority.ts`, `app/src/engine/contextBriefPlanningHandoff.ts`)
   - Action: Preserve `resolveBriefPlanAuthority`; render unresolved/unreadable conflicts explicitly and keep rest, event, fallback, moved/deferred, and gate-replaced outcomes distinguishable.
   - Why: The external coach must not receive two competing prescriptions for one day.
   - Dependencies: None.
   - Risk: High for incorrect authority; avoid changing resolver precedence under this issue.
   - Done when: Fixtures prove at most one actionable prescription per date and unresolved authority fails closed with an explicit ask/unknown state.

### WP2 — Canonical performed training and response evidence

4. **Use canonical occurrences for morning D-1 adherence** (Files: `app/src/services/contextBriefService.ts`, `app/src/engine/contextBrief.ts`, `app/src/engine/contextBriefActivityTelemetry.ts`)
   - Action: Feed already-resolved `PerformedTrainingFacts` into the morning adherence/debrief path when available, deduping structured execution plus matched Garmin evidence as one physical session. Keep raw provider evidence labelled in diagnostic and use only an explicit, uncertainty-labelled fallback when canonical facts are unavailable.
   - Why: Morning is the daily decision handoff and currently has a separate raw-row path.
   - Dependencies: None; preserve existing planning/diagnostic completed-training projection.
   - Risk: Medium; same-day linkage and partial executions must not disappear.
   - Done when: Structured plus matched Garmin renders once in morning/planning, separately inspectable in diagnostic, and partial/abandoned execution remains visible with its completion state.

5. **Expose confidence and evidence lineage for comparisons** (Files: `app/src/engine/contextBriefResponseSummary.ts`, `app/src/engine/contextBriefResponseFeatures.ts`, `app/src/engine/contextBriefSessionResponse.ts`, `app/src/engine/contextBrief.ts`)
   - Action: Ensure each displayed numerical comparison carries source, comparability/evidence confidence, and `insufficient_evidence` where required; keep display-only features distinct from engine-authoritative fields.
   - Why: A coach must be able to trace a comparison without mistaking a display summary for policy.
   - Dependencies: None; use existing #814 comparability outputs.
   - Risk: Medium; do not invent physiology or thresholds.
   - Done when: Every numeric response comparison links to canonical/provider evidence and has confidence/comparability or an explicit insufficiency reason.

### WP3 — Purpose-specific information budgets

6. **Bound variable detail and rendered size** (Files: `app/src/engine/contextBriefActivityTelemetry.ts`, `app/src/engine/contextBrief.ts`, `app/src/engine/contextBriefPlanningHandoff.ts`)
   - Action: Apply D2 section/activity caps to lap, segment, and response detail in morning/planning and explicit caps in diagnostic. Add deterministic size checks for representative fixtures. If a cap is reached, render a count and omission marker; render authority and safety sections before any lower-priority detail.
   - Why: High-lap inputs must not make routine exports unbounded or silently remove the facts that drive action.
   - Dependencies: D2.
   - Risk: Medium; a size cap must not cut a decision-critical section.
   - Done when: High-lap/segment fixtures remain within agreed budgets, detail caps are deterministic, omission is explicit, and authority/safety content remains complete.

### WP4 — Regression matrix and living docs

7. **Complete golden and service-level contract coverage** (Files: `app/src/engine/contextBriefContract.test.ts`, `app/src/engine/contextBriefTrainingDedupe.test.ts`, `app/src/engine/contextBriefPurpose.test.ts`, `app/src/services/contextBriefService.test.ts`, `app/src/utils/contextBriefExport.test.ts`; add a focused test file only if these cannot express the matrix clearly)
   - Action: Cover all 15 issue cases: normal day; authored rest; structured strength + matched Garmin; two valid same-day workouts; partial/abandoned session; missing check-in; stale Garmin/recovery; unavailable vs no activity; imported-plan revision change; travel/fixed-activity overlay; changed FTP/threshold provenance; quality cycling with segments; high-lap easy ride; no wearable/subjective-only; tissue response linked to execution. Add morning/planning/diagnostic golden outputs and one service-built final-artifact assertion through Markdown and JSON export.
   - Why: Unit tests of isolated render helpers do not prove that real service reads survive into the delivered brief.
   - Dependencies: WP0–WP3 as applicable.
   - Risk: Medium; fixtures should remain synthetic and deterministic.
   - Done when: Each case asserts relevant authority, missingness, provenance, bounds and date behavior; semantic snapshots ignore only generation time; end-to-end artifact validates contract identity, canonical content, JSON envelope and budget.

8. **Reconcile the architecture contract** (Files: `docs/architecture/context-brief-contract.md`, `docs/architecture/recommendation-engine.md`)
   - Action: Document authoritative, observational and diagnostic-only fields; source/missingness/freshness semantics; cap behavior; version discipline; and the completed acceptance boundary. Do not add a second status board or copy mutable implementation status into `AGENTS.md`.
   - Why: The architecture page is the durable contract for future export changes.
   - Dependencies: WP0–WP3 decisions and implementation.
   - Risk: Low.
   - Done when: Architecture docs describe behavior verified by the final artifact tests and no longer call completed slices outstanding.

## Verification

- Focused Vitest suites: `contextBriefContract.test.ts`, `contextBriefTrainingDedupe.test.ts`, `contextBriefPurpose.test.ts`, `contextBriefService.test.ts`, and `contextBriefExport.test.ts`.
- Frontend gate: `cd app && npm run check` after the full change; it covers typecheck, lint, Vitest and knowledge/workout validators.
- Determinism: compare semantic content after `stripBriefContractEphemeral`; run with fixed `asOfDate` and purpose.
- Date semantics: include Europe/Warsaw midnight and DST-boundary cases; no UTC date slicing.
- Policy drift: no `POLICY_VERSION` bump expected. If implementation changes recommendation authority, stop and split that work into a policy-scoped change with knowledge lineage, simulation and policy-version review.

## Risks and rollback

- **Risk:** a metadata/meaning change is shipped without an explicit contract-version decision. **Mitigation:** settle D3 and test parsing before changing required fields; revert the renderer/schema change together if consumers cannot handle the new contract.
- **Risk:** canonicalization hides a real or partial performed session. **Mitigation:** keep structured-only and partial fixtures; preserve labelled raw fallback when canonical identity is unavailable.
- **Risk:** bounds remove action-critical content. **Mitigation:** structure and assert authority/safety sections independently of detail caps; if size cannot fit, reduce optional telemetry rather than truncate those sections.
- **Rollback:** revert the additive contract/rendering change and its version together. Keep existing resolver, canonical occurrence authority and JSON transport behavior intact.

## Out of scope

- Changing recommendation selection, safety gates, physiological thresholds or `POLICY_VERSION`.
- Converting Markdown to raw JSON or creating a second recommendation/authority resolver.
- Adding new wearable/provider reads solely to fill brief sections.
- Showing every wearable metric or raw lap in morning/planning.
- Treating display-only response features as diagnoses or engine inputs.

## Acceptance criteria

- [x] Morning, planning and diagnostic artifacts expose purpose, explicit semantic contract version, Warsaw as-of date, windows, generation time, and interpretation-relevant policy/source provenance.
- [x] One date never contains two actionable prescriptions; unresolved authority is explicit.
- [x] Canonical performed occurrences deduplicate physical training; partial/abandoned sessions remain visible.
- [x] All required missingness states stay distinct from zero and from each other.
- [x] Decision-critical source dates/ages and staleness are explicit without late data changing the semantic date.
- [x] Morning/planning bounds and representative size budgets pass; diagnostic provenance remains explicit and capped.
- [x] Every response comparison reports lineage and comparability/confidence or `insufficient_evidence`.
- [x] All 15 issue scenarios, three purpose goldens, and one service-built rendered-artifact regression pass.
- [x] Architecture documentation matches tested behavior; display-only export work does not change recommendation policy.
