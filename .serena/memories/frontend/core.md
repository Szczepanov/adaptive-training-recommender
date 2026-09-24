# Frontend & Adaptive Decision Engine (`app/`)

React + TypeScript + Vite + Firebase SPA (`app/src/`) containing the pure adaptive training decision engine (`app/src/engine/`) and sports knowledge registry (`app/src/knowledge/`).

## Decision Engine (`app/src/engine/`)

- `rules.ts` — Core adaptive readiness/strain evaluator (`evaluateEnvelopes`, acute/drift strain, mode hierarchy, rationale generation).
- `fatigue.ts` — 6-dimensional fatigue state, exponential decay, internal response reconciliation, and `D - 1` ambient step surge normalization with activity step deduction.
- `trainingIntent.ts`, `periodization.ts`, `microcycle.ts`, `dose.ts` — Composes phase weighting, weekly objectives, fatigue state, and clinical/athlete dose ceilings (ADR-0009).
- `optimizer.ts`, `eligibility.ts`, `templates.ts`, `planningCandidate.ts` — Hard-gate session eligibility (equipment, time, injury, guardrails) and benefit-vs-cost candidate selection.
- `planner.ts`, `evergreenPlanning.ts`, `weeklyAllocation.ts`, `weeklyDosePacking.ts`, `coverage.ts` — Rolling 7-day projection, weekly anchor reservation, and exact programming-role coverage (ADR-0008/0011/0016/0017/0018).
- `scheduleWindows.ts`, `localInstant.ts`, `dailyLedger.ts`, `intradayBundlePlacement.ts`, `intradayReassessment.ts`, `intradayDecision.ts` — Intraday window binding, as-of daily cost accounting, pre-session reassessment, and write-once intraday decision audit (ADR-0036).
- `externalSession.ts`, `externalPlacement.ts`, `externalCritique.ts`, `recoveryPlacement.ts`, `blockIntent.ts` — Imported plan adjudication, recovery truth/placement (ADR-0038), and block progression intent (ADR-0037).
- `provenance.ts`, `replay.ts`, `policy.ts` — Builds `RecommendationAudit`, verifies deterministic decision replay, and defines `POLICY_VERSION`.

## Knowledge Registry (`app/src/knowledge/`)

- `sportsKnowledgeRegistry.ts` — Registered scientific claims with evidence tiers, review cadences, and domain parameter ownership (ADR-0033).
- `knowledgeCoverage.ts` & `knowledgeFreshness.ts` — Complete inventory of decision-authority rules and review-cadence freshness reporting.

## Application Services & Domain Slices (`app/src/`)

- `training-occurrence/` — Canonical performed-training-occurrence reconciliation across device FIT files, manual logs, and planned sessions (ADR-0034).
- `sessions/`, `responses/`, `observations/`, `outcomes/` — Source-neutral session authoring, execution, internal response, and outcome tracking (ADR-0023).
- `services/recoverySnapshotService.ts` & `utils/localDate.ts` — User-scoped Firestore readers and `Europe/Warsaw` calendar date helpers (`getLocalDateString()`).
