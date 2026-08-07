# Adaptive Training Recommender — Documentation Hub

Welcome to the documentation for **Adaptive Training Recommender**, a hybrid system providing automated Garmin Connect ingestion and adaptive training recommendations.

---

## 📚 Documentation Index

### 🏛️ Architecture Decision Records (ADRs)
Architectural choices, system invariants, and technical trade-offs are documented as ADRs in [`docs/adr/`](./adr/):

* [**ADR-0001: Record Architecture Decisions**](./adr/0001-record-architecture-decisions.md) — Standardizing architectural decision tracking.
* [**ADR-0002: User-Scoped Firestore Isolation & Schema Version 3**](./adr/0002-user-scoped-firestore-isolation.md) — Strict multi-tenant security and user-scoped data modeling (`users/{userId}/...`).
* [**ADR-0003: Timezone Semantics & Previous-Day Step Window**](./adr/0003-timezone-semantics-and-d1-step-window.md) — Explicit `Europe/Warsaw` calendar boundaries and `D-1` completed day step semantics.
* [**ADR-0004: Decoupled Workout Library & Prescriptions**](./adr/0004-workout-library-architecture.md) — Layered exercise catalog, adjustable parameters, parameter bindings, and prescription semantics.
* [**ADR-0005: Raw Ingestion Archive & Offline Rebuild Pipeline**](./adr/0005-raw-archive-store-and-rebuild-pipeline.md) — Opt-in immutable GCS/local raw payload archiving and offline snapshot recalculation.
* [**ADR-0006: Reconciled Strain Telemetry & Baseline Drift Scoring**](./adr/0006-reconciled-strain-telemetry.md) — Acute metric deviation vs 28-day baseline drift strain decomposition.
* [**ADR-0007: Adaptive Multi-Sport Engine Architecture & Utility Optimization Pipeline**](./adr/0007-adaptive-multisport-engine-architecture.md) — 6-tier adaptive engine, schedule availability, event periodization, microcycle objectives, 6D fatigue decay, and utility optimization.

---

### 🏗️ System Architecture
In-depth technical design documents covering system subsystems:

* [**Ingestion Pipeline Architecture**](./architecture/ingestion-pipeline.md) — Python Garmin API client, token persistence, baseline metrics calculation, and Firestore repository.
* [**Recommendation Engine**](./architecture/recommendation-engine.md) — TypeScript rule engine (`rules.ts`), strain scoring breakdown, mode hierarchy, and decision rationale generation.
* [**Workout Library Architecture**](./workout-library.md) — Multi-layered workout definitions, variants, and September race event plan contract.

---

### 🛠️ Operations & Guides
Operational manuals and operational procedures:

* [**GCP Cloud Run & Cloud Scheduler Deployment**](./ops/cloud-run-deployment.md) — Packaging Docker images, GCS token store management, Cloud Run jobs, and Cloud Scheduler setups.
* [**Data Backfill, Audit & Offline Rebuild**](./ops/data-backfill-and-rebuild.md) — Executing historical backfills, data completeness audits, and offline raw payload rebuilds.

---

## ⚡ Quick Links & Root Documents

* [`AGENTS.md`](../AGENTS.md) — AI agent guidance, system constraints, and command cheat sheet.
* [`README.md`](../README.md) — Root project overview, env vars, quick start commands.
