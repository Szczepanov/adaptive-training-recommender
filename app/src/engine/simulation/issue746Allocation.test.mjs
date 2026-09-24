import { describe, expect, it } from 'vitest';
import { makeAllFamilies } from '../../../scripts/build-plan-judge-corpus.mjs';
import { SCENARIOS } from './scenarios';
import * as deliveredDose from './deliveredDoseScenarios';
import { resolveDemandProfile } from '../eventPresets';
import { runScenario } from './analyze';

const cases = makeAllFamilies(SCENARIOS, deliveredDose, resolveDemandProfile)
  .flatMap(family => family.cases);
const scenarioFor = caseId => cases.find(item => item.scenario.id === caseId)?.scenario;

describe('issue #746 weekly strength allocation', () => {
  it('keeps a later reserved primary-strength date after heavy lower-body load', async () => {
    const scenario = scenarioFor('judge_concurrent_heavy_lower');
    expect(scenario).toBeDefined();
    const result = await runScenario(scenario);
    const week1 = result.allocationReports[0].report.outcomes;
    const strength = week1.find(outcome => outcome.occurrence.coverageKey === 'primary_strength');
    expect(strength).toBeDefined();
    expect(strength.status).toBe('fulfilled');
    expect(strength.reservation.templateId).toBe('str_full_03');
    expect(result.decisionTraces[1].selected.templateId).not.toBe('str_full_03');
  });

  it('reports an explicit strength miss rather than forcing heavy strength through soreness', async () => {
    const scenario = scenarioFor('judge_subj_soreness');
    expect(scenario).toBeDefined();
    const result = await runScenario(scenario);
    const week1 = result.allocationReports[0].report.outcomes;
    const strength = week1.find(outcome => outcome.occurrence.coverageKey === 'primary_strength');
    expect(strength).toBeDefined();
    expect(strength.status).toBe('missed');
    expect(strength.reason).toBeTruthy();
    expect(result.decisionTraces[1].selected.templateId).not.toBe('str_full_03');
  });
});
