# Daily Coach Brief Implementation Plan

**Goal:** Make Daily a compact update for an ongoing coaching conversation.

**Status:** Implemented. The user authorized proceeding with the recommendations. The full verification gate reports existing dependency-audit findings; dependencies were not changed.

**Architecture:** Reuse the purpose-specific Markdown renderer and canonical performed-training facts. Preserve the existing authority resolver, safety restrictions, missingness and measurement dates. Do not change recommendation selection or add chat synchronization.

**Design:** Daily contains check-in, recovery and seven-day trend, yesterday's app-relative debrief, today's app-held session and recorded work, and nonempty upcoming constraints. Remove season/development inventory, standing assessments, unused horizons and forensic provenance. Keep identity metadata and compact source freshness. Planning retains baseline assessments and diagnostic retains detailed provenance. No comparison with previous exports or inference of conversation contents.

**Approaches:** Use deterministic purpose-specific rendering (selected); reject export-history tracking because this app cannot know what was pasted into the chat, and reject another preset because Daily already represents this workflow.

**Tech stack:** Existing TypeScript renderers, Vitest, service-level Markdown/JSON exports.

## Tasks

- [x] Added failing renderer and service tests for omissions, nonempty constraints, explicit missingness, app-relative adherence, current-day canonical work and safety preservation.
- [x] Updated `contextBriefContract`, `contextBriefPlanningHandoff`, `briefPlanAuthority` presentation and `ContextBriefService`; bumped semantic export contract to v11, preserving planning and diagnostic behavior.
- [x] Updated affected assertions and service snapshots; documented the revised contract.
- [x] Ran focused tests, TypeScript and lint, then `make verify`; recorded actual results below.

## Review focus

Canonical sessions must not double-count linked Garmin rows. App absence must not imply no conversation plan. Unreadable future context must remain unknown. Symptoms, safety overrides, reduced doses, stale decisions and active injuries must survive omission. Missing physical work is distinct from an explicit negative answer.

## Verification

The final affected-test manifest is `contextBriefContract.test.ts`, `contextBriefPlanningHandoff.test.ts`, `briefPlanAuthority.test.ts`, `contextBriefRecoverySynthesis.test.ts`, `contextBriefAssessments.test.ts`, and `contextBriefService.test.ts`: 229 tests passed. TypeScript and ESLint passed. Independent review identified and prompted regressions for clinical escalation, distinct metrics sharing a protocol, and unsupported metric bindings; all were addressed.

`make verify` passed repository hygiene, Python checks (1452 tests), frontend unit tests (9161 passed), production build, simulations, plan-judge corpus, both Firestore rules shards, and browser E2E (63 passed). The gate failed on the existing npm dependency audit: 14 vulnerabilities, including four high. The static/registry/catalog checks and persona build skipped after that audit failure were run separately and passed, as did policy drift, unchanged simulation baseline, advisory simulation diff and latency tests (two passed). No dependencies were updated, no recommendation policy changed, and no deployment was performed.
