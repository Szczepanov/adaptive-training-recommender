// Phase 5.1 adoption-decision harness: runs every scenario in
// src/engine/simulation/scenarios.ts through BOTH the production greedy planner
// (generateWeekAheadPlanWithIntent) and the Phase 5.1 beam-search prototype
// (generateWeekAheadPlanWithIntentBeamSearch), using the identical `runScenario` harness
// and metrics for each, and reports the comparison. See docs/adr/0015-sequence-planning-and-session-role-model.md
// for how this data feeds the recorded adoption decision.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

function aggregateRestPct(results) {
  const totalDays = results.reduce((sum, r) => sum + r.totalDays, 0);
  const totalRest = results.reduce((sum, r) => sum + r.restOrRecoveryDayCount, 0);
  return totalDays > 0 ? (totalRest / totalDays) * 100 : 0;
}

function keyCyclingDates(result, templateById) {
  const keyCategories = new Set(['Hard Endurance', 'Moderate Endurance', 'Race-Specific Endurance']);
  const dates = new Set(
    result.objectiveCredits
      .filter((credit) => {
        const template = templateById.get(credit.templateId);
        return credit.modality === 'Cycling' && template?.modality === 'Cycling' && keyCategories.has(template.category);
      })
      .map((credit) => credit.date),
  );
  result.anchorWeeks.forEach((week) => {
    if (week.qualityAnchorHit && week.qualityAnchorDate) dates.add(week.qualityAnchorDate);
    week.eventSpecificExposureDates.forEach((date) => dates.add(date));
  });
  return Array.from(dates).sort();
}

function goldenWeekInvariants(result, templateById, categoryByTemplateId) {
  const violations = [];
  const dates = keyCyclingDates(result, templateById);
  const timestamps = dates.map((d) => new Date(`${d}T00:00:00`).getTime());
  for (let i = 1; i < timestamps.length; i++) {
    const diffHours = (timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60);
    if (diffHours < 48) violations.push(`key cycling spacing violation: ${dates[i - 1]} -> ${dates[i]} (${diffHours}h)`);
  }

  const heavyStrengthCategories = new Set(['Lower-body Strength', 'Full-body Strength']);
  const keyDateSet = new Set(dates);
  result.objectiveCredits.forEach((c) => {
    if (heavyStrengthCategories.has(categoryByTemplateId.get(c.templateId) ?? '')) {
      const strengthTime = new Date(`${c.date}T00:00:00`).getTime();
      keyDateSet.forEach((cycleDate) => {
        const cycleTime = new Date(`${cycleDate}T00:00:00`).getTime();
        const diffDays = Math.abs(strengthTime - cycleTime) / (1000 * 60 * 60 * 24);
        if (diffDays === 1) violations.push(`heavy strength adjacent to key cycling day: ${c.date} / ${cycleDate}`);
      });
    }
  });

  if (dates.length < 2) violations.push(`fewer than 2 key/race-specific cycling sessions (${dates.length})`);

  const threshold = result.objectiveResolution.find((o) => o.key === 'threshold_quality');
  const strength = result.objectiveResolution.find((o) => o.key === 'strength_maintenance');
  if (!threshold || threshold.timesResolved < threshold.timesGenerated) violations.push('threshold_quality objective not fully resolved');
  if (!strength || strength.timesResolved < strength.timesGenerated) violations.push('strength_maintenance objective not fully resolved');

  if (result.restOrRecoveryDayCount < 1) violations.push('no Rest/Mobility-Recovery day in the week');

  return violations;
}

