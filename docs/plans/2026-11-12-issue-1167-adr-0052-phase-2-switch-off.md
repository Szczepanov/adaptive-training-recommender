# Issue #1167: ADR-0052 Phase 2, switch off the engine's recommendation surfaces

- **Status:** In progress. OQ1–OQ6 answered by the owner (2026-11-12). P2-1 (#1241), P2-2 (#1247), P2-3 (#1251), P2-4 (#1246), P2-5 (#1248), P2-6 (#1249), and P2-7 (#1250) are **Implemented** on `main`. Only the default flip (**P2-8**) remains, waiting on device acceptance.
- **Blocked by:** Device acceptance of #897, #895, #725–#729 for the **flip** (P2-8) only.
- **Gates met:** Phase 1 (#1144, closed 2026-11-08); D-EXPORT v1 shipped and contract-tested (#1145); D-EVAL criteria merged (#1149, #1150); D-EVAL §5 ledger inputs (#1151, #1152, #1153, #1154).
- **Decision source:** [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md) (D-AUTHORITY, D-TRAVEL, D-FLAGS, D-ENGINE Phase 2, D-CI, D-EXPORT), [D-EVAL criteria](../analysis/2026-10-25-adr-0052-d-eval-criteria.md), [#1145 plan](./2026-10-25-issue-1145-ledger-export-v1.md) (OD4, OD5), [ADR-0053](../adr/0053-firestore-rules-scope.md) (rules stay through Phase 2).
- **Tier:** Opus for every PR, with owner review. Not suitable for a cheaper model end to end (#1167).

## Goal

By default, the app shows and runs today's imported session **as authored**, with D-FLAGS
next to it, and records what happened. It does not show engine recommendations. A
default-off profile setting brings back today's engine behaviour as a rollback. While that
setting is off:
- the engine is not evaluated for Home, Plan or the week-ahead strip;
- nothing writes `daily_recommendations`.

Engine code, knowledge claims and simulations stay in the tree until Phase 3.

## Key design choice: build behind the setting, flip last

Phase 2 is a single user-visible change, but it is too large to land as one PR. Proposal:
1. P2-1 adds the setting with its **effective default set to "engine on"**. Every
   ledger-mode surface renders only when the setting resolves to "engine off".
2. P2-2…P2-7 build and test ledger mode behind that setting. Default behaviour does not
   change, so these PRs do not need device acceptance (OQ1).
3. P2-8 flips the effective default to "engine off". It also does everything ADR-0052 ties
   to the switch: the CI gates go advisory, the ADRs are marked superseded, and `CLAUDE.md`
   and `AGENTS.md` change. Only P2-8 waits for device acceptance.

This keeps D-EVAL clean, because the qualifying block can only start after P2-8. It also
gives every PR a working rollback.

## Current engine surfaces (verified 2026-11-12 against `f5c47ffa`)

| Surface | Engine use today | Ledger mode (setting off) |
|---|---|---|
| `components/Home.tsx` | `evaluateSameDayRecommendation` (verdict, persisted via `recommendationService.saveRecommendation`), `evaluateReadinessAndSafetyEnvelope` (authored replacements), `evaluateNextDayPlanWithIntent`, `adjustSessionRecommendation`, `generateWeekAheadPlanWithIntent`, audit replay | None of these run |
| `components/MorningDecisionCard.tsx` + `ExternalVerdictBanner` + `morningLaunchDecision.ts` | Renders the engine decision and the external verdict (proceed/scale/defer/skip) and gates launch | Not rendered; replaced by the ledger Today card (P2-2) |
| `session/TodayImportedSessionsCard.tsx` | Launch only when `verdictsBySessionId[id] === 'proceed'` and `canGenerateNormalPlan` | Launch as authored; a reduced definition only on explicit athlete choice |
| `Home.tsx` reduced definition | `useReducedDefinition = verdict?.decision === 'scale'` | Never selected from readiness (D-AUTHORITY) |
| `components/PlanView.tsx` | `imported` tab (default) plus `ai_forecast` tab (`evaluateTrainingWithIntent`, planner) and `PlanAuthorityBanner` | `imported` only; no forecast tab or authority banner |
| `components/WeekAheadStrip.tsx` | Imported placements when `externalPlan` is set; otherwise the engine `WeekAheadPlan` | Imported placements only; with no active plan, an empty state that links to import |
| `daily_recommendations` writers | `recommendationService.saveRecommendation` / `saveNotApplicableContext` (Home), `manualRecommendationReplacementService.replaceRecommendationOccurrence` (`SessionDestinationSheet`), `recordAdherence` (`AdherencePrompt`) | No writes (P2-5) |
| `daily_recommendations` readers | `services/contextBriefService`, `services/shadowLogService`, `services/blockReviewService`, `training-occurrence/historyShadowService`, `training-occurrence/performedTrainingFactsService`, `engine/firestoreTrainingHistory`, `DataView` (`getAdherenceStats`) | They must treat a missing day as "no engine record", never as an error or a rest day (P2-5) |
| Travel | `engine/planningOverlays.ts` `applyPlanningOverlays`, called only inside `rules.ts`, `planner.ts`, `trainingIntent.ts` | Not applied, because the engine does not run; the prompt changes (P2-6) |
| Export | `ledgerExportService` → `buildLedgerExport`; `ENGINE_OPINION_KEYS` only inside the opt-in `legacyEngine` layer (OD4). The Markdown Context Brief (`contextBriefService`, `briefPlanAuthority`, `contextBriefPlanningHandoff`) still carries engine opinions | The Markdown brief renders from `LedgerExport` (OD5) |
| D-FLAGS | Captured per date (`services/flagEvaluationPersistence.ts`) and exported, but **not rendered anywhere in the UI** | Shown next to today's session and on the launch screen (P2-3) |

Unchanged (ADR-0052 neutral consequences): ingestion, the session runner, diary,
occurrences (ADR-0023/0034), assessments (ADR-0046), and `activeExternalPlanService.ts`. The
last of these uses engine types only, and places sessions through
`externalPlacement`/`intradayBundlePlacement`.

## Work items

Each PR keeps I1–I6. P2-1…P2-7 must not change default behaviour. Prove that with:
- the existing E2E suite, unchanged;
- a `simulate:diff` with no recommendation change.

| PR | Status | Scope | Done when |
|---|---|---|---|
| **P2-1** Setting | **Implemented** (#1241) | `UserPreferences.engineRecommendationsEnabled?: boolean`, following the `shadowModeEnabled` pattern (`ledger/models.ts`, `preferencesService.ts`, `engine/validationCore.ts` pass-through). A pure `resolvePlanningAuthorityMode(preferences)` returns `'engine' \| 'ledger'`; an unset value resolves to `'engine'` until P2-8. The preferences rules already accept any key (ADR-0053: the type is owned by `validatePreferences`). `preferencesService` never writes a default, so the P2-8 flip reaches every account without an explicit choice. **No toggle UI in P2-1:** a working "engine off" switch before ledger mode exists would leave Home empty. The toggle ships with P2-8 (OQ5). | Unit tests for the resolver, validation and no-default writes; a rules emulator test; no UI change |
| **P2-2** Ledger Today card | **Implemented** (#1247) | A new `LedgerTodayCard` for Home in ledger mode. It shows today's imported sessions from `activeExternalPlanService`, with authored dose and placement, and has **Start** (authored) and, when `scaling.reducedDefinition` exists, **Start reduced version** (`executedDefinition: 'reduced'`, #1152). There is no verdict, no `canGenerateNormalPlan` gate and no engine call. Without today's check-in, the card shows a "Check in first" prompt next to Start but does not block it (OQ3). A red flag can only pause a launch once a check-in records it (OQ2). A rest day or no plan gets an honest empty state ("Rest day in your plan" / "No imported plan — import one"). In ledger mode Home skips every engine evaluation and the morning card. | Component tests; E2E: a v6 session with `reducedDefinition` launches the authored definition by default, and the reduced one only on explicit choice; the execution records which ran |
| **P2-3** Flags display | **Implemented** (#1251) | `FlagStrip`, a read-only list of today's captured D-FLAGS (state, rule text, inputs, missingness). It shows `illness_anomaly` as not yet supported (HA7 withheld). It appears on `LedgerTodayCard` and on the session launch screen, with the session-scoped `injury_constraint_touches_session` for the session being launched. Flags never block or re-dose (D-FLAGS). **Red-flag pause (OQ2, ADR-0052 amendment 2026-11-12):** move `engine/adapters.ts` `resolveRedFlagFindings` to `derived/` as a drift-checked relocation; while a red flag is recorded for the date, `LedgerTodayCard` and the launch screen offer no Start and show the clinical-evaluation message. | Component tests per flag state; E2E: an active injury flag is visible at launch and the session still starts as authored |
| **P2-4** Plan and week ahead | **Implemented** (#1246) | In ledger mode, `PlanView` hides the `ai_forecast` tab and `PlanAuthorityBanner`, and `WeekAheadStrip` renders only imported placements, or an empty state. The engine path stays as it is in engine mode. | Component tests; visual fixtures at mobile and desktop widths for both modes |
| **P2-5** Stop engine writes and harden readers | **Implemented** (#1248) | In ledger mode: no `saveRecommendation` / `saveNotApplicableContext`; `SessionDestinationSheet` replaces nothing in `daily_recommendations`; `AdherencePrompt` is not shown, because adherence comes from occurrences. Every reader listed above handles a missing day explicitly. Firestore write rules stay, for rollback (ADR-0053). | Unit tests per reader for "no record"; an emulator test that a ledger-mode day writes no `daily_recommendations` doc |
| **P2-6** Export, brief and D-TRAVEL prompt | **Implemented** (#1249) | The Markdown brief renders from `LedgerExport` (OD5); engine-opinion sections appear only in the opt-in `legacyEngine` layer (OD4). `ExternalPlanImport.tsx` `AI_PROMPT_TEMPLATE` gets a ledger-mode variant: "plan around `userContext.travel` and `venueRestrictions`" instead of "plan as if every day is available" (OQ4). Travel and venue facts are already exported (`schema.ts` `TRAVEL_FIELDS`, `VENUE_RESTRICTION_FIELDS`). | Contract tests: no engine-derived field outside `legacyEngine`; the brief is deterministic; the prompt variant follows the mode |
| **P2-7** v6 round-trip E2E | **Implemented** (#1250) | Export → import an `external-plan@6` plan with `scaling.reducedDefinition` → execute offline → re-export shows the performed occurrence and `executedDefinition`. Keep a v5 compatibility fixture. Extends V10 in `external-coach-round-trip.pw.ts`, which today covers export and execution but not re-import and re-export. | The spec passes in CI in ledger mode (set explicitly) |
| **P2-8** Flip (**after device acceptance**) | **Pending device acceptance** | The resolver's unset default becomes `'ledger'`, and the settings toggle ships in `StyleSections.tsx` under "Advanced: legacy engine recommendations" (OQ5). Until then, ledger-mode E2E and visual fixtures set `engineRecommendationsEnabled: false` in seeded preferences. Replace the D-NOTRAVEL test in `engine/externallyPlannedMode.test.ts` with: "an imported session inside a travel block runs as authored, and the block appears in the export". Keep the old assertion for engine mode. The D-CI Phase 2 column takes effect: `engine-simulations`, `simulate:plan-judge` and the persona-judge build go advisory (`continue-on-error`); `check-policy-drift.mjs` stays; coverage items for switched-off modules are marked retired. Mark ADR-0007, ADR-0012 and ADR-0017 **Superseded by ADR-0052**. `CLAUDE.md` and `AGENTS.md`: I4 narrows to flags and derived metrics, and the default-mode description changes. Update `docs/architecture/recommendation-engine.md` and `user-flows.md`, and the status board. | `make verify`; full E2E; visual fixtures refreshed; owner review |

### Ordering

```text
P2-1 ──> P2-2 ──> P2-3
   │        └────> P2-7 (needs the ledger launch path)
   ├────> P2-4
   ├────> P2-5
   └────> P2-6
P2-2…P2-7 + device acceptance ──> P2-8 ──> qualifying D-EVAL block (≥ 4 weeks, setting off)
```

After P2-1 lands, P2-4, P2-5 and P2-6 touch disjoint files and can run in parallel.

## Owner questions

- **OQ1. Build before acceptance.** **Answered yes (owner, 2026-11-12).** P2-1…P2-7 land
  before device acceptance; the default stays "engine on" until P2-8.
- **OQ2. Red-flag symptoms in ledger mode.** **Answered: keep the pause (owner,
  2026-11-12).** Recorded as an ADR-0052 D-FLAGS amendment in this PR. It applies only to
  red-flag findings; the four flags stay advisory.
- **OQ3. Check-in before launch.** **Answered: no gate, just prompt (owner, 2026-11-12).**
  Ledger mode does not apply engine mode's minimum safety check-in
  (`canGenerateNormalRecommendation`). It shows a "Check in first" prompt and still allows
  Start, so the ledger records what was done.
- **OQ4. Prompt in rollback mode.** **Answered (owner, 2026-11-12): yes.** The prompt text follows `resolvePlanningAuthorityMode`. Engine mode keeps "plan as if every day is available", because the engine still applies travel there; ledger mode uses "plan around `userContext.travel` and `venueRestrictions`", avoiding a double travel reduction when the setting is turned back on.
- **OQ5. Where the setting lives.** **Answered (owner, 2026-11-12): yes.** Preferences → Advanced ("Advanced: legacy engine recommendations"). Its label states that turning it on during a D-EVAL block ends the block (criteria §1, C4).
- **OQ6. Silent engine runs.** **Answered (owner, 2026-11-12): yes.** None in ledger mode — no shadow evaluation and no decision journal entries, because the D-EVAL block requires adjudication off, and a hidden run would still cost reads.

## Risks

- **Readers treating "no recommendation" as rest or error.** Mitigation: P2-5 lands before
  P2-8, with a per-reader test.
- **Double travel reduction on rollback.** Mitigation: OQ4.
- **Rules size.** Phase 2 adds no rules beyond one boolean preference. Headroom is 21.06%
  (#1202, 2026-11-12). The `06-recommendations` read-only trim stays a Phase 3 item.
- **Visual drift.** Engine-mode fixtures must stay byte-identical through P2-7. Ledger-mode
  fixtures are new.

## Rollback

Turning the setting on restores today's behaviour for that user, including
`daily_recommendations` writes. Reverting P2-8 restores the default. Nothing is deleted or
migrated in Phase 2.
