# H4: external-plan execution-binding pipeline — analysis and PR-1 handoff

**Status:** Analysis only. No code changes in this doc's commit. Written for another
agent (or a future session) to implement against.
**Tracks:** [GitHub issue #434](https://github.com/Szczepanov/adaptive-training-recommender/issues/434).
**Discovered by:** investigation while wiring ADR-0036 (H4) D-PLACEMENT into the decision
path ([PR #432](https://github.com/Szczepanov/adaptive-training-recommender/pull/432)).

## Root cause

`SessionSourceRef`'s `kind: 'external_plan'` variant is declared in `app/src/sessions/models.ts`
but is **never actually constructed anywhere in the codebase** — not for a v4 intraday
bundle's second member (the original H4 ask), and not even for today's single primary
external-plan session. External-plan sessions (`external-plan@1..4`) have never been
wired into the newer multidomain execution pipeline:

```text
SessionReferenceBinding -> sessionOccurrenceService -> executionPrescriptionService -> SessionRunner
```

Instead, an external-plan session's primary-session path
(`adjudicatedExternalRecommendation` in `app/src/engine/rules.ts`) produces
`externalPrescription`/`externalVerdict`/`decisionTrace.externalPlan` — a parallel,
older, **text-display-only** contract. `Recommendation.primarySession` (the
`SessionReferenceBinding` field `SessionRunner` actually consumes to start a structured
session) is left `undefined` for every external-plan recommendation today. This is why
building "the same launch flow a manual/catalog session already has" for an external-plan
session is a real, non-trivial gap, not a small wiring tweak.

## Current state, verified against code

### The three existing `SessionSourceRef` kinds and how each is built

| kind | Built by | Occurrence record? | Notes |
|---|---|---|---|
| `catalog` | `prepareCatalogSessionLaunch` (`sessionAuthoringService.ts`) | No | Identity is `(workoutId, catalogVersion)`; today's recommendation already made the selection decision (D-MAUTH), so no separate occurrence doc is needed. |
| `manual` | `prepareUnplannedSessionLaunch` / `prepareAuthoredOccurrenceLaunch` | Yes, in `session_occurrences` | The occurrence record is created *earlier*, when the athlete authors the session via `ManualSessionBuilder`; launch only freezes the execution-prescription snapshot for it. |
| `unplanned_fixture` | *(not investigated further; out of scope for this doc)* | — | — |

Every one of these ends in the same shape, `PreparedSessionLaunch = { definition:
SessionDefinition, binding: SessionReferenceBinding }`, which `SessionRunner.tsx` requires
verbatim (`runner.startSession(launch.definition, launch.binding.sessionSource, {
occurrenceId: launch.binding.occurrenceId, prescriptionHash: launch.binding.prescriptionHash
})`, confirmed at `SessionRunner.tsx:331,353,447`). There is no code path that starts a
session without going through this `PreparedSessionLaunch` shape.

### Why v4 is the targeted scope for PR 1

- `ExternalPlanSessionV4.definition: SessionDefinition` (`sessions/externalPlanV4.ts:62`)
  is the **exact same structured type** `SessionRunner` already consumes for manual/catalog
  sessions.
- `validateExternalSessionV2` (which v4 reuses unchanged for its `definition`-based content,
  per that file's own header comment) already calls `validateSessionDefinition(raw.definition)`
  at import time (`externalPlanV2.ts:105`). **A v4 session's `definition` is therefore
  already guaranteed to pass `validateSessionDefinition` before it ever reaches launch
  code** — the same gate `prepareUnplannedSessionLaunch`/`prepareAuthoredOccurrenceLaunch`
  re-run defensively. This removes what looked like a risk (re-validating untrusted-shaped
  imported JSON at launch time) — it's already been checked once, and defense-in-depth
  re-validation at launch is cheap and consistent with the existing manual/catalog paths.
- Note on older schemas: `external-plan@1` carries only free-text `prescription: { summary: string }`.
  `external-plan@2` (M3.6) and `external-plan@3` (ADR-0035) introduced and retained structured
  `definition: SessionDefinition` (and `sessionDefinitionResolver.ts:245-247` already resolves
  v2, v3, and v4 identically via `isV2Session`). However, intraday bundles are a v4-only capability
  (`intraday` is declared only on `ExternalPlanSessionV4`). **Scoping this initial pipeline to
  v4 keeps PR 1 strictly bounded to proving out the execution binding alongside H4 D-PLACEMENT
  bundle resolution**, without risking regressions on legacy plans. Broader enablement across v2/v3
  can follow trivially once v4 is validated.

### What's missing, concretely

1. **No `prepareExternalPlanSessionLaunch`-equivalent function.** Nothing builds
   `{ sessionSource: { kind: 'external_plan', planId, revision, sessionId, contentHash },
   prescriptionHash, occurrenceId? }` from a v4 `ExternalPlanContext`
   (`activeExternalPlanService.ts`'s existing output shape already has every field this
   needs except a way to freeze the prescription).
2. **`OccurrenceAuthority` has no `'external_plan'` member** (`sessions/models.ts:215-219`:
   `'unplanned_log' | 'schedule' | 'replace_recommendation' | 'additional_session'`), and
   `SessionOccurrence.definitionRef` (`{ definitionId, revision, contentHash }`,
   `sessions/models.ts:234-238`) has no field for `planId`/`sessionId`/bundle membership.
   Extending this schema (plus its Firestore rules validation) is real, separate work --
   **not required for a first slice**, because (mirroring the `catalog` precedent above) an
   external-plan session's identity is already fully determined by
   `(planId, revision, sessionId, date)` without needing a separate occurrence document.
   An occurrence record only becomes necessary once something needs to track *execution
   state* independently of the plan/date (D-REASSESS's "has the predecessor actually
   completed" check, and multi-occurrence bundle launches where more than one external
   session can be active on one date) -- see "Future PRs" below.
3. **`rules.ts`'s `adjudicatedExternalRecommendation` never populates `primarySession`.**
   Wiring in the new launch function means deciding whether this happens inside
   `rules.ts` (making the binding itself part of the pure decision function — awkward,
   since binding creation is `async`/has Firestore side effects, and `rules.ts` is
   otherwise synchronous/pure) or in the caller (`Home.tsx`, mirroring exactly how
   `prepareCatalogSessionLaunch`/`prepareAuthoredOccurrenceLaunch` are already called
   *after* `evaluateTrainingWithIntent` returns, at lines ~433-471 of `Home.tsx` in the
   current tree). **The caller-side pattern is almost certainly correct** — it's the
   existing precedent for every other session kind, and keeps `rules.ts` pure.

## Design options considered

### Option A — Prescription-only, no occurrence record (recommended for PR 1)

Mirror the `catalog` path exactly: freeze a content-addressed `ExecutionPrescription`
with `sessionSource: { kind: 'external_plan', ... }`, no `session_occurrences` write, no
`OccurrenceAuthority`/`definitionRef` schema change. `primarySession` gets populated for a
v4 recommendation the same way it already does for catalog/manual ones. This alone makes
a v4 external-plan session **launchable through `SessionRunner`** and replayable through
the same prescription-hash boundary everything else uses — a large, real capability gap
closed — without touching occurrence schema at all.

**Tradeoff:** does not yet give D-REASSESS a way to check "has the predecessor bundle
member's occurrence actually completed" (there's no occurrence record to query), and does
not yet let a bundle's second member become an independently-tracked `additionalSessions`
entry with its own lifecycle state (`scheduled` → `active` → `completed`). Both of those
need real occurrence tracking — deliberately deferred to a follow-up PR (see below), not
because they don't matter, but because they're separable and this slice is valuable on
its own.

### Option B — Full occurrence tracking now

Extend `OccurrenceAuthority` with `'external_plan'`, extend or replace
`SessionOccurrence.definitionRef` to carry plan/session identity (or add a parallel
`externalPlanRef` field alongside it), and build real occurrence records for v4
external-plan sessions from the start. Bigger and riskier as a first PR: touches
`sessions/models.ts` (a widely-imported shared type), `firestore.rules`' `session_occurrences`
validation, and `sessionOccurrenceService.ts`'s query/write surface, all before proving
out the simpler prescription-only path even works end-to-end through `SessionRunner`.

**Decision (confirmed with the repo owner):** ship Option A first.

## Recommended PR 1 scope

**Goal:** a v4 external-plan session's primary recommendation gets a real
`SessionReferenceBinding` (`kind: 'external_plan'`) and becomes launchable through
`SessionRunner`, exactly like a catalog session today. No occurrence record. No change to
v1-v3 sessions' existing display-only path. No change to bundle/`additionalSessions`
surfacing (that's PR 2+, see below) — this PR is specifically about making the **existing
single primary external-plan session** real, since that's the prerequisite every later
piece (bundle launch, D-REASSESS) builds on.

### Concrete changes

1. **`app/src/services/sessionAuthoringService.ts`** — add:
   ```typescript
   /**
    * Freezes the execution-prescription snapshot for a v4 external-plan session (ADR-0036
    * H4). Mirrors prepareCatalogSessionLaunch's shape: no session_occurrences record --
    * an external-plan session's identity is already (planId, revision, sessionId, date),
    * the same reasoning a catalog recommendation's (workoutId, catalogVersion) needs no
    * separate occurrence doc either. v1-v3 sessions (prescription: {summary}, no
    * SessionDefinition) are out of scope -- this only accepts a v4 ExternalPlanContext.
    */
    export async function prepareExternalPlanSessionLaunch(
        userId: string,
        externalPlan: { planId: string; revision: number; contentHash: string; session: ExternalPlanSessionV4 },
        summaryOverride?: string,
    ): Promise<PreparedSessionLaunch> {
        const definition = externalPlan.session.definition;
        // Defense in depth: already validated at import time (validateExternalSessionV2,
        // reused unchanged by v4), but every other launch path re-validates too.
        const validation = validateSessionDefinition(definition);
        if (!validation.ok) {
            throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
        }
        const definitionHash = await hashSessionDefinition(definition);
        const sessionSource: Extract<SessionReferenceBinding['sessionSource'], { kind: 'external_plan' }> = {
            kind: 'external_plan',
            planId: externalPlan.planId,
            revision: externalPlan.revision,
            sessionId: externalPlan.session.id,
            contentHash: externalPlan.contentHash,
        };
        const effectiveSummary = summaryOverride ?? definition.summary;
        const unsignedPrescription: ExecutionPrescription = {
            schemaVersion: 1,
            prescriptionHash: '',
            sessionSource,
            definitionHash,
            blocks: definition.blocks,
            displayMetadata: {
                title: definition.title,
                ...(effectiveSummary !== undefined ? { summary: effectiveSummary } : {}),
                intent: definition.intent,
                ...(definition.dominantModality !== undefined ? { dominantModality: definition.dominantModality } : {}),
                ...(definition.duration !== undefined ? { duration: definition.duration } : {}),
            },
            createdAt: new Date().toISOString(),
        };
        const prescriptionHash = await hashExecutionPrescription(unsignedPrescription);
        await executionPrescriptionService.savePrescription(userId, { ...unsignedPrescription, prescriptionHash });
        return { definition, binding: { sessionSource, prescriptionHash } };
    }
   ```
   Exact field names/types need re-verification against current `sessionAuthoringService.ts`
   at implementation time (this doc was written against the tree as of PR #432 merging;
   confirm nothing shifted).

2. **`app/src/components/Home.tsx`** — after `evaluateTrainingWithIntent` returns and
   `recommendationWithPrescription`/`primarySession` are being assembled (the existing
   `if (recommendationWithPrescription.prescription) { ... prepareCatalogSessionLaunch ... }`
   block): add an `else if` branch for when the recommendation came from
   `adjudicatedExternalRecommendation`.

   **CRITICAL DOMAIN SAFETY GATE:**
   In `rules.ts:659`, `externalPrescription` is *unconditionally* populated whenever an
   external plan session is present, even if the engine ruled `skip` (clinical red flag or
   safety-restricted modality) or `defer` (recovery mode), or if the recommended template was
   swapped to canonical Rest (`rest_01`). A `primarySession` binding must **NEVER** be created
   for a skipped or deferred session.

    Gate the launch preparation strictly on:
    ```typescript
    const isV4 = activeExternal && isV4Plan(activeExternal.plan);
    const isProceed = recommendationWithPrescription.externalVerdict?.decision === 'proceed';
    const notRest = recommendationWithPrescription.template.id !== 'rest_01';
    if (isV4 && isProceed && notRest && externalContext && 'definition' in externalContext.session) {
        try {
            const launch = await prepareExternalPlanSessionLaunch(
                userId,
                {
                    planId: externalContext.planId,
                    revision: externalContext.revision,
                    contentHash: externalContext.contentHash,
                    session: externalContext.session as ExternalPlanSessionV4,
                },
            );
            if (!isCurrent()) return;
            primarySession = launch.binding;
        } catch (err) {
            console.warn('Failed to prepare the external-plan session binding for today\'s recommendation:', err);
        }
    }
    ```

3. **Behavior on `scale` verdict:**
   For catalog sessions, `resolveWorkoutPrescription` produces `adjustedBlocks`. External-plan
   sessions currently lack a block-level auto-scaling transformer (only
   `session.scaling.reducedSummary` and volume/intensity scalar bounds exist). Launching
   unscaled blocks when a session was adjudicated as `scale` would run the full authored
   workout without the advised reduction. Therefore, in PR 1, `primarySession` is **strictly
   excluded** on `scale` verdicts (in addition to `skip` and `defer`), and is only bound when
   the verdict is `proceed`. `ExternalVerdictBanner` continues to render the scaled summary and
   prescribed reduction text for the athlete. A full block-level scaling engine for external
   definitions is deferred to a future PR.

4. **Decide whether `externalPrescription`/`externalVerdict`/`decisionTrace.externalPlan`
   stay populated alongside the new `primarySession`, or whether `primarySession` replaces
   them once populated.** Recommendation: **keep both** for this PR. `externalPrescription`
   is still what today's UI (`ExternalVerdictBanner`, `ExternalPlanWeek`) renders for
   the plan-week overview and the athlete's own annotation/verdict flow; `primarySession`
   is strictly additive, enabling a *new* "Start Session" action through `SessionRunner`
   that didn't exist before. Removing the old fields would be a separate, larger UI
   migration and is not needed to unblock D-PLACEMENT/D-REASSESS.

5. **UI: launch affordance already verified.**
   Inspection of `MorningDecisionCard.tsx:286` confirms it already checks
   `(canLaunchCurrentPrescription || (recommendation.primarySession && onStartSession))`.
   Once `primarySession` is populated, the "Start Workout" hero button renders automatically
   without UI rewrites. Note: load adjustments (`easier`/`harder`) in `MorningDecisionCard.tsx`
   rely on catalog prescriptions and are naturally inactive for external sessions.

6. **Tests:**
   - `sessionAuthoringService.test.ts` (or a new sibling file): unit tests for
     `prepareExternalPlanSessionLaunch` — valid v4 session produces a correct binding and
     saved prescription; an invalid `definition` (if one could ever reach this function
     despite import-time validation — test the defensive re-validation path) throws.
   - An integration-level test (wherever `Home.tsx`'s recommendation-assembly logic is
     covered, if anywhere — check for existing `Home.test.tsx`-style coverage of the
     catalog/manual launch branches to mirror) confirming a v4 primary session gets a
     `primarySession` binding while a v1-v3 primary session does not (regression guard for
     "v1-v3 stays untouched").
   - `SessionRunner.tsx`'s existing tests should not need changes if `PreparedSessionLaunch`'s
     shape is respected exactly — verify by running its existing suite after wiring this in.

7. **No `POLICY_VERSION` bump needed for the launch mechanism itself** (this doesn't change
   *which* session is recommended, only how an already-recommended v4 session can be
   started) — but re-verify this claim once the exact `Home.tsx` diff is known.
   - **Firestore rules status:** `firestore.rules:1218-1222` (`hasValidSessionSource`) and
     `1234-1241` (`hasValidSessionReferenceBinding`) already accept `kind: 'external_plan'` with
     `['kind', 'planId', 'revision', 'sessionId', 'contentHash']` and optional `occurrenceId`.
     No rules change is needed to support the binding.
   - **Expression budget risk:** `hasValidRecommendationAudit` (`firestore.rules:321-376`) is near
     Firestore's ~1,000 expression limit. When an external-plan recommendation populates both
     `externalPlan` (lines 368-376) and `primarySession` (line 358), both branches will evaluate
     simultaneously. Running `npm run test:rules` during PR 1 implementation is required to verify
     that the evaluation budget remains within limits.

### Suggested PR description (paste and adapt)

> ## Summary
> First PR of the external-plan execution-binding pipeline (issue #434), discovered
> missing while wiring ADR-0036 H4 D-PLACEMENT ([PR #432](https://github.com/Szczepanov/adaptive-training-recommender/pull/432)).
> `SessionSourceRef`'s `kind: 'external_plan'` was declared but never constructed --
> not even for today's single primary external-plan session, which has never been
> launchable through `SessionRunner`.
>
> Scoped to v4 for H4 intraday bundle continuity (mirroring the `catalog` no-occurrence-record precedent):
> while v2/v3 plans also carry structured `SessionDefinition`, v4 is the specific target
> for H4 intraday bundles. `definition` is already validated by `validateSessionDefinition`
> at import time. No `OccurrenceAuthority`/`SessionOccurrence` schema change in this PR -- an
> external-plan session's identity is already `(planId, revision, sessionId, date)`,
> needing no separate occurrence doc, the same reasoning a catalog recommendation
> already relies on.
>
> ## What's delivered
> - `sessionAuthoringService.ts`: new `prepareExternalPlanSessionLaunch`, mirroring
>   `prepareCatalogSessionLaunch`'s shape, snapshotting `displayMetadata` and supporting
>   `summaryOverride` for scaled sessions.
> - `Home.tsx`: wires it into the existing external-plan recommendation branch,
>   populating `primarySession` for actionable v4 sessions (`verdict.decision in ['proceed', 'scale']`
>   and `template.id !== 'rest_01'`).
> - Crucial domain safety gate: skipped or deferred external sessions (e.g. clinical red flags,
>   recovery mode) never receive a `primarySession` binding.
> - Existing `externalPrescription`/`externalVerdict`/`decisionTrace.externalPlan` fields are
>   preserved alongside `primarySession` to keep today's plan-week display intact.
>
> ## Not in scope here
> - Occurrence tracking (needed for D-REASSESS's predecessor-completion check and
>   multi-occurrence bundle launches) -- separate follow-up PR.
> - Surfacing a bundle's second member as a real `additionalSessions` entry -- needs the
>   occurrence-tracking follow-up first.
> - Full block-level scaling transformation for external definitions (`scale` verdict is strictly excluded from `primarySession` launch until block scaling exists).
>
> ## Validation
> (standard checklist: typecheck, lint, full vitest, build, rules emulator tests,
> simulate:scenarios/diff, check-policy-drift.mjs)

## Future PRs (roadmap beyond PR 1)

1. **PR 1** (this doc): prescription-only v4 launch binding. No occurrence record.
2. **PR 2 — occurrence tracking.** Extend `OccurrenceAuthority` with `'external_plan'`
   (or find a less invasive alternative — e.g. a parallel `externalPlanRef` on
   `SessionOccurrence` instead of overloading `definitionRef`; evaluate both at
   implementation time) and create a real occurrence record when a v4 external-plan
   session launches, so its lifecycle (`scheduled → active → completed`) is queryable
   independently of the plan/date. This is the prerequisite for:
3. **PR 3 — bundle second-member launch.** Once occurrence tracking exists, a v4 intraday
   bundle's non-primary members (already correctly *placed* by
   `activeExternalPlanService.ts`'s `resolveIntradayBundlePlacement`, PR #432) can be
   adjudicated via `adjudicateAuthoredSession` (reusing the exact pattern `Home.tsx`
   already uses for manually-authored additional sessions, per the manual
   `additionalOccurrences` loop) and surfaced as real `additionalSessions` entries the
   athlete can independently launch.
4. **PR 4 — D-REASSESS** (issue #436) becomes meaningful once PR 3 exists: "before a later
   session starts" requires that later session to be a real, launchable thing with
   trackable state.

## Verified facts & risks for the implementing agent

- **Firestore rules support verified:** `firestore.rules:1218-1222` already accepts
  `kind: 'external_plan'` with `['kind', 'planId', 'revision', 'sessionId', 'contentHash']`.
  No rules change is needed.
- **Rules budget risk:** When `primarySession` is present on an external plan recommendation,
  `hasValidRecommendationAudit` evaluates both `externalPlan` and `primarySession`.
  Run `npm run test:rules` to ensure the 1,000 expression limit is not exceeded.
- **UI launch affordance verified:** `MorningDecisionCard.tsx:286` already checks
  `(canLaunchCurrentPrescription || (recommendation.primarySession && onStartSession))`.
  The "Start Workout" button appears automatically once `primarySession` is populated.
- **Domain safety invariant:** Ensure `Home.tsx` checks `activeExternal && isV4Plan(activeExternal.plan)`,
  `verdict === 'proceed'`, and `template.id !== 'rest_01'`. Never bind `primarySession` on
  `skip`, `defer`, or `scale` (until block-scaling exists, preventing execution of unscaled blocks).
