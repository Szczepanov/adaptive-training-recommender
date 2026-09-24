import { createServer } from 'vite';
import { makeAllFamilies } from '../../../scripts/build-plan-judge-corpus.mjs';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});

try {
  const scenarios = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');
  const analyze = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  const deliveredDose = await server.ssrLoadModule('/src/engine/simulation/deliveredDoseScenarios.ts');
  const eventPresets = await server.ssrLoadModule('/src/engine/eventPresets.ts');
  const families = makeAllFamilies(scenarios.SCENARIOS, deliveredDose, eventPresets.resolveDemandProfile);
  const caseId = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length);
  const definitions = families.flatMap(family => family.cases).filter(definition =>
    !caseId || definition.scenario.id === caseId);
  if (caseId && definitions.length !== 1) throw new Error(`Unknown judge case ${caseId}.`);
  const results = [];
  for (const definition of definitions) {
    const result = await analyze.runForecastDailyParityScenario(
      definition.scenario,
      definition.execution?.mode === 'rolling_daily' ? definition.execution.readinessForDay : undefined,
    );
    results.push({
      ...result,
      simulationMode: definition.execution?.mode ?? 'weekly_forecast',
    });
  }
  const total = key => results.reduce((sum, result) => sum + result[key], 0);
  const eligible = results.filter(result => result.simulationMode === 'weekly_forecast');
  const eligibleTotal = key => eligible.reduce((sum, result) => sum + result[key], 0);
  process.stdout.write(`${JSON.stringify({
    cases: results.length,
    weeklyForecastCases: eligible.length,
    rollingTrajectoryCases: results.length - eligible.length,
    all: {
      days: total('comparedDays'),
      matchingPicks: total('matchingPicks'),
      matchingCompletedCreditStates: total('matchingCompletedCreditStates'),
      matchingAgedCompletedCreditStates: total('matchingAgedCompletedCreditStates'),
      matchingAvailableCreditStates: total('matchingAvailableCreditStates'),
      matchingAgedAvailableCreditStates: total('matchingAgedAvailableCreditStates'),
      matchingForcedAvailableCreditStates: total('matchingForcedAvailableCreditStates'),
      matchingAgedForcedAvailableCreditStates: total('matchingAgedForcedAvailableCreditStates'),
      changedCompletedCreditDays: total('changedCompletedCreditDays'),
      unclassifiedObjectiveDays: total('unclassifiedObjectiveDays'),
    },
    weeklyForecast: {
      days: eligibleTotal('comparedDays'),
      matchingPicks: eligibleTotal('matchingPicks'),
      matchingCompletedCreditStates: eligibleTotal('matchingCompletedCreditStates'),
      matchingAgedCompletedCreditStates: eligibleTotal('matchingAgedCompletedCreditStates'),
      matchingAvailableCreditStates: eligibleTotal('matchingAvailableCreditStates'),
      matchingAgedAvailableCreditStates: eligibleTotal('matchingAgedAvailableCreditStates'),
      matchingForcedAvailableCreditStates: eligibleTotal('matchingForcedAvailableCreditStates'),
      matchingAgedForcedAvailableCreditStates: eligibleTotal('matchingAgedForcedAvailableCreditStates'),
      changedCompletedCreditDays: eligibleTotal('changedCompletedCreditDays'),
      unclassifiedObjectiveDays: eligibleTotal('unclassifiedObjectiveDays'),
    },
    agedPickParity: null,
    results: caseId ? results : results.map(({ days, ...summary }) => summary),
  }, null, 2)}\n`);
} finally {
  await server.close();
}
