import { describe, expect, it } from 'vitest';
import type { DailyRecommendation, NormalizedGarminActivity } from '../engine/models';
import type { ExecutionPrescription, SessionEntry, SessionExecution } from '../sessions/models';
import { buildTrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import { workoutForTemplate } from '../workouts/prescription';
import type { PerformedOccurrenceSourceRef, PerformedTrainingOccurrence } from './models';
import {
    computeCanonicalIdentityMetrics,
    deriveCanonicalBroadExposure,
    pairLiveAndCanonicalHistory,
    type CanonicalHistorySources,
} from './canonicalBroadHistory';

const TEMPLATE_ID = 'end_mod_02';
const WORKOUT_ID = workoutForTemplate(TEMPLATE_ID)!.id;

function activity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'a-1', date: '2026-08-06', type: 'cycling', durationMin: 50,
        trainingEffectAerobic: 3.2, trainingEffectAnaerobic: null, averageHr: 150,
        activityTrainingLoad: 115, intensityTag: 'hard',
        startedAt: '2026-08-06T16:00:00Z', endedAt: '2026-08-06T16:50:00Z',
        ...overrides,
    };
}

function recommendation(overrides: Partial<DailyRecommendation> = {}): DailyRecommendation {
    return {
        userId: 'u1', date: '2026-08-06', templateId: TEMPLATE_ID, templateTitle: 'Tempo Ride',
        category: 'Moderate Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 2,
        createdAt: '', updatedAt: '',
        adherence: { respondedAt: 'x', followed: true, actualModality: null, actualDurationMin: 50, skipped: false, notes: null },
        ...overrides,
    };
}

function execution(overrides: Partial<SessionExecution> = {}): SessionExecution {
    return {
        userId: 'u1', executionId: 'e-1', date: '2026-08-06',
        sessionSource: { kind: 'catalog', workoutId: WORKOUT_ID, catalogVersion: 'v1' },
        startedAt: '2026-08-06T16:00:00Z', completedAt: '2026-08-06T16:45:00Z', updatedAt: '2026-08-06T16:45:00Z',
        state: 'completed', schemaVersion: 1,
        ...overrides,
    };
}

function occurrence(sourceRefs: PerformedOccurrenceSourceRef[], overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1, performedOccurrenceId: `pto-${sourceRefs.length}`, userId: 'u1', status: 'active',
        localDate: '2026-08-06', modality: 'cycling', sourceRefs,
        reconciliation: { state: sourceRefs.length > 1 ? 'matched' : 'single_source' },
        createdAt: 'x', updatedAt: 'x',
        ...overrides,
    };
}

const structuredRef: PerformedOccurrenceSourceRef = { kind: 'structured_execution', executionId: 'e-1' };
const garminRef: PerformedOccurrenceSourceRef = { kind: 'provider_activity', provider: 'garmin', activityId: 'a-1' };
const strengthPrescription: ExecutionPrescription = {
    schemaVersion: 1, prescriptionHash: 'ph-1', sessionSource: { kind: 'manual', definitionId: 'upper', revision: 1, contentHash: 'h' },
    definitionHash: 'dh', displayMetadata: { title: ' Upper Maintenance ', intent: 'training', dominantModality: 'Strength', duration: { min: 50, max: 60 } },
    blocks: [
        { id: 'warmup', role: 'warmup', executionMode: 'sequential', steps: [{ id: 'warmup-press', kind: 'exercise', dose: { kind: 'repetition', sets: 2, reps: 8 } }] },
        { id: 'main', role: 'main', executionMode: 'sequential', steps: [{ id: 'press', kind: 'exercise', dose: { kind: 'repetition', sets: 4, reps: 8 } }] },
    ],
    createdAt: 'x',
};
function setEntry(id: string, executionId = 'e-1', isWarmup = false): SessionEntry {
    return { id, executionId, stepId: 'press', completedAt: '2026-08-06T16:10:00Z', createdAt: 'x', updatedAt: 'x', payload: { kind: 'repetition', setIndex: Number(id), reps: 8, isWarmup } };
}

