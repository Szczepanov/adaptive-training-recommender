# Task Completion & Verification Gates

Run the applicable verification gates before considering any coding or documentation task complete, and explicitly report which commands ran and their outcomes.

## 1. Standard Code Change Gate (Always Run for Code Changes)

- From repo root: `make check`
  - Runs Python checks: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy src/garmin_sync`, `uv run pytest`
  - Runs Frontend checks (`cd app && npm run check`): `tsc -b`, `eslint`, `vitest run`, `validate:knowledge`, `validate:knowledge-coverage`, `validate:knowledge-freshness`, `validate:workouts`
- If formatting fails, run `make format` (or `uv run ruff format .`) and re-run `make check`.

## 2. Engine / Policy / Workout Catalog Changes

- Bump `POLICY_VERSION` in `app/src/engine/policy.ts` if recommendation output can change.
- Verify policy drift from `app/`: `node scripts/check-policy-drift.mjs <base-sha>`
- Run simulations and deterministic plan-judge invariants:
  - `make simulate` (runs `simulate:scenarios` + `simulate:diff`)
  - `cd app && npm run simulate:plan-judge`
  - Ensure committed simulation baselines (`docs/analysis/simulation-baseline.json`) are updated via `npm run simulate:update-baseline` when intentional behavior changes land.

## 3. Firestore Security Rules Changes

- Run `cd app && npm run test:rules` (executes Vitest rules suite against Firebase Firestore Emulator; requires Java).

## 4. Material UI / UX Changes

- Verify against `docs/standards/ui-ux.md`.
- Run relevant component tests (`cd app && npm test`), browser E2E (`cd app && npm run test:e2e`), and refresh Playwright visual review bundles (`cd app && npm run visual:refresh`) when layout/visual states change.

## 5. Documentation-Only Changes

- Run `uv run pre-commit run --all-files` to verify repository and documentation hygiene hooks.
