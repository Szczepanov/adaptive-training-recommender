# AGENTS.md — AI Agent Guidance for Adaptive Training Recommender

This document outlines repository rules, code conventions, testing instructions, and architecture for AI assistants operating on this codebase.

## Repository Overview

`adaptive-training-recommender` is a hybrid Python/TypeScript repository:
* **Python Backend** (`src/garmin_sync/`, `fetch_garmin.py`, `backfill_garmin.py`): Ingests health & training metrics from Garmin Connect into user-scoped Firestore documents.
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
* `uv run python scripts/migrate_legacy_snapshots.py --user-id <UID> --dry-run` — Test migration

### Frontend App
* `cd app && npm ci` — Install node dependencies
* `cd app && npm run build` — Build production bundle (`tsc -b && vite build`)
* `cd app && npm run dev` — Start Vite dev server

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
```

---

## Code Style & Testing Standards

* Maintain type hints across all Python modules.
* Use synthetic JSON fixtures (`tests/fixtures/`) for unit tests; do not call live APIs during tests.
* Ensure all frontend changes compile with TypeScript (`npm run build`).
