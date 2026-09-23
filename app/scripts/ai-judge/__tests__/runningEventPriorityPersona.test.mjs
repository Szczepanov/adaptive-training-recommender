import { describe, expect, it } from 'vitest';
import { buildPersonaFamilies } from '../personaSuite.mjs';
import { runScenario } from '../../../src/engine/simulation/analyze.ts';

const family = buildPersonaFamilies().find(({ familyId }) => familyId === 'persona_running_event_priority');

const resultByPriority = new Map();
async function resultFor(priority) {
  if (!resultByPriority.has(priority)) {
    const definition = family.cases.find(({ scenario }) => scenario.event.priority === priority);
    resultByPriority.set(priority, await runScenario(definition.scenario));
  }
  return resultByPriority.get(priority);
}

function raceSpecificVolume(result, fromDate = '0000-01-01') {
  const traces = result.decisionTraces.filter(({ selected, date }) => selected.category === 'Race-Specific Endurance' && date >= fromDate);
  return {
    count: traces.length,
    durationMax: traces.reduce((total, trace) => total + (trace.selected.durationMax ?? trace.selected.durationMin ?? 0), 0),
  };
}

function weekTwoBuildDuration(result) {
  return result.decisionTraces
    .filter(({ weekIndex, date }) => weekIndex === 1 && date < '2026-09-12')
    .reduce((total, trace) => total + (trace.selected.durationMax ?? trace.selected.durationMin ?? 0), 0);
}

describe('running event-priority persona (issue #698)', () => {
  it('keeps C-priority build duration above B through the 48-hour pre-event boundary', async () => {
    const bBuildDuration = weekTwoBuildDuration(await resultFor('B'));
    const cBuildDuration = weekTwoBuildDuration(await resultFor('C'));

    expect(cBuildDuration).toBeGreaterThan(bBuildDuration);
  });

  it('keeps the final 48-hour C-priority race-specific taper no more than B', async () => {
    const boundaryDate = '2026-09-12';
    const bVolume = raceSpecificVolume(await resultFor('B'), boundaryDate);
    const cVolume = raceSpecificVolume(await resultFor('C'), boundaryDate);

    expect(cVolume.count).toBeLessThanOrEqual(bVolume.count);
    expect(cVolume.durationMax).toBeLessThanOrEqual(bVolume.durationMax);
  });
});
