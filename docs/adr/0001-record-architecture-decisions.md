# ADR-0001: Record Architecture Decisions

* **Status:** Accepted
* **Date:** 2026-08-07
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

The Adaptive Training Recommender system spans multiple execution environments (Python backend ingestion, Cloud Run automated jobs, Firebase/Firestore storage, TypeScript/React frontend decision engine). As features, metric calculations, and schema versions evolved, non-obvious constraints were introduced (e.g. user-scoped Firestore path enforcement, explicit local timezone boundaries, D-1 step aggregation, raw archive caching).

Without structured record-keeping, architectural context risk being lost, leading to accidental regression or confusion when refactoring.

---

## Decision Outcome

We will record key software architecture decisions as **Architecture Decision Records (ADRs)** stored in the repository under [`docs/adr/`](./).

Each ADR will follow a standard lightweight markdown template:
* **Title & ID** (`000X-title.md`)
* **Status** (Proposed / Accepted / Superseded / Deprecated)
* **Date**
* **Context and Problem Statement**
* **Decision Outcome**
* **Consequences** (Positive and Negative)
* **References** (Code implementations, relevant files)

### Rules for ADRs
1. **Immutable History**: ADRs are generally immutable once accepted. If a decision is changed, a new ADR is created that marks the old ADR as `Superseded by ADR-XXXX`.
2. **Co-located with Code**: ADRs live inside git alongside source code so changes to architecture are reviewed in pull requests.
3. **Traceability**: Code comments, commit messages, or design documents can cite specific ADR numbers (e.g., `ADR-0002`).

---

## Consequences

### Positive
* Technical decisions and context are documented explicitly in source control.
* Reduces onboarding time for developers and AI assistants.
* Prevents accidental undoing of critical system constraints.

### Negative
* Requires slight discipline overhead when proposing major design alterations.
