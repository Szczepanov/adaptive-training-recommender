import { describe, expect, it } from 'vitest';
import { buildMicrocycleState, creditObjectivesFromStimulus, generateWeeklyObjectives, stimulusCoverage, updateMicrocycleProgress } from './microcycle.ts';
import type { MicrocycleState, UserEvent, WorkoutStimulusProfile } from './models.ts';
import type { CompletedExposure } from './trainingHistory.ts';
import { completedEventToExposure, DEFAULT_COST_BY_MODALITY, DEFAULT_STIMULUS_BY_MODALITY } from './completedTraining.ts';
import { evaluatePeriodizationPhase } from './periodization.ts';

describe('updateMicrocycleProgress', () => {
  it('credits controlled field work toward surge repeatability', () => {
    const microcycle = { windowStartDate: '2026-08-03', objectives: [{ id: 'surges', key: 'surge_repeatability' as const, title: 'Surges', targetExposures: 1, completedExposures: 0, targetStimulus: { repeatedSurges: 0.9 } }] };
    const updated = updateMicrocycleProgress(microcycle, {
      id: 'field-1', userId: 'athlete-1', title: 'Field Field Maintenance', date: '2026-08-07', durationMin: 40,
      isCompleted: true, fixed: true, environment: 'outdoor', equipment: [],
      createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    });
    expect(updated.objectives.find((objective) => objective.key === 'surge_repeatability')?.completedExposures).toBe(1);
  });
});

describe('creditObjectivesFromStimulus (regression: the split-brain ledger bug)', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0,
  };
  const microcycleWith = (targetStimulus: Record<string, number>): MicrocycleState => ({
    windowStartDate: '2026-08-03',
    objectives: [{ id: 'obj', key: 'threshold_quality', title: 'Threshold Development', targetExposures: 1, completedExposures: 0, targetStimulus }],
  });

  it('credits an objective a pick genuinely covers, using the SAME vector that earned it the benefit score', () => {
    const microcycle = microcycleWith({ thresholdPower: 0.9 });
    const tempoRideStimulus: WorkoutStimulusProfile = { ...zeroStimulus, aerobicEndurance: 0.7, thresholdPower: 0.8 };
    const updated = creditObjectivesFromStimulus(microcycle, tempoRideStimulus, 'Cycling');
    expect(updated.objectives[0].completedExposures).toBe(1);
  });

  it('does NOT credit an objective a pick only touches with a token amount (false-positive guard)', () => {
    const microcycle = microcycleWith({ aerobicEndurance: 0.8 });
    const technicalDrillStimulus: WorkoutStimulusProfile = { ...zeroStimulus, aerobicEndurance: 0.1, repeatedSurges: 0.2 };
    const updated = creditObjectivesFromStimulus(microcycle, technicalDrillStimulus, 'Cycling');
    expect(updated.objectives[0].completedExposures).toBe(0);
  });

  it('never exceeds targetExposures and leaves already-resolved objectives untouched', () => {
    const microcycle: MicrocycleState = {
      windowStartDate: '2026-08-03',
      objectives: [{ id: 'obj', key: 'threshold_quality', title: 'Threshold Development', targetExposures: 1, completedExposures: 1, targetStimulus: { thresholdPower: 0.9 } }],
    };
    const updated = creditObjectivesFromStimulus(microcycle, { ...zeroStimulus, thresholdPower: 1.0 }, 'Cycling');
    expect(updated.objectives[0].completedExposures).toBe(1);
  });

  it('stimulusCoverage is 0 for an objective with no target axes, and is a target-weighted average of the stimulus (matching calculateStimulusBenefit\'s own target*stimulus convention)', () => {
    expect(stimulusCoverage(zeroStimulus, {})).toBe(0);
    expect(stimulusCoverage({ ...zeroStimulus, aerobicEndurance: 0.8 }, { aerobicEndurance: 0.8 })).toBeCloseTo(0.8, 5);
    expect(stimulusCoverage({ ...zeroStimulus, aerobicEndurance: 0.1 }, { aerobicEndurance: 0.8 })).toBeCloseTo(0.1, 5);
    const mixedStimulus: WorkoutStimulusProfile = { ...zeroStimulus, thresholdPower: 0.9, aerobicEndurance: 0.1 };
    const mixedTarget = { thresholdPower: 0.9, aerobicEndurance: 0.1 };
    expect(stimulusCoverage(mixedStimulus, mixedTarget)).toBeGreaterThan(0.8);
  });
});

