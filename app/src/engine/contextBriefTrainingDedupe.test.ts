import { describe, expect, it } from 'vitest';
import { buildContextBrief, type ContextBriefInput } from './contextBrief';
import type { NormalizedGarminActivity } from './models';
import type { PerformedExposureFact } from './performedTrainingFacts';

const AS_OF = '2026-08-15';
const D1 = '2026-08-10';
const D2 = '2026-08-12';

function activity(date: string, overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: `a-${date}`, date, type: 'cycling', durationMin: 60,
        trainingEffectAerobic: 3.1, trainingEffectAnaerobic: 0.4, averageHr: 138,
        activityTrainingLoad: 120, intensityTag: 'moderate', ...overrides,
    };
}

function fact(localDate: string, overrides: Partial<PerformedExposureFact> = {}): PerformedExposureFact {
    return {
        performedOccurrenceId: `occ-${localDate}`,
        localDate,
        durationMin: 60,
        modality: 'Cycling',
        confidence: 'exact',
        sourceKinds: ['structured_execution', 'provider_activity'],
        evidenceTier: 'completedStructuredWorkout',
        ...overrides,
    };
}

function input(overrides: Partial<ContextBriefInput> = {}): ContextBriefInput {
    return {
        asOfDate: AS_OF, windowDays: 14,
        snapshots: [], checkins: [], activities: [], recommendations: [],
        recommendationsReadable: true,
        trainingSettings: null, preferences: null, intentProfile: null,
        ...overrides,
    };
}

function withFacts(
    performedFacts: readonly PerformedExposureFact[] | null,
    extra: Partial<ContextBriefInput> = {},
): ContextBriefInput {
    return input({
        activities: [activity(D1)],
        exposureLedger: {
            activitiesReadable: true,
            recommendationsReadable: true,
            activityOverrides: null,
            performedFacts,
            plannedSessions: null,
        },
        ...extra,
    });
}

const linkedFacts = [
    fact(D1),
    fact(D2, {
        performedOccurrenceId: 'occ-strength',
        durationMin: 45,
        modality: 'Strength',
        sourceKinds: ['structured_execution'],
        isReadinessModifiedDose: true,
    }),
];

describe('contextBrief canonical training table (#894)', () => {
    it('planning renders one deduped row per fact and counts structured-only sessions', () => {
        const text = buildContextBrief(withFacts(linkedFacts, { purpose: 'planning' }));
        expect(text).toContain(`| ${D1} | Cycling | 60 | structured + Garmin | — |`);
        expect(text).toContain(`| ${D2} | Strength | 45 | structured | readiness-modified dose |`);
        expect(text).toContain('Totals: 2 sessions · 105 min (canonical, deduped across structured and provider sources; 1 raw activity records in window).');
        expect(text).not.toContain('Aerobic TE');
        expect(text).not.toContain('Raw activity provenance');
    });

    it('diagnostic keeps raw provider rows as provenance, not additional volume', () => {
        const text = buildContextBrief(withFacts(linkedFacts, { purpose: 'diagnostic' }));
        expect(text).toContain(`| ${D1} | Cycling | 60 | structured + Garmin | — |`);
        expect(text).toContain('Raw activity provenance (diagnostic only — the same sessions as above, not additional volume)');
        expect(text).toContain('| Date | Type | Min | Load | Aerobic TE | Anaerobic TE | Avg HR | Intensity |');
    });

    it('surfaces partial and unverified rows instead of dropping them', () => {
        const facts = [
            fact(D1, { performedOccurrenceId: 'occ-partial', startedAt: `${D1}T08:00:00+02:00`, endedAt: undefined, durationMin: undefined }),
            fact(D2, { performedOccurrenceId: 'occ-inferred', confidence: 'inferred', sourceKinds: ['provider_activity'], evidenceTier: 'genericModalityFallback' }),
        ];
        const text = buildContextBrief(withFacts(facts, { purpose: 'planning' }));
        expect(text).toContain('started, completion unrecorded');
        expect(text).toContain('identity inferred from provider');
    });

    it('filters facts outside the render window', () => {
        const facts = [fact('2026-08-01'), fact(D1)];
        const text = buildContextBrief(withFacts(facts, { purpose: 'planning' }));
        expect(text).not.toContain('| 2026-08-01 |');
        expect(text).toContain('Totals: 1 sessions · 60 min (canonical, deduped');
    });

    it('null facts fall back to the raw table with a double-count caution', () => {
        const text = buildContextBrief(withFacts(null, { purpose: 'planning' }));
        expect(text).toContain('Canonical performed-training facts were unreadable for this window');
        expect(text).toContain('| Date | Type | Min | Load | Aerobic TE | Anaerobic TE | Avg HR | Intensity |');
    });

    it('empty facts next to raw records warn about pending reconciliation instead of asserting no training', () => {
        const text = buildContextBrief(withFacts([], { purpose: 'planning' }));
        expect(text).toContain('reconciliation pending?');
        expect(text).not.toContain('No recorded sessions in this window.');
    });

    it('empty facts with no raw records still report an empty window', () => {
        const emptied = withFacts([], { purpose: 'planning', activities: [] });
        expect(buildContextBrief(emptied)).toContain('No recorded sessions in this window (canonical performed-training facts).');
    });
});