function sources(overrides: Partial<CanonicalHistorySources> = {}): CanonicalHistorySources {
    return {
        executionsById: new Map([['e-1', execution()]]),
        entriesByExecutionId: new Map(),
        prescriptionsByHash: new Map(),
        activitiesById: new Map([['a-1', activity()]]),
        recommendationsByDate: new Map([['2026-08-06', recommendation()]]),
        ...overrides,
    };
}

describe('deriveCanonicalBroadExposure', () => {
    it('reproduces the live exact-template exposure for a matched structured + Garmin workout', () => {
        const live = buildTrainingHistorySnapshot(
            '2026-08-07', 7,
            { status: 'AVAILABLE', data: [activity()], revision: 'r' },
            { status: 'AVAILABLE', data: [recommendation()], revision: 'r' },
            'fixed',
        ).exposures;
        const derived = deriveCanonicalBroadExposure(occurrence([structuredRef, garminRef]), sources());
        expect(live).toHaveLength(1);
        expect(derived.status).toBe('derived');
        if (derived.status !== 'derived') return;
        expect(derived.authority).toBe('structured');
        expect(derived.exposure.costProfile).toEqual(live[0].costProfile);
        expect(derived.exposure.stimulusProfile).toEqual(live[0].stimulusProfile);
        expect(derived.exposure.deliveredDose).toEqual(live[0].deliveredDose);
        expect(derived.exposure).toMatchObject({ templateId: TEMPLATE_ID, workoutId: WORKOUT_ID, stimulusConfidence: 'exact', modality: 'Cycling' });
    });

    it('keeps structured identity and modality when Garmin classifies the workout differently', () => {
        const disagreeing = sources({ activitiesById: new Map([['a-1', activity({ type: 'walking' })]]) });
        const derived = deriveCanonicalBroadExposure(occurrence([structuredRef, garminRef]), disagreeing);
        expect(derived).toMatchObject({ status: 'derived', authority: 'structured', exposure: { modality: 'Cycling', templateId: TEMPLATE_ID } });
    });

    it('uses the production Garmin-only mapper for a provider-only occurrence', () => {
        const live = buildTrainingHistorySnapshot('2026-08-07', 7, { status: 'AVAILABLE', data: [activity()], revision: 'r' }, { status: 'AVAILABLE', data: [], revision: 'r' }, 'fixed').exposures[0];
        const derived = deriveCanonicalBroadExposure(occurrence([garminRef]), sources());
        expect(derived).toMatchObject({ status: 'derived', authority: 'provider' });
        if (derived.status === 'derived') expect({ ...derived.exposure }).toEqual({ ...live, occurrenceKey: undefined, date: '2026-08-06' });
    });

    it.each([
        ['multiple_provider_sources', [garminRef, { kind: 'provider_activity', provider: 'garmin', activityId: 'a-2' }] as PerformedOccurrenceSourceRef[], sources()],
        ['unsupported_provider', [{ kind: 'provider_activity', provider: 'polar', activityId: 'p-1' }] as PerformedOccurrenceSourceRef[], sources()],
        ['structured_source_unavailable', [structuredRef], sources({ executionsById: new Map() })],
        ['structured_source_not_completed', [structuredRef], sources({ executionsById: new Map([['e-1', execution({ state: 'abandoned' })]]) })],
        ['non_catalog_execution_evidence_missing', [structuredRef], sources({ executionsById: new Map([['e-1', execution({ sessionSource: { kind: 'manual', definitionId: 'd', revision: 1, contentHash: 'h' } })]]) })],
        ['legacy_strength_semantics_not_derived', [structuredRef], sources({ executionsById: new Map([['e-1', execution({ sessionSource: { kind: 'catalog', workoutId: 'legacy_strength', catalogVersion: 'v1' } })]]) })],
        ['provider_source_unavailable', [garminRef], sources({ activitiesById: new Map() })],
    ])('reports %s as unknown instead of fabricating semantics', (reason, refs, hydrated) => {
        expect(deriveCanonicalBroadExposure(occurrence(refs), hydrated)).toEqual({ status: 'unknown', reason });
    });

    it('derives manual strength from performed sets, session duration and RPE', () => {
        const manual = execution({ sessionSource: strengthPrescription.sessionSource, prescriptionHash: 'ph-1', sessionRpe: 8 });
        const hydrated = sources({
            executionsById: new Map([['e-1', manual]]),
            entriesByExecutionId: new Map([['e-1', [setEntry('1'), setEntry('2'), setEntry('3', 'e-1', true), { ...setEntry('4'), stepId: 'warmup-press' }]]]),
            prescriptionsByHash: new Map([['ph-1', strengthPrescription]]),
        });
        const derived = deriveCanonicalBroadExposure(occurrence([structuredRef], { modality: 'strength' }), hydrated);
        expect(derived.status).toBe('derived');
        if (derived.status !== 'derived') return;
        expect(derived.exposure).toMatchObject({
            trainingRecordLike: { type: 'Upper Maintenance', duration_min: 45 }, modality: 'Strength',
            deliveredDose: { plannedDurationMin: 55, completionRatio: 0.5 }, stimulusConfidence: 'inferred',
        });
        expect(Object.values(derived.exposure.costProfile).every(value => Number.isFinite(value) && value > 0)).toBe(true);
        expect(Object.values(derived.exposure.stimulusProfile ?? {}).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
        const audit = pairLiveAndCanonicalHistory({
            liveEvents: [], liveExposures: [], occurrences: [occurrence([structuredRef], { modality: 'strength' })], sources: hydrated,
        }).audit;
        expect(audit).toMatchObject({ derived: 1, unsupportedDerivations: 0, structuredAuthorityViolations: 0 });
    });

    it('computes completion from required per-step targets without optional or excess work masking misses', () => {
        const manual = execution({ sessionSource: strengthPrescription.sessionSource, prescriptionHash: 'ph-1', sessionRpe: 8 });
        const rotatingPrescription: ExecutionPrescription = {
            ...strengthPrescription,
            blocks: [{
                id: 'main', role: 'main', executionMode: 'superset', rounds: 3,
                steps: [
                    { id: 'press', kind: 'exercise', dose: { kind: 'repetition', sets: 1, reps: 8 } },
                    { id: 'row', kind: 'exercise', dose: { kind: 'repetition', sets: 1, reps: 8 } },
                    { id: 'carry', kind: 'exercise', optional: true, dose: { kind: 'duration', seconds: 30 } },
                ],
            }],
        };
        const entries = [
            setEntry('1'), setEntry('2'), setEntry('3'), setEntry('4'),
            { ...setEntry('5'), stepId: 'row' },
            { ...setEntry('6'), stepId: 'carry', payload: { kind: 'duration', seconds: 30 } as const },
            { ...setEntry('7'), stepId: 'carry', payload: { kind: 'duration', seconds: 30 } as const },
            { ...setEntry('8'), stepId: 'carry', payload: { kind: 'duration', seconds: 30 } as const },
        ];
        const derived = deriveCanonicalBroadExposure(occurrence([structuredRef], { modality: 'strength' }), sources({
            executionsById: new Map([['e-1', manual]]),
            entriesByExecutionId: new Map([['e-1', entries]]),
            prescriptionsByHash: new Map([['ph-1', rotatingPrescription]]),
        }));
        expect(derived.status).toBe('derived');
        if (derived.status !== 'derived') return;
        // Superset rounds prescribe 3 press + 3 row entries. Four press entries cap at 3;
        // optional carries do not compensate for the two missing row entries.
        expect(derived.exposure.deliveredDose?.completionRatio).toBeCloseTo(4 / 6);
    });

    it('fails closed when prescription source identity does not match the completed execution', () => {
        const manual = execution({ sessionSource: strengthPrescription.sessionSource, prescriptionHash: 'ph-1' });
        const mismatched: ExecutionPrescription = {
            ...strengthPrescription,
            sessionSource: { kind: 'manual', definitionId: 'different', revision: 1, contentHash: 'h' },
        };
        expect(deriveCanonicalBroadExposure(occurrence([structuredRef], { modality: 'strength' }), sources({
            executionsById: new Map([['e-1', manual]]),
            entriesByExecutionId: new Map([['e-1', [setEntry('1')]]]),
            prescriptionsByHash: new Map([['ph-1', mismatched]]),
        }))).toEqual({ status: 'unknown', reason: 'non_catalog_execution_evidence_missing' });
    });

    it('ignores a foreign execution entry even if it is placed under the hydrated execution key', () => {
        const manual = execution({ sessionSource: strengthPrescription.sessionSource, prescriptionHash: 'ph-1' });
        expect(deriveCanonicalBroadExposure(occurrence([structuredRef], { modality: 'strength' }), sources({
            executionsById: new Map([['e-1', manual]]),
            entriesByExecutionId: new Map([['e-1', [setEntry('1', 'e-foreign')]]]),
            prescriptionsByHash: new Map([['ph-1', strengthPrescription]]),
        }))).toEqual({ status: 'unknown', reason: 'non_catalog_execution_evidence_missing' });
    });

    it('lets Garmin duration and Training Effect enrich an authored execution without replacing its identity', () => {
        const authoredSource = { kind: 'external_plan', planId: 'p-1', revision: 1, sessionId: 's-1', contentHash: 'h' } as const;
        const authoredPrescription: ExecutionPrescription = {
            ...strengthPrescription, sessionSource: authoredSource,
            displayMetadata: { ...strengthPrescription.displayMetadata!, title: 'Plan Upper', duration: { min: 50, max: 60 } },
        };
        const hydrated = sources({
            executionsById: new Map([['e-1', execution({ sessionSource: authoredSource, prescriptionHash: 'ph-1', sessionRpe: 4 })]]),
            entriesByExecutionId: new Map([['e-1', [setEntry('1'), setEntry('2'), setEntry('3'), setEntry('4')]]]),
            prescriptionsByHash: new Map([['ph-1', authoredPrescription]]),
        });
        const authoredOccurrence = occurrence([structuredRef, garminRef], { modality: 'cycling' });
        const derived = deriveCanonicalBroadExposure(authoredOccurrence, hydrated);
        expect(derived.status).toBe('derived');
        if (derived.status !== 'derived') return;
        expect(derived.exposure).toMatchObject({ trainingRecordLike: { type: 'Plan Upper', duration_min: 50, training_effect: 3.2 }, modality: 'Strength' });
        const audit = pairLiveAndCanonicalHistory({ liveEvents: [], liveExposures: [], occurrences: [authoredOccurrence], sources: hydrated }).audit;
        expect(audit).toMatchObject({ derived: 1, unsupportedDerivations: 0, structuredAuthorityViolations: 0 });
    });

    it('fails closed when the immutable prescription cannot establish structured modality', () => {
        const manual = execution({ sessionSource: strengthPrescription.sessionSource, prescriptionHash: 'ph-1' });
        const hydrated = sources({
            executionsById: new Map([['e-1', manual]]),
            entriesByExecutionId: new Map([['e-1', [setEntry('1')]]]),
            prescriptionsByHash: new Map([['ph-1', { ...strengthPrescription, displayMetadata: { ...strengthPrescription.displayMetadata!, dominantModality: 'unknown' } }]]),
        });
        expect(deriveCanonicalBroadExposure(occurrence([structuredRef], { modality: 'strength' }), hydrated))
            .toEqual({ status: 'unknown', reason: 'non_catalog_execution_evidence_missing' });
    });
});

describe('pairLiveAndCanonicalHistory', () => {
    const live = buildTrainingHistorySnapshot(
        '2026-08-07', 7,
        { status: 'AVAILABLE', data: [activity()], revision: 'r' },
        { status: 'AVAILABLE', data: [recommendation()], revision: 'r' },
        'fixed',
    );

    it('counts one matched structured + Garmin workout exactly once with an opaque alias', () => {
        const result = pairLiveAndCanonicalHistory({
            liveEvents: live.completedEvents, liveExposures: live.exposures,
            occurrences: [occurrence([structuredRef, garminRef])], sources: sources(),
        });
        expect(result.liveExposures).toHaveLength(1);
        expect(result.canonicalExposures).toHaveLength(1);
        expect(result.canonicalExposures[0].occurrenceKey).toBe('occ-0001');
        expect(result.liveExposures[0].occurrenceKey).toBe('occ-0001');
        expect(JSON.stringify([result.liveExposures, result.canonicalExposures])).not.toMatch(/a-1|e-1|pto-/);
    });

    it('shares one alias across a group that cannot be split one-to-one so it is reported ambiguous', () => {
        const split = [
            occurrence([garminRef], { performedOccurrenceId: 'pto-g' }),
            occurrence([structuredRef], { performedOccurrenceId: 'pto-s' }),
        ];
        const result = pairLiveAndCanonicalHistory({ liveEvents: live.completedEvents, liveExposures: live.exposures, occurrences: split, sources: sources() });
        expect(new Set(result.canonicalExposures.map(row => row.occurrenceKey)).size).toBe(1);
        expect(result.canonicalExposures).toHaveLength(2);
    });

    it('keeps same-day distinct workouts distinct', () => {
        const second = activity({ activityId: 'a-2', startedAt: '2026-08-06T19:00:00Z', endedAt: '2026-08-06T19:30:00Z', durationMin: 30 });
        const twoActivities = buildTrainingHistorySnapshot('2026-08-07', 7, { status: 'AVAILABLE', data: [activity(), second], revision: 'r' }, { status: 'AVAILABLE', data: [], revision: 'r' }, 'fixed');
        const result = pairLiveAndCanonicalHistory({
            liveEvents: twoActivities.completedEvents, liveExposures: twoActivities.exposures,
            occurrences: [
                occurrence([garminRef], { performedOccurrenceId: 'pto-1' }),
                occurrence([{ kind: 'provider_activity', provider: 'garmin', activityId: 'a-2' }], { performedOccurrenceId: 'pto-2' }),
            ],
            sources: sources({ activitiesById: new Map([['a-1', activity()], ['a-2', second]]) }),
        });
        expect(new Set(result.canonicalExposures.map(row => row.occurrenceKey)).size).toBe(2);
    });

    it('lists an underivable occurrence as unknown with its reason and no canonical row', () => {
        const result = pairLiveAndCanonicalHistory({
            liveEvents: live.completedEvents, liveExposures: live.exposures,
            occurrences: [occurrence([garminRef], { performedOccurrenceId: 'pto-x' })],
            sources: sources({ activitiesById: new Map() }),
        });
        expect(result.canonicalExposures).toHaveLength(0);
        expect(result.unknownCanonicalOccurrenceKeys).toEqual(['occ-0001']);
        expect(result.unknownByReason).toEqual({ provider_source_unavailable: 1 });
    });

    it('never reads a merged occurrence as performed history', () => {
        const result = pairLiveAndCanonicalHistory({
            liveEvents: [], liveExposures: [],
            occurrences: [occurrence([garminRef], { status: 'merged', mergedIntoOccurrenceId: 'pto-z' })],
            sources: sources(),
        });
        expect(result.canonicalExposures).toHaveLength(0);
    });
});

describe('computeCanonicalIdentityMetrics', () => {
    it('evaluates every provider ref and detects conflicts and sticky-decision violations', () => {
        const unlinked = occurrence([garminRef], {
            performedOccurrenceId: 'pto-u',
            reconciliation: {
                state: 'single_source',
                manualDecision: { decision: 'unlink', actor: 'athlete', decidedAt: 'x' },
                excludedSourceKeys: ['provider_activity:garmin:a-1'],
            },
        });
        const metrics = computeCanonicalIdentityMetrics([
            occurrence([structuredRef, garminRef], { performedOccurrenceId: 'pto-m' }),
            unlinked,
            occurrence([{ kind: 'provider_activity', provider: 'polar', activityId: 'p-1' }, { kind: 'provider_activity', provider: 'garmin', activityId: 'a-9' }], { performedOccurrenceId: 'pto-p' }),
        ], []);
        expect(metrics).toMatchObject({
            activeOccurrences: 3,
            sourceLinkConflicts: 1,
            manualDecisionOccurrences: 1,
            manualDecisionViolations: 1,
            multiProviderSourceOccurrences: 1,
            nonGarminProviderSourceRefs: 1,
            canonicalProviderActivitiesAbsentFromLive: 2,
        });
    });
});
