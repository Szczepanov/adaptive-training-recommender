# PR #321 review — structured strength warm-ups and concurrent rest logging

**Date:** 2026-09-01
**Scope:** follow-up review of `feat: add structured strength warm-ups and concurrent rest logging`

## Review outcome

The catalog-level direction is sound: active non-manual strength sessions now begin with an explicit warm-up, activation remains a separate role, warm-up repetition entries default to warm-up history, and authored load instructions survive the catalog-to-session execution boundary.

The follow-up audit identified two execution-layer ambiguities that should be guarded explicitly:

1. **Authored load must own the default.** A source-neutral step that already carries an explicit `load` must not silently fall back to a historical kilogram suggestion from overload history. The runner may keep an athlete-entered weight for the next set of the same step, and an exact authored mass can be suggested directly, but `bodyweight`, `unloaded`, descriptive and percentage loads remain source-preserving rather than being converted into historical kilograms.
2. **Rest preview must describe the actually due work.** Concurrent logging keeps the form usable during an advisory rest countdown. When a sequential exercise still has sets remaining, the next due work is another set of that exercise, not the following exercise. The same rule applies after rotation in a circuit/superset: the banner should follow persisted group progress rather than simply naming the next authored list item.

These are presentation/execution safeguards. They do not change recommendation selection, fatigue cost, stimulus credit, or the immutable prescription bytes.

## Evidence refresh

The original evidence pack correctly avoided a universal warm-up dose and any injury-prevention promise. The review adds a newer resistance-specific source:

- Neves PP, Marques DL, Neiva HP, Alves AR. *Acute Effects of Resistance Training Warm-Up and Re-Warm-Up on Dynamic Strength Performance: A Scoping Review.* Journal of Science in Sport and Exercise. 2026. DOI: [10.1007/s42978-025-00361-9](https://doi.org/10.1007/s42978-025-00361-9).

The review used a systematic search and found 19 warm-up studies plus one re-warm-up study. Results support task-specific/progressive preparation as a reasonable acute-performance strategy in some resistance-training contexts, while protocol effects remain heterogeneous and the literature is concentrated in strength-trained males. Accordingly, the product claims remain **low-certainty** and **conditional**.

The evidence boundary remains:

- a brief low-fatigue warm-up is a reasonable readiness/performance implementation pattern;
- movement-specific rehearsal/light ramping is reasonable before loaded or high-coordination work;
- no universal duration, number of sets, percentage-of-1RM ladder or guaranteed performance effect is asserted;
- no injury-prevention effect is asserted;
- symptom, tissue and return-to-training gates remain owned by the existing safety policy rather than by the warm-up catalog rule.

Supporting background retained in the knowledge pack includes Fradkin et al. 2010 (PMID 19996770), Ribeiro et al. 2020 (PMID 32971729), and the null crossover trial Ribeiro et al. 2014 (PMID 25153744).

## Regression coverage added by the follow-up

- current resistance-specific evidence has stable DOI provenance and preserves low/conditional claim semantics;
- explicit step loads suppress unrelated historical kg fallbacks;
- exact authored mass can still supply a kg default;
- an athlete-entered kg value on the current step remains available for its next set;
- rest preview stays on the current exercise until its prescribed sets are complete;
- after completion it advances to the next sequential or rotation-required step.

## Merge gate

The branch should merge only after the updated CI run is green. Existing catalog validation, policy drift checks, knowledge validation, type/lint/build checks and scenario simulations remain the primary repository gates; the follow-up tests above close the execution ambiguities found during manual review.

A green run from an earlier head is not sufficient evidence for the follow-up. Verification must be attached to the commit that contains the runtime hardening and evidence refresh (or a later descendant containing the same code).
