import { describe, expect, it } from 'vitest';
import { eligibleTemplates, evaluateTemplateEligibility } from './eligibility';
import { rankCandidates } from './optimizer';
import { ENRICHED_TEMPLATES, TEMPLATES, TEMPLATES_BY_ID } from './templates';
import type { FatigueState, SessionTemplate, TrainingSettings, UserContext, UserPreferences } from './models';
import type { ResolvedAvailability } from './schedule';

/**
 * Issue #677 — deterministic fixtures comparing neutral, conservative, and travel overlays
 * against identical underlying athlete state and capacity.
 *
 * Investigation findings (see docs/analysis/2026-09-19-conservative-travel-overlay-investigation.md):
 *   1. Travel overlay: before `end_easy_05`, every Easy/Moderate/Hard Endurance candidate
 *      required indoor_bike/outdoor_bike/swim_access equipment or was hard-tagged
 *      `environment: 'outdoor'`, so a travel day (no bike/treadmill, indoor-only) excluded
 *      every one of them on hard constraints -- a genuine catalog gap, not a scoring bug.
 *   2. Conservative-bias hard-session-count: `optimizer.ts`'s own per-candidate scoring
 *      (tested below) IS correctly monotonic in isolation. The real, CONFIRMED regression
 *      lives one layer up, in `weeklyAllocation.ts`'s required-role reservation search
 *      (see the analysis doc's day-by-day reproduction) -- not fixed here; tracked as a
 *      dedicated follow-up. This suite locks in the per-candidate scoring invariant as a
 *      regression guard so a future fix to the reservation search cannot be "fixed" by
 *      quietly breaking this lower layer instead.
 */

const AN_ENDURANCE_CATEGORY: readonly SessionTemplate['category'][] = [
    'Easy Endurance', 'Moderate Endurance', 'Hard Endurance', 'Race-Specific Endurance',
];

function travelTrainingSettings(): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 2,
        equipment: { free_weights: false, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false, outdoor_bike: false, swim_access: false },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 30, weekendMaxMinutes: 30, environment: 'indoor' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

function travelContext(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: false, hasFreeWeights: false, hasTreadmill: false, hasIndoorBike: false, restrictedModalities: [], maxTimeMinutes: 30 },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        trainingSettings: travelTrainingSettings(),
    };
}

describe('travel overlay — equipment-free aerobic fallback (issue #677)', () => {
    it('admits the new equipment-free bodyweight circuit as the only eligible endurance candidate', () => {
        const eligible = eligibleTemplates(TEMPLATES, travelContext(), 30, '2026-09-19');
        const eligibleEnduranceIds = eligible
            .filter(t => AN_ENDURANCE_CATEGORY.includes(t.category))
            .map(t => t.id);

        expect(eligibleEnduranceIds).toEqual(['end_easy_05']);
    });

    it('clears all hard feasibility gates: no equipment fabricated, respects the time cap and indoor-only boundary', () => {
        const result = evaluateTemplateEligibility(TEMPLATES_BY_ID.get('end_easy_05')!, travelContext(), 30, '2026-09-19');
        expect(result.eligible).toBe(true);
        expect(result.reasons).toEqual([]);
        expect(TEMPLATES_BY_ID.get('end_easy_05')!.requiredEquipment).toEqual([]);
    });

    it('still excludes every bike/treadmill/swim/outdoor-only endurance candidate travel cannot honestly offer', () => {
        const eligible = eligibleTemplates(TEMPLATES, travelContext(), 30, '2026-09-19');
        const eligibleIds = new Set(eligible.map(t => t.id));

        for (const blocked of ['end_easy_01', 'end_easy_04', 'end_easy_02', 'end_mod_02', 'end_hard_02', 'swim_easy_01']) {
            if (TEMPLATES_BY_ID.has(blocked)) {
                expect(eligibleIds.has(blocked)).toBe(false);
            }
        }
    });

    it('leaves Rest and Mobility/Recovery available alongside the new fallback (no forced training)', () => {
        const eligible = eligibleTemplates(TEMPLATES, travelContext(), 30, '2026-09-19');
        expect(eligible.some(t => t.category === 'Rest')).toBe(true);
        expect(eligible.some(t => t.category === 'Mobility/Recovery')).toBe(true);
    });
});

const DEFAULT_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-09-19',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const OPEN_AVAILABILITY: ResolvedAvailability = {
    date: '2026-09-19',
    maxTimeMinutes: 120,
    availableEquipment: ['free_weights', 'indoor_bike', 'outdoor_bike', 'treadmill', 'cable_machine', 'swim_access'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

function preferences(conservativeBias: boolean): UserPreferences {
    return {
        userId: 'athlete',
        avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [],
        conservativeBias,
        preferredRecoveryStyle: 'mixed',
        defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 90,
        preferredTimeOfDay: 'flexible',
        explanationVerbosity: 'detailed',
        preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
        schemaVersion: 1, createdAt: '', updatedAt: '',
    };
}

describe('conservative-bias monotonicity (issue #677)', () => {
    it('never lowers the per-candidate cost penalty for a high-systemic-cost session vs the neutral run', () => {
        const hardCandidate = ENRICHED_TEMPLATES.find(t => t.id === 'end_hard_01')!;
        expect(hardCandidate.systemicCost).toBeGreaterThanOrEqual(0.6);

        const neutral = rankCandidates([hardCandidate], [], DEFAULT_FATIGUE, OPEN_AVAILABILITY, [], preferences(false), { date: '2026-09-19' });
        const conservative = rankCandidates([hardCandidate], [], DEFAULT_FATIGUE, OPEN_AVAILABILITY, [], preferences(true), { date: '2026-09-19' });

        expect(conservative.accepted[0].costPenalty).toBeGreaterThanOrEqual(neutral.accepted[0].costPenalty);
        expect(conservative.accepted[0].utilityScore).toBeLessThanOrEqual(neutral.accepted[0].utilityScore);
    });

    it('never lowers the utility of a low-systemic-cost recovery-adjacent session vs the neutral run', () => {
        const easyCandidate = ENRICHED_TEMPLATES.find(t => t.id === 'end_easy_02')!;
        expect(easyCandidate.systemicCost).toBeLessThanOrEqual(0.4);

        const neutral = rankCandidates([easyCandidate], [], DEFAULT_FATIGUE, OPEN_AVAILABILITY, [], preferences(false), { date: '2026-09-19' });
        const conservative = rankCandidates([easyCandidate], [], DEFAULT_FATIGUE, OPEN_AVAILABILITY, [], preferences(true), { date: '2026-09-19' });

        expect(conservative.accepted[0].utilityScore).toBeGreaterThanOrEqual(neutral.accepted[0].utilityScore);
    });

    it('picks the same-or-lower-systemic-cost top-ranked candidate under conservative bias, given an identical easy-vs-hard choice', () => {
        const easyCandidate = ENRICHED_TEMPLATES.find(t => t.id === 'end_easy_02')!;
        const hardCandidate = ENRICHED_TEMPLATES.find(t => t.id === 'end_hard_01')!;
        const candidates = [easyCandidate, hardCandidate];

        const topPickSystemicCost = (conservativeBias: boolean): number => {
            const result = rankCandidates(candidates, [], DEFAULT_FATIGUE, OPEN_AVAILABILITY, [], preferences(conservativeBias), { date: '2026-09-19' });
            const top = [...result.accepted].sort((a, b) => b.utilityScore - a.utilityScore)[0];
            return top.template.systemicCost;
        };

        expect(topPickSystemicCost(true)).toBeLessThanOrEqual(topPickSystemicCost(false));
    });
});