describe('surge_repeatability qualification', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0,
  };
  const cyclingSurgeObjective = (): MicrocycleState => ({
    windowStartDate: '2026-08-03',
    objectives: [{
      id: 'obj-surges', key: 'surge_repeatability', title: 'Surges', targetExposures: 1, completedExposures: 0,
      targetStimulus: { repeatedSurges: 0.9, aerobicEndurance: 0.5 },
      qualification: { minimumStimulus: { repeatedSurges: 0.6 }, allowedModalities: ['Cycling'] },
    }],
  });

  it('rejects a broad Cycling tempo stimulus that passes weighted coverage but misses the surge minimum', () => {
    const updated = creditObjectivesFromStimulus(cyclingSurgeObjective(), { ...zeroStimulus, aerobicEndurance: 0.9, repeatedSurges: 0.5 }, 'Cycling');
    expect(updated.objectives[0].completedExposures).toBe(0);
  });

  it('rejects a high-surge Strength candidate for a cycling-scoped objective', () => {
    const updated = creditObjectivesFromStimulus(cyclingSurgeObjective(), { ...zeroStimulus, aerobicEndurance: 0.7, repeatedSurges: 0.8 }, 'Strength');
    expect(updated.objectives[0].completedExposures).toBe(0);
  });

  it('credits a Cycling candidate that clears both the coverage and strict surge gates', () => {
    const updated = creditObjectivesFromStimulus(cyclingSurgeObjective(), { ...zeroStimulus, aerobicEndurance: 0.7, repeatedSurges: 0.8 }, 'Cycling');
    expect(updated.objectives[0].completedExposures).toBe(1);
  });

  it('allows a qualifying non-Cycling candidate when the objective is intentionally unscoped', () => {
    const microcycle = cyclingSurgeObjective();
    microcycle.objectives[0].qualification = { minimumStimulus: { repeatedSurges: 0.6 } };
    const updated = creditObjectivesFromStimulus(microcycle, { ...zeroStimulus, aerobicEndurance: 0.7, repeatedSurges: 0.8 }, 'Field');
    expect(updated.objectives[0].completedExposures).toBe(1);
  });

  it('preserves legacy weighted-average behavior for an objective without qualification', () => {
    const microcycle: MicrocycleState = {
      windowStartDate: '2026-08-03',
      objectives: [{ id: 'obj', key: 'surge_repeatability', title: 'Surges', targetExposures: 1, completedExposures: 0, targetStimulus: { repeatedSurges: 0.9, aerobicEndurance: 0.5 } }],
    };
    const updated = creditObjectivesFromStimulus(microcycle, { ...zeroStimulus, aerobicEndurance: 0.9, repeatedSurges: 0.5 }, 'Strength');
    expect(updated.objectives[0].completedExposures).toBe(1);
  });
});

describe('structured completed-history credit', () => {
  it('uses structured evidence rather than a loose activity title when rebuilding a microcycle', () => {
    const phase = {
      phaseName: 'Specificity' as const,
      targetDemandVector: { aerobicEndurance: 0.6, thresholdPower: 0.6, vo2MaxPower: 0.8, repeatedSurges: 0.9, sprintPower: 0.2, fatigueResistance: 0.6, neuromuscular: 0.2 },
      volumeScale: 1, intensityScale: 1, taperActive: false,
    };
    const event: UserEvent = {
      id: 'criterion', title: 'Criterium', date: '2026-09-10', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
      demandProfile: phase.targetDemandVector,
    };
    const exposure: CompletedExposure = {
      date: '2026-08-06',
      costProfile: { systemic: 0.5, cardiovascular: 0.6, lowerBody: 0.4, upperBody: 0, impactTissue: 0.1, neuromuscular: 0.3 },
      trainingRecordLike: { type: 'Cycling Race-Specific Endurance', duration_min: 60, training_effect: 0, intensity_tag: '' },
      modality: 'Cycling',
      stimulusProfile: { aerobicEndurance: 0.7, thresholdPower: 0.5, vo2MaxPower: 0, repeatedSurges: 0.5, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0 },
    };
    const microcycle = buildMicrocycleState(phase, '2026-08-03', [exposure], event);
    expect(microcycle.objectives.find(objective => objective.key === 'surge_repeatability')?.completedExposures).toBe(0);
  });
});

