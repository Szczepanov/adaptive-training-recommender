# Cycling-primary hybrid evaluation and recommendation improvements

**Status:** In progress — H1 deterministic evaluation delivered; recommendation-policy changes remain planned
**Blocked by:** No blocker for H2 investigation. Personal M00/M01 prescription requires current workload/restriction confirmation; intraday/progression changes require the relevant authority/schema decisions.
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
It receives authored taper and training-settings facts in the targeted packets, not hidden
optimizer scores. `deterministic-results.json` is a separate developer artifact; its
modeled cost/stimulus and objective diagnostics are not used as an answer key.

This harness chains seven-day forecasts with synthetic completion. It is not a day-by-day
prospective athlete trial, an AM/PM execution simulator, a nutrition model, or evidence
that any intervention improves health/performance. Passing hard constraints is necessary
but not sufficient for a good program.

### Reproduced findings

1. **Outdoor-only cycling gap.** The targeted outdoor-only case selected no Cycling
   across 14 forecast days despite outdoor bicycle access and the cycling-first identity.
   The reference selected Cycling. The output substituted Walking while resolving generic
   aerobic objectives. `templates.ts` `end_easy_01` requires `indoor_bike`; inspected outdoor
   cycling candidates require a focus event. This is a goal-specificity/catalog eligibility
   gap reproduced in the planner, not an equipment-safety violation. H2 owns the fix.
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

No live recommendation policy was changed to make these results look better. No AI-judge
score or baseline improvement is claimed; this delivery ran deterministic evaluation.

## H2 — Outdoor aerobic specificity (next)

**Dependencies:** H1 delivered; read current recommendation architecture, workout-library
contracts and ADR-0004/0017 before implementation.

Trace candidate eligibility and packing with the outdoor-only case, then provide an
honest, non-event-gated outdoor aerobic implementation through existing catalog/coverage
boundaries. Do not remove the indoor equipment gate or treat an airbike as a bicycle.

Acceptance: safe outdoor cycling is reachable without a race; unavailable indoor/cable
equipment remains excluded; no bicycle access does not fabricate cycling; the general
health substitution path remains usable. Validate authored dose, exact role identity,
both selection paths, workout catalog, replay/policy drift and relevant scenarios.

## H3 — Executable block, deliberate rest and substitutions

**Dependencies:** Reviewed near-term block; ADR-0019/0023 and existing import/occurrence
contracts. A user-specific load/impact prescription requires current-state confirmation.

Express M00/M01 as one exact default week plus costed optional sessions. Import only the
near-term reviewed block. Exercise planned rest versus an unplanned date, replacing
quality with a hard group ride/race, skipped work without catch-up debt, and full/reduced
versions with consistent minutes. Use existing external-plan and source-neutral schemas.

Acceptance: explicit rest cannot accidentally become evergreen discretionary training;
session authority and revisions remain replayable; a missed workout does not silently
stack with the next quality session. Add authored-plan contract tests first. These are not
covered by an evergreen persona prose change.

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
npm run persona:hybrid:build
npm run build
```

The full frontend check/build passed, including 3,393 tests at that point; subsequent
fixture-only refinements passed all 27 tests across the hybrid and active-persona suites,
and the final corpus was regenerated (37 cases / 11 families). Existing knowledge
coverage warnings remain; they are not new physiological validation results.

For optional local judging, use the `--hybrid-expansion` runner flag documented in
`app/scripts/ai-judge/README.md`. Review actual cases behind every complaint before
promoting any new active cases. Existing baseline update/diff commands intentionally
remain scoped to the unchanged active suite.

No engine behavior change means no `POLICY_VERSION` bump in H1. H2–H5 require the normal
policy/schema/replay review when decision behavior changes. Do not enable experimental
personalization simply to improve a judge score.
