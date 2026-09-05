# Cycling-primary hybrid evaluation and recommendation improvements

**Status:** In progress — H1, H2, H2b, H3 and H3-rest (ADR-0035) all delivered; H4-H5 remain planned
**Blocked by:** Personal M00/M01 prescription requires current workload/restriction confirmation; H4/H5 need their own recorded authority/schema decisions before implementation.
**Unlocks:** Reproducible acceptance cases for equipment specificity, block authority and hybrid plan quality.

## Decision

For implementation, start with the bounded work orders and ready-to-use task prompt in
[the implementation handoff](./cycling-primary-hybrid-implementation-handoff.md).
This document remains the status and evidence record.

Reuse the existing `cycling_primary_hybrid_advanced` persona. Add scenarios that exercise
distinct decisions and group them into focused judge families. Retain the existing seven
judge dimensions rather than adding a subjective "hybrid quality" score.

The athlete identity has a cycling performance priority, strength/muscle retention and
long-term sustainable activity. Sporting history does not override current tissue,
recovery, equipment or time constraints. Public fixtures are synthetic: no real identity,
medical timeline, measurements or actual event date is committed.

## H1 — Delivered coverage

`personaSuite.mjs` already contained five evergreen hybrid cases covering normal/adverse
recovery, local tissue conflict despite favorable wearables, today's strength preference,
and a short time window. These remain unchanged in the active 9-family/30-case suite.

`hybridScenarioFamilies.mjs` adds two opt-in families with seven cases, all using the same
persona identity and a matched synthetic 28-day history: 16 cycling exposures at 80 minutes
and eight strength exposures at 50 minutes, totaling 1,680 minutes (seven hours/week).
The history is identical across perturbations; available time and current capacity are
different inputs. The existing active history is not silently rewritten.

| Family | Cases | Decision under examination |
|---|---|---|
| `persona_hybrid_capacity_equipment` | Reference; 180-minute availability; 90-minute weekdays/20-minute weekend stress; outdoor bicycle without indoor bike | Does the plan respect actual windows/access while retaining useful cycling and strength? Does extra time invent additional capacity? |
| `persona_hybrid_event_lifecycle` | A-event build; same build/adverse recovery; explicitly authored 14-day taper | Does the same athlete enter the real structured cycling path, preserve supporting strength, tighten for recovery and honor the taper boundary? |

The 20-minute weekend is a deliberately binding stress perturbation, not a statement of
the athlete's normal weekend availability. The event and dates are synthetic. Race day is
outside the simulated taper horizon, so race participation is not being adjudicated here.

The opt-in command includes existing controls: **11 families / 37 cases**. It writes to a
separate gitignored directory so exploration cannot overwrite reviewed active-suite
artifacts or promote an unjudged baseline.

### Deterministic evidence versus AI judgment

Deterministic tests enforce fixture identity/history/commitment, branch reachability,
canonical road-race demand, equipment, effective duration caps on actual calendar dates,
binding weekend perturbation, event objectives and taper objective changes. Every new
case runs through `runScenario`, using the real planner.

The judge is responsible for qualitative hierarchy, sequencing and adequacy questions.
Only the seven opt-in H1 packets receive the additional authored-taper and training-settings
facts needed to judge those contracts; the existing 30 control packets retain the reviewed
active-suite judge-visible shape. Hidden optimizer scores remain excluded.
`deterministic-results.json` is a separate developer artifact; its modeled cost/stimulus
and objective diagnostics are not used as an answer key.

Repeated H1 judge samples cyclically rotate case presentation order. The strict response
schema is generated from that same per-sample order (including the ordered `prefixItems`
used by the local/Ollama adapter), then validation normalizes results back to canonical
case IDs before aggregation. This is a judge-reliability safeguard; it does not change
deterministic planner output.

This harness chains seven-day forecasts with synthetic completion. It is not a day-by-day
prospective athlete trial, an AM/PM execution simulator, a nutrition model, or evidence
that any intervention improves health/performance. Passing hard constraints is necessary
but not sufficient for a good program.

### Reproduced findings