describe('evidence hierarchy confidence weighting (Phase 5.5)', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0,
  };
  const zone2Microcycle = (): MicrocycleState => ({
    windowStartDate: '2026-08-03',
    objectives: [{ id: 'obj', key: 'zone2_aerobic', title: 'Aerobic Base', targetExposures: 1, completedExposures: 0, requiredCredit: 0.8, completedCredit: 0, targetStimulus: { aerobicEndurance: 0.8 } }],
  });

  it('credits full weight with the default confidence (unchanged from before this parameter existed)', () => {
    const updated = creditObjectivesFromStimulus(zone2Microcycle(), { ...zeroStimulus, aerobicEndurance: 0.8 }, 'Cycling');
    expect(updated.objectives[0].completedCredit).toBe(0.8);
  });

  it('discounts credit for inferred confidence', () => {
    const updated = creditObjectivesFromStimulus(zone2Microcycle(), { ...zeroStimulus, aerobicEndurance: 0.8 }, 'Cycling', undefined, {}, 'inferred');
    expect(updated.objectives[0].completedCredit).toBe(0.6);
  });

  it('still credits a modality-agnostic objective from an exposure with no known modality at all', () => {
    const updated = creditObjectivesFromStimulus(zone2Microcycle(), { ...zeroStimulus, aerobicEndurance: 0.8 }, undefined, undefined, {}, 'unknown');
    expect(updated.objectives[0].completedCredit).toBeGreaterThan(0);
    expect(updated.objectives[0].completedCredit).toBe(0.32);
  });

  it('buildMicrocycleState credits an exposure that has a stimulusProfile but no modality (Phase 5.5 relaxed gate)', () => {
    const exposure: CompletedExposure = {
      date: '2026-08-06',
      costProfile: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.2, upperBody: 0, impactTissue: 0.1, neuromuscular: 0.2 },
      trainingRecordLike: { type: 'Unknown unknown', duration_min: 40, training_effect: 0, intensity_tag: '' },
      stimulusProfile: { ...zeroStimulus, aerobicEndurance: 0.5 },
      stimulusConfidence: 'unknown',
    };
    const phase = evaluatePeriodizationPhase([], '2026-08-03').phase;
    const microcycle = buildMicrocycleState(phase, '2026-08-03', [exposure], null);
    const z2 = microcycle.objectives.find(o => o.key === 'zone2_aerobic');
    expect(z2?.completedCredit).toBeGreaterThan(0);
  });

  it('buildMicrocycleState defaults an exposure with no stimulusConfidence field to exact (legacy compatibility)', () => {
    const exposure: CompletedExposure = {
      date: '2026-08-06',
      costProfile: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.2, upperBody: 0, impactTissue: 0.1, neuromuscular: 0.2 },
      trainingRecordLike: { type: 'Cycling moderate', duration_min: 40, training_effect: 0, intensity_tag: '' },
      modality: 'Cycling',
      stimulusProfile: { ...zeroStimulus, aerobicEndurance: 0.8 },
    };
    const phase = evaluatePeriodizationPhase([], '2026-08-03').phase;
    const microcycle = buildMicrocycleState(phase, '2026-08-03', [exposure], null);
    const z2 = microcycle.objectives.find(o => o.key === 'zone2_aerobic');
    expect(z2?.completedCredit).toBe(0.8);
  });
});

