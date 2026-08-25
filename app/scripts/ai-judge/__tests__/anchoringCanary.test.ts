import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildBlindFamilyPacket, compactFamilyForJudge } from '../packets.mjs';
import { evaluateDiagnosticFidelity } from '../diagnosticsAudit.mjs';

describe('Anchoring Canary & Diagnostic Isolation', () => {
  const cleanRawFamily = {
    familyId: 'event_demand',
    changedAxis: 'event demand and priority',
    cases: [
      {
        input: {
          caseId: 'judge_demand_crit_A',
          label: 'Event demand — criterium A',
          changedAxis: { eventDemand: 'criterium', priority: 'A' },
          readiness: {
            objective: { hrv_delta: 0, rhr: 50 },
            subjective: { readiness: 8 },
          },
          event: {
            title: 'Criterium A-Race',
            date: '2026-06-20',
            priority: 'A',
          },
        },
        plan: [
          {
            day: 1,
            date: '2026-06-01',
            session: {
              templateId: 'criterium_prep',
              title: 'Criterium Prep',
              category: 'Anaerobic / Surges',
              modality: 'Cycling',
              durationMin: 60,
              systemicCost: 0.75,
            },
          },
        ],
        engineSummary: {
          qualityWarnings: [],
          constraintViolations: [],
        },
      },
    ],
  };

  const contaminatedRawFamily = {
    ...cleanRawFamily,
    cases: [
      {
        ...cleanRawFamily.cases[0],
        engineSummary: {
          qualityWarnings: ['CRITICAL_SAFETY_FAIL: Overload on day 1 with severe exhaustion risk'],
          constraintViolations: ['VIOLATION_EQUIPMENT_UNAVAILABLE: smart_trainer required'],
        },
      },
    ],
  };

  it('proves that blind packet serialization is immune to diagnostic contamination (zero hash drift)', () => {
    const cleanBlindPacket = buildBlindFamilyPacket(cleanRawFamily);
    const contaminatedBlindPacket = buildBlindFamilyPacket(contaminatedRawFamily);

    const cleanHash = createHash('sha256').update(JSON.stringify(cleanBlindPacket)).digest('hex');
    const contaminatedHash = createHash('sha256').update(JSON.stringify(contaminatedBlindPacket)).digest('hex');

    // Blind packets MUST produce identical JSON and identical hashes regardless of engine warnings/violations
    expect(cleanHash).toBe(contaminatedHash);
    expect(cleanBlindPacket).toEqual(contaminatedBlindPacket);

    // Contrast with unblinded v1 packets where warnings directly alter the payload
    const unblindedClean = compactFamilyForJudge(cleanRawFamily);
    const unblindedContaminated = compactFamilyForJudge(contaminatedRawFamily);
    expect(unblindedClean).not.toEqual(unblindedContaminated);
  });

  it('diagnostic audit module flags discrepancy when engine warnings contradict high judge score', () => {
    const judgedHighCase = {
      caseId: 'judge_demand_crit_A',
      scores: { overall: 9.0 },
      flags: [],
    };

    const fidelity = evaluateDiagnosticFidelity({
      casePlan: cleanRawFamily.cases[0].plan,
      engineSummary: {
        warnings: ['Questionable recovery spacing on day 5'],
        violations: [],
      },
      judgedCase: judgedHighCase,
    });

    expect(fidelity.diagnosticFidelity).toBe('potential_false_alarm');
    expect(fidelity.notes).toContain('quality warnings');
  });
});
