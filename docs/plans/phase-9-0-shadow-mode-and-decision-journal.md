# Phase 9.0: Shadow mode and the decision journal

* **Status:** In progress. 9.0.2-9.0.6 (code) are complete; 9.0.1 (operational) is outstanding, and 9.0.7/9.0.8 wait on it.
* **Blocked by:** nothing in code. 9.0.1 (unattended ingestion) is an operational precondition.
* **Unlocks:** a decision on whether to retire the manual AI daily loop, and a real subjective corpus for [Phase 9](./phase-9-subjective-baselines.md) 9.5.
* **Source analysis:** [2026-08-16 manual loop vs app adjudication](../analysis/2026-08-16-manual-loop-vs-app-adjudication.md)
* **Decisions:** none new. See "Why this needs no ADR" below.

## Goal

Run the app and the athlete's existing AI loop side by side for one training block and record where they disagree.

The deliverable is **evidence, not a feature**: a per-day log of the engine's verdict, the AI's verdict, what the athlete actually did, and whether the AI verdict was recorded before or after seeing the engine. Everything built here exists to collect that log honestly and get it back out for analysis.

## Why this comes before Phase 9

Phase 9 needs real subjective variance. The simulation corpus mostly uses stable readiness, so calibrating subjective coefficients directly from simulation would manufacture the variation the model is supposed to learn from. A shadow block produces the athlete's own check-ins as a by-product of normal use and, at the same time, creates the first same-day comparison between an engine verdict and a human/AI planning verdict in this repository.

## Why this needs no ADR

The code in this phase collects evidence; it does not change recommendation policy. The journal and shadow export are structurally prevented from reaching the engine. If the 9.0.8 readout leads to a policy change, that change needs its own ADR.

---

## Preconditions

* **9.0.1 must be complete before the block starts.** Shadowing against ingestion gaps measures the sync, not the engine.
* The athlete keeps prompting their AI exactly as today. Changing the manual loop mid-block invalidates the comparison.
* **Keep the decision policy stable during the block.** Once 9.0.7 starts, do not change recommendation thresholds, selection behavior, decision-field equality, or replay/provenance semantics inside the same evidence segment. Evidence-only/UI work may continue when it cannot reach the engine or change reveal/journal ordering. If a decision-affecting change is unavoidable, end the segment, record the policy/version boundary, and report the segments separately rather than pooling them as one stable-policy block.

---

## Work items

### 9.0.1 Unattended ingestion `[ ]`

Operational, not code:

1. Deploy the Cloud Run Job and the **morning polling** Cloud Scheduler trigger documented in `docs/ops/cloud-run-deployment.md`: `*/15 5-9 * * *` in `Europe/Warsaw`, without `--force`. The Firestore freshness gate (`GARMIN_STALENESS_MINUTES`) is what keeps most scheduler ticks from calling Garmin.
2. Run `uv run python -m garmin_sync backfill --days 56` so the 28-day objective baselines are mature before day 1.
3. Run `uv run python -m garmin_sync audit` over the pre-block/backfill window and record the coverage result. Record the deployed scheduler expression and staleness setting with the operational evidence so the block can be reproduced.

**Done when.** Seven consecutive days land unattended under the documented polling schedule and the audit reports no gap in the backfilled window. A gap discovered mid-block is a confound, not a data point.

---

### 9.0.2 Decision journal model, validation and storage `[x]`

The journal lives at `users/{uid}/decision_journal/{date}`, one document per Warsaw-local day:

```ts
export type ShadowVerdict = 'proceed' | 'scale' | 'defer' | 'skip' | 'advisory';

export interface DecisionJournalEntry {
    userId: string;
    date: string;
    externalVerdict: ShadowVerdict;
    externalNote?: string;
    sawEngineVerdictFirst: boolean;
    actualVerdict?: ShadowVerdict;
    createdAt: string;
    updatedAt: string;
    schemaVersion: 1;
}
```

`ShadowVerdict` deliberately uses the same five-value vocabulary as imported-session adjudication: do it, do it easier, move it, skip it, or your call.

**Mutation lifecycle and evidence integrity:**

* **Morning creation is append-only evidence.** `externalVerdict`, optional `externalNote`, `sawEngineVerdictFirst`, and `createdAt` are recorded once and cannot be rewritten after the engine may have been revealed.
* **Evening update changes only outcome evidence.** `actualVerdict` may be added/updated and `updatedAt` advances.
* **Deletion is denied.** A participant cannot selectively erase an inconvenient disagreement after the fact.
* An existing INVALID or UNAVAILABLE journal record blocks a new morning write instead of being treated as an empty day.
* The read parser enforces owner/date identity, the closed key set, `schemaVersion === 1`, the five-value enums, timestamp types, and the 2000-character journal-note bound. Range reads count invalid records separately so export missingness cannot silently improve by dropping malformed evidence.

Firestore rules mirror the service contract. Emulator tests cover ownership, malformed writes, immutable morning fields, legitimate evening outcome updates, and deletion denial.