describe('taper as an explicit contract (Phase 5.7)', () => {
  const aCyclingEvent = (): UserEvent => ({
    id: 'race', title: 'A-Priority Road Race', date: '2026-08-14', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event', taper: { startDate: '2026-08-07' },
    demandProfile: { aerobicEndurance: 0.7, thresholdPower: 0.6, vo2MaxPower: 0.4, repeatedSurges: 0.7, sprintPower: 0.2, fatigueResistance: 0.85, neuromuscular: 0.3 },
  });

  it('generates a taper-calibrated race_specific_endurance objective instead of silently dropping it', () => {
    const result = evaluatePeriodizationPhase([aCyclingEvent()], '2026-08-07');
    expect(result.phase.taperActive).toBe(true);
    const microcycle = generateWeeklyObjectives(result.phase, '2026-08-03', result.focusEvent);
    const taperObjective = microcycle.objectives.find(o => o.key === 'race_specific_endurance');
    expect(taperObjective).toBeDefined();
    expect(taperObjective?.title).toBe('Taper Sharpening (event-specific freshness)');
    expect(taperObjective?.qualification?.minimumStimulus?.aerobicEndurance).toBeUndefined();
    expect(taperObjective?.qualification?.minimumStimulus?.thresholdPower).toBe(0.3);
  });

  it('the taper objective is actually satisfiable by end_taper_sharpen_01\'s real stimulus profile', () => {
    const taperSharpeningStimulus: WorkoutStimulusProfile = {
      aerobicEndurance: 0.3, thresholdPower: 0.6, vo2MaxPower: 0.5, repeatedSurges: 0.5,
      sprintPower: 0.1, fatigueResistance: 0.4, maxStrength: 0, hypertrophy: 0,
    };
    const result = evaluatePeriodizationPhase([aCyclingEvent()], '2026-08-07');
    const microcycle = generateWeeklyObjectives(result.phase, '2026-08-03', result.focusEvent);
    const updated = creditObjectivesFromStimulus(microcycle, taperSharpeningStimulus, 'Cycling', 'Race-Specific Endurance');
    const taperObjective = updated.objectives.find(o => o.key === 'race_specific_endurance');
    expect(taperObjective?.completedCredit ?? taperObjective?.completedExposures).toBeGreaterThan(0);
  });

  it('reduces the strength_maintenance target during taper (race-week primer, not full volume)', () => {
    const result = evaluatePeriodizationPhase([aCyclingEvent()], '2026-08-07');
    const microcycle = generateWeeklyObjectives(result.phase, '2026-08-03', result.focusEvent);
    const strengthObjective = microcycle.objectives.find(o => o.key === 'strength_maintenance');
    expect(strengthObjective?.title).toBe('Race-Week Strength Primer');
    expect(strengthObjective?.targetStimulus.maxStrength).toBe(0.3);
    expect(strengthObjective?.targetStimulus.maxStrength).toBeLessThan(0.7);
  });

  it('keeps the full-volume race_specific_endurance target outside taper (regression guard)', () => {
    const result = evaluatePeriodizationPhase([aCyclingEvent()], '2026-07-01');
    expect(result.phase.taperActive).toBe(false);
    const microcycle = generateWeeklyObjectives(result.phase, '2026-06-27', result.focusEvent);
    const objective = microcycle.objectives.find(o => o.key === 'race_specific_endurance');
    expect(objective?.title).toBe('Cycling Race-Specific Endurance');
    expect(objective?.qualification?.minimumStimulus?.aerobicEndurance).toBe(0.6);
  });

  it('plan-derived: the event-relative cycling plan requests taper_sharpening and race_week_strength coverage during its taper block', async () => {
    const { buildSeptemberCyclingEventPlan } = await import('./planSchedule.ts');
    const septemberEvent: UserEvent = {
      id: 'sep-event-1', title: 'September Cycling Event', date: '2026-09-20', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event', taper: { startDate: '2026-09-06' },
      demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
    };
    const planState = buildSeptemberCyclingEventPlan(septemberEvent);
    expect(planState.status).toBe('AVAILABLE');
    if (planState.status !== 'AVAILABLE') return;

    const taperSharpening = planState.data.objectives.find(o => o.coverageKey === 'taper_sharpening');
    const raceWeekStrength = planState.data.objectives.find(o => o.coverageKey === 'race_week_strength');
    expect(taperSharpening?.role).toBe('taper_sharpening');
    expect(raceWeekStrength?.role).toBe('secondary_support');

    // 2026-09-10 falls inside the event-relative A taper (2026-09-06..2026-09-19).
    const phase = evaluatePeriodizationPhase([septemberEvent], '2026-09-10').phase;
    const microcycle = generateWeeklyObjectives(phase, '2026-09-10', septemberEvent, planState.data);
    const sharpening = microcycle.objectives.find(o => o.key === 'race_specific_endurance');
    expect(sharpening?.title).toBe('Taper Sharpening (event-specific freshness)');
    const strength = microcycle.objectives.find(o => o.key === 'strength_maintenance');
    expect(strength?.title).toBe('Race-Week Strength Primer');
    expect(strength?.targetStimulus.maxStrength).toBe(0.3);
  });
});

