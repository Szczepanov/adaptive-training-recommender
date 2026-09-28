import { describe, expect, it } from 'vitest';
import type { CompletedExposure } from '../engine/trainingHistory';
import { SCENARIOS } from '../engine/simulation/scenarios';
import { workoutForTemplate } from '../workouts/prescription';
import { runHistoryCounterfactualSeries, type NonHistoryDecisionInputs } from './historyRecommendationCounterfactual';
import { prepareTo4Evidence, type TrainingOccurrenceRecordExport } from './to4EvidencePreparation';

const scenario = SCENARIOS.find(candidate => candidate.id === 'evergreen_balanced_four_sessions')!;
const inputs: NonHistoryDecisionInputs = {
    readiness: scenario.readinessForWeek(0),
    context: scenario.context,
    events: [...(scenario.events ?? (scenario.event ? [scenario.event] : []))],
    fixedActivities: scenario.fixedActivities ?? [],
    trainingIntentProfile: scenario.trainingIntentProfile ?? null,
    preferences: scenario.preferences ?? null,
};

function hardRide(date: string): CompletedExposure {
    return {
        occurrenceKey: `occ-${date}`,
        date,
        costProfile: { systemic: 0.9, cardiovascular: 0.9, lowerBody: 0.8, upperBody: 0.1, impactTissue: 0.2, neuromuscular: 0.6 },
        trainingRecordLike: { type: 'Cycling hard', duration_min: 120, training_effect: 4.5, intensity_tag: 'hard' },
        stimulusConfidence: 'inferred',
        modality: 'Cycling',
    };
}

describe('runHistoryCounterfactualSeries', () => {
    const dates = ['2026-08-10', '2026-08-11'];

    it('reports no delta when only identical histories are swapped', async () => {
        const history = [hardRide('2026-08-08')];
        const series = await runHistoryCounterfactualSeries(inputs, history, history, dates);
        expect(series).toMatchObject({ evaluatedDates: 2, changedDates: 0, unresolvedDates: 0 });
    });

    it('is deterministic and marks unclassified history-driven changes unresolved', async () => {
        const heavy = ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'].map(hardRide);
        const first = await runHistoryCounterfactualSeries(inputs, [], heavy, dates);
        const second = await runHistoryCounterfactualSeries(inputs, [], heavy, dates);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        expect(first.changedDates).toBeGreaterThan(0);
        expect(first.unresolvedDates).toBe(first.changedDates);
    });
});

const WORKOUT_ID = workoutForTemplate('end_mod_02')!.id;

function recordExport(overrides: Partial<TrainingOccurrenceRecordExport> = {}): TrainingOccurrenceRecordExport {
    return {
        schemaVersion: 1,
        userId: 'u1',
        window: { startDate: '2026-08-01', endDateExclusive: '2026-08-08' },
        performedTrainingOccurrences: [{
            id: 'pto-1',
            data: {
                schemaVersion: 1, performedOccurrenceId: 'pto-1', userId: 'u1', status: 'active', localDate: '2026-08-06', modality: 'cycling',
                sourceRefs: [{ kind: 'structured_execution', executionId: 'e-1' }, { kind: 'provider_activity', provider: 'garmin', activityId: 'a-1' }],
                reconciliation: { state: 'matched' }, createdAt: 'x', updatedAt: 'x',
            },
        }],
        sessionExecutions: [{
            id: 'e-1',
            data: {
                userId: 'u1', executionId: 'e-1', date: '2026-08-06', sessionSource: { kind: 'catalog', workoutId: WORKOUT_ID, catalogVersion: 'v1' },
                startedAt: '2026-08-06T16:00:00Z', completedAt: '2026-08-06T16:45:00Z', updatedAt: '2026-08-06T16:45:00Z', state: 'completed', schemaVersion: 1,
            },
        }],
        activities: [{
            id: 'a-1',
            data: {
                activityId: 'a-1', date: '2026-08-06', type: 'cycling', durationMin: 50, trainingEffectAerobic: 3.2, trainingEffectAnaerobic: null,
                averageHr: 150, activityTrainingLoad: 115, intensityTag: 'hard',
            },
        }],
        dailyRecommendations: [{
            id: '2026-08-06',
            data: {
                userId: 'u1', date: '2026-08-06', templateId: 'end_mod_02', templateTitle: 'Tempo Ride', category: 'Moderate Endurance', modality: 'Cycling',
                mode: 'train', rationale: 'test', schemaVersion: 2, createdAt: '', updatedAt: '',
                adherence: { respondedAt: 'x', followed: true, actualModality: null, actualDurationMin: 50, skipped: false, notes: null },
            },
        }],
        ...overrides,
    };
}

const options = { sourceCommit: 'synthetic-fixture', coveragePolicyVersion: 'coverage-v1', fitFingerprintVersion: 'fit-workout-v2' };

