# Product-scope cutline review — evidence before breadth (2026-08-19)

## Question

Given the current implementation state, which remaining items in the Multidomain plan should be built now, reduced, deferred behind usage/evidence triggers, or left as later evidence work if the goal is maximum value for the athlete who actually uses this repository rather than maximum architectural completeness?

This is a dated product/roadmap review, not a replacement for accepted ADRs and not an implementation plan. It does not change task status. If this cutline is accepted, the mutable plan in `docs/plans/multidomain-session-authoring-execution-and-evidence.md` should be updated separately.

## Executive verdict

The repository has crossed the architecture threshold. The highest-value remaining work is now to make the existing daily loop trustworthy, start the prospective evidence clock, and close the chain from **planned occurrence → performed execution → delayed response**.

The recommended near-term code sequence is:

```text
M3.7 semantic import preview/diff
    ↓
M3.8 bounded hardening only — no feature expansion by default
    ↓
M4.3 occurrence/companion reconciliation
    ↓
M5.1 generalized occurrence-linked response
    ↓
M5.2 later-day / next-morning follow-up
```

In parallel, Phase 9.0 should start its 4–6 week shadow block as soon as 9.0.1 unattended ingestion is proven. Work that changes recommendation policy, decision equality, or replay/provenance semantics should not be mixed into one shadow evidence segment.

The rest of M6–M9 should mostly become **triggered capability work**, not scheduled roadmap debt. The current generic runner already handles repetitions, duration, distance, check-offs and strength gauges. Specialized sprint/COD/jump cards, protocol registries, benchmark UI, device adapters and assisted prose parsing should be built only when real use proves the generic path inadequate or a named testing/device workflow begins.

## Evidence from the current repository

### 1. The source-neutral execution core is already real

The Multidomain plan records M0–M2, M3.1–M3.6 and M4.1–M4.2 as delivered. The repository has a general `SessionDefinition`, occurrence and execution persistence, content-addressed prescriptions, recommendation bindings/replay, authored authority flow, catalog parity, facets, external-plan v2, group execution and recorded athlete choices.

This means the original product risk — “can catalog/manual/external sessions share one safe execution path?” — is largely retired. The remaining work should be judged by marginal athlete/evidence value rather than by architectural symmetry.

### 2. M3.8 is much closer to usable than its remaining acceptance text suggests

`ManualSessionBuilder.tsx` already supports:

* title, modality, duration and purpose/notes;
* multiple blocks, block role, execution mode and rounds;
* catalog or explicit unresolved free-text movements;
* repetition, duration, distance and check-off doses;
* RPE and rest;
* movement/block reorder and duplication;
* advanced prescription fields;
* validation, semantic preview and destination flow.

The remaining M3.8 work is therefore mostly **hardening and richer authoring completeness**, not “build a manual builder”. For a one-athlete repository that also has JSON import, the default should be to finish only defects that prevent reliable owner use. Authored option-set editing, every load/effort variant and fixture-perfect parity should not remain unconditional roadmap obligations.

### 3. Generic performed inputs already cover the common field shapes

The general runner currently has dedicated input cards for:

* repetitions;
* duration;
* distance;
* check-off/completion.

That is enough to execute many field, speed, mobility and mixed sessions today. M6.2/M6.3 still add legitimate domain value — splits, side, attempt validity, contact count, jump/throw metrics — but they should be justified by an actual data-capture gap, not by the existence of a domain in the taxonomy.

### 4. The response and observation layers are still new subsystems

There is currently no `app/src/responses/` or `app/src/observations/` subsystem. M5 and M7 therefore have very different cost/value profiles:

* M5 closes a feedback loop needed by several existing evidence gates and immediately starts accumulating useful history;
* M7 creates a new protocol/measurement abstraction whose value appears only when repeated comparable testing is actually performed.

That makes M5 near-term product work and M7 conditional capability work.

### 5. M4.3 is the structural hinge

