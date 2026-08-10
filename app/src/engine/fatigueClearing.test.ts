import { describe, expect, it } from 'vitest';
import type { DimensionalFatigue, FatigueState, UserPreferences } from './models';
import type { ResolvedAvailability } from './schedule';
import { decayFatigue } from './fatigue';
import { ENRICHED_TEMPLATES } from './templates';
import { rankCandidates } from './optimizer';
import { workoutForTemplate } from '../workouts/prescription';

// Behavioral authority: docs/macrocycle-v5.md — Recovery authority + Strength during cycling build.
const ZERO: DimensionalFatigue = {
    systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
};
const FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-08-10',
    externalLoadFatigue: { ...ZERO, lowerBody: 0.8, impactTissue: 0.8 },
    internalResponseStrain: { ...ZERO },
    combinedFatigue: { ...ZERO, lowerBody: 0.8, impactTissue: 0.8 },
};
const AVAILABILITY: ResolvedAvailability = {
    date: '2026-08-10', maxTimeMinutes: 180, availableEquipment: ['free_weights', 'indoor_bike'],
    fixedActivities: [], reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};
function preferences(style: UserPreferences['preferredRecoveryStyle']): UserPreferences {
    return {
        userId: 'macrocycle-w3', preferredRecoveryStyle: style,
        defaultWeekdayTimeMin: 90, defaultWeekendTimeMin: 150, preferredTimeOfDay: 'flexible',
        preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [], explanationVerbosity: 'detailed',
        conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
        schemaVersion: 1, createdAt: '', updatedAt: '',
    };
}

describe('macrocycle v5 recovery and strength contracts', () => {
    it('prefers complete rest for passive/mixed recover-tier days and active recovery only when explicitly active', () => {
        const rest = ENRICHED_TEMPLATES.find(template => template.id === 'rest_01');
        const mobility = ENRICHED_TEMPLATES.find(template => template.id === 'mob_01');
        if (!rest || !mobility) throw new Error('recovery templates missing');

        const rank = (style: UserPreferences['preferredRecoveryStyle']) => rankCandidates(
            [mobility, rest], [], FATIGUE, AVAILABILITY, [], preferences(style),
            { date: '2026-08-10', fatigueTier: 'recover' },
        ).accepted[0]?.template.id;

        expect(rank('passive')).toBe('rest_01');
        expect(rank('mixed')).toBe('rest_01');
        expect(rank('active')).toBe('mob_01');
    });

    it('lets a saturated 48-hour fatigue dimension clear below recover and modify thresholds with rest', () => {
        const saturated = { ...ZERO, lowerBody: 1, impactTissue: 1 };
        const after24h = decayFatigue(saturated, 24);
        const after48h = decayFatigue(saturated, 48);
        expect(Math.max(after24h.lowerBody, after24h.impactTissue)).toBeGreaterThan(0.65);
        expect(Math.max(after48h.lowerBody, after48h.impactTissue)).toBeLessThan(0.60);
    });

    it('keeps primary full-body strength reachable inside the modify ceiling without relaxing recover', () => {
        const reduced = ENRICHED_TEMPLATES.find(template => template.id === 'str_full_03');
        if (!reduced) throw new Error('str_full_03 missing');
        expect(reduced.category).toBe('Full-body Strength');
        expect(reduced.systemicCost).toBeLessThanOrEqual(0.5);
        expect(reduced.costProfile?.systemic).toBeLessThanOrEqual(0.5);
        expect(workoutForTemplate(reduced.id)?.id).toBe('strength_full_body_maintenance_01');
    });
});
