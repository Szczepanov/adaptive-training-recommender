# Codebase Conventions & Architectural Patterns

## Purity & IO Boundary

- **Pure Decision Evaluators**: Modules inside `app/src/engine/` and `src/garmin_sync/metrics.py` must remain strictly pure — no Firestore reads/writes, no `fetch`, no wall-clock `Date.now()` inside evaluators.
- **Lazy Provider Injection**: Only orchestration entrypoints (`app/src/engine/rules.ts`, `app/src/engine/trainingIntent.ts`, `app/src/engine/replay.ts`, and `src/garmin_sync/service.py`) reach for IO, and only as a lazily-imported default when no provider (`TrainingHistoryProvider` in TS, `WearableProvider` / `RecoveryObservationProvider` in Python) was injected.
- **Vendor Boundary Isolation**: `src/garmin_sync/garmin_provider.py` is the only module allowed to know raw Garmin API payload shapes; `google_health_mapper.py` and `eight_sleep_mapper.py` isolate their respective vendor payloads and emit vendor-neutral canonical models (`src/garmin_sync/canonical.py`).

## Knowledge Registry & Policy Alignment (ADR-0033)

- Never introduce or alter a decision-authority constant (threshold, weight, decay rate, spacing window, cap) in `app/src/engine/` without updating all three:
  1. `app/src/knowledge/sportsKnowledgeRegistry.ts` (claim definition & evidence citation)
  2. `app/src/knowledge/knowledgeCoverage.ts` (rule inventory & classification)
  3. The corresponding `*PolicyAlignment.test.ts` suite
- Any change that can alter a recommendation output must bump `POLICY_VERSION` in `app/src/engine/policy.ts` (ADR-0010).

## Typing & Testing Standards

- **Python**: Complete type annotations required (`disallow_untyped_defs = true` in `mypy`). Use dataclasses/typed models from `src/garmin_sync/models.py` and `src/garmin_sync/canonical.py`.
- **Tests**: Always use synthetic fixtures (`tests/fixtures/` or inline deterministic builders). Never call live external APIs in tests.
- **Error Sanitization**: Error logs and telemetry (`src/garmin_sync/error_reporting.py`) must never emit raw personal health values (HRV, RHR, sleep stages, respiration) or tokens.

## Documentation & Commit Hygiene

- **Reference symbols, never line numbers**: Write `` `rules.ts` `evaluateEnvelopes` `` rather than `` `rules.ts:544-556` `` in docs, ADRs, plans, and commit messages.
- **Plan Status**: Track implementation state exclusively in `docs/plans/README.md`. When a plan reaches `Implemented`, strike present-tense problem statements so completed work is not mistaken for open defects.
