# Implementation Plan: #927 Long-horizon event-directed development authority

**Status:** In progress
**Blocked by:** None; #925 and #928 landed on the starting `origin/main`.
**Unlocks:** #929 season-roadmap coordination.
**Execution:** One implementation subagent, followed by independent diff review and repository verification. The user explicitly requested implementation after planning.

## Goal and acceptance

A distant cycling A event can own current adaptation intent through an explicitly authored, date-local development block before the final structured event build. The current block feeds evidence, dose, capacity and exact role packing; periodization phase names remain event-relative context. A missing, conflicting, stale or unsupported development block falls back safely to Evergreen with diagnostics.

Success covers all issue #927 acceptance criteria: distinguish a 300-day target from an eventless athlete when a development block exists; support VO2 and productive-volume blocks while generic context says Base; support authored strength/power/physical-capital intent; prevent future-block authority; hand off without duplicate objectives/coverage; revalidate on changed evidence/context; expose goal and executable authority in replay, trace and Context Brief; simulate multiple development blocks 250–350 days before an event.

## Scope and findings

- Reuse `IntentBlock`, `BlockObjectiveDefinition`, their validation/replay contracts and revisioned `IntentBlockService` storage. Current Home reads blocks only to derive confirmed duration overrides; block dose intent does not yet own programming.
- `resolvePlanningContext` owns date-local authority; `resolveEvergreenPlan` already implements evidence → dose → capacity → exact packing. `createForecastAuthorityResolver` segments ownership and must recognize individual development-block identities.
- Reuse `eventHorizonPolicy.ts` rather than encoding D-84. Active structured event/travel/taper/recovery authority takes precedence over development. Existing externally planned selection remains unchanged.
- Preserve athlete profile commitment, knowledge lineage, Warsaw dates, injected IO, downstream safety and exact identity credit. No new planning mode, long calendar, new dependency, automatic clinical clearance or inferred physiological success.
- ADR-0037 requires explicit intent and supported mappings; ADR-0017 governs dose/capacity; ADR-0016 separates adaptation from exact coverage; ADR-0010 governs deterministic replay.

## Ordered implementation

1. **Bind authored intent to an event and retain evidence.** Add a backward-compatible optional event binding to the existing block contract, with boundary validation and canonical semantic hashing. Preserve legacy block hashes when the optional binding is absent. Carry typed development inputs through existing engine options/composition rather than introduce a parallel service. Capture event demand, capabilities/testing evidence, recent completed exposure with its quality/tolerance limitations, capacity, review checkpoint, supporting events/travel and block role purpose. BUILD/MAINTAIN/MICRODOSE are explicit authored purpose/dose semantics; do not infer them from profile priority or phase labels. Use existing `develop`/`maintain` and authored dose envelopes where sufficient.
2. **Resolve one date-local authority.** Extend `planningMode.ts` `PlanningContext` with development authority and diagnostics. Select exactly one validated event-bound active block. Evaluate entry prerequisites, review expiry and changed event/evidence/context conservatively; ambiguity fails closed. Structured final build and overlays take precedence. A next block can be metadata only; no future block contributes current dose or coverage. No active safe block retains existing fallback.
3. **Apply intent before packing.** In `evergreenStrategy.ts` / `evergreenPlanning.ts`, map supported active objectives into existing adaptation-dose requirements and exact descriptor roles before `packWeeklyDose`. VO2 restricts exact quality candidates/objective identity to VO2; productive-volume intent suppresses the conflicting generic hard-session prior. Preserve health floors, actual capacity and explicit shortfalls. Respect authored bounds and existing adverse-recovery/power/mechanical restrictions. Unsupported units/roles/knowledge mappings produce diagnostics and safe fallback, never guessed conversions. Event demand and measured/inferred gaps must be consumed and explained without manufacturing exact coverage from demand.
4. **Integrate same-day and forecasts.** Thread blocks through `trainingIntent.ts`, `rules.ts`, `sameDayRecommendation.ts`, `planner.ts` and `forecastAuthority.ts`, and existing Home/service composition. Reuse stored blocks with a bounded date-range read for today/tomorrow/forecast where needed. Different block revisions and development-to-structured handoffs create distinct ownership segments, bound packing to active dates and never duplicate coverage. IO stays at existing composition boundaries.
5. **Preserve replay and explanation.** Pin all behavior-affecting development inputs in existing decision provenance/replay paths; never reload mutable latest blocks during replay. Extend decision trace and `contextBrief.ts`/service export to explain the long-horizon target, active purpose, event/gap rationale, review reasons and executable dates. Keep next/future context non-executable. Update relevant versioned contracts only where required and retain legacy readers.
6. **Evidence and documentation.** Add regressions first, then the smallest implementation that passes. Bump `POLICY_VERSION`; register any new decision-authority mapping/product policy in knowledge coverage/registry with alignment tests. Update living recommendation-engine and Context Brief architecture and add an ADR amendment/new ADR for the new authority while retaining accepted history. Update this plan/status board to the actual verified delivery state.

