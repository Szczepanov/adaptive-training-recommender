# Tech Stack & Tooling

## Python Backend (`src/garmin_sync/`, `scripts/`, `tests/`)

- **Python Version**: `>=3.14,<3.15` (managed via `uv`; `pyproject.toml` pins `requires-python = ">=3.14,<3.15"`).
- **Build & Package Manager**: `uv` (`uv.lock` committed) + `hatchling` build backend.
- **Core Libraries**: `garminconnect` (`>=0.3.16,<0.4`), `fitdecode` (`>=0.11.0,<0.12`), `firebase-admin`, `google-cloud-storage`, `pyotp`, `python-dotenv`, `tzdata`.
- **Static Analysis & Testing**: `ruff` (lint + format, line-length 100), `mypy` (`python_version = "3.14"`, `disallow_untyped_defs = true`), `pytest` + `pytest-cov`.

## Frontend & Decision Engine (`app/`)

- **Runtime & Package Manager**: Node.js (native TypeScript execution via `node --experimental-strip-types` for validation scripts) + `npm` (`app/package.json`).
- **UI & State**: React `^19.3.0`, React DOM `^19.3.0`, Firebase JS SDK `^12.19.0` (Auth, Firestore, Hosting).
- **TypeScript & Build**: `@typescript/native` (`npm:typescript@~7.0.2`), Vite (`tsc -b && vite build`), ESLint `^10.0.1`.
- **Testing & Verification**:
  - Unit & integration: `vitest` (`npm test`, `npm run test:coverage`).
  - Firestore security rules: `@firebase/rules-unit-testing` inside Firebase Firestore Emulator (`npm run test:rules`, requires Java).
  - Browser E2E & Visual Review: `@playwright/test` (`npm run test:e2e` against Auth + Firestore emulators; `npm run visual:refresh` for desktop `1440px` and mobile `390px` review bundles).

## Infrastructure

- **Database & Hosting**: Firebase Firestore (user-scoped collections under `users/{uid}/...`) + Firebase Hosting.
- **Containers**: Root `Dockerfile` + `docker-compose.yml` (Python backend API on port `8081`, frontend Nginx SPA on port `8080`).