M4.3 is not “more session UI”. It resolves two correctness issues:

* an embedded segment versus a separately executable companion must have distinct occurrence semantics;
* a manual execution and its matching Garmin activity must not become two completed training exposures.

It also unlocks M5.1–M5.3. That combination makes M4.3 the highest-value structural item after the import path is trustworthy.

## Item-by-item cutline

| Item | Recommendation | Why | Trigger / bounded scope |
|---|---|---|---|
| **M3.7** semantic import preview/diff | **BUILD NOW** | Imported content is already a first-class source; silent behavior-changing diffs are a correctness and trust problem. | Complete external-plan@2 preview and behavior-field diff. Stop there. |
| **M3.8** manual builder | **HARDEN, DO NOT EXPAND BY DEFAULT** | A substantial builder already exists and JSON import covers advanced authoring. | Fix validation focus, mobile/a11y defects and owner-blocking bugs. Advanced option-set/load editors require observed repeated fallback to JSON. |
| **M4.3** companion occurrence + reconciliation | **BUILD NOW** | Prevents double-counted physical work and unlocks the response chain. | Keep scope to occurrence identity, companion start/skip, and deterministic Garmin/manual reconciliation. |
| **M5.1** occurrence-linked response | **BUILD NOW** | Starts durable session→response evidence across all session types. | Linkage + non-tissue facts only; preserve check-in as sole tissue authority. |
| **M5.2** later-day / next-morning follow-up | **BUILD NOW** | Turns M5.1 into usable prospective evidence rather than a schema waiting for data. | Surface in Today/Check-in; no notification system. |
| **M5.3** outcome/override evidence views | **REDUCE / LATER** | Useful for analysis, but a dedicated history UI is not required to start evidence collection. | First deliver a reproducible export/report if needed; build rich history UI only after it is consulted in practice. |
| **M6.1** speed/field/power taxonomy | **SMALL, USAGE-LED** | Some domain metadata is needed for honest field logging, but the original taxonomy can sprawl quickly. | Add only movements/fields used by current authored sessions/tests. No completeness goal. |
| **M6.2** sprint/COD cards | **DEFER UNTIL GENERIC INPUT FAILS** | Distance/duration/check-off already execute many field sessions. | Start when a real session needs splits/side/validity/stop metadata that cannot be captured honestly today. |
| **M6.3** jump/throw/contact cards | **DEFER** | Low immediate value without repeated measured jump/throw/contact use. | Trigger on actual recurring manual measurement. |
| **M6.4** exposure read models | **DEFER UNTIL HISTORY EXISTS** | A perfect 7/14/28-day report over near-zero structured history is infrastructure without product value. | Trigger after enough resolved executions exist to make the report decision-relevant. |
| **M7.1** metric registry/protocols | **DEFER; START SMALL BEFORE FIRST SERIOUS TEST BLOCK** | Comparability matters, but a generalized registry is not needed for normal training logs. | First protocolized repeated test requiring comparable series. Prefer static reviewed protocols before editable protocol machinery. |
| **M7.2** observation persistence/adapters | **FOLLOW M7.1 ONLY** | Valuable only once a real measurement workflow exists. | Manual adapter first. No vendor abstraction beyond the seam required by the first real source. |
| **M7.3** protocol-locked testing mode | **DEFER** | A separate testing product should be earned by repeated use, not architecture symmetry. | Trigger when the athlete actually runs recurring standardized tests and current session execution is too error-prone. |
| **M7.4** benchmarks/progress | **DEFER** | One test has no trend. | Require at least repeated comparable observations before building rich progress UI. |
| **M8.1** step-derived profile candidate | **EVIDENCE-GATED; NO SCHEDULE** | Production authored-session gating already exists. A finer profile is a candidate, not missing product capability. | Start after observed coarse-profile gate errors or sufficient authored history. |
| **M8.2** response/exposure harness | **LATER, HIGH VALUE ONCE DATA EXISTS** | This is where collected evidence becomes decision material, but it cannot precede the history it analyzes. | Trigger when M5/M6/M7 have enough real rows for non-trivial joins. |
| **M8.3** ship/no-ship decisions | **KEEP EXACTLY AS GATED** | The repository's discipline is correct: implemented candidate ≠ authorized policy. | Real history + invariants + replay + rollback selector. |
| **M9.1** aliases/custom movements | **KEEP TRIGGERED** | Correct n=1 trade-off: free text logs, catalog resolves. | Second athlete or repeated durable metadata need. |
| **M9.2** prose-to-draft import | **KEEP TRIGGERED** | JSON import plus AI-generated structured JSON is currently cheaper and more deterministic. | Build only if semantic preview is good and JSON import is still recurrent friction. |
| **M9.3** device adapters | **KEEP TRIGGERED** | Device abstraction without a device is speculative work. | Implement one adapter only when the corresponding device is actually used. |