1. **Outdoor-only cycling gap — fixed in H2.** The targeted outdoor-only case selected no
   Cycling across 14 forecast days despite outdoor bicycle access and the cycling-first
   identity, substituting Walking while resolving generic aerobic objectives. `end_easy_04`
   closes that catalogue/equipment gap without weakening indoor-bike or no-bike gates.
2. **More time does not alone escalate this fixture.** Reference and extra-time cases
   produced the same session choices/duration ranges in the recorded run. This is bounded
   evidence for one input family, not proof of general monotonicity or adequate training dose.
3. **Event build requires closer credit inspection.** The build report generated
   `race_specific_endurance` but reported zero fully resolved weeks of two. An unresolved
   fractional objective is not proof of zero event-specific sessions. Inspect delivered
   dose, exact coverage and typed allocation outcomes before changing any thresholds.
4. **Taper authority is reachable; taper efficacy is unproven.** The authored taper drops
   build threshold objectives. Aggregate duration ranges are not necessarily lower than
   this build fixture. There is no fixed historical pre-taper prescription here against
   which to validate a percentage reduction. H3 needs explicit authored-plan comparisons.
5. **Restricted time exposes a substitution question.** The binding weekend case can
   select short Field work. No impact restriction is present in that case, so this is not
   evidence of violating an injury gate. Judge its relevance to the cycling-first goal;
   separately retain the existing local-tissue case as the safety contract.

## H2 — Outdoor aerobic specificity (delivered)

**Dependencies:** H1 delivered; current recommendation architecture, workout-library
contracts and ADR-0004/0017 were reviewed before implementation.

`end_easy_04` (`app/src/engine/templates.ts`) is an Easy Endurance Cycling template
requiring `outdoor_bike` instead of `indoor_bike`, not event-gated. It reuses the existing
`cycling_zone2_standard_01` workout through `app/src/workouts/prescription.ts`: that workout
was already environment-agnostic (`indoor_or_outdoor`, generic `bike` equipment), so the
missing behavior was at the engine-template/equipment layer rather than the detailed
workout catalogue.

Three deterministic hybrid tests cover the outdoor-only positive path, the indoor path,
and a no-bicycle-access negative control. Safe outdoor cycling is now reachable without a
race; unavailable bicycle equipment is not fabricated; the general-health substitution
path remains available.

## H2b — Nominated anchor-date authority (delivered)

Adding a legal cheap outdoor Z2 candidate exposed a pre-existing ordering bug in
`triathlon_novice_eighth_A`: Race-Specific Endurance Cycling dropped from 3 sessions to 0
and event-specific anchor misses rose from 1 to 4 across the four-week simulation.

### Root cause

The first hypothesis was that fatigue-cost penalty overwhelmed `ANCHOR_ROLE_BOOST` and
`ANCHOR_TIMING_BENEFIT`. Source-level tracing showed the decisive issue occurred earlier in
the lexicographic ranking path.

`rankCandidates` sorts accepted candidates by `coverageNeedTier` before benefit/utility.
`coverageNeedTierForTemplate` correctly recognized the nominated `event-specific` or
`quality` role, but granted it tier 0 only while that role's **weekly minimum was still
unmet**. If an earlier exposure had already satisfied the weekly minimum, the explicitly
nominated anchor candidate lost date-level authority. A different still-unmet role such as
`aerobic_volume` could then receive a better coverage tier and win before fatigue cost or
anchor boosts were compared.

That behavior contradicted the coverage contract itself: an overdue/different role should
not steal an explicitly nominated hard anchor date. It also conflicts with the cycling
programming intent behind this evaluation, where easy volume supports rather than replaces
the small number of genuine key cycling days.

### Correction

`coverageNeedTierForTemplate` now treats a nominated anchor as a **date-level programming
role**, not merely a mechanism for repairing an unmet weekly minimum. When the active plan
contains the relevant requirement and a legal candidate exactly matches today's nominated
`outdoor_event_specific` or `sustained_quality` coverage key, that candidate retains tier 0
regardless of whether an earlier exposure already met the week's minimum.

