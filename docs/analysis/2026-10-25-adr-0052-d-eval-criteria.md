# ADR-0052 D-EVAL criteria: does the ledger + external-AI loop justify retiring the engine?

- **Status:** **Owner-approved 2026-10-25; pre-block prerequisites completed 2026-11-22; criteria frozen for the qualifying block.**
  OD1–OD5, OD7 and OD8 were approved on `2026-10-25`, with OD6 replaced by per-protocol
  schedules (§3). On `2026-11-22`, the owner completed all pre-block prerequisites (§3 goal-bound
  protocol table, `90d`/`180d` schedules, cited `literature_reference` `cv_pct` measurement noise,
  Oct 19–25 `"before"` baseline, `[OD4]`/`[OD5]` adherence baseline rule, and `OD9`–`OD10` including
  live `illness_anomaly` under ADR-0054 in `C3`/`OD8`), freezing the criteria for the qualifying
  block (ADR-0052 D-EVAL).
- **Decision source:** [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md), sections D-EVAL and D-ENGINE.
- **Companion:** [`../plans/2026-10-25-issue-1145-ledger-export-v1.md`](../plans/2026-10-25-issue-1145-ledger-export-v1.md). ADR-0052 requires both to merge together, before Phase 2.
- **Result document (written after the block):** `docs/analysis/<date>-adr-0052-d-eval-result.md`, using the template at the end of this document.

## 1. When the qualifying block runs

- It starts **after Phase 2 ships**. The rollback setting must be off, meaning engine
  adjudication is disabled, for the whole block.
- The external AI plans it, and its sessions are imported as `external-plan@6`, or a later
  version, and run as authored.
- It lasts **28 consecutive Warsaw calendar dates** at minimum **[OD1]**. The block's first date
  must come after both this document's merge commit and recorded owner approval of its
  thresholds. Merging this draft alone does not start a qualifying block.
- If Phase 2 is rolled back during the block, for any reason, the block ends. A new block
  starts from day 1 after the switch-off is restored.

## 2. Definitions

These are fixed now, before any reporting for them is built (ADR-0052 D-EVAL).

**Planned session.** An assignment in a placement overlay
(`external_plans/{planId}/revisions/{revision}/placement/current` `assignments[]`) whose date
falls inside the block, using the assignment history as it stood on that date. Moving or
dropping an assignment after its due date must not remove a miss from the denominator.
A future session replaced by a revision is counted once through its successor; do not infer
successors from matching titles. Rest directives (`restDays`) are not planned sessions.

**Outcome of each planned session.** Apply these rules in table order; the first match wins.
Each planned session gets exactly one outcome. Count a linked occurrence at most once.

