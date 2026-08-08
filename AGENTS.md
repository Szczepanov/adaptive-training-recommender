# AGENTS.md — AI Agent Guidance for Adaptive Training Recommender

This document outlines repository rules, code conventions, testing instructions, and architecture for AI assistants operating on this codebase.

## Repository Overview

`adaptive-training-recommender` is a hybrid Python/TypeScript repository:
* **Python Backend** (`src/garmin_sync/`): Ingests health & training metrics from Garmin Connect into user-scoped Firestore documents.
* **Frontend App** (`app/`): React + TypeScript + Vite + Firebase application that reads user recovery snapshots and computes adaptive training recommendations.

---

## Critical System Constraints

1. **User Isolation**: NEVER write recovery documents to `daily_recovery_snapshot/{date}` or with `"default_user"`. Always write to `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`.
2. **Timezone Semantics**: Always use `Europe/Warsaw` for local date calculations (`local_today()` in Python, `getLocalDateString()` in TypeScript). Do not use UTC `toISOString().split('T')[0]` for calendar dates.
3. **No Credential Leaks**: Never commit `.env`, `.garth`, Firebase service account files, or raw health JSONs.
4. **Step Count Semantics**: `totalSteps` in recovery snapshots represents the completed previous calendar day (`D - 1`).

---

## Commands Reference

### Python Backend
* `uv sync` — Restore dependencies
* `uv run pytest` — Run unit tests
* `uv run python -m garmin_sync sync` — Run daily ingestion
* `uv run python -m garmin_sync backfill --days 56` — Run historical backfill

### Frontend App
* `cd app && npm ci` — Install node dependencies
* `cd app && npm run check` — Run full validation suite (TypeScript typecheck, ESLint, Vitest, workout catalog)
* `cd app && npm test` — Run engine unit test suite (`vitest run`)
* `cd app && npm run build` — Build production bundle (`npm run check && vite build`)
* `cd app && npm run dev` — Start Vite dev server (automatically executes `npm run check` pre-flight)
* `cd app && npm run validate:workouts` — Validate workout catalog definitions and prescription contracts
* `cd app && npm run simulate:scenarios` — Run multi-week engine simulations and generate reports in `artifacts/simulation-reports/latest/`
* `cd app && npm run replay:recommendation -- <audit.json>` — Replay and audit historical recommendation decision reproducibility
* `cd app && npm run visual:install` — Install Playwright Chromium binary for visual review tests
* `cd app && npm run visual:refresh` — Capture desktop/mobile visual review screenshots in `artifacts/visual-review/latest/`
* `cd app && npm run visual:serve` — Start visual review harness dev server with synthetic fixtures (`http://127.0.0.1:4174`)
* `cd app && npm run test:rules` — Run Firestore security rules unit test suite inside local Firebase emulator


### Docker
* `docker build -t adaptive-training-garmin-sync .` — Build container image

---

## Package Architecture

```text
src/garmin_sync/
  config.py            # Typed Settings & validation
  dates.py             # Europe/Warsaw date provider
  models.py            # Domain Schema Version 2 models & provenance
  garmin_client.py     # Garmin API wrapper with exponential backoff
  token_store.py       # LocalTokenStore & GcsTokenStore abstraction
  firestore_repository.py # Firestore user-scoped repository
  metrics.py           # Pure baseline and intensity classification math
  mapper.py            # Payload transformation with metric dates
  service.py           # Daily sync and backfill orchestrator
  cli.py               # Argument parsing and entry points

app/src/engine/
  models.ts            # Domain models, event schemas, microcycle & strain telemetry
  rules.ts             # Adaptive rules engine (acute/drift strain, mode hierarchy & rationale)
  templates.ts         # Session template catalog & systemic load caps with dual profiles
  validation.ts        # Input schema validators & sanitizers
  schedule.ts          # Multi-layered schedule availability & location context resolution
  periodization.ts     # Structured event demand profiles & continuous phase weighting
  microcycle.ts        # Weekly training objectives & exposure progress tracker
  fatigue.ts           # 6-dimensional fatigue state, exponential decay & internal response
  optimizer.ts         # Benefit vs cost utility optimization candidate selector
```

---

## Code Style & Testing Standards

* Maintain type hints across all Python modules.
* Use synthetic JSON fixtures (`tests/fixtures/`) for unit tests; do not call live APIs during tests.
* Ensure all frontend changes compile with TypeScript (`npm run build`).
