# Phase 9.0: Shadow mode and the decision journal

* **Status:** In progress. 9.0.2-9.0.6 (code) are done; 9.0.1 (operational) is outstanding,
  and 9.0.7/9.0.8 wait on it.
* **Blocked by:** nothing in code. 9.0.1 (unattended ingestion) is an operational precondition.
* **Unlocks:** a decision on whether to retire the manual AI daily loop, and a real
  subjective corpus for [Phase 9](./phase-9-subjective-baselines.md) 9.5
* **Source analysis:** [2026-08-16 manual loop vs app adjudication](../analysis/2026-08-16-manual-loop-vs-app-adjudication.md)
* **Decisions:** none new. See "Why this needs no ADR" below.

## Goal

Run the app and the athlete's existing AI loop side by side for one training block, and
record where they disagree.

The deliverable is **evidence, not a feature**: a per-day log of the engine's verdict, the
AI's verdict, and what actually happened. Everything built here exists to collect that log
honestly and to get it back out for analysis.

## Why this comes before Phase 9

Phase 9 opens by describing a chicken-and-egg: the coefficients come from calibration, but
calibration needs an implementation. It resolves that with a default-off selector. It does
**not** resolve a second one, which 9.5 states plainly — the corpus has no subjective
variance to measure, because `simulation/scenarios.ts` builds nearly every scenario from
`stableReadiness()`, a constant.

So 9.5 as written means *inventing* variance. After a shadow block it means *sampling the
athlete's own check-ins*. Same work item, categorically better input, and it arrives as a
by-product of using the app rather than as extra work.

The disagreement log is the larger prize. Nothing in this repository has ever compared an
engine verdict to a human verdict on the same day.

## Why this needs no ADR

