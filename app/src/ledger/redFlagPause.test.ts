import { describe, expect, it } from 'vitest';
import { resolveClinicalEnvelopeSources } from '../engine/adapters';
import type { DailySubjectiveCheckin } from './models';
import { hasRecordedRedFlag } from './redFlagPause';

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date: '2026-11-13',
        readiness: 7,
        sleepQuality: 7,
        fatigue: 3,
        soreness: 3,
        mentalStress: 3,
        motivation: 7,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        ...overrides,
    } as DailySubjectiveCheckin;
}

const engineSaysRedFlag = (c: DailySubjectiveCheckin | null) =>
    resolveClinicalEnvelopeSources(c).includes('red_flag');

describe('hasRecordedRedFlag (ledger P2-2)', () => {
    const cases: Array<[string, DailySubjectiveCheckin | null, boolean]> = [
        ['no check-in', null, false],
        ['clean check-in', checkin(), false],
        ['present with categories', checkin({ redFlags: { present: true, categories: ['neurological'] } }), true],
        ['present without categories', checkin({ redFlags: { present: true } }), true],
        ['categories but present=false', checkin({ redFlags: { present: false, categories: ['neurological'] } }), false],
        [
            'severe fever_or_chills',
            checkin({ healthContext: { symptoms: { present: true, severity: 'severe', types: ['fever_or_chills'] } } }),
            true,
        ],
        [
            'moderate fever_or_chills',
            checkin({ healthContext: { symptoms: { present: true, severity: 'moderate', types: ['fever_or_chills'] } } }),
            false,
        ],
        [
            'severe symptoms without fever',
            checkin({ healthContext: { symptoms: { present: true, severity: 'severe', types: ['cough'] } } }),
            false,
        ],
        [
            'severe fever but symptoms.present=false',
            checkin({ healthContext: { symptoms: { present: false, severity: 'severe', types: ['fever_or_chills'] } } }),
            false,
        ],
    ];

    it.each(cases)('%s -> %s', (_label, input, expected) => {
        expect(hasRecordedRedFlag(input)).toBe(expected);
    });

    it.each(cases)('matches the engine red_flag clinical source: %s', (_label, input) => {
        expect(hasRecordedRedFlag(input)).toBe(engineSaysRedFlag(input));
    });
});