describe('protected race-specific cycling objective', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0,
  };
  const objective: MicrocycleState = {
    windowStartDate: '2026-08-03',
    objectives: [{
      id: 'race-specific', key: 'race_specific_endurance', title: 'Cycling Race-Specific Endurance', targetExposures: 1, completedExposures: 0,
      targetStimulus: { aerobicEndurance: 0.6, repeatedSurges: 0.6 },
      qualification: { minimumStimulus: { aerobicEndurance: 0.6 }, allowedModalities: ['Cycling'], allowedCategories: ['Race-Specific Endurance'] },
    }],
  };

  it('cannot be completed by a broadly similar cycling interval outside the required category', () => {
    const updated = creditObjectivesFromStimulus(objective, { ...zeroStimulus, aerobicEndurance: 0.7, repeatedSurges: 1 }, 'Cycling', 'Hard Endurance');
    expect(updated.objectives[0].completedExposures).toBe(0);
  });

  it('credits only a cycling Race-Specific Endurance session that clears the stimulus gate', () => {
    const updated = creditObjectivesFromStimulus(objective, { ...zeroStimulus, aerobicEndurance: 0.7, repeatedSurges: 0.6 }, 'Cycling', 'Race-Specific Endurance');
    expect(updated.objectives[0].completedExposures).toBe(1);
  });
});

describe('threshold qualification', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0,
  };
  const cyclingThreshold: MicrocycleState = {
    windowStartDate: '2026-08-03',
    objectives: [{
      id: 'threshold', key: 'threshold_quality', title: 'Threshold Development', targetExposures: 1, completedExposures: 0,
      targetStimulus: { thresholdPower: 0.9 },
      qualification: { minimumStimulus: { thresholdPower: 0.6 }, allowedModalities: ['Cycling'] },
    }],
  };

  it('requires both meaningful threshold stimulus and the event-relevant modality', () => {
    const nonCycling = creditObjectivesFromStimulus(cyclingThreshold, { ...zeroStimulus, thresholdPower: 0.9 }, 'Strength');
    const tooEasy = creditObjectivesFromStimulus(cyclingThreshold, { ...zeroStimulus, thresholdPower: 0.5 }, 'Cycling');
    const qualifying = creditObjectivesFromStimulus(cyclingThreshold, { ...zeroStimulus, thresholdPower: 0.7 }, 'Cycling');
    expect(nonCycling.objectives[0].completedExposures).toBe(0);
    expect(tooEasy.objectives[0].completedExposures).toBe(0);
    expect(qualifying.objectives[0].completedExposures).toBe(1);
  });
});

