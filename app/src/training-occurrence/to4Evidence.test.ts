import { describe, expect, it } from 'vitest';
import { workoutForTemplate } from '../workouts/prescription';
import { assembleOfflineHistoricalContext } from './offlineContextAssembler';
import { prepareTo4Evidence, type ReviewLabel, type TrainingOccurrenceRecordExport } from './to4EvidencePreparation';

const WORKOUT_ID = workoutForTemplate('end_mod_02')!.id;

function recordExport(overrides: Partial<TrainingOccurrenceRecordExport> = {}): TrainingOccurrenceRecordExport {
    const evaluationWindow = { startDate: '2026-08-01', endDateExclusive: '2026-08-08' };
    const historyWindow = { startDate: '2026-07-01', endDateExclusive: '2026-08-08' };
    return {
        schemaVersion: 2,
        userId: 'u1',
        window: evaluationWindow,
        evaluationWindow,
        sourceEvidenceBounds: {
            performedTrainingOccurrences: historyWindow, activities: historyWindow, dailyRecommendations: historyWindow,
            dailyRecommendationRevisions: historyWindow, dailyRecoverySnapshots: evaluationWindow,
            dailySubjectiveCheckins: historyWindow, fixedActivities: evaluationWindow,
            scheduleOverlays: evaluationWindow, planBlocks: evaluationWindow,
            scheduleWindowManifests: evaluationWindow, sessionOccurrences: evaluationWindow,
            sessionExecutions: historyWindow, sessionEntries: historyWindow,
            executionPrescriptions: historyWindow, sessionDefinitionRevisions: historyWindow,
            externalPlanRevisions: evaluationWindow,
        },
        sourceProvenance: { dailyRecoverySnapshots: { status: 'unprovable', reason: 'No date-D proof' } },
        dailyRecommendationRevisions: [], dailyRecoverySnapshots: [], dailySubjectiveCheckins: [],
        fixedActivities: [], scheduleOverlays: [], planBlocks: [], scheduleWindowManifests: [],
        sessionOccurrences: [], externalPlanHeaders: [], externalPlanRevisions: [], externalPlanPlacements: [],
        goals: [], intentBlockHeaders: [], intentBlockRevisions: [], trainingSettings: [], preferences: [], trainingIntentProfiles: [],
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
        sessionEntries: [],
        executionPrescriptions: [],
        sessionDefinitionRevisions: [],
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

const options = { sourceCommit: 'synthetic-fixture', sourceTreeSha256: 'a'.repeat(64), coveragePolicyVersion: 'coverage-v1', fitFingerprintVersion: 'fit-workout-v2' };

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

    it('keeps lookback-only records out of evaluation exposure counts', () => {
        const raw = recordExport();
        const earlierOccurrence = structuredClone(raw.performedTrainingOccurrences[0]);
        earlierOccurrence.id = 'pto-earlier';
        Object.assign(earlierOccurrence.data as object, {
            performedOccurrenceId: 'pto-earlier', localDate: '2026-07-20',
            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'a-earlier' }],
            reconciliation: { state: 'single_source' },
        });
        const earlierActivity = structuredClone(raw.activities[0]);
        earlierActivity.id = 'a-earlier';
        Object.assign(earlierActivity.data as object, { activityId: 'a-earlier', date: '2026-07-20' });
        raw.performedTrainingOccurrences.push(earlierOccurrence);
        raw.activities.push(earlierActivity);
        raw.dailyRecoverySnapshots.push({ id: 'private-recovery', data: { userId: 'u1', date: '2026-08-06' } });

        const prepared = prepareTo4Evidence(raw, options);
        expect(prepared.liveExposures.some(row => row.date === '2026-07-20')).toBe(false);
        expect(prepared.canonicalExposures.some(row => row.date === '2026-07-20')).toBe(false);
        expect(prepared.preparedInput).toMatchObject({
            corpus: { realHistoryOccurrenceCount: 1 },
            canonicalDerivation: { windowDays: 7, derived: 1 },
            identityEvidence: { activeOccurrences: 1 },
        });
        expect(prepared.sourceEvidence.dailyRecoverySnapshots[0].id).toBe('private-recovery');
        expect(JSON.stringify(prepared.preparedInput)).not.toContain('private-recovery');
    });

    it('rejects schema v1 and invalid offline source evidence', () => {
        expect(() => prepareTo4Evidence({ ...recordExport(), schemaVersion: 1 } as unknown as TrainingOccurrenceRecordExport, options)).toThrow(/schemaVersion 2/);
        expect(() => prepareTo4Evidence(recordExport({ dailyRecoverySnapshots: [{ id: 'foreign', data: { userId: 'other' } }] }), options)).toThrow(/cross-user/);
        expect(() => prepareTo4Evidence(recordExport({ sourceEvidenceBounds: {
            ...recordExport().sourceEvidenceBounds,
            activities: { startDate: '2026-08-03', endDateExclusive: '2026-08-08' },
        } }), options)).toThrow(/activities/);
        expect(() => prepareTo4Evidence(recordExport({
            sourceProvenance: { dailyRecoverySnapshots: { status: 'unprovable', reason: '' } },
        }), options)).toThrow(/provenance/);
        expect(() => prepareTo4Evidence(recordExport({
            window: { startDate: '2026-08-02', endDateExclusive: '2026-08-08' },
        }), options)).toThrow(/evaluationWindow/);
    });

    it('keeps every evaluation date and reports unprovable historical sources without fallback', () => {
        const prepared = prepareTo4Evidence(recordExport(), options);
        const context = assembleOfflineHistoricalContext(prepared.sourceEvidence, 'u1');
        const first = context.inputForDate(context.dates[0]);

        expect(context.dates).toHaveLength(7);
        expect(context.sourceCoverage).toMatchObject({ candidateDates: 7, minimumSafetyCheckin: { missing: 7 } });
        expect(first).toMatchObject({
            status: 'not_replayable',
            dateAlias: 'D001',
            reasonCodes: expect.arrayContaining([
                'recovery_history_unprovable', 'goal_history_unprovable', 'training_settings_history_unprovable',
            ]),
        });
        expect(JSON.stringify(context.sourceCoverage)).not.toContain('u1');
    });

    it('marks a provably incomplete minimum-safety check-in not applicable', () => {
        const incomplete = {
            userId: 'u1', date: '2026-08-01', readiness: null, sleepQuality: null, fatigue: null, soreness: null,
            mentalStress: null, motivation: null, painOrInjury: false, illnessSymptoms: false,
            unusuallyLimitedTime: false, alreadyTrainedToday: false,
            availability: { timeAvailableMin: null, preferredModalityToday: null, indoorOnly: false },
            notes: null, submittedAt: '2026-07-31T21:00:00.000Z',
            dataQuality: { isComplete: false, missingFields: ['fatigue', 'soreness'] }, schemaVersion: 1,
            createdAt: '2026-07-31T21:00:00.000Z', updatedAt: '2026-07-31T21:00:00.000Z',
        };
        const prepared = prepareTo4Evidence(recordExport({
            dailySubjectiveCheckins: [{ id: '2026-08-01', data: incomplete }],
        }), options);
        const context = assembleOfflineHistoricalContext(prepared.sourceEvidence, 'u1');

        expect(context.inputForDate('2026-08-01')).toMatchObject({
            status: 'not_applicable', reasonCode: 'minimum_safety_checkin_incomplete', dateAlias: 'D001',
        });
        expect(context.sourceCoverage.minimumSafetyCheckin).toMatchObject({ incomplete: 1, provenIncomplete: 1 });
    });

    it('does not infer a failed safety gate from an incomplete check-in updated during the date', () => {
        const incomplete = {
            userId: 'u1', date: '2026-08-01', readiness: null, sleepQuality: null, fatigue: null, soreness: null,
            mentalStress: null, motivation: null, painOrInjury: false, illnessSymptoms: false,
            unusuallyLimitedTime: false, alreadyTrainedToday: false,
            availability: { timeAvailableMin: null, preferredModalityToday: null, indoorOnly: false },
            notes: null, submittedAt: '2026-08-01T00:00:00.000Z',
            dataQuality: { isComplete: false, missingFields: ['fatigue', 'soreness'] }, schemaVersion: 1,
            createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        };
        const prepared = prepareTo4Evidence(recordExport({
            dailySubjectiveCheckins: [{ id: '2026-08-01', data: incomplete }],
        }), options);
        const context = assembleOfflineHistoricalContext(prepared.sourceEvidence, 'u1');

        expect(context.inputForDate('2026-08-01')).toMatchObject({ status: 'not_replayable' });
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

    it('rejects malformed prescription modality metadata instead of throwing during derivation', () => {
        const source = { kind: 'manual', definitionId: 'upper', revision: 1, contentHash: 'h' };
        const raw = recordExport({
            performedTrainingOccurrences: [{ id: 'pto-1', data: {
                schemaVersion: 1, performedOccurrenceId: 'pto-1', userId: 'u1', status: 'active', localDate: '2026-08-06', modality: 'strength',
                sourceRefs: [{ kind: 'structured_execution', executionId: 'e-1' }], reconciliation: { state: 'single_source' }, createdAt: 'x', updatedAt: 'x',
            } }],
            sessionExecutions: [{ id: 'e-1', data: {
                userId: 'u1', executionId: 'e-1', date: '2026-08-06', sessionSource: source, prescriptionHash: 'ph-1', sessionRpe: 8,
                startedAt: '2026-08-06T16:00:00Z', completedAt: '2026-08-06T16:45:00Z', updatedAt: '2026-08-06T16:45:00Z', state: 'completed', schemaVersion: 1,
            } }],
            sessionEntries: [{ id: 'set-1', data: {
                id: 'set-1', executionId: 'e-1', stepId: 'press', completedAt: '2026-08-06T16:10:00Z', createdAt: 'x', updatedAt: 'x',
                payload: { kind: 'repetition', setIndex: 1, reps: 8 },
            } }],
            executionPrescriptions: [{ id: 'ph-1', data: {
                schemaVersion: 1, prescriptionHash: 'ph-1', sessionSource: source, definitionHash: 'dh',
                displayMetadata: { title: 'Upper Maintenance', intent: 'training', dominantModality: { malformed: true }, duration: { min: 50, max: 60 } },
                blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [{ id: 'press', kind: 'exercise', dose: { kind: 'repetition', sets: 4, reps: 8 } }] }],
                createdAt: 'x',
            } }],
            activities: [], dailyRecommendations: [],
        });
        expect(() => prepareTo4Evidence(raw, options)).not.toThrow();
        expect(prepareTo4Evidence(raw, options).preparedInput).toMatchObject({
            canonicalDerivation: {
                invalidRecords: 1,
                derived: 0,
                unknownByReason: { non_catalog_execution_evidence_missing: 1 },
            },
            hardGates: { structuredSemanticAuthorityPreserved: 'not_evaluated' },
        });
    });

    it('rejects foreign-user documents before they can enter prepared evidence', () => {
        const raw = recordExport();
        const foreign = {
            ...raw,
            activities: [...raw.activities, { id: 'a-9', data: { ...(raw.activities[0].data as object), activityId: 'a-9', userId: 'someone-else' } }],
            sessionEntries: [{ id: 'foreign-entry', data: { id: 'foreign-entry', executionId: 'e-1', userId: 'someone-else', stepId: 'step', completedAt: 'x', createdAt: 'x', updatedAt: 'x', payload: { kind: 'repetition', setIndex: 1, reps: 1 } } }],
        };
        expect(() => prepareTo4Evidence(foreign, options)).toThrow(/cross-user/);
    });

    it('evaluates reviewed labels and refuses labels for unknown aliases', () => {
        expect(prepareTo4Evidence(recordExport(), { ...options, labels: { 'occ-0001': 'correct_merge' } }).preparedInput)
            .toMatchObject({ hardGates: { noKnownFalsePositiveMerges: 'pass' } });
        expect(prepareTo4Evidence(recordExport(), { ...options, labels: { 'occ-0001': 'false_positive_merge' } }).preparedInput)
            .toMatchObject({ hardGates: { noKnownFalsePositiveMerges: 'fail' } });
        expect(() => prepareTo4Evidence(recordExport(), {
            ...options,
            labels: { 'occ-0001': 'not_a_review_label' } as unknown as Readonly<Record<string, ReviewLabel>>,
        })).toThrow(/supported label/);
        expect(() => prepareTo4Evidence(recordExport(), { ...options, labels: { 'occ-9999': 'correct_merge' } })).toThrow(/alias/);
    });
});