let comparison;
try {
  const { SCENARIOS } = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');
  const { runScenario } = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  const { generateWeekAheadPlanWithIntentBeamSearch } = await server.ssrLoadModule('/src/engine/sequenceSearch.ts');
  const { ENRICHED_TEMPLATES } = await server.ssrLoadModule('/src/engine/templates.ts');

  const templateById = new Map(ENRICHED_TEMPLATES.map((t) => [t.id, t]));
  const categoryByTemplateId = new Map(ENRICHED_TEMPLATES.map((t) => [t.id, t.category]));

  const greedyResults = [];
  const beamResults = [];
  const greedyStart = Date.now();
  for (const scenario of SCENARIOS) greedyResults.push(await runScenario(scenario));
  const greedyMs = Date.now() - greedyStart;

  const beamStart = Date.now();
  for (const scenario of SCENARIOS) beamResults.push(await runScenario(scenario, generateWeekAheadPlanWithIntentBeamSearch));
  const beamMs = Date.now() - beamStart;

  const goldenWeekScenario = SCENARIOS.find((s) => s.id === 'cycling_a_event_build_week');
  const greedyGolden = greedyResults.find((r) => r.scenarioId === 'cycling_a_event_build_week');
  const beamGolden = beamResults.find((r) => r.scenarioId === 'cycling_a_event_build_week');

  comparison = {
    scenarioCount: SCENARIOS.length,
    timing: { greedyMs, beamMs, beamOverheadFactor: greedyMs > 0 ? beamMs / greedyMs : null },
    aggregate: {
      greedy: {
        restPct: aggregateRestPct(greedyResults),
        constraintViolations: greedyResults.reduce((sum, r) => sum + r.constraintViolations.length, 0),
      },
      beam: {
        restPct: aggregateRestPct(beamResults),
        constraintViolations: beamResults.reduce((sum, r) => sum + r.constraintViolations.length, 0),
      },
    },
    goldenWeek: {
      scenarioFound: !!goldenWeekScenario,
      greedyViolations: greedyGolden ? goldenWeekInvariants(greedyGolden, templateById, categoryByTemplateId) : ['scenario result missing'],
      beamViolations: beamGolden ? goldenWeekInvariants(beamGolden, templateById, categoryByTemplateId) : ['scenario result missing'],
    },
    perScenario: SCENARIOS.map((scenario, i) => {
      const g = greedyResults[i];
      const b = beamResults[i];
      return {
        scenarioId: scenario.id,
        label: scenario.label,
        greedy: { restOrRecoveryDayPct: g.restOrRecoveryDayPct, constraintViolations: g.constraintViolations.length, objectivesUnresolved: g.objectiveResolution.filter((o) => o.timesResolved < o.timesGenerated).length },
        beam: { restOrRecoveryDayPct: b.restOrRecoveryDayPct, constraintViolations: b.constraintViolations.length, objectivesUnresolved: b.objectiveResolution.filter((o) => o.timesResolved < o.timesGenerated).length },
        categoryDistributionDelta: Object.keys({ ...g.categoryDistribution, ...b.categoryDistribution }).reduce((acc, cat) => {
          const delta = (b.categoryDistribution[cat] ?? 0) - (g.categoryDistribution[cat] ?? 0);
          if (delta !== 0) acc[cat] = delta;
          return acc;
        }, {}),
      };
    }),
  };
} finally {
  await server.close();
}

const outputDir = resolve('artifacts/sequence-search-comparison');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`);

console.log(`\n=== Phase 5.1 sequence-search comparison (beam vs greedy) ===\n`);
console.log(`Scenarios: ${comparison.scenarioCount}`);
console.log(`Timing: greedy ${comparison.timing.greedyMs}ms, beam ${comparison.timing.beamMs}ms (${comparison.timing.beamOverheadFactor?.toFixed(1)}x)`);
console.log(`Aggregate rest/recovery share: greedy ${comparison.aggregate.greedy.restPct.toFixed(1)}%, beam ${comparison.aggregate.beam.restPct.toFixed(1)}%`);
console.log(`Aggregate constraint violations: greedy ${comparison.aggregate.greedy.constraintViolations}, beam ${comparison.aggregate.beam.constraintViolations}`);
console.log(`\nGolden week (cycling_a_event_build_week) invariant violations:`);
console.log(`  greedy: ${comparison.goldenWeek.greedyViolations.length === 0 ? 'none' : comparison.goldenWeek.greedyViolations.join('; ')}`);
console.log(`  beam:   ${comparison.goldenWeek.beamViolations.length === 0 ? 'none' : comparison.goldenWeek.beamViolations.join('; ')}`);
console.log(`\nPer-scenario deltas (beam - greedy) written to ${resolve(outputDir, 'comparison.json')}`);
comparison.perScenario.forEach((s) => {
  const changed = Object.keys(s.categoryDistributionDelta).length > 0;
  if (changed || s.beam.constraintViolations !== s.greedy.constraintViolations || s.beam.objectivesUnresolved !== s.greedy.objectivesUnresolved) {
    console.log(`  ${s.scenarioId}: rest% ${s.greedy.restOrRecoveryDayPct}->${s.beam.restOrRecoveryDayPct}, violations ${s.greedy.constraintViolations}->${s.beam.constraintViolations}, unresolved ${s.greedy.objectivesUnresolved}->${s.beam.objectivesUnresolved}, category deltas: ${JSON.stringify(s.categoryDistributionDelta)}`);
  }
});
console.log('');
