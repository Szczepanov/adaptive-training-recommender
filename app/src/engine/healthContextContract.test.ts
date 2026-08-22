import { describe, expect, it } from 'vitest';
import { validateCheckin } from './validation';
import { parseSubjectiveCheckin } from '../persistence/parsers/decisionInputs';

const DATE = '2026-08-21';
const PATH = `users/u1/daily_subjective_checkins/${DATE}`;

function writePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        userId: 'u1',
        date: DATE,
        readiness: 7,
        sleepQuality: 7,
        fatigue: 4,
        soreness: 3,
        mentalStress: 4,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        ...overrides,
    };
}

function storedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...writePayload(),
        submittedAt: `${DATE}T06:00:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: `${DATE}T06:00:00Z`,
        updatedAt: `${DATE}T06:00:00Z`,
        ...overrides,
    };
}

describe('HA1 validateCheckin migration contract', () => {
    it('rejects non-object root inputs without throwing', () => {
        for (const value of [null, undefined, 'checkin', 42, []]) {
            expect(() => validateCheckin(value)).not.toThrow();
            const result = validateCheckin(value);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(error => error.field === 'checkin')).toBe(true);
        }
    });

    it('keeps a legacy-only check-in unchanged', () => {
        const result = validateCheckin(writePayload({ illnessSymptoms: true }));
        expect(result.isValid).toBe(true);
        expect(result.data?.illnessSymptoms).toBe(true);
        expect(result.data?.healthContext).toBeUndefined();
    });

    it('accepts context-only symptoms and derives the compatibility flag', () => {
        const payload = writePayload({ healthContext: { symptoms: { present: true } } });
        delete payload.illnessSymptoms;
        const result = validateCheckin(payload);
        expect(result.isValid).toBe(true);
        expect(result.data?.illnessSymptoms).toBe(true);
        expect(result.data?.healthContext?.symptoms?.present).toBe(true);
        expect(result.data?.dataQuality.missingFields).not.toContain('illnessSymptoms');
    });

    it('makes rich symptoms authoritative when legacy and rich values conflict', () => {
        const richTrue = validateCheckin(writePayload({
            illnessSymptoms: false,
            healthContext: { symptoms: { present: true } },
        }));
        expect(richTrue.data?.illnessSymptoms).toBe(true);

        const richFalse = validateCheckin(writePayload({
            illnessSymptoms: true,
            healthContext: { symptoms: { present: false } },
        }));
        expect(richFalse.data?.illnessSymptoms).toBe(false);
    });

    it('supports explicit clear and rejects stale nested symptom details', () => {
        const clear = validateCheckin(writePayload({
            illnessSymptoms: true,
            healthContext: { symptoms: { present: false } },
        }));
        expect(clear.isValid).toBe(true);
        expect(clear.data?.illnessSymptoms).toBe(false);
        expect(clear.data?.healthContext?.symptoms).toEqual({ present: false });

        const stale = validateCheckin(writePayload({
            healthContext: { symptoms: { present: false, onset: 'yesterday' } },
        }));
        expect(stale.isValid).toBe(false);
        expect(stale.errors.some(error => error.field === 'healthContext.symptoms.onset')).toBe(true);
    });

    it('accepts tri-state subjective physiology changes and preserves explicit false', () => {
        const result = validateCheckin(writePayload({
            healthContext: {
                subjectiveRhrHigher: true,
                subjectiveHrvLower: false,
                subjectiveRespirationHigher: null,
            },
        }));
        expect(result.isValid).toBe(true);
        expect(result.data?.healthContext).toMatchObject({
            subjectiveRhrHigher: true,
            subjectiveHrvLower: false,
            subjectiveRespirationHigher: null,
        });
    });

    it('rejects malformed subjective physiology changes', () => {
        const result = validateCheckin(writePayload({
            healthContext: { subjectiveRhrHigher: 'yes' },
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.field === 'healthContext.subjectiveRhrHigher')).toBe(true);
    });

    it('rejects non-finite and out-of-range timezone shifts', () => {
        for (const value of [14.1, -14.1, Number.POSITIVE_INFINITY, Number.NaN]) {
            const result = validateCheckin(writePayload({ healthContext: { timezoneShiftHours: value } }));
            expect(result.isValid).toBe(false);
            expect(result.errors.some(error => error.field === 'healthContext.timezoneShiftHours')).toBe(true);
        }
        expect(validateCheckin(writePayload({ healthContext: { timezoneShiftHours: -14 } })).isValid).toBe(true);
        expect(validateCheckin(writePayload({ healthContext: { timezoneShiftHours: 14 } })).isValid).toBe(true);
    });

    it('rejects nested symptom details without a true present state', () => {
        expect(validateCheckin(writePayload({
            healthContext: { symptoms: { severity: 'mild' } },
        })).isValid).toBe(false);
        expect(validateCheckin(writePayload({
            healthContext: { symptoms: { present: false, types: ['cough'] } },
        })).isValid).toBe(false);
    });
});

describe('HA1 parseSubjectiveCheckin migration contract', () => {
    it('parses legacy-only documents exactly as before', () => {
        const parsed = parseSubjectiveCheckin(storedPayload({ illnessSymptoms: true }), PATH, 'u1', DATE);
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.illnessSymptoms).toBe(true);
        expect(parsed.data.healthContext).toBeUndefined();
    });

    it('accepts a context-only persisted document and derives illnessSymptoms', () => {
        const raw = storedPayload({ healthContext: { symptoms: { present: true } } });
        delete raw.illnessSymptoms;
        const parsed = parseSubjectiveCheckin(raw, PATH, 'u1', DATE);
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.illnessSymptoms).toBe(true);
    });

    it('resolves conflicting persisted values in favor of healthContext', () => {
        const parsed = parseSubjectiveCheckin(storedPayload({
            illnessSymptoms: true,
            healthContext: { symptoms: { present: false } },
        }), PATH, 'u1', DATE);
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.illnessSymptoms).toBe(false);
    });

    it('parses subjective physiology changes without converting unknown to normal', () => {
        const parsed = parseSubjectiveCheckin(storedPayload({
            healthContext: {
                subjectiveRhrHigher: false,
                subjectiveHrvLower: true,
                subjectiveRespirationHigher: null,
            },
        }), PATH, 'u1', DATE);
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.healthContext).toMatchObject({
            subjectiveRhrHigher: false,
            subjectiveHrvLower: true,
            subjectiveRespirationHigher: null,
        });
    });

    it('rejects stale nested details and invalid timezone ranges on read', () => {
        const stale = parseSubjectiveCheckin(storedPayload({
            healthContext: { symptoms: { present: false, severity: 'mild' } },
        }), PATH, 'u1', DATE);
        expect(stale.status).toBe('INVALID');

        const invalidRange = parseSubjectiveCheckin(storedPayload({
            healthContext: { timezoneShiftHours: 15 },
        }), PATH, 'u1', DATE);
        expect(invalidRange.status).toBe('INVALID');
    });
});
