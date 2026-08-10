# Adaptive Training Recommender — Frontend Application

React + TypeScript + Vite + Firebase application computing adaptive training recommendations based on Garmin health metrics and user-scoped recovery snapshots.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm ci

# (Optional for Firebase production data; test & simulation suite runs out of the box without .env)
# Copy template if connecting to a real Firebase instance:
cp .env.example .env

# Run pre-flight check (typecheck, lint, unit tests, workout catalog validation)
npm run check

# Start development server (runs npm run check pre-flight automatically via predev)
npm run dev
```

---

## 📜 Command Reference

All scripts defined in `package.json` are organized below by feature domain:

### 1. Pre-Flight & Validation

| Command | Action | Description |
|---|---|---|
| `npm run check` | Pre-flight validation | Executes `typecheck`, `lint`, `test`, and `validate:workouts`. Required before builds and dev server start. |
| `npm run typecheck` | Static type checking | Runs `tsc -b` across TypeScript project references (`tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`). |
| `npm run lint` | ESLint analysis | Scans TypeScript/React files for code quality, hook usage, and pattern warnings. |
| `npm run lint:fix` | ESLint auto-fix | Automatically resolves fixable ESLint warnings and formatting issues. |
| `npm run validate:workouts` | Workout catalog validation | Runs `scripts/validate-workouts.ts` via `node --experimental-strip-types` to ensure prescription contracts, parameter ranges, and intensity levels in `src/engine/workouts/` are valid. |

### 2. Development & Production Build

| Command | Action | Description |
|---|---|---|
| `npm run dev` | Development server | Starts Vite dev server with Hot Module Replacement (HMR). Automatically executes `npm run check` beforehand via npm `predev` lifecycle hook. |
| `npm run build` | Production bundle | Runs full `npm run check` suite then builds optimized production assets to `dist/` via `vite build`. |
| `npm run preview` | Production preview | Serves the built production bundle from `dist/` locally for verification. |

### 3. Unit & Emulator Testing

| Command | Action | Description |
|---|---|---|
| `npm test` | Engine unit tests | Runs Vitest unit tests once (`vitest run`). |
| `npm run test:watch` | Watch mode unit tests | Runs Vitest in interactive watch mode for test-driven development. |
| `npm run test:coverage` | Code coverage report | Executes Vitest V8 coverage and writes terminal, JSON, and HTML reports to `artifacts/coverage/frontend/`. |
| `npm run test:rules` | Firestore security rules test | Launches Firebase local emulator with `--only firestore` and executes security rules unit tests (`test:rules:emulator`). |
| `npm run test:rules:emulator` | Direct rules test | Executes Vitest directly against `src/emulator/firestoreRules.emulator.test.ts` (called internally by `test:rules`). |

### 4. Engine Simulation & Decision Audit

| Command | Action | Description |
|---|---|---|
| `npm run simulate:scenarios` | Multi-week simulation | Evaluates adaptive engine scenarios defined in `src/engine/simulation/scenarios.ts` over multi-week spans. Uses Vite SSR loader to analyze periodization, objective fulfillment, fatigue decay, anchor placement, and constraint compliance. |
| `npm run simulate:diff` | Simulation semantic diff | Compares current simulation run against committed `docs/analysis/simulation-baseline.json` baseline and outputs scenario-by-scenario semantic changes in distributions, objectives, and fatigue tiers. |
| `npm run replay:recommendation -- <path>` | Decision replay audit | Replays a historical recommendation audit JSON object (e.g. `npm run replay:recommendation -- artifacts/audit-sample.json`) via `src/engine/replay.ts` to verify reproducibility and inspect engine rationale. |

#### `simulate:scenarios` Artifacts
Running `npm run simulate:scenarios` writes detailed simulation outputs to `artifacts/simulation-reports/latest/`:
- `report.json` — Machine-readable simulation breakdown.
- `report.md` — Human-readable markdown audit detailing category/modality distributions, consecutive template streaks, anchor fulfillment, and constraint violations. Exits with code 1 if constraint violations occur.

#### `replay:recommendation` Usage
```bash
npm run replay:recommendation -- ../path/to/recommendation-audit.json
```
Parses the input JSON payload, feeds the historical recovery snapshot and athlete settings into `replayRecommendationAudit()`, outputs decision reproducibility status to stdout, and exits with code 1 if decisions do not match.

### 5. Visual Review Harness & Playwright

| Command | Action | Description |
|---|---|---|
| `npm run visual:install` | Install browser binaries | Installs Playwright Chromium browser binary needed for visual regression testing and screenshot capture. |
| `npm run visual:serve` | Visual harness server | Starts Vite in visual testing mode (`.env.visual`, entry point `visual.html`) rendering synthetic athlete fixtures on `http://127.0.0.1:4174`. |
| `npm run visual:refresh` | Refresh review screenshots | Prepares workspace, executes Playwright visual screenshot tests across desktop (1440x1000) and mobile (390x844) viewports against synthetic fixtures, and finalizes review artifacts. |

#### Visual Review Artifacts
Regenerated into `artifacts/visual-review/latest/`:
- `contact-sheet.html` — Visual overview grid of all captures.
- `manifest.json` — Metadata containing commit hash, captured timestamp, and screenshot list.
- `review-context.md` — Review instructions, viewport specifications, and scenario intents.
- `desktop/` and `mobile/` — Full-page PNG screenshots.

---

## 📁 Application Architecture

```text
app/src/
  components/          # React UI components & view controllers
  context/             # React context providers (Auth, Navigation, Settings)
  engine/              # Recommendation engine domain logic
    fatigue.ts         # 6-dimensional fatigue state & exponential decay math
    microcycle.ts      # Microcycle objective tracker & exposure progress
    models.ts          # Schema models, telemetry, and event definitions
    optimizer.ts       # Utility optimization & candidate selection
    periodization.ts    # Race event demand profiles & continuous phase weighting
    replay.ts          # Recommendation reproducibility audit engine
    rules.ts           # Strain decomposition & mode hierarchy
    schedule.ts        # Availability & location context resolution
    templates.ts       # Session template catalog & systemic load caps
    validation.ts      # Input schema validators & sanitizers
    simulation/        # Multi-week scenario simulator & analytical metrics
    workouts/          # Structured technical workout catalog & parameter bindings
  emulator/            # Firestore security rules emulator test harness
  services/            # Firebase Firestore readers and settings persistence
  utils/               # Local date helpers (Europe/Warsaw) & formatters
  visual/              # Visual review harness fixtures & page entries
scripts/               # Node ESM & TS automation scripts
```
