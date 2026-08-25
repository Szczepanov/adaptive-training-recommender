import { describe, expect, it } from 'vitest';
import { computeDerivedPlanFeatures } from '../derivedFeatures.mjs';

describe('computeDerivedPlanFeatures', () => {
  it('computes factual duration, cost, and category counts accurately', () => {
    const plan = [
      {
        day: 1,
        date: '2026-06-01',
        session: {
          templateId: 'tempo_intervals',
          title: 'Tempo Intervals',
          category: 'Threshold Intervals',
          modality: 'Cycling',
          durationMin: 60,
          systemicCost: 0.7,
          costProfile: { systemic: 0.7, cardiovascular: 0.8, neuromuscular: 0.6 },
          requiredEquipment: ['smart_trainer'],
        },
      },
      {
        day: 2,
        date: '2026-06-02',
        session: {
          templateId: 'easy_recovery',
          title: 'Easy Spin',
          category: 'Recovery',
          modality: 'Cycling',
          durationMin: 30,
          systemicCost: 0.2,
          costProfile: { systemic: 0.2, cardiovascular: 0.2, neuromuscular: 0.1 },
          requiredEquipment: ['bike'],
        },
      },
      {
        day: 3,
        date: '2026-06-03',
        session: {
          templateId: 'vo2max_surges',
          title: 'VO2 Max Surges',
          category: 'Anaerobic / Surges',
          modality: 'Cycling',
          durationMin: 45,
          systemicCost: 0.85,
          costProfile: { systemic: 0.85, cardiovascular: 0.9, neuromuscular: 0.8 },
          requiredEquipment: ['smart_trainer'],
        },
      },
    ];

    const inputContext = {
      event: { date: '2026-06-05' },
      constraints: { restrictedModalities: ['Running'] },
    };

    const features = computeDerivedPlanFeatures(plan, inputContext);

    expect(features.totalPlannedDurationMin).toBe(135);
    expect(features.cumulativeSystemicCost).toBe(1.75);
    expect(features.cumulativeCardiovascularCost).toBe(1.9);
    expect(features.cumulativeNeuromuscularCost).toBe(1.5);
    expect(features.hardSessionCount).toBe(2);
    expect(features.recoveryOrRestDayCount).toBe(1);
    expect(features.consecutiveHardDaysMax).toBe(1);
    expect(features.modalityDistribution).toEqual({ Cycling: 3 });
    expect(features.categoryDistribution).toEqual({
      'Threshold Intervals': 1,
      Recovery: 1,
      'Anaerobic / Surges': 1,
    });
    expect(features.requiredEquipmentUsed).toEqual(['bike', 'smart_trainer']);
    expect(features.restrictedModalitiesViolated).toEqual([]);
    expect(features.daysFromLastHardSessionToEvent).toBe(2); // 2026-06-03 to 2026-06-05
    expect(features.eventWeekHardSessionCount).toBe(2);
  });

  it('detects restricted modality violations and consecutive hard day clusters', () => {
    const plan = [
      {
        day: 1,
        date: '2026-06-01',
        session: {
          templateId: 'hard_run_1',
          title: 'Hard Run 1',
          category: 'Threshold',
          modality: 'Running',
          durationMin: 45,
          systemicCost: 0.75,
        },
      },
      {
        day: 2,
        date: '2026-06-02',
        session: {
          templateId: 'hard_run_2',
          title: 'Hard Run 2',
          category: 'Threshold',
          modality: 'Running',
          durationMin: 45,
          systemicCost: 0.75,
        },
      },
    ];

    const inputContext = {
      constraints: { restrictedModalities: ['Running'] },
    };

    const features = computeDerivedPlanFeatures(plan, inputContext);

    expect(features.hardSessionCount).toBe(2);
    expect(features.consecutiveHardDaysMax).toBe(2);
    expect(features.restrictedModalitiesViolated).toHaveLength(2);
    expect(features.restrictedModalitiesViolated[0].modality).toBe('Running');
  });
});