This does **not** force unnecessary repeats on unclaimed dates. With `anchorRole === null`,
an already-met race-specific or quality role keeps its ordinary lower coverage tier and an
unmet easy-aerobic minimum can still take precedence. Safety, equipment, time, intensity,
fatigue/recovery and spacing constraints continue to run before coverage ordering.

A focused `coverageAnchorAuthority.test.ts` regression covers both `event-specific` and
`quality` anchors after their weekly minimum has already been met, and verifies the
unclaimed-date control so the fix cannot silently become "always prefer hard work".

`POLICY_VERSION` is now
`2026-09-outdoor-easy-cycling-anchor-authority-v1` because both the new outdoor candidate
and the corrected anchor ordering can change persisted recommendations. The prior
`2026-09-outdoor-easy-cycling-v1` is retained as historical.

### Validation expectation

Use the latest PR-head CI run as the authoritative validation record. In addition to the
focused unit and hybrid tests, run the full deterministic checks and scenario diff. The
specific H2b acceptance requirement is that the outdoor-bike-only triathlon scenario no
longer loses its explicitly nominated race-specific anchors while other scenario changes
remain either unchanged or explicitly explained. Do not regenerate the committed
simulation baseline merely to hide an unexplained diff.

## H3 — Executable block, deliberate rest and substitutions (investigated — no production defect found)

**Dependencies:** Reviewed near-term block; ADR-0019/0023 and existing import/occurrence
contracts. A user-specific load/impact prescription requires current-state confirmation.

### Investigation result

Each acceptance scenario from the implementation handoff was traced against the actual
`main` codebase (commit `a1685ec4`) rather than inferred from the original review prose.
The executable-session contracts are already implemented; this PR adds one focused
regression test where the prior evidence was too indirect:

1. **Genuinely unplanned date vs. externally-planned mode with a placed session.** Already
   distinct and labelled: `resolvePlanningContext` sets `externalFallback: true` only when
   the mode is selected but no session is placed for the date; the day-level evaluator
   labels the resulting catalog pick as a fallback. Covered by existing tests in
   `externallyPlannedMode.test.ts` (`resolves external only when a session is actually
   placed today`, `falls back and flags it when the mode is selected but no session is
   placed`, `still ranks a catalog pick when no session is placed today, and labels that
   fallback`, plus the ignored-mode control).
2. **A missed quality session with a later session already planned.**
   `externalPlacement.ts`'s `proposeReplacement`/`resolvePlacement` excludes occupied dates
   from replacement candidates, is proposal-only (never writes without confirmation), and
   honours each session's own `ifMissed` (`drop` / `reschedule_within_week` /
   `carry_forward`) rather than inventing catch-up debt. `externalPlacement.test.ts`
   includes `does not propose a day another session already holds` directly on point.
3. **An imported hard cycling event contributing enough typed stimulus to resolve a quality
   requirement.** `externalEventAsFixedActivity` derives typed `expectedStimulus` and an
   inferred-confidence external identity. `h3AuthoredPlanContracts.test.ts` exercises that
   adapter plus `applyFixedActivityStimulusCredit` and verifies the resulting projected
   credit resolves a `threshold_quality` objective when projected commitments are included.
   This closes the prior evidence gap in `externalEventFixedActivityCredit.test.ts`, which
   covered aerobic credit and qualification semantics only. The production evaluator in
   `rules.ts` currently performs the same fixed-activity credit step before `rankCandidates`,
   but this focused regression does **not** itself execute catalog ranking; ordering was
   source-reviewed rather than independently integration-tested here. This is also narrower
   than claiming every free-text "hard group ride" is equivalent: a non-event group ride
   must enter the typed `FixedActivity` identity/stimulus path to earn the same objective
   credit.
4. **Full and reduced session forms with correct minutes and immutable revisions.**
   Content-hash immutability (`contentHash` on `ExternalPlanContext`, verified against the
   stored revision) and reduced-dose scaling are exercised across
   `externalSession.test.ts`, `provenance.test.ts`, `replay.test.ts` and
   `externalPlanValidation.test.ts`.

No production decision logic needed changing for these executable-session scenarios.

### Open product question: explicit rest cannot currently be authored at all

