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

    it('defaults ordinary contextual flags to explicit false when the context block exists', () => {
        const result = validateCheckin(writePayload({
            healthContext: {
                unusualHeatOrSauna: null,
                closeSickContact: true,
            },
        }));
        expect(result.isValid).toBe(true);
        expect(result.data?.healthContext).toMatchObject({
            unusualHeatOrSauna: false,
            dehydrationOrFluidLoss: false,
            recentVaccination: false,
            medicationChange: false,
            closeSickContact: true,
        });
    });

    it('accepts legacy manual physiology fields but strips them from canonical check-in data', () => {
        const result = validateCheckin(writePayload({
            healthContext: {
                manualRhrHigher: true,
                manualHrvLower: false,
                manualRespirationHigher: null,
            },
        }));
        expect(result.isValid).toBe(true);
        expect(result.data?.healthContext).not.toHaveProperty('manualRhrHigher');
        expect(result.data?.healthContext).not.toHaveProperty('manualHrvLower');
        expect(result.data?.healthContext).not.toHaveProperty('manualRespirationHigher');
    });

    it('rejects malformed legacy manual physiology fields', () => {
        const result = validateCheckin(writePayload({
            healthContext: { manualRhrHigher: 'yes' },
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.field === 'healthContext.manualRhrHigher')).toBe(true);
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

    it('accepts the allergy-oriented symptom types and a suspected cause', () => {
        const result = validateCheckin(writePayload({
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'mild',
                    types: ['sneezing', 'runny_nose'],
                    suspectedCause: 'allergy',
                },
            },
        }));
        expect(result.isValid).toBe(true);
        expect(result.data?.healthContext?.symptoms).toEqual({
            present: true,
            severity: 'mild',
            types: ['sneezing', 'runny_nose'],
            suspectedCause: 'allergy',
        });
    });

    it('rejects an unrecognized suspectedCause and a stale one on a cleared symptom', () => {
        expect(validateCheckin(writePayload({
            healthContext: { symptoms: { present: true, suspectedCause: 'viral' } },
        })).isValid).toBe(false);
        expect(validateCheckin(writePayload({
            healthContext: { symptoms: { present: false, suspectedCause: 'allergy' } },
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

    it('normalizes absent/null contextual flags to No on persisted health-context documents', () => {
        const parsed = parseSubjectiveCheckin(storedPayload({
            healthContext: { closeSickContact: null },
        }), PATH, 'u1', DATE);
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.healthContext).toMatchObject({
            unusualHeatOrSauna: false,
            dehydrationOrFluidLoss: false,
            recentVaccination: false,
            medicationChange: false,
            closeSickContact: false,
        });
    });

    it('strips legacy manual physiology so missing Garmin stays objectively unavailable', () => {
        const parsed = parseSubjectiveCheckin(storedPayload({
            healthContext: {
                manualRhrHigher: false,
                manualHrvLower: true,
                manualRespirationHigher: null,
            },
        }), PATH, 'u1', DATE);
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.healthContext).not.toHaveProperty('manualRhrHigher');
        expect(parsed.data.healthContext).not.toHaveProperty('manualHrvLower');
        expect(parsed.data.healthContext).not.toHaveProperty('manualRespirationHigher');
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

    it('round-trips the allergy-oriented symptom types and suspected cause on read', () => {
        const parsed = parseSubjectiveCheckin(storedPayload({
            healthContext: {
                symptoms: { present: true, types: ['sneezing', 'runny_nose'], suspectedCause: 'allergy' },
            },
        }), PATH, 'u1', DATE);
        expect(parsed.status).toBe('AVAILABLE');
        if (parsed.status !== 'AVAILABLE') throw new Error('expected available');
        expect(parsed.data.healthContext?.symptoms).toEqual({
            present: true,
            types: ['sneezing', 'runny_nose'],
            suspectedCause: 'allergy',
        });
    });
});