## What should be removed from the default roadmap

The following should no longer be interpreted as work that must eventually happen simply because the item exists:

1. **Advanced manual-authoring completeness.** The builder does not need to author every valid `SessionDefinition` field if JSON import is an efficient escape hatch.
2. **Domain-specific runner UI for every domain.** Add a specialized card only when the generic card loses information that is actually being collected.
3. **A rich response-history product before evidence exists.** Reproducible export/reporting is sufficient initially.
4. **General editable measurement-protocol infrastructure.** Start with reviewed static protocols for the first real tests.
5. **A benchmark/progress dashboard before repeated comparable observations exist.**
6. **Automatic policy candidates on a calendar schedule.** M8 remains evidence-triggered.
7. **AI parsing and device integrations without measured workflow friction or owned hardware.**

These are not rejected capabilities. They are removed from the **default obligation** and moved behind explicit triggers.

## Proposed execution order after the cutline

### Track A — evidence clock

1. Complete Phase 9.0.1 operational ingestion proof.
2. Start Phase 9.0.7 immediately after the seven-day unattended-ingestion gate.
3. Hold decision-affecting policy/provenance semantics stable within an evidence segment.
4. After the block, run 9.0.8 and Phase 9.8 using prospective data.

### Track B — product correctness and evidence capture

1. Finish M3.7.
2. Run a bounded M3.8 hardening pass; stop adding authoring features unless real use blocks.
3. Build M4.3.
4. Build M5.1.
5. Build M5.2.
6. Use the system for real sessions and collect evidence.

### Track C — capability only when triggered

M6/M7 work begins from an actual logging/testing failure or a real repeated measurement workflow. M8 begins from collected history. M9 begins only when its named trigger fires.

## Success criteria for the next product milestone

The next milestone should not be “M7 exists”. It should be:

> For several consecutive weeks, the athlete can accept/import/build the intended session, execute it on the phone, have Garmin/manual evidence reconcile to one physical occurrence, record immediate/later/next-morning response, and export/replay the resulting decision/evidence chain without manual repair.

If that is true, the repository has a trustworthy training operating loop. At that point the next feature should be chosen from observed friction or evidence, not from the longest remaining section of the roadmap.

## Recommendation

Accept this cutline and then update the mutable Multidomain plan so that:

* M3.8 is explicitly a bounded hardening item rather than an advanced-authoring completeness target;
* M5.3 is report-first and UI-optional;
* M6.2–M7.4 are usage-triggered rather than implicitly scheduled after their blockers land;
* M8/M9 remain evidence/trigger work;
* `docs/plans/README.md` lists the true near-term execution chain as M3.7 → M4.3 → M5.1 → M5.2, with M3.8 only as bounded hardening.

No ADR change is required for this cutline because it changes execution priority and product scope, not accepted record boundaries or authority rules. If a later scope reduction would remove an accepted invariant rather than merely defer a capability, that change should go through the relevant ADR process.