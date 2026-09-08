import { describe, expect, it } from 'vitest';
import { rankCandidates } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import type { FatigueState, UserEvent, UserPreferences, WeeklyObjective } from './models';
import type { ResolvedAvailability } from './schedule';

function cyclingEvent(): UserEvent {
    return {
        id: 'crit-a',
        title: 'City Criterium',
        category: 'cycling_event',
        date: '2026-09-20',
        priority: 'A',
        lifecycle: 'scheduled',
        demandProfile: {
            aerobicEndurance: 0.8,
            thresholdPower: 0.85,
            vo2MaxPower: 0.9,
            repeatedSurges: 0.95,
            sprintPower: 0.7,
            fatigueResistance: 0.8,
            neuromuscular: 0.3,
        },
    };
}

function preferences(): UserPreferences {
    return {
        userId: 'u1',
        preferredRecoveryStyle: 'mixed',
        defaultWeekdayTimeMin: 60,
        defaultWeekendTimeMin: 90,
        preferredTimeOfDay: 'flexible',
        avoidedModalities: [],
        deprioritizedModalities: [],
        preferredModalities: [],
        explanationVerbosity: 'brief',
        conservativeBias: false,
        preferredUnits: {
            distance: 'km',
            weight: 'kg',
            temperature: 'celsius',
        },
        schemaVersion: 1,
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
    };
}

function autonomicFatigue(internalCardiovascular = 0.50): FatigueState {
    return {
        lastUpdatedDate: '2026-09-08',
        externalLoadFatigue: {
            systemic: 0.2,
            cardiovascular: 0.2,
            lowerBody: 0.1,
            upperBody: 0.1,
            impactTissue: 0.1,
            neuromuscular: 0.1,
        },
        internalResponseStrain: {
            systemic: 0.45,
            cardiovascular: internalCardiovascular,
            lowerBody: 0.1,
            upperBody: 0.1,
            impactTissue: 0.1,
            neuromuscular: 0.1,
        },
        // Keep combined fatigue fixed below the cardiovascular branch threshold so the
        // paired test below changes exactly one decision input: internal cardiovascular
        // strain crossing 0.35. This also keeps the generic fatigue cost identical.
        combinedFatigue: {
            systemic: 0.45,
            cardiovascular: 0.30,
            lowerBody: 0.1,
            upperBody: 0.1,
            impactTissue: 0.1,
            neuromuscular: 0.1,
        },
    };
}

const availability: ResolvedAvailability = {
    date: '2026-09-08',
    maxTimeMinutes: 90,
    availableEquipment: ['indoor_bike', 'free_weights'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: {
        systemic: 0,
        cardiovascular: 0,
        lowerBody: 0,
        upperBody: 0,
        impactTissue: 0,
        neuromuscular: 0,
    },
    environmentOverride: null,
};

const mixedObjectives: WeeklyObjective[] = [
    {
        id: 'obj_1',
        key: 'zone2_aerobic',
        title: 'Zone 2 Aerobic',
        targetExposures: 2,
        completedExposures: 1,
        targetStimulus: { aerobicEndurance: 0.8 },
    },
    {
        id: 'obj_2',
        key: 'strength_maintenance',
        title: 'Strength Maintenance',
        targetExposures: 1,
        completedExposures: 0,
        targetStimulus: { maxStrength: 0.5 },
    },
];

describe('autonomic stress modality preservation', () => {
    it('applies the endurance-event strength penalty only when internal cardiovascular strain crosses its threshold', () => {
        const belowThreshold = rankCandidates(
            ENRICHED_TEMPLATES,
            mixedObjectives,
            autonomicFatigue(0.34),
            availability,
            [],
            preferences(),
            { focusEvent: cyclingEvent(), date: '2026-09-08', fatigueTier: 'modify' },
        );
        const atThreshold = rankCandidates(
            ENRICHED_TEMPLATES,
            mixedObjectives,
            autonomicFatigue(0.35),
            availability,
            [],
            preferences(),
            { focusEvent: cyclingEvent(), date: '2026-09-08', fatigueTier: 'modify' },
        );

        const controlStrength = belowThreshold.accepted.find(candidate => candidate.template.modality === 'Strength');
        expect(controlStrength).toBeDefined();
        const suppressedStrength = atThreshold.accepted.find(
            candidate => candidate.template.id === controlStrength!.template.id,
        );
        expect(suppressedStrength).toBeDefined();

        // The only changed decision input is internal cardiovascular strain 0.34 -> 0.35.
        // The endurance-event branch therefore accounts for the full 0.25x utility change.
        expect(suppressedStrength!.utilityScore).toBeCloseTo(controlStrength!.utilityScore * 0.25, 10);
        expect(atThreshold.accepted[0].template.modality).toBe('Cycling');
    });

    it('does not suppress strength when there is no endurance focus event', () => {
        const ranked = rankCandidates(
            ENRICHED_TEMPLATES,
            [{
                id: 'obj_strength',
                key: 'strength_maintenance',
                title: 'Strength Maintenance',
                targetExposures: 1,
                completedExposures: 0,
                targetStimulus: { maxStrength: 1 },
            }],
            autonomicFatigue(),
            {
                ...availability,
                availableEquipment: ['free_weights'],
            },
            [],
            preferences(),
            { date: '2026-09-08', fatigueTier: 'modify' },
        );

        expect(ranked.accepted.some(candidate => candidate.template.modality === 'Strength')).toBe(true);
    });
});