Every decision here is about evidence collection, and nothing built can change a
recommendation. The closest precedent is
[Phase 6.4's calibration corpus](../analysis/2026-08-10-phase-6-calibration-corpus.md),
which shipped with a dated analysis and no ADR for the same reason. The two design
commitments that would otherwise deserve one — the journal is invisible to the engine, and
anchoring is measured rather than assumed away — are stated here and enforced by tests.

If the readout at 9.0.8 leads to changing engine policy, *that* needs an ADR.

---

## Preconditions

* **9.0.1 must be complete before the block starts.** Shadowing against ingestion gaps
  measures the sync, not the engine.
* The athlete keeps prompting their AI exactly as today. Changing the manual loop mid-block
  invalidates the comparison.

---

## Work items

### 9.0.1 Unattended ingestion `[ ]`

**Current behaviour.** `docs/ops/cloud-run-deployment.md` documents a Cloud Run Job plus
Cloud Scheduler trigger. It is written, not necessarily running.

**Change.** Operational, not code:

1. Deploy the job and schedule it daily at `05:00 Europe/Warsaw` (`0 5 * * *`), early enough
   that the snapshot exists before the morning check-in.
2. `uv run python -m garmin_sync backfill --days 56` so the 28-day objective baselines are
   mature on day 1 rather than maturing during the measurement.
3. `uv run python -m garmin_sync audit` over the block window; record the coverage result.

**Done when.** Seven consecutive days land unattended, and the audit reports no gap in the
backfilled window. A gap discovered mid-block is a confound, not a data point.

---

### 9.0.2 Decision journal model, validation and storage `[x]`

**Current behaviour.** The engine's verdict already persists —
`users/{uid}/daily_recommendations/{date}` carries `mode`, `templateId`, `adherence` and
the compact `recommendationAudit`, and after ADR-0019 an external decision also carries
`externalPlan` provenance. The athlete's *own* verdict is recorded nowhere.

**Change.** Add `users/{uid}/decision_journal/{date}`, one document per day:

```ts
export type ShadowVerdict = 'proceed' | 'scale' | 'defer' | 'skip' | 'advisory';

export interface DecisionJournalEntry {
    userId: string;
    date: string;                        // Warsaw-local, matches the recommendation doc id
    /** What the athlete's own planner said to do today. */
    externalVerdict: ShadowVerdict;
    /** Free text, the athlete's own words. Never parsed. */
    externalNote?: string;
    /** Which the athlete saw first. The honest way to handle anchoring: measure it. */
    sawEngineVerdictFirst: boolean;
    /** What they actually did, in the same vocabulary. */
    actualVerdict?: ShadowVerdict;
    createdAt: string;
    updatedAt: string;
    schemaVersion: 1;
}
```

`ShadowVerdict` deliberately reuses `ExternalSessionDecision`'s exact five values. The
comparison is only meaningful if both sides speak one vocabulary, and these five already
cover what a conversational planner says: do it, do it easier, move it, skip it, your call.

**Mutation lifecycle:**
- **Morning write (creation):** Records `externalVerdict`, optional `externalNote`, and
  locks `sawEngineVerdictFirst` (determined from whether the athlete revealed the engine
  recommendation prior to submission).
- **Evening write (update):** Records or updates `actualVerdict` (or syncs from daily
  adherence) and sets `updatedAt`.
- **Immutability rule:** `sawEngineVerdictFirst` and `createdAt` cannot be modified on
  update, preventing post-hoc rewriting of anchoring telemetry.

Validation in `engine/validation.ts` (closed key set, as every other stored shape).
Firestore rules owner-scoped, with `hasValidDecisionJournalEntry`, mirroring the
`daily_subjective_checkins` block and enforcing immutable `sawEngineVerdictFirst` / `createdAt`
on update. Emulator tests including cross-user denial and update-tampering rejection.

**Done when.** A well-formed entry is accepted, a malformed or foreign-owned one is
rejected, and the rules tests prove both.

---

### 9.0.3 Journal entry UI `[x]`

**Change.** A card on Home, beside the adherence prompt, that records today's entry.

Two ordering rules, both about not corrupting the evidence:

* The entry form is reachable **without** expanding the recommendation, so an athlete who
  wants to record the AI's verdict blind can.
* Whichever order they choose, `sawEngineVerdictFirst` records it. The field is set from
  observed interaction, not from asking the athlete to self-report their own bias.

The card shows the engine's verdict for the day only after an entry exists or the athlete
explicitly reveals it.

**Adherence alignment:** When the athlete answers the existing `AdherencePrompt.tsx`
(`followed === true`), `actualVerdict` defaults naturally to the executed recommendation's
verdict rather than forcing the athlete through redundant double-entry, while still
permitting an explicit override on the journal card if execution diverged from both.

**Done when.** An entry can be recorded before the engine's verdict is visible; recording
after reveal is possible and flagged; and the flag reflects what actually happened rather
than a checkbox the athlete ticks.

**Implementation note.** The reveal gate lives on the "Today's Recommendation" card itself
(`Home.tsx`'s `recommendationRevealed` state, gated whenever `canGenerateNormalPlan` is
true) rather than inside `DecisionJournalCard`, so there is exactly one reveal control on
the page, not two that could disagree. `DecisionJournalCard` sits beside `AdherencePrompt`
in the sidebar, reads that gate, and both records `sawEngineVerdictFirst` from it at submit
time and displays the engine's verdict inline once unlocked. An existing entry for today
also counts as unlocked (a returning athlete who already recorded blind isn't re-hidden).
`AdherencePrompt.tsx`'s `onResolved` now passes the answer through so `Home.tsx` can sync
`actualVerdict` onto yesterday's entry when `followed === true` and no explicit override
exists yet.

---

### 9.0.4 Agreement classification `[x]`

**Change.** Add `engine/shadowAgreement.ts`, pure:

```ts
export type AgreementClass =
    | 'agree'
    | 'engine_more_conservative'
    | 'engine_less_conservative'
    | 'incomparable';

export function classifyAgreement(engine: ShadowVerdict, external: ShadowVerdict): AgreementClass;
```

Ordering on the conservatism ladder: `proceed` > `scale` > `defer` ≈ `skip`. `defer` and
`skip` are equally conservative *about today* — they differ in what happens to the session
afterwards, which is a placement question, not a load question. `advisory` sits outside the
ladder entirely (D-EVENT makes it a non-instruction), so any pair involving it is
`incomparable` rather than being forced onto a scale it was never on.

Classifying in code rather than in a spreadsheet is the point: the readout at 9.0.8 must not
depend on how the reviewer eyeballed the table.

**Done when.** Every ordered pair of the five verdicts has an asserted class, and the
`advisory` rows assert `incomparable` in both directions.

---

### 9.0.5 Export `[x]`

**Change.** Add `engine/shadowLog.ts` (pure renderer) and a service read, following the
`contextBrief.ts` / `contextBriefService.ts` split exactly.

One row per day, joining what already exists with what 9.0.2 adds:

| Column | Source |
|---|---|
| `date` | — |
| `engineVerdict`, `engineMode` | `daily_recommendations/{date}` |
| `externalVerdict`, `externalNote`, `sawEngineVerdictFirst` | `decision_journal/{date}` |
| `actualVerdict`, `adherence.followed`, `actualDurationMin` | journal + recommendation |
| `agreement` | 9.0.4 |
| subjective vector | `daily_subjective_checkins/{date}` |
| objective vector, 7d/28d deltas | `daily_recovery_snapshots/{date}` |
| `policyVersion`, `externalPlan.contentHash` | `recommendationAudit` |

Two consumers, one file: the 9.0.8 readout, and Phase 9.5's corpus.

Rows are emitted for days with **any** of the three, not only complete ones — a day the
athlete skipped the check-in is itself a finding, and silently dropping it would bias the
log toward days that went well. That is the same missingness argument `contextBrief.ts`
already makes about its coverage gate.

**Done when.** A fixture of partial days round-trips with the gaps visible as gaps, and no
identifier or raw wearable payload appears in the output.

**Implementation note.** `engineVerdict` is a documented mode-based approximation:
`daily_recommendations/{date}` retains only the three-value `mode`, not the specific
`ExternalSessionDecision` an adjudicated day resolved to, so `deriveEngineVerdictFromMode`
(in `shadowLog.ts`) can produce `proceed`/`scale`/`defer` but never `skip`/`advisory`. `skip`
still classifies correctly on the conservatism ladder (tied with `defer`); `advisory` does
not, since it sits outside the ladder entirely. Revisit if the 9.0.8 readout needs the
distinction. `renderShadowLogCsv` is the human-readable form for 9.0.8; Phase 9.5's corpus
should consume `buildShadowLog`'s row objects directly rather than parsing the CSV back.

---

### 9.0.6 The journal cannot reach the engine `[x]`

**Change.** Extend the runtime-import-graph guard added for ADR-0019
(`engine/externalArchitecture.test.ts`, or a sibling) so that no module reachable from
`rules.ts`, `optimizer.ts`, `planner.ts` or `trainingIntent.ts` can reach
`decisionJournalService.ts` or `shadowLog.ts`.

**Why this is load-bearing.** A journal the engine reads is evidence contaminated by its own
effect. This is the same one-way boundary D-CRITIQUE draws for the weekly critique, for the
same reason, and it is worth enforcing structurally rather than by intention — the existing
guard already carries a positive control so a passing result means absence rather than a
broken scan.

**Done when.** The guard fails if a planted import is added, and passes otherwise.

**Progress.** Complete. `rules.ts`, `optimizer.ts`, `planner.ts` and `trainingIntent.ts` are
each asserted not to reach `decisionJournalService.ts`, `engine/shadowLog.ts`, or
`services/shadowLogService.ts`, using the existing scanner and positive control.

---

### 9.0.7 Run the block `[ ]`

Not a code task. 4–6 weeks of: check-in, record the AI's verdict, read the engine's verdict,
answer the adherence prompt.

**Done when** the export contains:

* **≥ 28 days** with an engine verdict and an external verdict both present;
* **≥ 21 days** with a complete subjective check-in — the same 21-of-28 coverage floor
  `contextBrief.ts` already applies before it will show a subjective baseline at all;
* **≥ 7 days** where `sawEngineVerdictFirst` is false, so anchoring can be estimated rather
  than merely acknowledged.

If the third gate is not met, the log is still useful for Phase 9's corpus but the
agreement rate must be reported as anchored. Say so rather than quietly reporting it as if
it were independent.

---

### 9.0.8 Readout and decision `[ ]`

**Change.** A dated analysis in `docs/analysis/` reporting:

* agreement rate overall, and split by `sawEngineVerdictFirst`;
* the disagreement rows in full, with the athlete's note — the sample is small enough to
  read every one, and the interesting content is in the prose;
* directional bias: is the engine systematically more or less conservative;
* whether disagreements concentrate on days where the subjective scores diverge from the
  athlete's own trailing average, which is the specific hypothesis
  [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) predicts.

Then one of:

1. **Switch.** Agreement is high and disagreements are defensible. The manual daily prompt
   retires; the AI keeps the block planning it is better at.
2. **Switch with a named fix.** Disagreements concentrate somewhere specific — most likely
   subjective normalisation, which is Phase 9. Do that first, then switch.
3. **Do not switch, and record why.** The most valuable outcome if it is the true one, and
   the reason it is worth building the log rather than deciding on taste.

**Done when.** The analysis is written and Phase 9's 9.5 is re-scoped to sample the block's
check-ins instead of inventing variance.

---

## Acceptance criteria

- [x] `cd app && npm run check` and `npm run test:rules` pass.
- [x] `npm run simulate:diff` reports no changed pre-existing baseline scenario. Nothing in
      this phase touches a decision path, so a change here is a bug in this phase.
- [x] `POLICY_VERSION` is **unchanged**. If it needs a bump, something in this phase reached
      the decision path and 9.0.6 failed to catch it. (`check-policy-drift.mjs` passes.)
- [x] A planted import from `rules.ts` to the journal fails 9.0.6's guard. (Verified via the
      existing scanner's positive control, the same standard ADR-0019's identical guard
      uses, rather than a literal planted-and-reverted import.)
- [x] The export contains no identifiers, raw wearable payloads, or free-text check-in notes
      beyond the athlete's own journal note. (Asserted in `shadowLog.test.ts`.)
- [ ] The block's volume gates in 9.0.7 are met, or the shortfall is stated in the readout.
      Not yet reachable: 9.0.1 (unattended ingestion) hasn't run.

## Risks

| Risk | Mitigation |
|---|---|
| Anchoring: the athlete reads the engine's verdict, then "remembers" the AI agreeing. | Cannot be eliminated without hiding the app. Recorded per day (9.0.3) and reported split (9.0.8); a minimum of unanchored days is a volume gate. |
| The athlete stops recording after two weeks. | The entry is one tap on a card already on Home. If it lapses anyway, that is itself the answer about daily-use viability, and should be reported rather than retried silently. |
| The log becomes a feature and starts influencing decisions. | 9.0.6 makes that a test failure, not a judgement call. |
| Comparing a five-value verdict flattens real nuance. | Accepted, and why `externalNote` is free text and every disagreement row is read individually rather than only aggregated. |
| One athlete, one block, no control. | Accepted and stated. This is decision evidence for one person's workflow, not a study. It is still strictly more than the zero real-athlete evidence held today. |

## Out of scope

* Any change to `rules.ts`, thresholds, or the strain formula. That is Phase 9, and doing it
  during the block would invalidate the block.
* Automating capture of the AI's verdict. Parsing a chat transcript at the persistence
  boundary is the same non-determinism ADR-0019 D-NOPARSE refused.
* Surfacing agreement statistics to the athlete during the block — it would feed back into
  the behaviour being measured.
* Backfilling the journal. It cannot be reconstructed.

## Docs to update

- [ ] `docs/README.md` — index row.
- [ ] `plans/README.md` — plan table row.
- [ ] `AGENTS.md` — `engine/` map gains `shadowAgreement.ts` and `shadowLog.ts`.
- [ ] `phase-9-subjective-baselines.md` — 9.5 re-scoped to sample the block's check-ins.
- [ ] `architecture/recommendation-engine.md` — only if 9.0.8 leads to a policy change.

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

9.0.1 and 9.0.2 are startable immediately and in parallel — one is operational, the other is
a storage shape with no dependency on it. 9.0.1 is on the critical path for the block, so it
should start first even though it is not code.