describe('prepareTo4Evidence', () => {
    it('produces a sanitized, one-to-one prepared input with evaluated hard gates', () => {
        const prepared = prepareTo4Evidence(recordExport(), options);
        const rendered = JSON.stringify(prepared.preparedInput);
        expect(rendered).not.toMatch(/"u1"|a-1|e-1|pto-1/);
        expect(prepared.preparedInput).toMatchObject({
            corpus: { realHistory: 'prepared', realHistoryOccurrenceCount: 1, strata: { matched_structured_garmin_endurance: 1 } },
            identityEvidence: { pairedMatched: 1, sourceLinkConflicts: 0 },
            hardGates: {
                noCrossUserEvidenceLeakage: 'pass',
                deterministicReplayStable: 'pass',
                matchedOccurrenceSingleExposure: 'pass',
                structuredSemanticAuthorityPreserved: 'pass',
                noKnownFalsePositiveMerges: 'not_evaluated',
                noStickyManualDecisionViolations: 'not_evaluated',
            },
        });
    });

    it('never passes a gate on an empty export', () => {
        const empty = recordExport({ performedTrainingOccurrences: [], sessionExecutions: [], activities: [], dailyRecommendations: [] });
        const gates = prepareTo4Evidence(empty, options).preparedInput.hardGates as Record<string, string>;
        expect(Object.values(gates).every(state => state === 'not_evaluated')).toBe(true);
    });

    it('does not evaluate structured authority when no structured exposure was derived', () => {
        const raw = recordExport();
        const manual = { ...raw, sessionExecutions: [{ id: 'e-1', data: { ...(raw.sessionExecutions[0].data as object), sessionSource: { kind: 'manual', definitionId: 'd', revision: 1, contentHash: 'h' } } }] };
        expect(prepareTo4Evidence(manual, options).preparedInput).toMatchObject({
            canonicalDerivation: { derived: 0, unknownByReason: { non_catalog_execution_evidence_missing: 1 } },
            hardGates: { structuredSemanticAuthorityPreserved: 'not_evaluated', missingDetailRemainsUnknown: 'pass' },
        });
    });

    it('derives a manual strength occurrence from exported execution entries and its prescription', () => {
        const source = { kind: 'manual', definitionId: 'upper', revision: 1, contentHash: 'h' };
        const manual = recordExport({
            performedTrainingOccurrences: [{ id: 'pto-1', data: {
                schemaVersion: 1, performedOccurrenceId: 'pto-1', userId: 'u1', status: 'active', localDate: '2026-08-06', modality: 'strength',
                sourceRefs: [{ kind: 'structured_execution', executionId: 'e-1' }], reconciliation: { state: 'single_source' }, createdAt: 'x', updatedAt: 'x',
            } }],
            sessionExecutions: [{ id: 'e-1', data: {
                userId: 'u1', executionId: 'e-1', date: '2026-08-06', sessionSource: source, prescriptionHash: 'ph-1', sessionRpe: 8,
                startedAt: '2026-08-06T16:00:00Z', completedAt: '2026-08-06T16:45:00Z', updatedAt: '2026-08-06T16:45:00Z', state: 'completed', schemaVersion: 1,
            } }],
            sessionEntries: [1, 2].map(setIndex => ({ id: `set-${setIndex}`, data: {
                id: `set-${setIndex}`, executionId: 'e-1', stepId: 'press', completedAt: '2026-08-06T16:10:00Z', createdAt: 'x', updatedAt: 'x',
                payload: { kind: 'repetition', setIndex, reps: 8 },
            } })),
            executionPrescriptions: [{ id: 'ph-1', data: {
                schemaVersion: 1, prescriptionHash: 'ph-1', sessionSource: source, definitionHash: 'dh',
                displayMetadata: { title: 'Upper Maintenance', intent: 'training', dominantModality: 'Strength', duration: { min: 50, max: 60 } },
                blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [{ id: 'press', kind: 'exercise', attemptIndex: 1, dose: { kind: 'repetition', sets: 4, reps: 8 } }] }], createdAt: 'x',
            } }],
            activities: [], dailyRecommendations: [],
        });
        const prepared = prepareTo4Evidence(manual, options).preparedInput;
        expect(prepared.canonicalDerivation).toMatchObject({ derived: 1, unknownByReason: {} });
        expect(prepared.hardGates).toMatchObject({ structuredSemanticAuthorityPreserved: 'pass' });
    });

    it('rejects foreign-user records and fails the cross-user gate', () => {
        const raw = recordExport();
        const foreign = {
            ...raw,
            activities: [...raw.activities, { id: 'a-9', data: { ...(raw.activities[0].data as object), activityId: 'a-9', userId: 'someone-else' } }],
            sessionEntries: [{ id: 'foreign-entry', data: { id: 'foreign-entry', executionId: 'e-1', userId: 'someone-else', stepId: 'step', completedAt: 'x', createdAt: 'x', updatedAt: 'x', payload: { kind: 'repetition', setIndex: 1, reps: 1 } } }],
        };
        expect(prepareTo4Evidence(foreign, options).preparedInput).toMatchObject({
            canonicalDerivation: { crossUserRecordsRejected: 2 },
            hardGates: { noCrossUserEvidenceLeakage: 'fail' },
        });
    });

    it('evaluates reviewed labels and refuses labels for unknown aliases', () => {
        expect(prepareTo4Evidence(recordExport(), { ...options, labels: { 'occ-0001': 'correct_merge' } }).preparedInput)
            .toMatchObject({ hardGates: { noKnownFalsePositiveMerges: 'pass' } });
        expect(prepareTo4Evidence(recordExport(), { ...options, labels: { 'occ-0001': 'false_positive_merge' } }).preparedInput)
            .toMatchObject({ hardGates: { noKnownFalsePositiveMerges: 'fail' } });
        expect(() => prepareTo4Evidence(recordExport(), { ...options, labels: { 'occ-9999': 'correct_merge' } })).toThrow(/alias/);
    });
});