## Verification

- Focused unit tests: validation/hash compatibility; date bounds/overlap/future blocks; demand/gap explanation; VO2 vs Base; volume-only quality suppression; strength/power/mechanical support; unsupported/review-due/event-change fallback; safety and capacity shortfalls.
- Boundary/integration tests: current→next development blocks, changed event horizon, development→structured final build, travel/taper/recovery, same-day/forecast parity, exact coverage identity and no duplication.
- Replay and Context Brief tests: pinned deterministic inputs, hash changes for event binding and authored dose, legacy records, authority/rationale export.
- Add synthetic multi-block simulation spanning a target initially 250–350 days away and assert progressive intent rather than merely scenario execution. Refresh baseline only after inspecting intentional changes.
- Run affected Vitest tests, `npx tsc -b`, lint/knowledge validators while iterating. Final gate: `make verify`, engine simulations/plan judge and policy-drift checks per the repository contract. If `make` is absent, use its documented Python verification entry point with the same scope.
- Run one diff-first `code-reviewer` after implementation. Parent owns final deterministic verification and classifies failures before repairs.

## Execution checkpoint

Implementation is present in the requested worktree; delivery remains **In progress** while
the parent finishes verification and PR review.

- Added optional event snapshot binding with legacy absent-field hash compatibility and
  manual-v2 authoring through the existing revisioned service.
- Added one active reviewed authority, entry/context revalidation, exact supported mappings,
  bounded packing, distinct forecast/objective identities and existing embedded capability gates.
- Added an exact development-only VO2 template alias because the old hard-bike template
  resolves to over-under work. No new prescription or physiological multipliers were added.
- Home supplies a bounded current/upcoming block read to same-day, tomorrow and forecasts;
  decision capture pins those inputs. Audit and Context Brief v6 expose persisted authority.
- Added focused tests and the eight-week `long_horizon_development_blocks` scenario,
  starting at D-300 and exercising VO2 → volume → strength maintenance before final build.
- `tsc -b`, targeted ESLint, knowledge/coverage/workout validators and focused Vitest checks
  passed during implementation. The final affected-test manifest is in the implementer handoff.

Supported dose mappings are intentionally explicit: cycling VO2/threshold quality;
cycling/cross-training aerobic minutes; strength sessions; and embedded power/mechanical
session counts through their existing evidence gates. Unsupported units, duplicate adaptation
maps, protected imported-session identities and authored substitution rules fail closed with
diagnostics. Comparable physiological gaps, adaptation success and follow-up tolerance are
not inferred from completion. The independent/full gate and generated simulation baseline
review are pending, so this checkpoint is not a delivery declaration.

Independent review identified two authority bugs: quality completion was counted across
the whole block instead of the rolling week, and authored quality could bypass the existing
establishment-evidence gate. Both were repaired with failing-first regressions. Eligibility
now takes the evaluation date explicitly, and the existing athlete-state/evidence gate is
preserved for authored quality. Positive fixtures use established synthetic history.
The parent reran seven affected test files (79 tests passed), `tsc -b`, and `git diff --check`.
The scoped security review found no actionable issues. A fresh canonical gate is running;
the previous run found four now-repaired unit failures and one browser Home-render timeout
(53 of 54 E2E cases passed). Final verification evidence belongs in the PR description.

## Risks and rollback

The main risks are accepting unrelated imported blocks, stale event associations, hashing incompatibility, phase eligibility hiding VO2, widening safety gates, and packing beyond a block boundary. Explicit binding/source checks, legacy hash tests, fail-closed review diagnostics and boundary simulations address them. Rollback removes the new optional authority path and restores Evergreen fallback; no data migration or destructive operation is required.

No season roadmap, fixed daily calendar, new block editor or automatic outcome-driven progression is included. Existing authoring/service boundaries remain usable; unsupported adaptation mappings must be stated precisely rather than silently accepted.
