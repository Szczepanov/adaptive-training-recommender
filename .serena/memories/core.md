# Adaptive Training Recommender — Core Project Map & Invariants

Hybrid repository combining a Python health/training ingestion backend (`src/garmin_sync/`) and a React + TypeScript + Firebase frontend (`app/`) with a pure adaptive training decision engine (`app/src/engine/`).

## Non-Negotiable System Invariants

- **I1 User Isolation (ADR-0002)**: All recovery snapshots and user data must be written to `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`. Never write to top-level `daily_recovery_snapshot/{date}` or use `"default_user"`.
- **I2 Warsaw Calendar Dates (ADR-0003)**: Every calendar date uses `Europe/Warsaw` via `local_today()` (`src/garmin_sync/dates.py`) in Python and `getLocalDateString()` (`app/src/utils/localDate.ts`) in TypeScript. Never use `new Date().toISOString().split('T')[0]`.
- **I3 `D - 1` Step Semantics (ADR-0003)**: `totalSteps` in a daily snapshot represents the previous completed calendar day (`D - 1`), normalized by 7d/28d baselines with estimated activity steps deducted in `app/src/engine/fatigue.ts`.
- **I4 Knowledge Lineage (ADR-0033)**: Every engine threshold, weight, cadence, or policy constant with decision authority is owned by a registered claim in `app/src/knowledge/sportsKnowledgeRegistry.ts`, tracked in `app/src/knowledge/knowledgeCoverage.ts`, and enforced by `*PolicyAlignment.test.ts`.
- **I5 Policy Version (ADR-0010)**: Any change that can alter a recommendation must bump `POLICY_VERSION` in `app/src/engine/policy.ts`.
- **I6 No Credential or Health Payload Leaks**: Never commit or log `.env`, `.garth/`, token stores, Firebase service accounts, or raw health JSON payloads.

## Documentation Authority Precedence

- For live vs shadow vs planned status, consult `docs/plans/README.md` (single authoritative status board).
- For current behavior: code wins, then `docs/architecture/`, then `docs/adr/`. `docs/standards/ui-ux.md` is the normative UI/UX quality bar.

## Domain & Workflow Memories

- Read `mem:tech_stack` when inspecting runtime requirements, language versions, build tools, and library dependencies across Python and TypeScript.
- Read `mem:backend/core` when working in `src/garmin_sync/` (Garmin, Google Health, Eight Sleep ingestion, canonical mapping, FIT decoding, Firestore persistence, or CLI entrypoints).
- Read `mem:frontend/core` when working in `app/` (pure adaptive decision engine in `app/src/engine/`, knowledge registry in `app/src/knowledge/`, session/occurrence reconciliation, or React UI/Firebase services).
- Read `mem:conventions` before editing code, engine constants, or documentation to follow purity rules, knowledge-lineage registration, and symbol-reference conventions.
- Read `mem:suggested_commands` when running CLI workflows, tests, simulations, or Windows/PowerShell commands.
- Read `mem:task_completion` before finishing any task to run the required verification gates (`make check`, simulations, policy drift, or Firestore rules).
