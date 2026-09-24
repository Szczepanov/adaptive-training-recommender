# Suggested Commands (Windows / PowerShell & Makefile)

## Root Makefile Gates

- `make check` — Core local gate: Python (`ruff check`, `ruff format --check`, `mypy`, `pytest`) + Frontend (`tsc -b`, `eslint`, `vitest`, knowledge/coverage/freshness/workout validators).
- `make all` — `make check` + `make simulate` + `make build`.
- `make test` — Fast unit test suite (`pytest` + `vitest`).
- `make format` — Auto-format Python (`ruff format`) and TypeScript.
- `make simulate` — Multi-week engine scenario simulations + baseline diff check.

## Python Backend (`uv` from repo root)

- `uv sync` — Restore Python virtual environment from `uv.lock`.
- `uv run pytest` — Run backend unit tests (`tests/`).
- `uv run ruff check .` / `uv run ruff format --check .` — Lint and format verification.
- `uv run mypy src/garmin_sync` — Strict static type check.
- `uv run python -m garmin_sync sync [--date YYYY-MM-DD] [--force]` — Daily ingestion for `APP_USER_ID`.
- `uv run python -m garmin_sync backfill --days 56` — Historical backfill.
- `uv run python -m garmin_sync rebuild --start-date YYYY-MM-DD --end-date YYYY-MM-DD` — Offline snapshot rebuild from immutable raw archive.
- `uv run python -m garmin_sync audit --days 90` — Archive/sync completeness audit.

## Frontend & Decision Engine (run inside `app/`)

- `npm run check` — Full frontend static + unit + validator gate (`typecheck`, `lint`, `test`, `validate:knowledge`, `validate:knowledge-coverage`, `validate:knowledge-freshness`, `validate:workouts`).
- `npm test` — Run `vitest run` (`npx vitest run <path>` for targeted tests).
- `npm run test:rules` — Run Firestore security rules tests inside Firebase Emulator.
- `npm run test:e2e` — Run Playwright E2E suite inside Auth + Firestore emulators.
- `npm run simulate:scenarios` — Generate multi-week simulation reports in `app/artifacts/simulation-reports/latest/`.
- `npm run simulate:plan-judge` — Build plan-judge corpus and check deterministic plan-judge invariants.
- `node scripts/check-policy-drift.mjs <base-sha>` — Verify `POLICY_VERSION` was bumped if engine/policy files changed.

## Windows / PowerShell Notes

- In PowerShell (`pwsh`), chain commands with `;` or check `$LASTEXITCODE` when needed; avoid bash-only syntax (`export VAR=...` -> use `$env:VAR = "..."`).
- Validate Serena memories from the project root with `serena memories check`.