The remaining scenario — an **explicitly prescribed rest date**, distinct from an
unplanned one — is a real capability gap, not a resolver defect. Both `external-plan@1`
and `external-plan@2` deliberately say "Rest days are not sessions"; omission is therefore
indistinguishable from "the plan says nothing about this day," which activates the labelled
catalog fallback.

This evaluation no longer uses external-product behavior as architecture evidence. The
rest-vs-unplanned requirement follows from the repository's own authored-instruction-vs-
absence semantics and immutable/versioned import contract; product observations, if
retained elsewhere, are non-normative research only.

**Follow-up architecture decision:** [ADR-0035](../adr/0035-explicit-rest-day-authoring.md)
(Accepted) decides a single compatibility model: protected rest is added only in
`adaptive-training-recommender/external-plan@3`, inheriting v2 session semantics unchanged,
through relative plan-level `restDays` directives (`{ id, week, day }`). v1/v2 remain
immutable and continue rejecting the new field. The ADR also separates plan intent from
readiness: authored rest blocks ordinary fallback/ranking and resolves the default planning
outcome to canonical Rest without fabricating a physiological `recover` verdict. Placement
and missed-session replacement must treat rest dates as blocked, while an explicit athlete
override remains auditable and still passes the normal safety/readiness/availability gates.

This PR intentionally does not implement that schema extension. Personal M00/M01 import
also remains blocked on current-workload/restriction confirmation.

## H4 — Intraday capacity and post-AM reassessment

**Dependencies:** H3; scheduling authority/schema decision for elapsed separation and
multiple windows. Existing external placement already supports preferred double/triple
bundles, and authored additional sessions have remaining-budget handling.

Extend those boundaries rather than creating a new persona planner. Cover AM completion,
PM optionality, updated symptoms, aggregate daily time/load, bundle moves, and one-time
counting of canonical performed work. Add a separate execution family when the harness
can represent these facts; do not claim current one-session forecasts validate doubles.

## H5 — Explicit develop/maintain intent and progression

**Dependencies:** H3 plus plan/observation/outcome authority design; reuse ADR-0017/0023/0033.

Model block-level development versus maintenance and bounded progression choices. Track
one main experimental change at a time. Current experience, recent tolerated exposure,
available time and future ambition remain distinct. Missing response evidence does not
justify automatic progression; favorable wearables do not clear standing restrictions.

Acceptance: actual completed/tolerated work supports progression, tests consume training
budget, regress/hold options exist, and any learned refinement preserves safety
monotonicity. Outcome reports must distinguish observations from causal conclusions.

## Reproduction and verification

From `app/`:

```bash
npm exec vitest run scripts/ai-judge/__tests__/hybridScenarios.test.mjs
npm exec vitest run src/engine/coverageAnchorAuthority.test.ts
npm exec vitest run src/engine/h3AuthoredPlanContracts.test.ts
npm run persona:hybrid:build
npm run check
npm run build
npm run simulate:scenarios
npm run simulate:diff
node scripts/check-policy-drift.mjs <starting-commit>
```

Use the latest PR-head CI run as the authoritative full validation rather than copying a
stale test-count snapshot into this document. The focused hybrid regression suite, full
frontend checks, deterministic corpus gates, Firestore rules, simulation bounds, bundle
build and dependency audits should remain green before merge. The opt-in corpus remains
**37 cases / 11 families**; the default active suite remains **30 cases / 9 families**.
Existing knowledge coverage warnings, if any, are not new physiological validation results.

For optional local judging, use the `--hybrid-expansion` runner flag documented in
`app/scripts/ai-judge/README.md`. Review actual cases behind every complaint before
promoting any new active cases. Existing baseline update/diff commands intentionally
remain scoped to the unchanged active suite.

H1 did not change engine behavior and therefore required no policy bump. H2/H2b are
decision-affecting and are represented by the current policy version above. H3's new test
is non-decision-affecting and needs no bump; the explicit-rest follow-up will require the
normal policy/schema/replay review when it changes decision behavior. H4-H5 likewise
require the normal review when decision behavior changes. Do not enable experimental
personalization simply to improve a judge score.
