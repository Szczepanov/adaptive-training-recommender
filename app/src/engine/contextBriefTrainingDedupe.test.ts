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
        expect(text).toContain('Totals: 2 sessions · 105 min (canonical, deduped across structured and provider sources; 1 raw provider activity row in window).');
        expect(text).not.toContain('Aerobic TE');
        expect(text).not.toContain('Raw activity provenance');
    });

    it('diagnostic keeps raw provider rows as provenance, not additional volume', () => {
        const text = buildContextBrief(withFacts(linkedFacts, { purpose: 'diagnostic' }));
        expect(text).toContain(`| ${D1} | Cycling | 60 | structured + Garmin | — |`);
        expect(text).toContain('Raw activity provenance (diagnostic only — source rows are not added to canonical totals; unmatched or multiple provider rows may reflect reconciliation state)');
        expect(text).toContain('| Date | Type | Min | Load | Aerobic TE | Anaerobic TE | Avg HR | Intensity |');
    });

    it('surfaces partial and unverified rows instead of dropping them', () => {
        const facts = [
            fact(D1, { performedOccurrenceId: 'occ-partial', startedAt: `${D1}T08:00:00+02:00`, endedAt: undefined, durationMin: undefined }),
            fact(D2, { performedOccurrenceId: 'occ-inferred', confidence: 'inferred', sourceKinds: ['provider_activity'], evidenceTier: 'genericModalityFallback' }),
        ];
        const text = buildContextBrief(withFacts(facts, { purpose: 'planning' }));
        expect(text).toContain('started, completion unrecorded; duration unrecorded');
        expect(text).toContain('identity inferred from provider');
        expect(text).toContain('Totals: 2 sessions · 60 known min · 1 session with duration unknown');
        expect(text).toContain('Discipline volume: Cycling: 2 sessions (60 known min; 1 duration unknown)');
    });

    it('labels abandoned and in-progress structured occurrences distinctly', () => {
        const facts = [
            fact(D1, { executionState: 'abandoned', startedAt: `${D1}T08:00:00+02:00`, endedAt: undefined }),
            fact(D2, { executionState: 'in_progress', startedAt: `${D2}T08:00:00+02:00`, endedAt: undefined }),
        ];
        const text = buildContextBrief(withFacts(facts, { purpose: 'planning' }));
        expect(text).toContain('abandoned structured execution; started, completion unrecorded');
        expect(text).toContain('structured execution in progress; started, completion unrecorded');
    });

    it('keeps two legitimate same-day canonical workouts distinct', () => {
        const facts = [
            fact(D1, { performedOccurrenceId: 'occ-am', durationMin: 50 }),
            fact(D1, { performedOccurrenceId: 'occ-pm', durationMin: 40, modality: 'Strength', sourceKinds: ['structured_execution'] }),
        ];
        const text = buildContextBrief(withFacts(facts, { purpose: 'planning' }));
        expect(text).toContain(`| ${D1} | Cycling | 50 |`);
        expect(text).toContain(`| ${D1} | Strength | 40 |`);
        expect(text).toContain('Totals: 2 sessions · 90 min');
    });

    it('distinguishes explicit zero duration from unknown duration in aggregates', () => {
        const facts = [
            fact(D1, { performedOccurrenceId: 'occ-zero', durationMin: 0 }),
            fact(D2, { performedOccurrenceId: 'occ-unknown', durationMin: undefined }),
        ];
        const text = buildContextBrief(withFacts(facts, { purpose: 'planning' }));
        expect(text).toContain(`| ${D1} | Cycling | 0 |`);
        expect(text).toContain(`| ${D2} | Cycling | — |`);
        expect(text).toContain('Totals: 2 sessions · 0 known min · 1 session with duration unknown');
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

    it('raw fallback preserves unknown duration instead of converting it to zero', () => {
        const text = buildContextBrief(withFacts(null, {
            purpose: 'planning',
            activities: [activity(D1, { durationMin: null })],
        }));
        expect(text).toContain(`| ${D1} | Cycling | — |`);
        expect(text).toContain('Totals: 1 sessions · 1 session with duration unknown · 0 tagged hard');
        expect(text).toContain('Discipline volume: Cycling: 1 session (duration unknown)');
        expect(text).not.toContain('Totals: 1 sessions · 0 min');
    });

    it('empty facts next to raw records warn about pending reconciliation instead of asserting no training', () => {
        const text = buildContextBrief(withFacts([], { purpose: 'planning' }));
        expect(text).toContain('reconciliation pending?');
        expect(text).not.toContain('No recorded sessions in this window.');
    });

    it('canonical read failure with no raw rows stays unknown instead of asserting no training', () => {
        const unreadable = withFacts(null, { purpose: 'planning', activities: [] });
        const text = buildContextBrief(unreadable);
        expect(text).toContain('Completed training cannot be determined for this window.');
        expect(text).not.toContain('No recorded sessions in this window.');
    });

    it('flags raw/canonical provider-count mismatches without adding raw rows to canonical totals', () => {
        const text = buildContextBrief(withFacts(linkedFacts, {
            purpose: 'planning',
            activities: [activity(D1), activity(D2, { activityId: 'unreconciled-provider-row' })],
        }));
        expect(text).toContain('Provider-count note: canonical sessions carrying provider evidence = 1; raw provider rows = 2.');
        expect(text).toContain('Raw rows are never added directly to canonical totals');
    });

    it('empty facts with no raw records still report an empty window', () => {
        const emptied = withFacts([], { purpose: 'planning', activities: [] });
        expect(buildContextBrief(emptied)).toContain('No recorded sessions in this window (canonical performed-training facts).');
    });

    it.each(['planning', 'diagnostic'] as const)('%s does not call an unreadable provider window empty', purpose => {
        const unreadable = withFacts([], {
            purpose,
            activities: [],
            exposureLedger: {
                activitiesReadable: false, recommendationsReadable: true,
                activityOverrides: null, performedFacts: [], plannedSessions: null,
            },
        });
        const text = buildContextBrief(unreadable);
        expect(text).toContain('completed training is unknown, not zero.');
        expect(text).not.toContain('No recorded sessions in this window');
    });
});
