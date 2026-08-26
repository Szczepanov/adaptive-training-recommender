## 2026-08-16 - README.md Missing Technical Features
**Learning:** `README.md` was missing two major features: Decision Provenance & Audit Replay (ADR-0010) and Rolling 7-Day Week-Ahead Planning (ADR-0008). This was documented as finding F13 in `docs/analysis/2026-08-08-architecture-review.md`.
**Action:** When auditing documentation drift, always compare feature lists in READMEs against the accepted Architectural Decision Records (ADRs) to ensure the high-level documentation reflects recent architectural additions.

## 2026-08-26 - README.md Index Missing Recent Analysis Documents
**Learning:** The documentation hub (docs/README.md) acts as the routing table but can easily fall out of sync with newly added review/analysis files in docs/analysis/.
**Action:** Always verify that newly added files in docs/analysis/ are indexed in the root docs/README.md.
