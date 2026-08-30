import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(text, oldValue, newValue, label) {
  const first = text.indexOf(oldValue);
  if (first < 0) throw new Error(`Missing expected text for ${label}`);
  if (text.indexOf(oldValue, first + oldValue.length) >= 0) throw new Error(`Expected unique text for ${label}`);
  return text.slice(0, first) + newValue + text.slice(first + oldValue.length);
}

function replaceRegexOnce(text, pattern, replacement, label) {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected one match for ${label}, found ${matches.length}`);
  return text.replace(pattern, replacement);
}

function patchSequenceSearch() {
  const path = 'app/src/engine/sequenceSearch.ts';
  let text = read(path);

  text = replaceOnce(
    text,
    "import { isTemplatePhaseEligible, evaluatePeriodizationPhase, type PeriodizationResult } from './periodization';",
    "import { isTemplatePhaseEligible, evaluatePeriodizationPhase, type DroppedContributorObjective, type PeriodizationResult } from './periodization';",
    'sequenceSearch periodization import',
  );
  text = replaceOnce(
    text,
    "import type { PlannedObjectiveCredit, WeekAheadDay, WeekAheadOptions, WeekAheadPlan, WeekAheadPlanSeed } from './planner';",
    "import type { PlannedObjectiveCredit, ProjectionExposure, WeekAheadDay, WeekAheadOptions, WeekAheadPlan, WeekAheadPlanSeed } from './planner';",
    'sequenceSearch planner type import',
  );
  text = replaceOnce(
    text,
    "    projectFatigueForRankingDate,\n    realizedSessionRole,",
    "    projectFatigueForRankingDate,\n    reconcileObjectivesForDate,\n    realizedSessionRole,",
    'sequenceSearch reconcile import',
  );

  text = replaceOnce(
    text,
`interface SearchBranch {
    days: WeekAheadDay[];
    microcycle: MicrocycleState;
    externalFatigue: FatigueState;
    objectiveCredits: PlannedObjectiveCredit[];
    /** Per projected day, lower is better. Equal-length branches are compared in date
     * order, preserving the coverage-first ordering for earlier projected days. */
    coverageTiers: number[];
    /** Utility only breaks ties after the coverage-tier sequence. */
    cumulativeScore: number;
}`,
`interface SearchBranch {
    days: WeekAheadDay[];
    microcycle: MicrocycleState;
    externalFatigue: FatigueState;
    objectiveCredits: PlannedObjectiveCredit[];
    /** Branch-local objective credit memory is required because objective eligibility can
     * change by forecast date, and sibling branches must never share mutable carry state. */
    creditMemory: Map<WeeklyObjective['key'], { completedCredit: number; projectedCredit: number; completedExposures: number }>;
    /** Prior projected recommendations let newly-relevant objectives backfill only credit
     * that was actually earned before the objective became active. */
    projectionExposures: ProjectionExposure[];
    droppedContributorObjectives: DroppedContributorObjective[];
    currentlyDroppedPairs: Set<string>;
    /** Per projected day, lower is better. Equal-length branches are compared in date
     * order, preserving the coverage-first ordering for earlier projected days. */
    coverageTiers: number[];
    /** Utility only breaks ties after the coverage-tier sequence. */
    cumulativeScore: number;
}`,
    'SearchBranch state',
  );

  text = replaceOnce(
    text,
`    objectiveCredits: PlannedObjectiveCredit[];
    microcycleObjectives: WeeklyObjective[];
    explain: SequenceExplainEntry[];`,
`    objectiveCredits: PlannedObjectiveCredit[];
    microcycleObjectives: WeeklyObjective[];
    droppedContributorObjectives: DroppedContributorObjective[];
    explain: SequenceExplainEntry[];`,
    'beam result dropped contributors',
  );

  text = replaceOnce(
    text,
`    const events = options.events ?? [];
    const fixedActivities = options.fixedActivities ?? [];
    const effectivePreferences = preferences ?? { ...NEUTRAL_PREFERENCES, preferredRecoveryStyle: resolveRecoveryStyle(context) };`,
`    const events = options.events ?? [];
    const fixedActivities = options.fixedActivities ?? [];
    const authoredPlanBlocks = options.authoredPlanBlocks ?? [];
    const suppliedPlanDefinition = options.planDefinition ?? null;
    const effectivePreferences = preferences ?? { ...NEUTRAL_PREFERENCES, preferredRecoveryStyle: resolveRecoveryStyle(context) };`,
    'beam option aliases',
  );

  text = replaceRegexOnce(
    text,
    /    \/\/ KNOWN GAP \(tracked by sequenceSearch\.test\.ts's "degenerates to exactly the greedy[\s\S]*?    const initialMicrocycle:/,
`    // Each forecast branch reconciles objectives against that date before ranking. The
    // branch owns its credit-memory/backfill state so pruning one path cannot leak objective
    // carry-over into a sibling path.
    const initialMicrocycle:`,
    'remove stale known-gap comment',
  );

  const reconcileHelper = `
    /** Reconcile the objective skeleton for one branch/date without sharing mutable carry
     * state across sibling branches. This mirrors the production greedy planner's daily
     * objective reconciliation contract while preserving branch-specific projected credit. */
    const reconcileBranchForDate = (
        branch: SearchBranch,
        date: string,
        periodization: PeriodizationResult,
    ): SearchBranch => {
        const creditMemory = new Map(branch.creditMemory);
        const reconciled = reconcileObjectivesForDate(
            branch.microcycle,
            events,
            date,
            todayDate,
            periodization,
            creditMemory,
            branch.projectionExposures,
            authoredPlanBlocks,
            suppliedPlanDefinition,
        );

        const droppedContributorObjectives = [...branch.droppedContributorObjectives];
        const currentlyDroppedPairs = new Set(branch.currentlyDroppedPairs);
        const dropKey = (drop: DroppedContributorObjective) => \`${'${drop.eventId}:${drop.objectiveKey}'}\`;
        const freshKeys = new Set(reconciled.droppedContributorObjectives.map(dropKey));
        reconciled.droppedContributorObjectives.forEach(drop => {
            if (!currentlyDroppedPairs.has(dropKey(drop))) droppedContributorObjectives.push(drop);
        });
        currentlyDroppedPairs.clear();
        freshKeys.forEach(key => currentlyDroppedPairs.add(key));

        return {
            ...branch,
            microcycle: reconciled.microcycle,
            creditMemory,
            droppedContributorObjectives,
            currentlyDroppedPairs,
        };
    };

`;
  text = replaceOnce(text, '    const applyPick = (\n', reconcileHelper + '    const applyPick = (\n', 'insert beam reconciliation helper');

  text = replaceOnce(
    text,
`            externalFatigue: applyCompletedSessionLoad(branch.externalFatigue, date, enrichedCostProfile(template.id)),
            objectiveCredits: [...branch.objectiveCredits, ...newCredits],`,
`            externalFatigue: applyCompletedSessionLoad(branch.externalFatigue, date, enrichedCostProfile(template.id)),
            objectiveCredits: [...branch.objectiveCredits, ...newCredits],
            projectionExposures: [...branch.projectionExposures, {
                occurrenceKey: \`recommendation:\${date}\`,
                date,
                stimulus: enrichedStimulusProfile(template),
                templateId: template.id,
                modality: template.modality,
                category: template.category,
                durationMin: template.durationMin,
            }],`,
    'record beam projection exposure',
  );

  text = replaceOnce(
    text,
`    let seedBranch: SearchBranch = {
        days: [], microcycle: initialMicrocycle, externalFatigue: initialFatigue,
        objectiveCredits: [], coverageTiers: [], cumulativeScore: 0,
    };`,
`    const seedDrops = [...(seed.droppedContributorObjectives ?? [])];
    let seedBranch: SearchBranch = {
        days: [], microcycle: initialMicrocycle, externalFatigue: initialFatigue,
        objectiveCredits: [],
        creditMemory: new Map(),
        projectionExposures: [],
        droppedContributorObjectives: seedDrops,
        currentlyDroppedPairs: new Set(seedDrops.map(drop => \`\${drop.eventId}:\${drop.objectiveKey}\`)),
        coverageTiers: [], cumulativeScore: 0,
    };`,
    'initialize branch reconciliation state',
  );

  text = replaceOnce(
    text,
`        const tomorrowPeriodization = evaluatePeriodizationPhase(events, tomorrowDate);
        const tomorrowCredits = creditingObjectivesFor(seedBranch.microcycle, tomorrowRec.template);`,
`        const tomorrowPeriodization = evaluatePeriodizationPhase(events, tomorrowDate);
        seedBranch = reconcileBranchForDate(seedBranch, tomorrowDate, tomorrowPeriodization);
        const tomorrowCredits = creditingObjectivesFor(seedBranch.microcycle, tomorrowRec.template);`,
    'reconcile provisional tomorrow',
  );

  text = replaceOnce(
    text,
`        const planDefinition = resolvePlanDefinitionForEvent(periodization.focusEvent, options.authoredPlanBlocks);`,
`        const planDefinition = suppliedPlanDefinition ?? resolvePlanDefinitionForEvent(periodization.focusEvent, authoredPlanBlocks);`,
    'beam plan definition',
  );

  text = replaceOnce(
    text,
`        for (const branch of beam) {
            const rankingFatigue = projectFatigueForRankingDate(branch.externalFatigue, internalStrain, internalStrainAsOf, date);
            const unresolved = getUnresolvedObjectives(branch.microcycle, true);`,
`        for (const branch of beam) {
            const reconciledBranch = reconcileBranchForDate(branch, date, periodization);
            const rankingFatigue = projectFatigueForRankingDate(reconciledBranch.externalFatigue, internalStrain, internalStrainAsOf, date);
            const unresolved = getUnresolvedObjectives(reconciledBranch.microcycle, true);`,
    'reconcile each forecast branch',
  );
  text = replaceOnce(text, '                ...[...confirmedDays, ...branch.days].map(d => ({', '                ...[...confirmedDays, ...reconciledBranch.days].map(d => ({', 'forecast projected history branch');
  text = replaceOnce(
    text,
`                    plannedDose: resolvePlannedDoseForDate(periodization.phase, branch.microcycle.objectives, unresolved, planDefinition, date),`,
`                    plannedDose: resolvePlannedDoseForDate(periodization.phase, reconciledBranch.microcycle.objectives, unresolved, planDefinition, date),`,
    'forecast planned dose reconciled objectives',
  );
  text = replaceOnce(
    text,
`                    nextGeneration.push(extendBranch(
                        branch, date, offset, periodization, restFallback,`,
`                    nextGeneration.push(extendBranch(
                        reconciledBranch, date, offset, periodization, restFallback,`,
    'fallback extends reconciled branch',
  );
  text = replaceOnce(
    text,
`                nextGeneration.push(extendBranch(
                    branch, date, offset, periodization, candidate.template,`,
`                nextGeneration.push(extendBranch(
                    reconciledBranch, date, offset, periodization, candidate.template,`,
    'candidate extends reconciled branch',
  );

  text = replaceOnce(
    text,
`        objectiveCredits: winner.objectiveCredits,
        microcycleObjectives: winner.microcycle.objectives ?? [],
        explain,`,
`        objectiveCredits: winner.objectiveCredits,
        microcycleObjectives: winner.microcycle.objectives ?? [],
        droppedContributorObjectives: winner.droppedContributorObjectives,
        explain,`,
    'beam result dynamic drops',
  );
  text = replaceOnce(
    text,
`        microcycleObjectives: result.microcycleObjectives,
        droppedContributorObjectives: intent.droppedContributorObjectives,
        allocationReport: { outcomes: [] },`,
`        microcycleObjectives: result.microcycleObjectives,
        droppedContributorObjectives: result.droppedContributorObjectives,
        allocationReport: { outcomes: [] },`,
    'beam wrapper dynamic drops',
  );

  write(path, text);
}

function patchSequenceSearchTest() {
  const path = 'app/src/engine/sequenceSearch.test.ts';
  let text = read(path);
  text = replaceRegexOnce(
    text,
    /    \/\/ KNOWN GAP, not a weakened invariant:[\s\S]*?    it\.skip\('degenerates to exactly the greedy algorithm when beamWidth=1 and candidatesPerDay=1', \(\) => \{/,
`    // Regression contract for per-branch objective reconciliation: with a width/count of
    // one, the prototype has no search freedom and must reuse the same date-specific
    // objective state and rank-0 decisions as the greedy planner.
    it('degenerates to exactly the greedy algorithm when beamWidth=1 and candidatesPerDay=1', () => {`,
    'reactivate greedy/beam parity test',
  );
  write(path, text);
}

function patchRunningWorkouts() {
  const path = 'app/src/workouts/catalog/running-race.ts';
  let text = read(path);
  text = replaceOnce(text, "timeStep('long_run_main', 'easy_continuous_run', 'Progressive long run', 4800,", "timeStep('long_run_main', 'easy_continuous_run', 'Progressive long run', 4500,", 'long-run full duration');
  text = replaceOnce(text, "{ id: 'reduced', targetDurationMin: 65, loadMultiplier: 0.7, rationale: 'Shorten the long run while preserving continuous aerobic exposure.', stepOverrides: [{ stepId: 'long_run_main', durationSeconds: 3300 }] },", "{ id: 'reduced', targetDurationMin: 65, loadMultiplier: 0.7, rationale: 'Shorten the long run while preserving continuous aerobic exposure.', stepOverrides: [{ stepId: 'long_run_main', durationSeconds: 3000 }] },", 'long-run reduced duration');
  text = replaceOnce(text, "{ id: 'return_to_training', targetDurationMin: 60, loadMultiplier: 0.5, rationale: 'Use the minimum durability-relevant continuous exposure.', stepOverrides: [{ stepId: 'long_run_main', durationSeconds: 2880 }] }", "{ id: 'return_to_training', targetDurationMin: 60, loadMultiplier: 0.5, rationale: 'Use the minimum durability-relevant continuous exposure.', stepOverrides: [{ stepId: 'long_run_main', durationSeconds: 2700 }] }", 'long-run return duration');
  text = replaceOnce(text, "{ id: 'long_run_duration', label: 'Long-run duration', unit: 'minutes', defaultValue: 80,", "{ id: 'long_run_duration', label: 'Long-run duration', unit: 'minutes', defaultValue: 75,", 'long-run parameter default');

  text = replaceOnce(text, "timeStep('race_pace_warmup', 'walk_run_easy', 'Easy running warm-up', 600,", "timeStep('race_pace_warmup', 'walk_run_easy', 'Easy running warm-up', 900,", 'race pace warmup duration');
  text = replaceOnce(text, "{ id: 'reduced', targetDurationMin: 45, loadMultiplier: 0.75, rationale: 'Reduce repeat count before increasing effort.', stepOverrides: [{ stepId: 'race_pace_main', sets: 2 }] },", "{ id: 'reduced', targetDurationMin: 45, loadMultiplier: 0.75, rationale: 'Reduce repeat count before increasing effort.', stepOverrides: [{ stepId: 'race_pace_main', sets: 2 }, { stepId: 'race_pace_cooldown', durationSeconds: 660 }] },", 'race pace reduced duration');
  text = replaceOnce(text, "{ id: 'return_to_training', targetDurationMin: 40, loadMultiplier: 0.55, rationale: 'Use a single controlled effort at reduced intensity.', stepOverrides: [{ stepId: 'race_pace_main', sets: 1, durationSeconds: 300, target: { type: 'rpe', min: 4, max: 5 } }] }", "{ id: 'return_to_training', targetDurationMin: 40, loadMultiplier: 0.55, rationale: 'Use a single controlled effort at reduced intensity.', stepOverrides: [{ stepId: 'race_pace_main', sets: 1, durationSeconds: 300, target: { type: 'rpe', min: 4, max: 5 } }, { stepId: 'race_pace_cooldown', durationSeconds: 1200 }] }", 'race pace return duration');

  text = replaceOnce(text, "timeStep('taper_run_cooldown', 'walk_run_easy', 'Easy running cool-down', 480,", "timeStep('taper_run_cooldown', 'walk_run_easy', 'Easy running cool-down', 750,", 'taper full cooldown duration');
  text = replaceOnce(text, "{ id: 'reduced', targetDurationMin: 24, loadMultiplier: 0.7, rationale: 'Use two touches and a shorter cool-down.', stepOverrides: [{ stepId: 'taper_run_efforts', sets: 2 }, { stepId: 'taper_run_cooldown', durationSeconds: 360 }] },", "{ id: 'reduced', targetDurationMin: 24, loadMultiplier: 0.7, rationale: 'Use two touches and a shorter cool-down.', stepOverrides: [{ stepId: 'taper_run_efforts', sets: 2 }, { stepId: 'taper_run_cooldown', durationSeconds: 630 }] },", 'taper reduced duration');
  text = replaceOnce(text, "{ id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Use easy running with one controlled sub-threshold touch.', stepOverrides: [{ stepId: 'taper_run_efforts', sets: 1, durationSeconds: 60, target: { type: 'rpe', min: 4, max: 5 } }, { stepId: 'taper_run_cooldown', durationSeconds: 360 }] }", "{ id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Use easy running with one controlled sub-threshold touch.', stepOverrides: [{ stepId: 'taper_run_efforts', sets: 1, durationSeconds: 60, target: { type: 'rpe', min: 4, max: 5 } }, { stepId: 'taper_run_cooldown', durationSeconds: 660 }] }", 'taper return duration');
  write(path, text);
}

function patchSwimmingWorkouts() {
  const path = 'app/src/workouts/catalog/swimming.ts';
  let text = read(path);

  text = replaceOnce(text, "timeStep('swim_tech_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 480,", "timeStep('swim_tech_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 600,", 'swim technique warmup');
  text = replaceOnce(
    text,
`      { id: 'main', name: 'Technique repeats', role: 'main', steps: [
        timeStep('swim_tech_drill', 'swim_technique_drill', 'Technique drill repeat', 90, { sets: 6, restAfterSec: 45, target: { type: 'technical_quality', cue: 'Relaxed body position with a long, controlled stroke.', successCriteria: ['Quiet head position.', 'Even breathing rhythm.'], commonFaults: ['Rushing stroke rate to chase pace.'], stopConditions: ['Stop technical work when stroke quality deteriorates.'] } })
      ]},`,
`      { id: 'main', name: 'Technique repeats', role: 'main', steps: [
        timeStep('swim_tech_drill', 'swim_technique_drill', 'Technique drill repeat', 90, { sets: 6, restAfterSec: 45, target: { type: 'technical_quality', cue: 'Relaxed body position with a long, controlled stroke.', successCriteria: ['Quiet head position.', 'Even breathing rhythm.'], commonFaults: ['Rushing stroke rate to chase pace.'], stopConditions: ['Stop technical work when stroke quality deteriorates.'] } }),
        timeStep('swim_tech_integration', 'swim_easy_continuous', 'Easy whole-stroke integration', 315, { target: { type: 'rpe', min: 1, max: 2 }, notes: ['Carry the drill cue into relaxed whole-stroke swimming without chasing pace.'] })
      ]},`,
    'swim technique integration',
  );
  text = replaceOnce(text, "timeStep('swim_tech_cooldown', 'swim_easy_continuous', 'Easy cool-down swimming', 300,", "timeStep('swim_tech_cooldown', 'swim_easy_continuous', 'Easy cool-down swimming', 420,", 'swim technique cooldown');
  text = replaceOnce(text, "{ id: 'reduced', targetDurationMin: 28, loadMultiplier: 0.75, rationale: 'Reduce drill repeats while preserving the technical theme.', stepOverrides: [{ stepId: 'swim_tech_drill', sets: 4 }] },", "{ id: 'reduced', targetDurationMin: 28, loadMultiplier: 0.75, rationale: 'Reduce drill repeats while preserving the technical theme.', stepOverrides: [{ stepId: 'swim_tech_drill', sets: 4 }, { stepId: 'swim_tech_integration', durationSeconds: 165 }] },", 'swim technique reduced');
  text = replaceOnce(text, "{ id: 'return_to_training', targetDurationMin: 25, loadMultiplier: 0.5, rationale: 'Use mostly easy continuous swimming with minimal drill work.', stepOverrides: [{ stepId: 'swim_tech_drill', sets: 2 }, { stepId: 'swim_tech_cooldown', durationSeconds: 240 }] }", "{ id: 'return_to_training', targetDurationMin: 25, loadMultiplier: 0.5, rationale: 'Use mostly easy continuous swimming with minimal drill work.', stepOverrides: [{ stepId: 'swim_tech_drill', sets: 2 }, { stepId: 'swim_tech_integration', durationSeconds: 375 }, { stepId: 'swim_tech_cooldown', durationSeconds: 300 }] }", 'swim technique return');

  text = replaceOnce(text, "timeStep('swim_easy_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 360,", "timeStep('swim_easy_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 600,", 'swim easy warmup');
  text = replaceOnce(text, "{ id: 'reduced', targetDurationMin: 35, loadMultiplier: 0.75, rationale: 'Retain the aerobic stimulus while lowering total volume.', stepOverrides: [{ stepId: 'swim_easy_main', durationSeconds: 1320 }] },", "{ id: 'reduced', targetDurationMin: 35, loadMultiplier: 0.75, rationale: 'Retain the aerobic stimulus while lowering total volume.', stepOverrides: [{ stepId: 'swim_easy_main', durationSeconds: 1200 }] },", 'swim easy reduced');
  text = replaceOnce(text, "{ id: 'return_to_training', targetDurationMin: 30, loadMultiplier: 0.55, rationale: 'Use a conservative relaxed exposure.', stepOverrides: [{ stepId: 'swim_easy_main', durationSeconds: 900 }, { stepId: 'swim_easy_cooldown', durationSeconds: 240 }] }", "{ id: 'return_to_training', targetDurationMin: 30, loadMultiplier: 0.55, rationale: 'Use a conservative relaxed exposure.', stepOverrides: [{ stepId: 'swim_easy_main', durationSeconds: 900 }] }", 'swim easy return');

  text = replaceOnce(text, "timeStep('swim_thresh_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 480,", "timeStep('swim_thresh_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 600,", 'swim threshold warmup');
  text = replaceOnce(text, "timeStep('swim_thresh_main', 'swim_threshold_interval', 'Sustained swim interval', 240, { sets: 5, restAfterSec: 45,", "timeStep('swim_thresh_main', 'swim_threshold_interval', 'Sustained swim interval', 300, { sets: 5, restAfterSec: 60,", 'swim threshold main');
  text = replaceOnce(text, "timeStep('swim_thresh_cooldown', 'swim_easy_continuous', 'Easy cool-down swimming', 300,", "timeStep('swim_thresh_cooldown', 'swim_easy_continuous', 'Easy cool-down swimming', 360,", 'swim threshold cooldown');
  text = replaceOnce(text, "{ id: 'reduced', targetDurationMin: 38, loadMultiplier: 0.75, rationale: 'Reduce interval count before increasing effort.', stepOverrides: [{ stepId: 'swim_thresh_main', sets: 4 }] },", "{ id: 'reduced', targetDurationMin: 39, loadMultiplier: 0.75, rationale: 'Reduce interval count before increasing effort.', stepOverrides: [{ stepId: 'swim_thresh_main', sets: 4 }] },", 'swim threshold reduced');
  text = replaceOnce(text, "{ id: 'return_to_training', targetDurationMin: 35, loadMultiplier: 0.55, rationale: 'Use fewer, easier repeats.', stepOverrides: [{ stepId: 'swim_thresh_main', sets: 3, target: { type: 'rpe', min: 4, max: 5 } }] }", "{ id: 'return_to_training', targetDurationMin: 35, loadMultiplier: 0.55, rationale: 'Use fewer, easier repeats.', stepOverrides: [{ stepId: 'swim_thresh_main', sets: 3, target: { type: 'rpe', min: 4, max: 5 } }, { stepId: 'swim_thresh_cooldown', durationSeconds: 480 }] }", 'swim threshold return');

  write(path, text);
}

function patchScenarios() {
  const path = 'app/src/engine/simulation/scenarios.ts';
  let text = read(path);
  for (const id of ['cycling_criterium_fresh_A', 'cycling_criterium_stressed_A']) {
    const pattern = new RegExp(`(id: '${id}'[\\s\\S]*?context: context\\()\\{ indoor_bike: true, free_weights: true \\}(, \\['Cycling'\\]\\),)`);
    text = replaceRegexOnce(text, pattern, `$1{ indoor_bike: true, free_weights: true, outdoor_bike: true }$2`, `${id} outdoor bike access`);
  }
  write(path, text);
}

function patchAuditDoc() {
  const path = 'docs/analysis/2026-08-30-running-triathlon-support-audit.md';
  let text = read(path);
  text = replaceOnce(
    text,
"7. **Beam-search objective reconciliation:** `beamSearchWeekAheadPlan` (the Phase 5.1 prototype search, not the production greedy planner) never calls `reconcileObjectivesForDate`, so it can silently miss event-specific objectives that only became relevant after its seed's microcycle was built — see the comment above `initialMicrocycle` in `sequenceSearch.ts` and the still-red `sequenceSearch.test.ts` parity test. Fixing it requires threading `reconcileObjectivesForDate`'s per-branch credit-memory state through the search's branch forks; deliberately left as documented follow-up rather than a rushed change to a prototype's core state model.",
"7. **Beam-search production status:** the Phase 5.1 prototype now reconciles event objectives independently for every forecast branch/date, including branch-local credit memory, prior-exposure backfill, and dynamic dropped-contributor state. Its width-1 / one-candidate parity regression is active again. The beam planner is still an experiment rather than the production replacement for the greedy weekly-role-allocation path, so this PR does not claim full planner equivalence beyond the invariants covered by tests.",
    'audit beam-search status',
  );
  write(path, text);
}

function patchPolicy() {
  const path = 'app/src/engine/policy.ts';
  let text = read(path);
  text = replaceRegexOnce(
    text,
    /export const POLICY_VERSION = '[^']+';/,
    "export const POLICY_VERSION = '2026-08-multisport-bodyweight-strength-v1';",
    'policy version after main merge',
  );
  if (!text.includes("'2026-08-evergreen-bodyweight-strength-v1'")) {
    text = replaceOnce(text, 'export const HISTORICAL_POLICY_VERSIONS = [\n', "export const HISTORICAL_POLICY_VERSIONS = [\n    '2026-08-evergreen-bodyweight-strength-v1',\n", 'historical bodyweight policy');
  }
  if (!text.includes("'2026-08-multisport-and-walking-merge-v1'")) {
    text = replaceOnce(text, 'export const HISTORICAL_POLICY_VERSIONS = [\n', "export const HISTORICAL_POLICY_VERSIONS = [\n    '2026-08-multisport-and-walking-merge-v1',\n", 'historical multisport policy');
  }
  write(path, text);
}

function addDurationContractTest() {
  const path = 'app/src/workouts/multisportDurationContracts.test.ts';
  const content = `import { describe, expect, it } from 'vitest';
import { RUNNING_RACE_WORKOUTS } from './catalog/running-race';
import { SWIMMING_WORKOUTS } from './catalog/swimming';

const MULTISPORT_WORKOUTS = [...RUNNING_RACE_WORKOUTS, ...SWIMMING_WORKOUTS];

/** Resolve the executable timed duration for a variant, including inter-set recovery. */
function variantDurationSeconds(workout: (typeof MULTISPORT_WORKOUTS)[number], variantId: 'full' | 'reduced' | 'return_to_training'): number {
  const variant = workout.variants.find(item => item.id === variantId);
  if (!variant) throw new Error(\`Missing \${variantId} variant for \${workout.id}\`);
  const overrides = new Map(variant.stepOverrides.map(override => [override.stepId, override]));

  return workout.blocks.flatMap(block => block.steps).reduce((total, step) => {
    const override = overrides.get(step.id);
    if (override?.omit) return total;
    if (step.duration.type !== 'time') throw new Error(\`Multisport duration contract requires timed steps: \${workout.id}/\${step.id}\`);
    const sets = override?.sets ?? step.sets ?? 1;
    const seconds = override?.durationSeconds ?? step.duration.seconds;
    const restAfterSec = override?.restAfterSec ?? step.restAfterSec ?? 0;
    return total + (seconds * sets) + (restAfterSec * Math.max(0, sets - 1));
  }, 0);
}

describe('multisport executable duration contracts', () => {
  for (const workout of MULTISPORT_WORKOUTS) {
    for (const variant of workout.variants) {
      it(\`\${workout.id}/\${variant.id} matches its declared target duration\`, () => {
        expect(variantDurationSeconds(workout, variant.id)).toBe(variant.targetDurationMin * 60);
      });
    }
  }
});
`;
  write(path, content);
}

patchSequenceSearch();
patchSequenceSearchTest();
patchRunningWorkouts();
patchSwimmingWorkouts();
patchScenarios();
patchAuditDoc();
patchPolicy();
addDurationContractTest();
console.log('Applied PR #297 review fixes.');
