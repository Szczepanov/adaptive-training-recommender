import { describe, expect, it } from 'vitest';
import { buildPersonaFamilies, assertPersonaFixtureIntegrity } from '../personaSuite.mjs';
import { runScenario } from '../../../src/engine/simulation/analyze.ts';
import { ENRICHED_TEMPLATES_BY_ID } from '../../../src/engine/templates.ts';

// Issue #679: deterministic engine-behavior fixtures for the four
// persona_triathlon_established_olympic cases an external LLM judge flagged --
// severe adverse recovery, a 45-minute weekday capacity, and the final 14-day A-event
// taper. These pin the concrete symptoms the issue reported (not the judge's subjective
// scoring) so a future regression is caught deterministically rather than by re-running
// an external judge sample.

const families = buildPersonaFamilies();
const triathlon = families.find(({ familyId }) => familyId === 'persona_triathlon_established_olympic');
const caseBySuffix = (suffix) => triathlon.cases.find(({ scenario }) => scenario.id === `persona_triathlon_established_olympic_${suffix}`);

const results = new Map();
async function resultFor(definition) {
  const id = definition.scenario.id;
  if (!results.has(id)) results.set(id, await runScenario(definition.scenario));
  return results.get(id);
}

const STRENGTH_CATEGORIES = ['Upper-body Strength', 'Lower-body Strength', 'Full-body Strength', 'Power Maintenance'];
const MODERATE_OR_HARDER_ENDURANCE_CATEGORIES = ['Moderate Endurance', 'Hard Endurance'];
const isWeekend = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
};
const dayDiff = (later, earlier) => {
  const toUtc = (date) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(later) - toUtc(earlier)) / 86400000);
};

