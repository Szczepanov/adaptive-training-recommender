import { describe, expect, it } from 'vitest';
import { buildBlindFamilyPacket, compactFamilyForJudge, formatFamilyForPacketVersion } from '../packets.mjs';

describe('packets module', () => {
  const sampleRawFamily = {
    familyId: 'objective_recovery',
    changedAxis: 'objective recovery metrics',
    cases: [
      {
        input: {
          caseId: 'judge_obj_neutral',
          label: 'Objective recovery — neutral',
          changedAxis: { state: 'neutral' },
          readiness: {
            objective: { hrv_delta: 0, rhr: 50, sleep_score: 85 },
            subjective: { readiness: 8, fatigue: 2 },
          },
          event: {
            title: 'Criterium Championship',
            date: '2026-06-14',
            priority: 'A',
          },
          context: {
            constraints: { maxTimeMinutes: 60, hasFreeWeights: true },
            trainingSettings: {
              defaults: { weekdayMaxMinutes: 60 },
              guardrails: { avoid_high_impact: false },
            },
          },
          initialHistory: [
            {
              date: '2026-05-31',
              category: 'Easy Endurance',
              modality: 'Cycling',
              durationMin: 45,
            },
          ],
        },
        plan: [
          {
            day: 1,
            date: '2026-06-01',
            mode: 'event_directed',
            readinessTier: 'fresh',
            session: {
              templateId: 'criterium_intervals',
              title: 'Criterium Race Intervals',
              category: 'Anaerobic / Surges',
              modality: 'Cycling',
              durationMin: 60,
              systemicCost: 0.8,
            },
            utility: 0.92,
            rejectionCounts: { fatigue_ceiling: 2 },
          },
        ],
        engineSummary: {
          restOrRecoveryDayCount: 2,
          fatigueTierDayCounts: { fresh: 5 },
          categoryDistribution: { 'Anaerobic / Surges': 1 },
          qualityWarnings: ['High anaerobic surge load in week 1'],
          constraintViolations: [],
        },
      },
    ],
  };

  it('compactFamilyForJudge includes engineSummary for v1 baseline compatibility', () => {
    const v1 = compactFamilyForJudge(sampleRawFamily);
    expect(v1.familyId).toBe('objective_recovery');
    expect(v1.cases[0].engineSummary.warnings).toEqual(['High anaerobic surge load in week 1']);
    expect(v1.cases[0].day1.tier).toBe('fresh');
  });

  it('buildBlindFamilyPacket strips all engine warnings, violations, tier, and utility', () => {
    const v2 = buildBlindFamilyPacket(sampleRawFamily);

    expect(v2.packetSchema).toBe('adaptive-training-recommender/ai-plan-judge-packet@2');
    expect(v2.familyId).toBe('objective_recovery');

    const blindCase = v2.cases[0];
    expect(blindCase.caseId).toBe('judge_obj_neutral');

    // Verify raw athlete context is preserved
    expect(blindCase.inputContext.readiness.objective.hrv_delta).toBe(0);
    expect(blindCase.inputContext.readiness.subjective.readiness).toBe(8);
    expect(blindCase.inputContext.event.title).toBe('Criterium Championship');
    expect(blindCase.inputContext.constraints.maxTimeMinutes).toBe(60);

    // Verify derived features are computed
    expect(blindCase.derivedFeatures.hardSessionCount).toBe(1);
    expect(blindCase.derivedFeatures.totalPlannedDurationMin).toBe(60);

    // Verify all engine opinion/diagnostics are completely absent
    expect((blindCase as Record<string, unknown>).engineSummary).toBeUndefined();
    expect((blindCase.plan14d[0] as Record<string, unknown>).utility).toBeUndefined();
    expect((blindCase.plan14d[0] as Record<string, unknown>).readinessTier).toBeUndefined();
    expect((blindCase.plan14d[0] as Record<string, unknown>).rejectionCounts).toBeUndefined();
  });

  it('formatFamilyForPacketVersion selects appropriate format based on version argument', () => {
    const v1 = formatFamilyForPacketVersion(sampleRawFamily, 'v1');
    expect(v1.cases[0].engineSummary).toBeDefined();

    const v2 = formatFamilyForPacketVersion(sampleRawFamily, 'v2');
    expect((v2.cases[0] as Record<string, unknown>).engineSummary).toBeUndefined();
    expect(v2.cases[0].derivedFeatures).toBeDefined();

    const blind = formatFamilyForPacketVersion(sampleRawFamily, 'blind');
    expect((blind.cases[0] as Record<string, unknown>).engineSummary).toBeUndefined();
  });
});