**Done when.** Well-formed evidence is accepted, malformed/foreign evidence is rejected, and morning observations cannot be rewritten or deleted.

---

### 9.0.3 Journal entry UI `[x]`

A Home card records the athlete's own planner verdict before or after the engine recommendation.

* The form is available while Today's Recommendation remains hidden.
* There is one explicit reveal control on the recommendation card.
* `sawEngineVerdictFirst` is derived from observed interaction, not a self-report checkbox.
* The observed reveal is remembered locally per user/date across same-day navigation or reload. Once the recommendation has been seen, a refresh cannot manufacture a later "blind" sample.
* After the morning entry is saved, the morning verdict/note is shown read-only; only the evening actual outcome remains editable.
* Existing journal evidence also unlocks the recommendation on a returning page load.

**Adherence alignment.** When yesterday's adherence answer is `followed === true`, Home can fill a missing `actualVerdict` from the exact persisted engine verdict. `advisory` is deliberately excluded from this shortcut: it is a non-instruction, so "followed" does not identify what action actually occurred.

**Done when.** A genuine blind entry can be recorded, a post-reveal entry is flagged, reload cannot reset the observed ordering, and the morning observation cannot be edited after reveal.

---

### 9.0.4 Agreement classification `[x]`

`engine/shadowAgreement.ts` is pure and deterministic:

```ts
export type AgreementClass =
    | 'agree'
    | 'engine_more_conservative'
    | 'engine_less_conservative'
    | 'incomparable';
```

Conservatism ladder: `proceed` > `scale` > `defer` ≈ `skip`. `defer` and `skip` are equally conservative about **today**; their difference is a placement question. `advisory` is outside the ladder and is incomparable in either direction.

`resolveEngineShadowVerdict()` centralizes how the engine's action enters this vocabulary: an exact imported-session decision wins when present; the three-value mode mapping is only a fallback.

**Done when.** All 25 ordered verdict pairs have an asserted class, including advisory in both directions, and exact imported decisions survive resolution unchanged.

---

### 9.0.5 Export `[x]`

`engine/shadowLog.ts` is the pure join/CSV renderer; `services/shadowLogService.ts` performs reads.

One row per day joins:

| Column | Source |
|---|---|
| `date` | — |
| `engineVerdict`, `engineMode` | `daily_recommendations/{date}` |
| `externalVerdict`, `externalNote`, `sawEngineVerdictFirst` | `decision_journal/{date}` |
| `actualVerdict`, `adherence.followed`, `actualDurationMin` | journal + recommendation |
| `agreement` | 9.0.4 |
| subjective vector | `daily_subjective_checkins/{date}` |
| objective 7d/28d deltas | `daily_recovery_snapshots/{date}` |
| `policyVersion`, `externalPlan.contentHash` | `recommendationAudit` |

**Exact engine verdict.** New recommendation writes persist the exact five-value `engineVerdict` as evidence-only metadata. This preserves imported-plan `skip` and event `advisory` decisions instead of reconstructing them later from `train|modify|recover`. Existing pre-Phase-9 rows without the field remain readable and use the legacy mode fallback (`train -> proceed`, `modify -> scale`, `recover -> defer`); that fallback is explicitly historical approximation, not the contract for new evidence.

Adding `engineVerdict` to a legacy row is metadata completion and does not fabricate a historical revision. Once an exact verdict exists, a later change is a decision change and follows the normal archive/revision rules.

Rows are emitted for partial days rather than complete cases only. Invalid decision-journal records are omitted from rows **and counted in `unavailableSources`**, so a malformed record cannot masquerade as a genuine missing day. The export contains no user identifier, raw wearable payload, or check-in free text beyond the athlete's explicit journal note.

**Done when.** Partial-day fixtures keep gaps visible, exact `skip`/`advisory` values survive persistence and export, malformed evidence is surfaced, and the CSV contains no excluded identifiers/raw payloads.

---

### 9.0.6 The journal cannot reach the engine `[x]`

The ADR-0019 runtime-import-graph guard is extended so no module reachable from `rules.ts`, `optimizer.ts`, `planner.ts`, or `trainingIntent.ts` can reach `decisionJournalService.ts`, `engine/shadowLog.ts`, or `services/shadowLogService.ts`.

This boundary is load-bearing: a journal that can influence the decision it measures is contaminated evidence.

**Done when.** The existing scanner/positive control proves those dependency paths are absent.

---

### 9.0.7 Run the block `[ ]`

Not a code task. Run 4–6 weeks of: check-in, record the AI verdict, read the engine verdict, answer adherence.

Keep each day's `policyVersion` in the export as already designed. If a decision-affecting version boundary occurs despite the precondition above, treat it as a new evidence segment and report agreement separately by stable-policy segment.

**Done when** the export contains:

* **≥ 28 days** with both engine and external verdicts;
* **≥ 21 days** with a complete subjective check-in;
* **≥ 7 days** with `sawEngineVerdictFirst === false`.