describe('established Olympic-triathlon persona (issue #679)', () => {
  it('is exactly the four reviewed cases within the nine-family active suite', () => {
    expect(assertPersonaFixtureIntegrity(families)).toEqual({ familyCount: 9, caseCount: 30 });
    expect(triathlon.cases.map(({ scenario }) => scenario.id).sort()).toEqual([
      'persona_triathlon_established_olympic_adverse_recovery',
      'persona_triathlon_established_olympic_baseline',
      'persona_triathlon_established_olympic_short_time',
      'persona_triathlon_established_olympic_taper',
    ]);
  });

  it('baseline: preserves all three race disciplines over the two-week horizon', async () => {
    const result = await resultFor(caseBySuffix('baseline'));
    expect(result.decisionTraces).toHaveLength(14);
    const modalities = new Set(result.decisionTraces.map((trace) => trace.selected.modality));
    for (const modality of ['Swimming', 'Cycling', 'Running']) {
      expect([...modalities], `baseline should include ${modality}`).toContain(modality);
    }
  });

  it('adverse recovery: opens with rest/mobility only, then a graduated non-strength, easy-only re-entry before day 6', async () => {
    const definition = caseBySuffix('adverse_recovery');
    const result = await resultFor(definition);
    const traces = result.decisionTraces;
    expect(traces).toHaveLength(14);

    // Days 1-2 (offset 1-2): rest/mobility only.
    for (const trace of traces.slice(0, 2)) {
      expect(['Rest', 'Mobility/Recovery'], `${trace.date}: ${trace.selected.category}`).toContain(trace.selected.category);
    }

    // Day 3 (offset 3, index 2): first non-recovery work must still be low-cost,
    // non-strength, and below generic tempo/threshold/race-specific categories.
    const day3 = traces[2];
    const day3Cost = ENRICHED_TEMPLATES_BY_ID.get(day3.selected.templateId)?.systemicCost ?? 0;
    expect(day3.selected.modality, `${day3.date} should not resume Strength during early re-entry`).not.toBe('Strength');
    expect(MODERATE_OR_HARDER_ENDURANCE_CATEGORIES, `${day3.date} should not resume tempo/hard endurance`).not.toContain(day3.selected.category);
    expect(day3.selected.category, `${day3.date} should not resume race-specific work`).not.toBe('Race-Specific Endurance');
    if (day3.selected.category !== 'Rest' && day3.selected.category !== 'Mobility/Recovery') {
      expect(day3Cost, `${day3.date}: ${day3.selected.templateId} systemic cost`).toBeLessThanOrEqual(0.35);
    }

    // Days 4-5 may widen to the normal modify ceiling, but threshold/tempo, race-specific
    // work, and Strength still stay out until day 6 because there is no fresh readiness
    // check available inside a forecast.
    for (const trace of traces.slice(3, 5)) {
      const cost = ENRICHED_TEMPLATES_BY_ID.get(trace.selected.templateId)?.systemicCost ?? 0;
      expect(trace.selected.modality, `${trace.date} should not resume Strength during late re-entry`).not.toBe('Strength');
      expect(MODERATE_OR_HARDER_ENDURANCE_CATEGORIES, `${trace.date} should not resume tempo/hard endurance`).not.toContain(trace.selected.category);
      expect(trace.selected.category, `${trace.date} should not resume race-specific work`).not.toBe('Race-Specific Endurance');
      if (trace.selected.category !== 'Rest' && trace.selected.category !== 'Mobility/Recovery') {
        expect(cost, `${trace.date}: ${trace.selected.templateId} systemic cost`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('45-minute weekday capacity: every weekday session duration range (not just its minimum) respects the declared cap', async () => {
    const definition = caseBySuffix('short_time');
    const cap = definition.scenario.context.trainingSettings.defaults;
    expect(cap.weekdayMaxMinutes, 'the case must actually carry its named 45-minute weekday cap').toBe(45);

    const result = await resultFor(definition);
    expect(result.decisionTraces).toHaveLength(14);
    for (const trace of result.decisionTraces) {
      const weekend = isWeekend(trace.date);
      const capMinutes = weekend ? cap.weekendMaxMinutes : cap.weekdayMaxMinutes;
      expect(trace.selected.durationMin, `${trace.date} min`).toBeLessThanOrEqual(capMinutes);
      expect(trace.selected.durationMax, `${trace.date} max`).toBeLessThanOrEqual(capMinutes);
    }

    const modalities = new Set(result.decisionTraces.map((trace) => trace.selected.modality));
    for (const modality of ['Swimming', 'Cycling', 'Running']) {
      expect([...modalities], `short-time case should still include ${modality}`).toContain(modality);
    }
  });

  it('final 14-day taper: at most one light strength touch and no stacked moderate/hard endurance density near the A-event', async () => {
    const definition = caseBySuffix('taper');
    const result = await resultFor(definition);
    const traces = result.decisionTraces;
    expect(traces).toHaveLength(14);

    const strengthTraces = traces.filter((trace) => STRENGTH_CATEGORIES.includes(trace.selected.category) || trace.selected.modality === 'Strength');
    expect(strengthTraces.length, `strength touches: ${strengthTraces.map((t) => t.date).join(', ')}`).toBeLessThanOrEqual(1);
    for (const trace of strengthTraces) {
      const cost = ENRICHED_TEMPLATES_BY_ID.get(trace.selected.templateId)?.systemicCost ?? 0;
      expect(cost, `${trace.date} strength touch should be a light primer`).toBeLessThanOrEqual(0.35);
    }

    const denseTraces = traces.filter((trace) => MODERATE_OR_HARDER_ENDURANCE_CATEGORIES.includes(trace.selected.category));
    for (let i = 1; i < denseTraces.length; i += 1) {
      const gap = dayDiff(denseTraces[i].date, denseTraces[i - 1].date);
      expect(gap, `${denseTraces[i - 1].date} -> ${denseTraces[i].date} moderate/hard endurance gap`).toBeGreaterThan(3);
    }

    // No unjustified strength or exhaustive work in the final 3 days before the A-event
    // (the pre-event restriction window, now extended to triathlon events).
    const raceDate = definition.scenario.event.date;
    for (const trace of traces) {
      const daysToRace = dayDiff(raceDate, trace.date);
      if (daysToRace >= 1 && daysToRace <= 3) {
        expect(STRENGTH_CATEGORIES.includes(trace.selected.category) || trace.selected.modality === 'Strength',
          `${trace.date} (D-${daysToRace}) should not carry strength work`).toBe(false);
      }
      if (daysToRace === 3) {
        expect(MODERATE_OR_HARDER_ENDURANCE_CATEGORIES,
          `${trace.date} (D-3) should preserve sharpening rather than generic tempo/hard work`).not.toContain(trace.selected.category);
      }
    }
  });
});