| Outcome | Rule |
|---|---|
| `unknown` | Linkage, assignment history or required completion evidence cannot be determined because it is missing, `unavailable` or `invalid`. Never infer full completion from linkage alone. |
| `reduced` | A linked performed occurrence ran the athlete-selected authored `scaling.reducedDefinition`, as recorded on the execution (ADR-0052 D-AUTHORITY). Keep its completion evidence separately, including partial or abandoned execution. Launch selection alone is not performed training. |
| `partial` | A linked occurrence has explicit `completedFraction < 1` in `SessionExecution.completionEvidence` or `SessionResponse`, or its execution state is `abandoned` (#896). Conflicting reports are `unknown`. |
| `moved` | A linked occurrence has evidence of full completion, the placement status is `moved`, and it was performed within the block. |
| `completed` | A canonical `PerformedTrainingOccurrence` (ADR-0034) is linked to the assignment, has evidence of full completion and was performed on the assigned date or ±1 date. |
| `flag_skip` | Confirmed no linked performance, and on the assigned date at least one D-FLAGS flag was `active: true` or a check-in recorded a red-flag symptom (`redFlags` non-empty, which pauses session launch under the 2026-11-12 ADR-0052 OQ2 amendment). |
| `missed` | Any remaining determinable planned session, including linked performance outside the completion/move window. |

Full completion means an explicit `completedFraction: 1` in the execution's completion
evidence or the session response, without conflicting partial/abandoned evidence. A missing
response alone does not make a confirmed absence of performance `unknown`.

**Unplanned session.** A canonical occurrence with no linked assignment. It is reported, but it
counts neither for nor against adherence.

**Hard session.** A performed occurrence whose authored intensity is `hard` or `max`
(`ExternalSessionIntensity`), using the definition actually performed when a reduced alternative
was chosen. For an unplanned session, a canonical occurrence whose intensity is
`hard`.

**Adherence.**
`(completed + moved + 0.5 × partial) ÷ (planned − reduced − flag_skip − unknown)` **[OD2: partial weight 0.5]**.
`reduced` is reported separately, as its own count and share, and is excluded from both
numerator and denominator. That way the metric neither rewards nor penalizes using the authored
alternative. A zero denominator is inconclusive. C1's minimum of 8 applies to this eligible
denominator, not to sessions excluded from it. For example, 6 completed, 2 reduced and 2
flag skips give `6 ÷ 6 = 100%`, but are inconclusive because only 6 sessions are eligible.

**Adverse flagged-day outcome.** A hard session performed on a date with any active flag,
followed within **72 hours [OD3]** by any of:
- a check-in with `illnessSymptoms: true`, `painOrInjury: true`, any red flag in `redFlags`, or a
  `tissueResponses` entry at the escalation level defined by ADR-0013/ADR-0032;
- a new injury constraint;
- an illness outcome recorded in `health_anomaly_outcomes`.

Observe the full 72-hour window after every flagged hard session, including sessions on
the block's final date; the result cannot be issued before the last window closes. Keep
Warsaw dates for grouping and recorded timestamps for elapsed hours. If only dates are
available, include the next three calendar dates conservatively and report that limit.
Missing follow-up evidence cannot establish the absence of an adverse outcome.

**Attribution of editable follow-up records (owner clarification `2026-11-22`).** This
clarifies how the rule above applies to records that can be edited without a versioned history.
It changes no threshold or decision. It does not reopen the frozen criteria.
- *Illness outcome* (`health_anomaly_outcomes`): a labelled symptom-onset date dates the illness.
  Without one, the outcome counts from when it was first recorded (`createdAt`). A later edit
  (`updatedAt`), including a note-only edit, never establishes an adverse outcome on its own.
- *Check-in*: it counts from when it was submitted (`submittedAt`).
- *Ambiguous edits*: an edit inside a follow-up window to a record created or submitted outside
  it may be the moment an adverse value was recorded, such as a relabel to illness or a later
  tissue follow-up. Such an edit makes that follow-up incomplete. It is neither a pass nor a
  fail.
- *Readouts taken before the result is final*: evidence recorded or edited after the readout's
  as-of point is not used and counts as incomplete follow-up. The same applies to date-only
  evidence dated on the as-of date when the as-of point is a timestamp.

## 3. Baselines (owner-confirmed 2026-11-22)

**Adherence baseline.** The previous 28 dates before the block start count as the comparison
block only if both of these hold:
- they contain at least **8 eligible sessions after the adherence exclusions [OD4]**;
- at least **90% [OD4]** of all planned sessions have a determinable outcome (not `unknown`).

Use the same outcome rules, exclusions and partial weight for both blocks; missing historic
evidence fails comparability rather than being treated as completion.
That earlier block ran with engine adjudication on, so the comparison is *loop vs loop*, not a
controlled experiment. The result document must say so. If the earlier block fails either test,
the adherence criterion uses the absolute threshold **≥ 75% [OD5]**.
On `2026-11-22`, the owner confirmed using `[OD4]`/`[OD5]` automatically against the pre-block
28-day window.

**Benchmark baseline: each protocol on its own schedule [OD6, owner decision 2026-10-25; table confirmed 2026-11-22].**
Goal-bound tests keep their usual retest schedule; some are roughly quarterly, others
semi-annual. No extra testing is required for the block. The code records no retest interval, so
on `2026-11-22` the owner declared each protocol's goal-bound status, retest interval, and
stated measurement noise below:

| Protocol (`physicalCapitalProtocols.ts` id) | Goal-bound? | Retest interval | Stated measurement noise (literature reference) |
|---|---|---|---|
| `strength-back-squat-1rm` | **Yes** | Semi-annual (180d) | `4.2% CV` — Grgic J et al., *Sports Med Open* 2020;6(1):31 (PMID `32681399`, `GRGIC-2020-1RM-RELIABILITY` in `goalFeasibilityKnowledge.ts`; median CV `4.2%`, pooled n = 1,595) |
| `strength-bench-press-1rm` | **Yes** | Semi-annual (180d) | `4.2% CV` — Grgic J et al., *Sports Med Open* 2020;6(1):31 (PMID `32681399`, `GRGIC-2020-1RM-RELIABILITY`) |
| `strength-back-squat-fixed-load-velocity` | No | — | — |
| `strength-bench-press-fixed-load-velocity` | No | — | — |
| `field-standing-broad-jump` | **Yes** | Quarterly (90d) | `3.8% CV` — Washif JA et al., *Biol Sport* 2024;41(3):231–241 (PMID `38952920` / PMC `11167475`, Table 2 standing long jump `Distance, best (cm)` between-session CV `3.8%`, matching `max_valid` reducer) |
| `field-wall-touch-cmj` | **Yes** | Quarterly (90d) | `4.6% CV` — Markovic G et al., *J Strength Cond Res* 2004;18(3):551–555 (PMID `15320660`, n = 93, upper bound of `2.4–4.6%` within-subject CV across Sargent/CMJ jump tests) |
| `field-seated-medball-chest-throw-3kg` | **Yes** | Quarterly (90d) | `5.1% CV` — Riemann BL et al., *Int J Sports Phys Ther* 2023;18(5):1166–1175 (PMID `37795324` / PMC `10547086`, Table 3 `SMBCPT` between-session CV `5.1%` males / `4.5%` females) |
| `cycling-6s-seated-sprint` | **Yes** | Quarterly (90d) | `3.0% CV` (1 s peak & 5 s mean power) — Wehbe G et al., *J Strength Cond Res* 2015;29(7):2050–2055 (PMID `25559911`, 6-s cycle peak power between-session CV `3.0%`, 90% CI `2.5–3.8%`; corroborated by Mendez-Villanueva et al., *J Sci Med Sport* 2007;10(5):323–326, PMID `16949868`, `2.8%` peak / `2.9%` mean) |

These declared `literature_reference` (`cv_pct`) thresholds satisfy `C2`'s stated-noise
requirement (aligned with `ReliabilityEstimate` in `observations/models.ts` and `deriveProgress`
in `observations/progress.ts`) without mutating immutable protocol revisions in
`physicalCapitalProtocols.ts`; personal close-spaced repeatability (`OV4.4`) supersedes the
literature reference if later collected.

On `2026-11-22`, the owner confirmed **19–25 Oct 2026** as the `"before"` baseline for
goal-bound protocols tested in that window (`90d`/`180d` intervals both span to block start).

For each goal-bound protocol:
- **Before:** the most recent comparable completed attempt (`assessment_attempts`,
  ADR-0046/0047) dated within one retest interval before the block start. If none exists, run
  one before the block.
- **After:** the next scheduled comparable attempt after the block ends, no later than one
  retest interval after the block end. It must use the same protocol, the same series identity
  (ADR-0047 for velocity series), and the comparability rules the protocol declares.
- **Between the block end and the after-attempt,** training must stay in the qualifying regime
  (Phase 2 active, rollback off). A rollback in that interval makes the protocol's C2 result
  inconclusive, because the after-attempt would then also measure the engine-adjudicated
  period.

Consequence, accepted by the owner: **C2, and therefore the overall go/no-go, may resolve
months after the block ends** when a goal-bound test is yearly or semi-annual. Until then the
result document records C2 as `pending` with each protocol's due date, and Phase 3 cannot start.
As confirmed on `2026-11-22`, the October 2026 assessment window (19–25 Oct) serves as
`"before"` for goal-bound protocols tested in that window (`90d`/`180d` both reach the block
start).

## 4. Criteria

| # | Criterion | Pass | Fail | Inconclusive |
|---|---|---|---|---|
| C1 | Adherence | ≥ baseline − **5 percentage points [OD7]** when §3 confirms a comparable baseline; otherwise ≥ the §3 absolute threshold | Below the applicable threshold | Fewer than 8 eligible sessions, zero denominator, or `unknown` > 10% of planned |
| C2 | Goal benchmarks | No goal benchmark declines by more than its protocol's stated measurement noise | Any goal benchmark declines by more than its noise | Missing before attempt, after-attempt missed beyond its interval, a rollback before the after-attempt, failed comparability, a protocol with no stated noise, or no goal-bound protocol declared. **Pending** (not inconclusive) while an after-attempt is not yet due |
| C3 | Flagged-day outcomes | Zero adverse flagged-day outcomes with complete follow-up windows | Any adverse flagged-day outcome: **no-go until ADR-0052 is amended** | A flag-input source missing, `unavailable` or `invalid` on 3 or more block dates **[OD8]**, or incomplete outcome follow-up for any flagged hard session |
| C4 | Rollback | The rollback setting was not used | It was used for a safety reason: **no-go until ADR-0052 is amended** | It was used for a non-safety reason: the block restarts (§1) |

An observed failure takes precedence over missing evidence; otherwise apply the inconclusive
conditions before the pass conditions.
**Overall go** means every criterion passes and none is inconclusive or pending. A pending C2
holds the result open; it is neither a go nor a no-go. Anything else is a no-go or an extension. An inconclusive criterion extends or repeats the block; it never counts as a
pass.

## 5. What the ledger must record for this to be measurable

These are inputs for #1145 Part B and for Phase 2. Without them the criteria cannot be evaluated.

- Placement assignments exist, but `ExternalPlanPlacement` is a mutable current overlay:
  `externalPlanService.savePlacement` overwrites it. **New before the block:** retain dated
  assignment/status history and explicit revision-successor links. Without these, historical
  planned counts cannot be reconstructed reliably and C1 is inconclusive.
- A link from each occurrence to its assignment, already present (ADR-0034 round trip).
- **New in Phase 2:** the execution record notes which definition ran (authored or reduced),
  per ADR-0052 D-AUTHORITY.
- **New:** flag state per date, kept and exported. A flag computed only at view time cannot be
  audited afterwards. Retain evaluation time, session scope for session-dependent flags,
  definition version, inputs and source states, including unevaluable flags.
- Check-in `illnessSymptoms`, `painOrInjury`, `redFlags` and `tissueResponses`, already present.
- Injury constraint creation dates are recorded for new constraints and retained with resolved
  periods in `trainingSettings.injuryHistory`. C3 can use these dates as well as check-ins;
  legacy constraints with unknown creation dates remain unknown and must not be backdated.

## 6. Owner decisions (recorded 2026-10-25; updated 2026-11-22)

| ID | Decision | Owner decision | Why |
|---|---|---|---|
| OD1 | Block length | **28 days** (approved) | ADR-0052 minimum; matches the adherence baseline window |
| OD2 | Weight of a `partial` session | **0.5** (approved) | Counts effort without equating it to completion |
| OD3 | Adverse-outcome window | **72 h** (approved) | ADR-0052 wording; covers delayed illness onset after a hard day |
| OD4 | Baseline comparability | **≥ 8 eligible, ≥ 90% of planned determinable** (approved) | Below this, a few sessions swing the percentage |
| OD5 | Absolute adherence floor | **75%** (approved) | Conventional "mostly followed" bar |
| OD6 | Benchmark recency and after-window | **Each protocol on its own retest schedule** (replaces the proposed ≤ 28 d before / ≤ 7 d after); the interval table in §3 is to be filled in before the block | Some tests are quarterly, some yearly; no extra testing for the block. The owner accepted that C2 may resolve late |
| OD7 | Adherence tolerance | **5 percentage points** (approved) | About 1 session in 20; sampling noise at this volume |
| OD8 | Flag-source availability for C3 | **Inconclusive if missing, unavailable or invalid on ≥ 3 dates** (approved) | Too many blind dates make "zero adverse outcomes" meaningless |
| OD9 | Live `illness_anomaly` flag in `C3` / `OD8` | **Included in both `C3` and `OD8` (approved 2026-11-22)** | Under ADR-0054 (`visible-v1`, `#1263`), `evaluateIllnessAnomalyFlag` raises `active: true` only on `possible_illness_or_systemic_stress`; `no_assessment` / `no_core_signals` count toward `OD8`'s `>= 3` blind-date gate |
| OD10 | Goal-bound §3 protocol schedule, literature noise & Oct baseline | **6-protocol battery (`90d`/`180d`), cited PubMed/PMC `cv_pct` noise, Oct 19–25 `"before"` baseline, and auto `[OD4]`/`[OD5]` rule (approved 2026-11-22)** | Fixed-load velocity marked non-goal-bound; avoids forcing an unnecessary pre-block retest while holding non-decline checks to published typical-error CVs |

## 7. Result template (for the result document)

```markdown
# ADR-0052 D-EVAL result: <block start> – <block end>
- Criteria document: <this file> at <merge commit>
- Phase 2 commit / rollback setting state during block: <…>
| # | Result (pass / fail / inconclusive) | Evidence (counts, values, sources) |
| C1 | | planned=…, completed=…, moved=…, partial=…, reduced=…, flag_skip=…, missed=…, unknown=…; baseline=… |
| C2 | | per protocol: retest interval / before (date, value) / after (due date, date, value) / noise / comparability; `pending` until each after-attempt is done |
| C3 | | flagged hard days=…, adverse outcomes=… (with dates and sources); blind flag-input dates=…; final follow-up window closed at=…; incomplete follow-ups=… |
| C4 | | rollback used? why? |
- Known limits: <e.g. loop-vs-loop baseline, legacy injury onset may be unknown>
- **Overall: GO / NO-GO / EXTEND / PENDING (C2 after-attempts due …)**
```