describe('Task 1.2 / F2 Garmin objective crediting', () => {
  it('credits zone2_aerobic and strength_maintenance from 3 Garmin-measured sessions', () => {
    const phase = evaluatePeriodizationPhase([], '2026-08-03').phase;
    const history: CompletedExposure[] = [
      completedEventToExposure({
        id: 'garmin:1', date: '2026-08-04', durationMin: 60, modality: 'Cycling', intensity: 'moderate',
        trainingEffect: 2.5, estimatedCost: DEFAULT_COST_BY_MODALITY['Cycling']['moderate'],
        estimatedStimulus: DEFAULT_STIMULUS_BY_MODALITY['Cycling']['moderate'], exactTemplateMatch: false,
        sources: ['garmin'], confidence: 'high', linkedActivityId: '1', linkedRecommendationDate: null,
        athleteFeedback: { followed: null, notes: null },
      }),
      completedEventToExposure({
        id: 'garmin:2', date: '2026-08-05', durationMin: 60, modality: 'Cycling', intensity: 'moderate',
        trainingEffect: 2.7, estimatedCost: DEFAULT_COST_BY_MODALITY['Cycling']['moderate'],
        estimatedStimulus: DEFAULT_STIMULUS_BY_MODALITY['Cycling']['moderate'], exactTemplateMatch: false,
        sources: ['garmin'], confidence: 'high', linkedActivityId: '2', linkedRecommendationDate: null,
        athleteFeedback: { followed: null, notes: null },
      }),
      completedEventToExposure({
        id: 'garmin:3', date: '2026-08-06', durationMin: 45, modality: 'Strength', intensity: 'moderate',
        trainingEffect: 2.0, estimatedCost: DEFAULT_COST_BY_MODALITY['Strength']['moderate'],
        estimatedStimulus: DEFAULT_STIMULUS_BY_MODALITY['Strength']['moderate'], exactTemplateMatch: false,
        sources: ['garmin'], confidence: 'high', linkedActivityId: '3', linkedRecommendationDate: null,
        athleteFeedback: { followed: null, notes: null },
      }),
    ];

    const state = buildMicrocycleState(phase, '2026-08-03', history, null);
    const z2 = state.objectives.find(o => o.key === 'zone2_aerobic');
    const str = state.objectives.find(o => o.key === 'strength_maintenance');
    expect(z2?.completedExposures).toBe(2);
    expect(str?.completedExposures).toBe(1);
  });

  it('prevents a hard cycling session from false-positive double-crediting zone2_aerobic', () => {
    const phase = evaluatePeriodizationPhase([], '2026-08-03').phase;
    const history: CompletedExposure[] = [
      completedEventToExposure({
        id: 'garmin:hard-ride', date: '2026-08-04', durationMin: 60, modality: 'Cycling', intensity: 'hard',
        trainingEffect: 3.8, estimatedCost: DEFAULT_COST_BY_MODALITY['Cycling']['hard'],
        estimatedStimulus: DEFAULT_STIMULUS_BY_MODALITY['Cycling']['hard'], exactTemplateMatch: false,
        sources: ['garmin'], confidence: 'high', linkedActivityId: 'hard-ride', linkedRecommendationDate: null,
        athleteFeedback: { followed: null, notes: null },
      }),
    ];
    const state = buildMicrocycleState(phase, '2026-08-03', history, null);
    const z2 = state.objectives.find(o => o.key === 'zone2_aerobic');
    const thresh = state.objectives.find(o => o.key === 'threshold_quality');
    expect(z2?.completedExposures).toBe(0);
    expect(thresh?.completedExposures).toBe(1);
  });

  it('prefers the exact template stimulus profile for adherence-followed exposures', () => {
    const exposure: CompletedExposure = {
      date: '2026-08-04',
      costProfile: { systemic: 0.5, cardiovascular: 0.5, lowerBody: 0.5, upperBody: 0, impactTissue: 0, neuromuscular: 0.2 },
      trainingRecordLike: { type: 'Cycling Zone 2 Base', duration_min: 60, training_effect: 0, intensity_tag: '' },
      modality: 'Cycling',
      stimulusConfidence: 'exact',
      stimulusProfile: { aerobicEndurance: 0.9, thresholdPower: 0.1, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0 },
    };
    const phase = evaluatePeriodizationPhase([], '2026-08-03').phase;
    const state = buildMicrocycleState(phase, '2026-08-03', [exposure], null);
    const z2 = state.objectives.find(o => o.key === 'zone2_aerobic');
    expect(z2?.completedExposures).toBe(1);
  });
});

