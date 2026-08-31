# 2026-08-31 SKR1 — Persisted Recommendation Knowledge Lineage

## Goal

Persist the exact reviewed sports-knowledge identity materially consumed by a historical recommendation without copying scientific content into Firestore and without changing training prescription behavior.

The audit must answer two independent questions:

1. Which recommendation policy version decided?
2. Which knowledge claim versions justified the evidence-backed policy surfaces evaluated for that decision?

## Repository state before SKR1

The repository already had:

- a canonical Git-backed Sports Knowledge Registry with stable claim IDs and integer versions;
- a coverage inventory mapping decision-authority policy families to reviewed claims;
- evidence packs for load/intensity/recovery, readiness/sleep/HRV/RHR/respiration, strength/concurrent training, and taper/fueling;
- persisted `RecommendationAudit` records with `POLICY_VERSION`, history revision, safety envelope, candidate ranking and external/session provenance;
- write-once audit semantics with archived recommendation revisions.

The missing link was runtime attribution. Static coverage could say which claims support `rules.ts` or a fatigue/spacing family, but a persisted recommendation could not say which of those policy families actually participated in that decision.

## Design

### 1. Runtime IDs, persisted versions

Decision code carries only stable claim IDs in `Recommendation.knowledgeRefs`. At the composition boundary, `buildRecommendationAudit` resolves each ID through the active canonical registry and freezes:

```ts
{ claimId, version }
```

The snapshot is sorted, de-duplicated and bounded to 64 entries. Unknown or non-active claims fail closed before persistence.

Statements, citations, source lists, evidence certainty and limitations are deliberately not duplicated into Firestore. They remain source-controlled registry state.

### 2. Material-use attribution

SKR1 does not dump the whole registry or whole coverage inventory into every recommendation.

The first runtime migration covers evidence-backed families already classified as covered and actually evaluated with applicable inputs:

- objective readiness: HRV, RHR, sleep, respiration, absolute device floors, acute biometric floors, recent-hard penalty and composite objective-mode thresholds;
- intent-aware ranking: internal intensity semantics, internal-response strain, and—when recent history exists—fatigue decay, hard density, anchor spacing, hard-lower-body recovery and strength/endurance adjacency;
- active endurance taper: taper evidence/policy only when taper is active for a running, cycling or triathlon event;
- Evergreen: the exact claim references already emitted by resolved dose requirements.

Deliberately absent:

- subjective readiness cut-points (`readiness.subjective_mode_thresholds`, still P0/uncovered);
- injury/tissue/pain mappings still awaiting the safety evidence pack;
- plan-tier systemic-cost ceilings;
- pre-event restriction windows whose bundled family remains uncovered;
- fueling evidence, because the current recommendation engine does not yet give those claims live decision authority;
- uncovered optimizer benefit/cost coefficients.

This prevents nearby scientific evidence from laundering unsupported product thresholds into historical provenance.

### 3. Recommendation schema v4

Schema v4 means: recommendation audit plus persisted knowledge lineage.

- v1/v2 remain legacy.
- v3 remains the pre-SKR1 audit contract.
- v4 requires `recommendationAudit.knowledgeLineage`.

Unchanged historical v3 recommendations are not backfilled. Reconstructing current claims onto an old decision would create false precision because it would not prove what the old build actually consumed.

A new or materially changed decision gets a fresh v4 audit. Re-saving an unchanged old decision keeps its original write-once audit.

### 4. Immutability

Firestore previously treated the audit as write-once operationally but the rule compared only `policyVersion` and `evaluatedAt` on a same-decision update. SKR1 tightens that boundary with explicit `Map.diff(...).affectedKeys()` checks requiring zero changed audit keys. Archived revisions use the same full-audit diff invariant against the prior decision audit.

That makes `{ claimId, version }` lineage genuinely historical rather than mutable metadata.

### 5. Replay semantics

Knowledge drift is intentionally separate from policy drift.

A v4 replay can report:

- `matches_current` — every recorded claim is still present, active and at the same version;
- `drifted` — a recorded claim version/status differs from the current registry, or the claim no longer exists;
- `lineage_unavailable` — only valid as a legacy situation; a v4 record missing lineage is invalid.

Knowledge drift does not, by itself, mark the historical recommendation internally non-reproducible. The persisted old version is the fact SKR1 exists to preserve. Policy-version mismatch continues to use the existing audit-only/replay rules.

## Behavior impact

No training prescription thresholds, candidate scores, dose semantics, safety gates, taper values or optimizer coefficients change in SKR1.

The global `POLICY_VERSION` is advanced because the persisted recommendation provenance contract changes in decision-affecting code, following ADR-0033/ADR-0010 version-discipline precedent.

## Validation plan

The implementation adds tests for:

- deterministic de-duplication and version snapshotting;
- fail-closed unknown claim references;
- knowledge drift comparison;
- objective-readiness attribution boundaries;
- taper/history-gated attribution;
- persisted audit snapshots;
- replay knowledge drift separated from reproducibility;
- v4 lineage requirement;
- local recommendation validation and Firestore schema/rule compatibility through the existing CI gates.

## Follow-up

The next highest-value evidence work remains the safety pack for subjective readiness and injury/pain mappings. SKR1 should not pre-emptively attribute those uncovered families.
