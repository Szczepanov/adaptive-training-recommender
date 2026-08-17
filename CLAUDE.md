# CLAUDE.md — Claude Code Instructions

Quick guide for building, testing, and working on `adaptive-training-recommender`.

## Core Guidelines & Architectural Rules
- **User Scoping**: Ingestion output path MUST be `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`. Never write `"default_user"` documents.
- **Timezone**: Dates MUST be computed in `Europe/Warsaw` timezone (`local_today()` in Python, `getLocalDateString()` in TS). Avoid UTC `.toISOString().split('T')[0]` for calendar dates.
- **Step Semantics**: `totalSteps` represents previous completed day (`D - 1`). Baselines and activity-deducted ambient surges feed `fatigue.ts`.
- **Security**: Never commit credentials, `.garth` token directories, `.env` files, or raw health JSON logs.

## Essential Development Commands

### Python Environment
- Install / Sync: `uv sync`
- Run Tests: `uv run pytest`
- Lint Python: `uv run ruff check .`
- Type Check Python: `uv run mypy src/garmin_sync`
- Daily Sync CLI: `uv run python -m garmin_sync sync [--date YYYY-MM-DD] [--force]`
- Backfill CLI: `uv run python -m garmin_sync backfill [--days N] [--force]`
- Login Bootstrap: `uv run python scripts/bootstrap_garmin_tokens.py`

### Frontend Application (`app/`)
- Install: `cd app && npm ci`
- Full Check: `cd app && npm run check` (TypeScript, ESLint, Vitest, workout catalog)
- Run Tests: `cd app && npm test`
- Build: `cd app && npm run build`
- Dev Server: `cd app && npm run dev` (automatically runs `npm run check` first via `predev`)
- Engine Simulation: `cd app && npm run simulate:scenarios`
- Simulation Diff: `cd app && npm run simulate:diff`
- Policy Version Guard: `cd app && node scripts/check-policy-drift.mjs <base-sha>`
- Replay Decision Audit: `cd app && npm run replay:recommendation -- <audit.json>`
- Visual Review Harness: `cd app && npm run visual:refresh` (captures screenshots to `artifacts/visual-review/latest/`)
- Firestore Rules Tests: `cd app && npm run test:rules` (executes Vitest in Firebase Firestore emulator)

### Docker Container
- Build: `docker build -t adaptive-training-garmin-sync .`

## Key Code Locations
- `src/garmin_sync/`: Core Python Garmin ingestion package.
- `scripts/bootstrap_garmin_tokens.py`: Garmin OAuth token bootstrap utility.
- `app/src/engine/`: Core adaptive engine modules (`rules.ts`, `schedule.ts`, `periodization.ts`, `microcycle.ts`, `fatigue.ts`, `optimizer.ts`).
- `app/src/utils/localDate.ts`: Frontend Warsaw date utility.
- `app/src/services/recoverySnapshotService.ts`: User-scoped Firestore recovery reader.
- `app/firestore.rules`: Security rules for user-owned paths.