If the third gate is not met, the data may still support Phase 9's corpus, but agreement must be reported as anchored rather than independent.

---

### 9.0.8 Readout and decision `[ ]`

Write a dated analysis in `docs/analysis/` reporting:

* agreement overall and split by `sawEngineVerdictFirst`;
* agreement split by stable `policyVersion` segment if the block crossed a decision-affecting version boundary;
* every disagreement row with the athlete's journal note;
* directional bias (engine systematically more or less conservative);
* whether disagreements concentrate on days where subjective scores diverge from the athlete's own trailing average, the hypothesis in [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md).

Then choose one:

1. **Switch.** Agreement is high and disagreements are defensible; retire the manual daily prompt while keeping AI block planning.
2. **Switch with a named fix.** Disagreements cluster in a specific model weakness; fix it first, then switch.
3. **Do not switch, and record why.**

**Done when.** The analysis is written and Phase 9.5 is re-scoped to sample the block's real check-ins rather than inventing subjective variance.

---

## Acceptance criteria

- [x] Journal storage/parser/rules enforce immutable, non-deletable morning evidence and evening-only outcome updates.
- [x] The exact five-value engine verdict is persisted for new evidence and preserved through history parsing/export; legacy rows have an explicit mode fallback.
- [x] `sawEngineVerdictFirst` survives same-day page reload/navigation when browser storage is available and never changes from true back to false.
- [x] All 25 agreement pairs are tested and `advisory` remains incomparable.
- [x] The import-graph guard prevents the journal/export from reaching the decision engine.
- [x] The export omits identifiers/raw wearable payloads/check-in free text and surfaces invalid journal records as data-quality gaps.
- [x] `POLICY_VERSION` remains unchanged: this phase adds evidence metadata and UI/storage behavior, not recommendation policy.
- [ ] Final branch CI is green on the current head.
- [ ] The block's 9.0.7 volume gates are met, or the shortfall is stated in the readout.

## Risks

| Risk | Mitigation |
|---|---|
| Anchoring: the athlete sees the engine and later records the AI as if blind. | One reveal control; observed ordering; same-day reveal marker; immutable/non-deletable morning evidence; report anchored/unanchored separately. |
| Selective evidence editing/deletion. | Morning verdict, note, anchoring flag, and creation timestamp are immutable; journal deletion is denied. |
| Malformed rows silently improve apparent coverage. | Strict parser plus explicit invalid-record count in export source status. |
| Exact imported verdict is lost behind the three-value mode. | Persist exact five-value `engineVerdict`; legacy fallback only for rows that predate it. |
| Decision policy changes during the block and contaminates the comparison. | Keep policy/equality/replay semantics stable; if an unavoidable decision-affecting change lands, end the evidence segment and report the versions separately rather than pooling them. |
| The log starts influencing recommendations. | 9.0.6 makes that a structural test failure. |
| The athlete stops recording. | Report the lapse rather than silently retry/backfill; daily-use viability is itself evidence. |
| Five values flatten nuance. | Keep `externalNote` verbatim and inspect all disagreement rows in 9.0.8. |
| One athlete, one block, no control. | State that limitation. This is workflow decision evidence, not a population study. |

## Out of scope

* Any change to recommendation thresholds, safety rules, selection, or strain formula during the block.
* Automatically parsing the AI conversation into a verdict.
* Showing agreement statistics to the athlete during the block.
* Backfilling the decision journal; a genuinely blind historical observation cannot be reconstructed.

## Docs to update

- [x] `docs/README.md` — Phase 9.0 indexed by this PR.
- [x] `docs/plans/README.md` — plan table/status updated by this PR.
- [x] `AGENTS.md` — shadow agreement/log modules documented by this PR.
- [x] `phase-9-subjective-baselines.md` — 9.5 dependency on the shadow block recorded by this PR.
- [ ] `architecture/recommendation-engine.md` — only if 9.0.8 later leads to a policy change.

---

## Task board

| # | Task | Status | Blocked by |
|---|---|:--:|---|
| 9.0.1 | Unattended ingestion | `[ ]` | — |
| 9.0.2 | Journal model, validation, storage | `[x]` | — |
| 9.0.3 | Journal entry UI | `[x]` | 9.0.2 |
| 9.0.4 | Agreement classification | `[x]` | 9.0.2 |
| 9.0.5 | Export | `[x]` | 9.0.2, 9.0.4 |
| 9.0.6 | Journal-cannot-reach-engine guard | `[x]` | 9.0.2 |
| 9.0.7 | Run the block | `[ ]` | 9.0.1, 9.0.3, 9.0.6 |
| 9.0.8 | Readout and decision | `[ ]` | 9.0.7 |

9.0.1 and 9.0.2 were independently startable; code work through 9.0.6 is now complete. The operational ingestion check remains the critical path before any shadow-block evidence should be considered valid.
