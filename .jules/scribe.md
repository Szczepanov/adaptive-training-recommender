## 2026-08-16 - README.md Missing Technical Features
**Learning:** `README.md` was missing two major features: Decision Provenance & Audit Replay (ADR-0010) and Rolling 7-Day Week-Ahead Planning (ADR-0008). This was documented as finding F13 in `docs/analysis/2026-08-08-architecture-review.md`.
**Action:** When auditing documentation drift, always compare feature lists in READMEs against the accepted Architectural Decision Records (ADRs) to ensure the high-level documentation reflects recent architectural additions.

## 2026-08-26 - README.md Index Missing Recent Analysis Documents
**Learning:** The documentation hub (docs/README.md) acts as the routing table but can easily fall out of sync with newly added review/analysis files in docs/analysis/.
**Action:** Always verify that newly added files in docs/analysis/ are indexed in the root docs/README.md.

## 2026-09-02 - docs/README.md Index Missing Recent Analysis Documents
**Learning:** The documentation hub (docs/README.md) acts as the routing table but can easily fall out of sync with newly added review/analysis files in docs/analysis/.
**Action:** Always verify that newly added files in docs/analysis/ are indexed in the root docs/README.md.

## 2026-09-07 - Root README.md Missing Technical Features
**Learning:** `README.md` was missing several features corresponding to ADRs 0019-0038 from the 'Technical Features' section. These include Explicit Rest-Day Authoring, Source-Aware Multisource Health, and Canonical Performed Training Occurrence.
**Action:** When auditing documentation drift, always compare feature lists in READMEs against the accepted Architectural Decision Records (ADRs) to ensure the high-level documentation reflects recent architectural additions.

## 2026-09-15 - Missing Root Documentation for ADR-0040
**Learning:** Accepted ADRs need to be documented not only in the main README's feature list but also indexed properly in the central documentation hub (`docs/README.md`) under both the Decision Log and Implementation Plans if applicable.
**Action:** When adding or auditing ADRs, ensure they are represented in the root `README.md` Technical Features section and correctly indexed in `docs/README.md`.

## 2026-10-25 - Proposed ADRs in Technical Features
**Learning:** The main `README.md`'s Technical Features list incorrectly included 'Proposed' and unimplemented ADRs (e.g., ADR-0030, ADR-0034, ADR-0037, ADR-0038). Documentation must describe the system that actually exists, not an imagined future version.
**Action:** When updating documentation (especially as the 'Scribe' persona), never list 'Proposed' or unimplemented Architectural Decision Records (ADRs) as existing technical features in the main `README.md`. Only 'Accepted' and fully implemented ADRs belong in the current reality feature list, to prevent documenting unimplemented behavior.
