# PR #335 Review Hardening — SKR4 Athlete Evidence Boundary

**Date:** 2026-09-02
**PR:** #335
**Scope:** architecture, safety semantics, identity isolation, audit/replay completeness, and stacked-branch consistency

## Findings corrected

### 1. Subjective de-escalation violated accepted ADR-0020

The first implementation allowed negative athlete-specific offsets to reduce current soreness/fatigue values. ADR-0020 D-SUBJFLOOR explicitly requires absolute subjective triggers to remain hard floors and permits personal-history signals only in the conservative direction.

**Fix:** deciding-path subjective calibration is now non-negative/tighten-only. Validation rejects negative subjective offsets and the pure policy layer treats an unvalidated negative offset as a no-op.

### 2. The 36-hour strenuous-lower-body recovery floor was unsupported precision

The first implementation allowed `48 h * 0.75 = 36 h` for a purported fast recoverer. Recovery literature supports heterogeneity by protocol/outcome and multi-day recovery in many demanding protocols, but does not validate a universal 36-hour personalized safety floor.

**Fix:** v1 safety-linked recovery evidence can only lengthen a general recovery prior. Faster-recovery hypotheses require a separate decision/calibration path.

Research context:

- Pareja-Blanco et al. / training to failure vs non-failure recovery, PMID 28965198.
- Raastad/colleagues, neuromuscular recovery after heavy resistance, jump and sprint training, PMID 30067591.
- Flatt et al., differing autonomic/neuromuscular/perceptual recovery time courses, PMID 31635206.

### 3. Identity isolation existed in validation but not in policy execution

An unvalidated profile could contain an `active` record owned by a different user, and `resolveActiveAthleteEvidenceRecords` filtered only on status/domain.

**Fix:** policy resolution additionally requires `record.userId === profile.userId`; lineage snapshot/replay rejects mixed-user record sets.

### 4. Region context parameter was unused

`resolveAthleteTissueTolerance` accepted `activeBodyRegions` but ignored it, so a nominally Achilles-specific restriction could act globally.

**Fix:** records can carry bounded `applicableBodyRegions`; explicit non-matching current region context excludes the scoped record, while missing region context remains conservative.

### 5. Restriction arrays were structurally under-validated

The first validator accepted arbitrary string arrays for restricted modalities and movement patterns.

**Fix:** modalities are checked against the engine modality vocabulary; bounded string-list validation rejects malformed, duplicate, oversized, or unsupported entries.

### 6. Safety monotonicity omitted red-flag category preservation

The first assertion protected `redFlagActive` but could allow the structured category set to be emptied.

**Fix:** every original red-flag category must remain present after refinement.

### 7. Athlete lineage was modeled but not built into recommendation audits

The schema/helper existed, but `buildRecommendationAudit()` did not snapshot athlete evidence. Replay provenance therefore existed only as a disconnected primitive.

**Fix:** audit construction accepts optional materially applied athlete records, snapshots deterministic compact athlete lineage, and automatically snapshots each record's base Sports Knowledge claim version. Personal `userId`, rationale, raw observations, and notes are excluded.

### 8. Replay could miss semantic drift without a version bump

Replay comparison checked only record ID and integer version. A changed domain/refinement/base claim with an accidentally unchanged version would report a match; a revoked record with the same version would also match.

**Fix:** replay now detects inactive status and same-version semantic definition drift.

### 9. SKR4 documentation overclaimed production readiness

The first plan described a Firestore path as already persisted and said the seven P0 calibration items were resolved. This PR contains no Firestore repository/rules or live composition wiring.

**Fix:** SKR4 is documented as a foundation. Persistence, pattern learning, prospective calibration, live composition, and activation remain follow-up work; the seven high-safety families remain partial/P0.

### 10. PR #335 carried stale SKR3 content from its stacked base

PR #335 includes the shared initial SKR3 commit from PR #334 but was missing #334's two subsequent review fixes.

**Fix:** the two corrected SKR3 files are synchronized to PR #334's reviewed head so #335 cannot reintroduce stale recovery-audit wording or planning-prior scope if branches merge in an unexpected order.

## Policy-version conclusion

These SKR4 refinements remain disconnected from the live recommendation composition path. The hardening changes therefore do not activate a new deciding signal and do not require a global recommendation `POLICY_VERSION` bump. A future production activation that allows athlete evidence to affect persisted recommendations must re-run the ADR-0010 policy-drift decision.
