import { describe, expect, it } from 'vitest';
import { createDefaultHealthContext, normalizeHealthContext } from './healthContextDefaults';
import { validateCheckin } from './validation';

describe('canonical health-context defaults', () => {
    it('uses one explicit product default set for newly reported context', () => {
        expect(createDefaultHealthContext()).toEqual({
            alcoholDrinksLast24h: 0,
            travelDisruption: 'none',
            unusualHeatOrSauna: false,
            dehydrationOrFluidLoss: false,
            recentVaccination: false,
            medicationChange: false,
            closeSickContact: false,
            symptoms: { present: false },
        });
    });

    it('normalizes legacy null contextual booleans to No while retaining positive answers', () => {
        expect(normalizeHealthContext({
            unusualHeatOrSauna: null,
            dehydrationOrFluidLoss: true,
            recentVaccination: null,
            medicationChange: false,
            closeSickContact: null,
        })).toMatchObject({
            alcoholDrinksLast24h: 0,
            travelDisruption: 'none',
            unusualHeatOrSauna: false,
            dehydrationOrFluidLoss: true,
            recentVaccination: false,
            medicationChange: false,
            closeSickContact: false,
            symptoms: { present: false },
        });
    });

    it('migrates a legacy top-level illness flag into nested symptoms when the old context lacked symptoms', () => {
        const result = validateCheckin({
            userId: 'u1',
            date: '2026-08-21',
            readiness: 7,
            sleepQuality: 7,
            fatigue: 4,
            soreness: 3,
            mentalStress: 4,
            motivation: 8,
            painOrInjury: false,
            illnessSymptoms: true,
            unusuallyLimitedTime: false,
            alreadyTrainedToday: false,
            availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
            notes: null,
            healthContext: { closeSickContact: false },
        });

        expect(result.isValid).toBe(true);
        expect(result.data?.illnessSymptoms).toBe(true);
        expect(result.data?.healthContext?.symptoms).toEqual({ present: true });
        expect(result.data?.healthContext?.closeSickContact).toBe(false);
    });

    it('keeps explicitly supplied nested symptoms authoritative over the legacy flag', () => {
        const result = validateCheckin({
            userId: 'u1',
            date: '2026-08-21',
            readiness: 7,
            sleepQuality: 7,
            fatigue: 4,
            soreness: 3,
            mentalStress: 4,
            motivation: 8,
            painOrInjury: false,
            illnessSymptoms: true,
            unusuallyLimitedTime: false,
            alreadyTrainedToday: false,
            availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
            notes: null,
            healthContext: { symptoms: { present: false } },
        });

        expect(result.isValid).toBe(true);
        expect(result.data?.illnessSymptoms).toBe(false);
        expect(result.data?.healthContext?.symptoms).toEqual({ present: false });
    });
});
