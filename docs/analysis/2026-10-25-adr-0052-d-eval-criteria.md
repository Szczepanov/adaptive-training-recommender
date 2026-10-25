# ADR-0052 D-EVAL criteria: does the ledger + external-AI loop justify retiring the engine?

- **Status:** **Owner-approved 2026-10-25; in force from its merge commit.** OD1–OD5, OD7 and
  OD8 were approved as proposed. OD6 was replaced by per-protocol schedules (§3). C2 can be
  evaluated only once the §3 protocol schedule table is filled in, which must happen before the
  block starts. The thresholds are frozen for the block they judge (ADR-0052 D-EVAL).
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
| `flag_skip` | Confirmed no linked performance, and on the assigned date at least one D-FLAGS flag was `active: true`. |
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

## 3. Baselines (candidates until confirmed)

**Adherence baseline.** The previous 28 dates before the block start count as the comparison
block only if both of these hold:
- they contain at least **8 eligible sessions after the adherence exclusions [OD4]**;
- at least **90% [OD4]** of all planned sessions have a determinable outcome (not `unknown`).

Use the same outcome rules, exclusions and partial weight for both blocks; missing historic
evidence fails comparability rather than being treated as completion.
That earlier block ran with engine adjudication on, so the comparison is *loop vs loop*, not a
controlled experiment. The result document must say so. If the earlier block fails either test,
the adherence criterion uses the absolute threshold **≥ 75% [OD5]**.

**Benchmark baseline: each protocol on its own schedule [OD6, owner decision 2026-10-25].**
Goal-bound tests keep their usual retest schedule; some are roughly quarterly, others yearly. No
extra testing is required for the block. The code records no retest interval, so the owner
declares one per goal-bound protocol in the table below, before the block starts:

| Protocol (`physicalCapitalProtocols.ts` id) | Goal-bound? | Retest interval |
|---|---|---|
| `strength-back-squat-1rm` | *owner* | *owner, e.g. quarterly* |
| `strength-bench-press-1rm` | *owner* | *owner* |
| `strength-back-squat-fixed-load-velocity` | *owner* | *owner* |
| `strength-bench-press-fixed-load-velocity` | *owner* | *owner* |
| `field-standing-broad-jump` | *owner* | *owner* |
| `field-wall-touch-cmj` | *owner* | *owner* |
| `field-seated-medball-chest-throw-3kg` | *owner* | *owner* |
| `cycling-6s-seated-sprint` | *owner* | *owner* |

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
months after the block ends** when a goal-bound test is yearly. Until then the result
document records C2 as `pending` with each protocol's due date, and Phase 3 cannot start.
The October 2026 assessment window (19–25 Oct) can serve as "before" for any protocol whose
interval reaches the block start.

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
- Injury constraint *creation dates*. `trainingSettings.injuries` has no history today, which
  is why D-USER's injury history is `not_yet_supported`. Until it exists, C3 detects new
  injuries through check-ins only, and the result document must say so.

## 6. Owner decisions (recorded 2026-10-25)

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
- Known limits: <e.g. loop-vs-loop baseline, injury onset via check-ins only>
- **Overall: GO / NO-GO / EXTEND / PENDING (C2 after-attempts due …)**
```
