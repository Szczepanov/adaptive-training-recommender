import { describe, expect, it } from 'vitest';
import type { AnthropometryEntry } from './models';
import { validateAnthropometryEntry } from './validation';

function validSampleEntry(): AnthropometryEntry {
    return {
        id: 'entry-2026-09-14-1',
        userId: 'athlete-test',
        date: '2026-09-14',
        observedAt: '2026-09-14T06:30:00.000Z',
        protocol: 'home_anthropometry@1',
        context: {
            morningPostVoidPreIntake: true,
            trainingBeforeMeasurement: false,
            respiratoryState: 'relaxed_normal_expiration',
            posture: 'standing_relaxed',
            clothing: 'minimal_or_bare_skin',
        },
        measurements: [
            {
                metricId: 'waist_minimum_cm',
                unit: 'cm',
                readings: [80.2, 80.8],
                value: 80.5,
                repeatabilityWarning: false,
            },
            {
                metricId: 'abdomen_umbilicus_cm',
                unit: 'cm',
                readings: [85.0, 85.6],
                value: 85.3,
                repeatabilityWarning: false,
            },
            {
                metricId: 'hips_max_cm',
                unit: 'cm',
                readings: [98.0, 98.4],
                value: 98.2,
                repeatabilityWarning: false,
            },
            {
                metricId: 'thigh_mid_cm',
                laterality: 'right',
                unit: 'cm',
                readings: [56.0, 56.4],
                value: 56.2,
                repeatabilityWarning: false,
            },
            {
                metricId: 'body_mass_kg',
                unit: 'kg',
                readings: [75.4],
                value: 75.4,
            },
        ],
        schemaVersion: 1,
        revision: 1,
        createdAt: '2026-09-14T06:35:00.000Z',
        updatedAt: '2026-09-14T06:35:00.000Z',
    };
}

describe('anthropometry entry validation', () => {
    it('validates a complete, well-formed entry', () => {
        const result = validateAnthropometryEntry(validSampleEntry());
        expect(result.isValid).toBe(true);
        expect(result.data?.measurements).toHaveLength(5);
        expect(result.errors).toHaveLength(0);
    });

    it('rejects an entry with an invalid protocol', () => {
        const entry = { ...validSampleEntry(), protocol: 'bogus@2' };
        const result = validateAnthropometryEntry(entry);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'protocol')).toBe(true);
    });

    it('rejects an entry where observedAt resolves to a different Warsaw calendar date', () => {
        // 2026-09-14T23:30:00Z is 2026-09-15 01:30 in Warsaw (UTC+2 in summer)
        const entry = { ...validSampleEntry(), date: '2026-09-14', observedAt: '2026-09-14T23:30:00.000Z' };
        const result = validateAnthropometryEntry(entry);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'observedAt')).toBe(true);
    });

    it('rejects an entry with out-of-bounds readings', () => {
        const entry = validSampleEntry();
        entry.measurements[0].readings = [10.0, 12.0]; // waist min is 40 cm
        entry.measurements[0].value = 11.0;
        const result = validateAnthropometryEntry(entry);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.startsWith('measurements[0]'))).toBe(true);
    });

    it('rejects non-limb metric with laterality specified', () => {
        const entry = validSampleEntry();
        entry.measurements[0].laterality = 'left'; // waist cannot have laterality
        const result = validateAnthropometryEntry(entry);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'measurements[0].laterality')).toBe(true);
    });

    it('rejects duplicate series keys in one session', () => {
        const entry = validSampleEntry();
        // Add a second right thigh
        entry.measurements.push({
            metricId: 'thigh_mid_cm',
            laterality: 'right',
            unit: 'cm',
            readings: [56.2, 56.6],
            value: 56.4,
        });
        const result = validateAnthropometryEntry(entry);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('Duplicate measurement series key'))).toBe(true);
    });

    it('allows bilateral thigh measurements (both left and right in one session)', () => {
        const entry = validSampleEntry();
        entry.measurements.push({
            metricId: 'thigh_mid_cm',
            laterality: 'left',
            unit: 'cm',
            readings: [55.8, 56.2],
            value: 56.0,
        });
        const result = validateAnthropometryEntry(entry);
        expect(result.isValid).toBe(true);
    });

    it('rejects revision < 1 or non-integer', () => {
        const entry = { ...validSampleEntry(), revision: 0 };
        const result = validateAnthropometryEntry(entry);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'revision')).toBe(true);
    });
});
