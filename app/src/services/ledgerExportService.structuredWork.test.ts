import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AS_OF } from '../ledger/export/ledgerExportFixtures.testSupport';
const reads = vi.hoisted(() => Object.fromEntries([
'flags', 'recovery', 'checkins', 'activities', 'preferences', 'goals', 'fixed', 'blocks', 'anthropometry', 'constraints', 'schedule', 'responses', 'outcomes', 'intent', 'assessments', 'executions', 'occurrences', 'settings', 'plans', 'header', 'activations', 'revision', 'placement', 'history', 'performed', 'definition',
].map(key => [key, vi.fn()])));
vi.mock('./flagEvaluationPersistence', () => ({ flagEvaluationRepository: { getInRangeState: reads.flags } }));
vi.mock('./recoverySnapshotService', () => ({ recoverySnapshotService: { getRecoverySnapshotsInRangeState: reads.recovery } }));
vi.mock('./checkinService', () => ({ checkinService: { getCheckinsInRangeState: reads.checkins } }));
vi.mock('./activityService', () => ({ activityService: { getActivitiesInRange: reads.activities } }));
vi.mock('./preferencesService', () => ({ preferencesService: { getPreferencesState: reads.preferences } }));
vi.mock('./goalService', () => ({ goalService: { getActiveGoalsState: reads.goals } }));
vi.mock('./fixedActivityService', () => ({ fixedActivityService: { getActivitiesInRangeState: reads.fixed } }));
vi.mock('./planBlockService', () => ({ planBlockService: { getBlocksInRangeState: reads.blocks } }));
vi.mock('./anthropometryService', () => ({ anthropometryService: { getEntriesInRange: reads.anthropometry } }));
vi.mock('./constraintService', () => ({ constraintService: { listConstraints: reads.constraints } }));
vi.mock('./scheduleWindowService', () => ({ scheduleWindowService: { getWindowsForDateState: reads.schedule } }));
vi.mock('./sessionResponseService', () => ({ sessionResponseService: { getResponsesInRangeState: reads.responses } }));
vi.mock('./competitionOutcomeService', () => ({ competitionOutcomeService: { listForLedger: reads.outcomes } }));
vi.mock('./intentBlockService', () => ({ intentBlockService: { getActiveBlocksWithDiagnostics: reads.intent } }));
vi.mock('./assessmentHistoryService', () => ({ assessmentHistoryService: { loadPlanningAssessmentSources: reads.assessments } }));
vi.mock('./sessionExecutionService', () => ({ sessionExecutionService: { getExecutionsInRange: reads.executions } }));
vi.mock('./sessionOccurrenceService', () => ({ sessionOccurrenceService: { getOccurrencesInRangeState: reads.occurrences } }));
vi.mock('./trainingSettingsService', () => ({ trainingSettingsService: { peekTrainingSettingsState: reads.settings } }));
vi.mock('../nutrition/nutritionService', () => ({ nutritionService: { getNutritionDaysState: reads.nutrition = vi.fn() } }));
vi.mock('../sessions/sessionDefinitionResolver', () => ({ resolveSessionDefinition: reads.definition }));
vi.mock('../training-occurrence/repository', () => ({ performedTrainingOccurrenceRepository: { queryActiveInDateWindow: reads.performed } }));
vi.mock('./externalPlanService', () => ({ externalPlanService: {
    listPlanIds: reads.plans, getHeaderState: reads.header, getActivationState: reads.activations,
    getRevisionState: reads.revision, getPlacementState: reads.placement, getPlacementHistoryState: reads.history,
} }));
import { LedgerExportService } from './ledgerExportService';
const available = <T,>(data: T) => ({ status: 'AVAILABLE', data, revision: null });
const request = { asOfDate: AS_OF, purpose: 'planning' as const, exportedAt: '2026-10-26T08:00:00Z' };
describe('LedgerExportService structured work (Phase 2b)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        for (const key of ['flags', 'recovery', 'checkins', 'activities', 'goals', 'fixed', 'blocks', 'schedule', 'responses', 'nutrition', 'occurrences']) reads[key].mockResolvedValue(available([]));
        reads.settings.mockResolvedValue({ status: 'MISSING' });
        reads.preferences.mockResolvedValue({ status: 'MISSING' });
        for (const key of ['anthropometry', 'constraints', 'performed']) reads[key].mockResolvedValue([]);
        reads.plans.mockResolvedValue(available([]));
        reads.history.mockResolvedValue(available([]));
        reads.executions.mockResolvedValue({ executions: [], invalidRecords: 0 });
        reads.intent.mockResolvedValue({ blocks: [], unreadableCount: 0, truncated: false });
        reads.outcomes.mockResolvedValue({ outcomes: [], unreadableCount: 0, truncated: false });
        reads.assessments.mockResolvedValue({ sources: [], relevanceState: 'available', omittedCount: 0 });
        reads.definition.mockResolvedValue({ status: 'MISSING' });
    });
    describe('validated set counts and linked responses (Phase 2b)', () => {
        const source = { kind: 'catalog', workoutId: 'w-1', catalogVersion: '1' };
        const definition = { schemaVersion: 2, id: 'w-1', revision: 1, title: 'Strength', intent: 'training', blocks: [
            { id: 'main', role: 'main', executionMode: 'sequential', steps: [
                { id: 'squat', kind: 'exercise', dose: { kind: 'repetition', sets: 3, reps: 5 },
                    alternatives: [{ id: 'alt', title: 'Press', exerciseRef: { kind: 'catalog', exerciseId: 'p' }, dose: { kind: 'repetition', sets: 9, reps: 5 } }] },
            ] },
        ] };
        const entry = (isWarmup: boolean, extra: Record<string, unknown> = {}) => ({ stepId: 'squat',
            exerciseRef: { kind: 'catalog', exerciseId: 'squat' }, payload: { kind: 'repetition', setIndex: 0, reps: 5, isWarmup }, ...extra });
        function strengthDay(refs: Record<string, unknown>[] = [{ kind: 'structured_execution', executionId: 'exec-1' },
            { kind: 'provider_activity', provider: 'garmin', activityId: 'a-1' }]) {
            reads.performed.mockResolvedValue([{ performedOccurrenceId: 'pto-1', status: 'active', localDate: '2026-11-19', modality: 'Strength', sourceRefs: refs }]);
            reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [{
                execution: { executionId: 'exec-1', sessionSource: source, prescriptionHash: 'rx-1', date: '2026-11-19' },
                entries: [entry(true), entry(false), entry(false), entry(false, { deletedAt: '2026-11-19T10:00:00Z' }), { payload: { kind: 'choice' } }],
            }] });
        }
        const fieldsOf = async () => (await new LedgerExportService().build('owner', request)).facts.performedTraining.items[0].fields;

        it('counts planned sets from the pinned prescription and separates warm-ups, never adding provider work', async () => {
            strengthDay();
            reads.definition.mockResolvedValue(available(definition));
            const fields = await fieldsOf();
            expect(reads.definition).toHaveBeenCalledWith('owner', source, 'rx-1');
            expect(fields.plannedSets).toMatchObject({ value: 3, state: 'measured' });
            expect(fields.workSets).toMatchObject({ value: 2, state: 'measured' });
            expect(fields.warmupSets).toMatchObject({ value: 1, state: 'measured' });
        });

        it.each([
            [{ status: 'MISSING' }, 'missing'],
            [{ status: 'INVALID', issues: [] }, 'invalid'],
            [{ status: 'UNAVAILABLE', operation: 'read', retryable: true }, 'unavailable'],
        ])('keeps an unreadable prescription as a missing denominator, never 0 (%o)', async (response, state) => {
            strengthDay();
            reads.definition.mockResolvedValue(response);
            const fields = await fieldsOf();
            expect(fields.plannedSets).toMatchObject({ value: null, state });
            expect(fields.workSets).toMatchObject({ value: 2, state: 'measured' });
        });

        it('reports a thrown prescription read as unavailable', async () => {
            strengthDay();
            reads.definition.mockRejectedValue(new Error('offline'));
            expect((await fieldsOf()).plannedSets).toMatchObject({ value: null, state: 'unavailable' });
        });

        it('withholds every count when the execution read failed, and marks provider-only work not applicable', async () => {
            strengthDay();
            reads.executions.mockRejectedValue(new Error('offline'));
            const failed = await fieldsOf();
            for (const key of ['plannedSets', 'workSets', 'warmupSets'] as const) expect(failed[key]).toMatchObject({ value: null, state: 'unavailable' });
            strengthDay([{ kind: 'provider_activity', provider: 'garmin', activityId: 'a-1' }]);
            const providerOnly = await fieldsOf();
            for (const key of ['plannedSets', 'workSets', 'warmupSets'] as const) expect(providerOnly[key]).toMatchObject({ value: null, state: 'not_applicable' });
            expect(providerOnly.linkedResponseIds).toMatchObject({ value: null, state: 'not_applicable' });
        });

        it('gives no planned denominator across several structured runs, but sums their performed sets', async () => {
            strengthDay([{ kind: 'structured_execution', executionId: 'exec-1' }, { kind: 'structured_execution', executionId: 'exec-2' }]);
            reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [
                { execution: { executionId: 'exec-1', sessionSource: source, prescriptionHash: 'rx-1', date: '2026-11-19', state: 'abandoned' },
                    entries: [entry(true), entry(false)] },
                { execution: { executionId: 'exec-2', sessionSource: source, prescriptionHash: 'rx-1', date: '2026-11-19' },
                    entries: [entry(false), entry(false), entry(false)] },
            ] });
            reads.definition.mockResolvedValue(available(definition));
            const fields = await fieldsOf();
            expect(fields.plannedSets).toMatchObject({ value: null, state: 'unavailable' });
            expect(fields.workSets).toMatchObject({ value: 4, state: 'measured' });
            expect(fields.warmupSets).toMatchObject({ value: 1, state: 'measured' });
        });

        it('takes planned sets from the pinned reduced prescription, never the authored definition', async () => {
            strengthDay();
            const reduced = { ...definition, blocks: [{ ...definition.blocks[0], steps: [{ id: 'squat', kind: 'exercise', dose: { kind: 'repetition', sets: 2, reps: 5 } }] }] };
            reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [{
                execution: { executionId: 'exec-1', sessionSource: source, prescriptionHash: 'rx-reduced', executedDefinition: 'reduced', date: '2026-11-19' },
                entries: [entry(false), entry(false)],
            }] });
            reads.definition.mockImplementation((_uid, _source, hash) => Promise.resolve(available(hash === 'rx-reduced' ? reduced : definition)));
            expect((await fieldsOf()).plannedSets).toMatchObject({ value: 2, state: 'measured' });
            reads.definition.mockClear();
            reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [{
                execution: { executionId: 'exec-1', sessionSource: source, executedDefinition: 'reduced', date: '2026-11-19' },
                entries: [entry(false), entry(false)],
            }] });
            const noHash = await fieldsOf();
            expect(noHash.plannedSets).toMatchObject({ value: null, state: 'unavailable' });
            expect(noHash.workSets).toMatchObject({ value: 2, state: 'measured' });
            expect(reads.definition).not.toHaveBeenCalled();
        });

        it('links the session response through the structured execution ref, not occurrenceId', async () => {
            strengthDay();
            const base = { userId: 'owner', window: 'immediate', date: '2026-11-19', checkinRef: { date: '2026-11-19' }, sessionRpe: 7,
                createdAt: '2026-11-19T18:00:00Z', updatedAt: '2026-11-19T18:00:00Z' };
            reads.responses.mockResolvedValue(available([
                { ...base, responseId: 'resp-linked', sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-11-19' } },
                { ...base, responseId: 'resp-planning-only', occurrenceId: 'pto-1', sourceSession: { kind: 'execution', id: 'exec-9', date: '2026-11-19' } },
            ]));
            expect((await fieldsOf()).linkedResponseIds).toMatchObject({ value: ['resp-linked'], state: 'measured' });
        });
    });
});
