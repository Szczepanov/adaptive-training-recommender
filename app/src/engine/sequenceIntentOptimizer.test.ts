import { describe, expect, it } from 'vitest';
import type { FatigueState, SessionTemplate, UserPreferences } from './models';
import { rankCandidates } from './optimizer';
import { resolveSequenceIntent } from './sequenceIntent';
import type { ResolvedAvailability } from './schedule';

const FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-03-05',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const AVAILABILITY: ResolvedAvailability = {
    date: '2026-03-05',
    maxTimeMinutes: 120,
    availableEquipment: [],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

const PREFERENCES: UserPreferences = {
    userId: 'sequence-test',
    avoidedModalities: [],
    deprioritizedModalities: [],
    preferredModalities: [],
    conservativeBias: false,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible',
    explanationVerbosity: 'detailed',
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
};

const QUALITY_LIKE_SUPPORTING_SESSION: SessionTemplate = {
    id: 'sequence-intent-quality-like',
    category: 'Easy Endurance',
    modality: 'Cycling',
    durationMin: 60,
    durationMax: 60,
    title: 'Quality-like supporting ride',
    description: 'Synthetic candidate used to isolate sequencing preference behavior.',
    requiredEquipment: [],
    environment: 'Either',
    safetyTags: [],
    systemicCost: 0.55,
    costProfile: { systemic: 0.55, cardiovascular: 0.55, lowerBody: 0.3, upperBody: 0, impactTissue: 0, neuromuscular: 0.2 },
    stimulusProfile: { aerobicEndurance: 0.6, thresholdPower: 0.2, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0.2, maxStrength: 0, hypertrophy: 0 },
};

const RECENT_HIGH_HISTORY = [{
    date: '2026-03-04',
    modality: 'Cycling' as const,
    category: 'Easy Endurance' as const,
    systemicCost: 0.55,
    lowerBodyCost: 0.3,
}];

describe('optimizer sequence-intent integration', () => {
    it('changes candidate utility while leaving the candidate eligible', () => {
        const base = rankCandidates(
            [QUALITY_LIKE_SUPPORTING_SESSION], [], FATIGUE, AVAILABILITY, [], PREFERENCES,
            { date: '2026-03-05', recentHistory: RECENT_HIGH_HISTORY, sequenceIntent: resolveSequenceIntent({ phaseName: 'Base' }) },
        );
        const specificity = rankCandidates(
            [QUALITY_LIKE_SUPPORTING_SESSION], [], FATIGUE, AVAILABILITY, [], PREFERENCES,
            { date: '2026-03-05', recentHistory: RECENT_HIGH_HISTORY, sequenceIntent: resolveSequenceIntent({ phaseName: 'Specificity' }) },
        );

        expect(base.accepted).toHaveLength(1);
        expect(specificity.accepted).toHaveLength(1);
        expect(specificity.accepted[0].utilityScore).toBeGreaterThan(base.accepted[0].utilityScore);
        expect(base.accepted[0].rationale).toContain('Sequence soft preference');
        expect(specificity.accepted[0].rationale).toContain('Sequence soft preference');
    });

    it('preserves the legacy consecutive-intensity penalty when no sequence policy is supplied', () => {
        const legacy = rankCandidates(
            [QUALITY_LIKE_SUPPORTING_SESSION], [], FATIGUE, AVAILABILITY, [], PREFERENCES,
            { date: '2026-03-05', recentHistory: RECENT_HIGH_HISTORY },
        );
        const base = rankCandidates(
            [QUALITY_LIKE_SUPPORTING_SESSION], [], FATIGUE, AVAILABILITY, [], PREFERENCES,
            { date: '2026-03-05', recentHistory: RECENT_HIGH_HISTORY, sequenceIntent: resolveSequenceIntent({ phaseName: 'Base' }) },
        );

        // Base adds its two-day preferred-gap soft penalty on top of the legacy 0.35 stack
        // penalty; absence of sequence intent keeps the pre-#460 behavior exactly intact.
        expect(legacy.accepted[0].utilityScore).toBeGreaterThan(base.accepted[0].utilityScore);
        expect(legacy.accepted[0].rationale).not.toContain('Sequence intent');
    });
});
