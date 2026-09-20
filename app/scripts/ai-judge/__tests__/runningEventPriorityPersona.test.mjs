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

function raceSpecificVolume(result) {
  const traces = result.decisionTraces.filter(({ selected }) => selected.category === 'Race-Specific Endurance');
  return {
    count: traces.length,
    durationMax: traces.reduce((total, trace) => total + (trace.selected.durationMax ?? trace.selected.durationMin ?? 0), 0),
  };
}

describe('running event-priority persona (issue #698)', () => {
  it('does not give C-priority more race-specific count or duration than B-priority', async () => {
    const bVolume = raceSpecificVolume(await resultFor('B'));
    const cVolume = raceSpecificVolume(await resultFor('C'));

    expect(cVolume.count).toBeLessThanOrEqual(bVolume.count);
    expect(cVolume.durationMax).toBeLessThanOrEqual(bVolume.durationMax);
  });
});