describe('Task 2.2 PlanDefinition & PlanSchedule', () => {
  const septemberEvent: UserEvent = {
    id: 'sep-event-1', title: 'September Cycling Event', date: '2026-09-20', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
    taper: { startDate: '2026-09-06' },
    demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
  };

  it('generates plan-derived objectives with event-relative dated block windows, scoped to the active block', async () => {
    const { buildSeptemberCyclingEventPlan } = await import('./planSchedule.ts');
    const { generateWeeklyObjectives } = await import('./microcycle.ts');
    const planState = buildSeptemberCyclingEventPlan(septemberEvent);
    expect(planState.status).toBe('AVAILABLE');
    if (planState.status !== 'AVAILABLE') return;

    const phase = evaluatePeriodizationPhase([septemberEvent], '2026-08-03').phase;
    const microcycle = generateWeeklyObjectives(phase, '2026-08-03', septemberEvent, planState.data);
    expect(microcycle.windowStartDate).toBe('2026-08-03');
    const buildObjectiveCount = planState.data.objectives.filter(o => o.blockId === 'block_build').length;
    expect(microcycle.objectives.length).toBe(buildObjectiveCount);
    expect(microcycle.objectives.every(o => o.windowStart === '2026-06-28' && o.windowEnd === '2026-08-15')).toBe(true);

    const z2BuildObj = microcycle.objectives.find(o => o.key === 'zone2_aerobic');
    expect(z2BuildObj).toBeDefined();
    expect(z2BuildObj?.windowStart).toBe('2026-06-28');
    expect(z2BuildObj?.windowEnd).toBe('2026-08-15');
  });

  it('scopes to the event-relative Specificity/peak block when asOfDate moves closer to the event', async () => {
    const { buildSeptemberCyclingEventPlan } = await import('./planSchedule.ts');
    const { generateWeeklyObjectives } = await import('./microcycle.ts');
    const planState = buildSeptemberCyclingEventPlan(septemberEvent);
    if (planState.status !== 'AVAILABLE') throw new Error('expected AVAILABLE plan');

    const phase = evaluatePeriodizationPhase([septemberEvent], '2026-09-01').phase;
    const microcycle = generateWeeklyObjectives(phase, '2026-08-25', septemberEvent, planState.data, '2026-09-01');
    const peakObjectiveCount = planState.data.objectives.filter(o => o.blockId === 'block_peak').length;
    expect(microcycle.objectives.length).toBe(peakObjectiveCount);
    expect(microcycle.objectives.every(o => o.windowStart === '2026-08-16' && o.windowEnd === '2026-09-05')).toBe(true);
    expect(microcycle.objectives.some(o => o.key === 'race_specific_endurance')).toBe(true);
  });

  it('returns no plan-derived objectives when asOfDate falls before the event-relative plan horizon', async () => {
    const { buildSeptemberCyclingEventPlan } = await import('./planSchedule.ts');
    const { generateWeeklyObjectives } = await import('./microcycle.ts');
    const planState = buildSeptemberCyclingEventPlan(septemberEvent);
    if (planState.status !== 'AVAILABLE') throw new Error('expected AVAILABLE plan');

    const phase = evaluatePeriodizationPhase([septemberEvent], '2026-06-20').phase;
    const microcycle = generateWeeklyObjectives(phase, '2026-06-20', septemberEvent, planState.data, '2026-06-20');
    expect(microcycle.objectives).toEqual([]);
  });

  it('rejects invalid plan definitions with overlapping blocks', async () => {
    const { buildPlanDefinition } = await import('./planSchedule.ts');
    const { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } = await import('../workouts/event-plan.ts');
    const event: UserEvent = {
      id: 'event-overlap', title: 'Test Event', date: '2026-09-20', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
      demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
    };
    const invalidBlocks = [
      { id: 'b1', phase: 'build' as const, startDate: '2026-08-01', endDate: '2026-08-15', volumeScale: 1.0, intensityScale: 1.0 },
      { id: 'b2', phase: 'peak' as const, startDate: '2026-08-10', endDate: '2026-08-25', volumeScale: 1.0, intensityScale: 1.0 },
    ];
    const result = buildPlanDefinition(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE, invalidBlocks, event);
    expect(result.status).toBe('INVALID');
  });

  it('rejects an objective whose coverage is unavailable in its block phase', async () => {
    const { buildPlanDefinition } = await import('./planSchedule.ts');
    const { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } = await import('../workouts/event-plan.ts');
    const blocks = [
      { id: 'travel', phase: 'travel' as const, startDate: '2026-08-24', endDate: '2026-08-30', volumeScale: 0.6, intensityScale: 0.8 },
    ];
    const result = buildPlanDefinition(
      SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE,
      blocks,
      septemberEvent,
      [{ key: 'race_specific_endurance', coverageKey: 'outdoor_event_specific', blockId: 'travel', requiredCredit: 1, priority: 'must_have' }],
    );
    expect(result.status).toBe('INVALID');
    if (result.status === 'INVALID') {
      expect(result.issues.some(issue => issue.code === 'COVERAGE_UNAVAILABLE_IN_BLOCK_PHASE')).toBe(true);
    }
  });

  describe('resolvePlanDefinitionForEvent', () => {
    it('resolves the authored plan for a cycling event', async () => {
      const { resolvePlanDefinitionForEvent } = await import('./planSchedule.ts');
      const resolved = resolvePlanDefinitionForEvent(septemberEvent);
      expect(resolved).not.toBeNull();
      expect(resolved?.eventId).toBe(septemberEvent.id);
    });

    it('returns null for non-cycling events but generates cycling plans relative to arbitrary target dates', async () => {
      const { resolvePlanDefinitionForEvent } = await import('./planSchedule.ts');
      expect(resolvePlanDefinitionForEvent(null)).toBeNull();
      expect(resolvePlanDefinitionForEvent({ ...septemberEvent, category: 'running_race' })).toBeNull();
      const future = resolvePlanDefinitionForEvent({ ...septemberEvent, date: '2027-09-20', taper: undefined });
      expect(future).not.toBeNull();
      expect(future?.blocks.find(block => block.id === 'block_race')?.startDate).toBe('2027-09-20');
    });
  });
});
