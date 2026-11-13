import { describe, expect, it } from 'vitest';
import type { DailySubjectiveCheckin } from '../../ledger/models';
import { resolveRedFlagFindings } from './redFlagFindings';

function makeCheckin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'user-1',
        date: '2026-11-13',
        readiness: 7,
        sleepQuality: 7,
        fatigue: 3,
        soreness: 3,
        mentalStress: 3,
        motivation: 7,
        painOrInjury: false,
        illnessSymptoms: false,
        alreadyTrainedToday: false,
        unusuallyLimitedTime: false,
        ...overrides,
    } as DailySubjectiveCheckin;
}

describe('resolveRedFlagFindings', () => {
    it('returns empty array when checkin is null or has no red flags', () => {
        expect(resolveRedFlagFindings(null)).toEqual([]);
        expect(resolveRedFlagFindings(undefined)).toEqual([]);
        expect(resolveRedFlagFindings(makeCheckin())).toEqual([]);
    });

    it('resolves explicit checkin red-flag categories', () => {
        const findings = resolveRedFlagFindings(makeCheckin({
            redFlags: { present: true, categories: ['neurological', 'acute_trauma_structural'] },
        }));
        expect(findings).toEqual([
            {
                category: 'neurological',
                source: 'explicit_checkin',
                description: 'Athlete reported red-flag symptom: neurological.',
            },
            {
                category: 'acute_trauma_structural',
                source: 'explicit_checkin',
                description: 'Athlete reported red-flag symptom: acute trauma structural.',
            },
        ]);
    });

    it('ignores categories when redFlags.present is false', () => {
        expect(resolveRedFlagFindings(makeCheckin({
            redFlags: { present: false, categories: ['neurological'] },
        }))).toEqual([]);
    });

    it('resolves implicit systemic_infection from severe fever_or_chills without duplicating explicit systemic_infection', () => {
        const implicit = resolveRedFlagFindings(makeCheckin({
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'severe',
                    types: ['fever_or_chills'],
                },
            },
        }));
        expect(implicit).toEqual([
            {
                category: 'systemic_infection',
                source: 'severe_systemic_symptoms',
                description: 'Severe fever or chills reported in health symptoms.',
            },
        ]);

        const both = resolveRedFlagFindings(makeCheckin({
            redFlags: { present: true, categories: ['systemic_infection'] },
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'severe',
                    types: ['fever_or_chills'],
                },
            },
        }));
        expect(both).toHaveLength(1);
        expect(both[0].source).toBe('explicit_checkin');
    });
});
