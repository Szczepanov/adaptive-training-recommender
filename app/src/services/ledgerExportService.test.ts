import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fullRecords, AS_OF } from '../ledger/export/ledgerExportFixtures.testSupport';
import { computeContentHash } from '../engine/externalPlanHash';
import { SOURCE_KEYS } from '../ledger/export/inputs';
import { ENGINE_OPINION_KEYS } from '../ledger/export/schema';
import { PLACEMENT_HISTORY_TRUNCATED_OPERATION } from '../ledger/placementHistory';
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
describe('LedgerExportService', () => {
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
    it.each([
        [{ status: 'INVALID', issues: [] }, 'invalid', 'corrupt_record'],
        [{ status: 'UNAVAILABLE', operation: 'scan_limit_exceeded', retryable: false }, 'unavailable', 'scan_limit_exceeded'],
        [{ status: 'UNAVAILABLE', operation: 'read failed', retryable: true }, 'unavailable', 'read_failed'],
    ])('reports a failed flag history without partial records', async (response, state, reason) => {
        reads.flags.mockResolvedValue(response);
        const output = await new LedgerExportService().build('owner', request);
        expect(output.sources.find(source => source.source === 'flag_evaluations')).toMatchObject({ state, reason });
        expect(output.flags.every(flag => flag.state === state && flag.active === null)).toBe(true);
    });

    it('reports an unexpected flag-read failure', async () => {
        reads.flags.mockRejectedValue(new Error('offline'));
        const output = await new LedgerExportService().build('owner', request);
        expect(output.sources.find(source => source.source === 'flag_evaluations')).toMatchObject({ state: 'unavailable', reason: 'read_failed' });
        expect(output.flags.every(flag => flag.state === 'unavailable')).toBe(true);
    });

    it('reads every source with user scoping and the purpose window, without writing defaults', async () => {
        const output = await new LedgerExportService().build('owner', request);
        expect(output.sources.map(s => s.source)).toEqual([...SOURCE_KEYS]);
        expect(output.sources.every(s => s.state !== 'unavailable')).toBe(true);
        expect(reads.recovery).toHaveBeenCalledWith('owner', '2026-11-07', '2026-11-21');
        expect(reads.checkins).toHaveBeenCalledWith('owner', '2026-10-23', '2026-11-21');
        expect(reads.flags).toHaveBeenCalledWith('owner', '2026-11-07', '2026-11-20');
        expect(reads.nutrition).toHaveBeenCalledWith('owner', '2026-11-07', AS_OF);
        expect(reads.settings).toHaveBeenCalledWith('owner');
        expect(output.userContext.equipment.fields.free_weights.state).toBe('missing');
        expect(output.legacyEngine).toBeNull();
        reads.constraints.mockResolvedValue([{ ...fullRecords().constraints![0], description: 'owner has this constraint' }]);
        const redacted = await new LedgerExportService().build('owner', request);
        expect(JSON.stringify(redacted)).not.toContain('owner');
        expect(JSON.stringify(output)).not.toContain('owner');
    });
    it('keeps unreadable and invalid sources distinct from measured empty collections', async () => {
        reads.recovery.mockResolvedValue({ status: 'INVALID', issues: [] });
        reads.responses.mockRejectedValue(new Error('offline'));
        reads.activities.mockResolvedValue({ status: 'UNAVAILABLE' });
        const output = await new LedgerExportService().build('owner', request);
        expect(output.facts.recovery.state).toBe('invalid');
        expect(output.facts.sessionResponses.state).toBe('unavailable');
        expect(output.facts.activities.state).toBe('unavailable');
        expect(output.facts.checkins.state).toBe('measured');
    });
    it('is semantically deterministic and does not widen the morning window', async () => {
        reads.recovery.mockResolvedValue(available(fullRecords().recovery));
        const service = new LedgerExportService();
        const one = await service.build('owner', { ...request, purpose: 'morning' });
        const two = await service.build('owner', { ...request, purpose: 'morning' });
        expect(two).toEqual(one);
        expect(one.window.days).toBe(2);
        expect(reads.recovery).toHaveBeenCalledWith('owner', '2026-11-19', '2026-11-21');
    });
    it('exports canonical work once, summarizes live entries and keeps the authored link', async () => {
        const plan = { schema: 'external-plan@6', sessions: [{ id: 'session-1' }] };
        const contentHash = await computeContentHash(plan);
        const source = { kind: 'external_plan', planId: 'plan-1', revision: 2, sessionId: 'session-1', contentHash };
        reads.plans.mockResolvedValue(available(['plan-1']));
        reads.header.mockResolvedValue(available({ revision: 2, contentHash, importedAt: '2026-11-10T08:00:00Z' }));
        reads.activations.mockResolvedValue(available([]));
        reads.revision.mockResolvedValue(available(plan));
        reads.placement.mockResolvedValue(available({ planId: 'plan-1', revision: 2, assignments: [{ sessionId: 'session-1', date: '2026-11-18', status: 'moved' }] }));
        reads.performed.mockResolvedValue([{ performedOccurrenceId: 'pto-1', status: 'active', localDate: '2026-11-19', modality: 'Strength',
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }, { kind: 'provider_activity', provider: 'garmin', activityId: 'a-1' }] }]);
        reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [{
            execution: { executionId: 'exec-1', sessionSource: source, date: '2026-11-19' },
            entries: [
                { exerciseRef: { kind: 'catalog', exerciseId: 'squat' }, payload: { kind: 'repetition' } },
                { exerciseRef: { kind: 'catalog', exerciseId: 'squat' }, payload: { kind: 'repetition' } },
                { payload: { kind: 'choice' } },
                { payload: { kind: 'repetition' }, deletedAt: '2026-11-19T09:00:00Z' },
            ],
        }] });
        const result = await new LedgerExportService().build('owner', request);
        expect(result.facts.performedTraining.items).toHaveLength(1);
        expect(result.facts.performedTraining.items[0].fields.structuredEntries.value).toEqual({ exerciseCount: 1, setCount: 2 });
        expect(result.facts.performedTraining.items[0].fields.executedDefinitions.value).toEqual([{ executionId: 'exec-1', executedDefinition: 'unknown' }]);
        reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [{ execution: { executionId: 'exec-1', sessionSource: source, date: '2026-11-19', executedDefinition: 'reduced' }, entries: [] }] });
        const reduced = await new LedgerExportService().build('owner', request);
        expect(reduced.facts.performedTraining.items[0].fields.executedDefinitions.value).toEqual([{ executionId: 'exec-1', executedDefinition: 'reduced' }]);
        expect(result.coachingHistory.plannedToPerformed.items[0].fields).toMatchObject({ performedOccurrenceRef: { value: 'pto-1' }, sessionId: { value: 'session-1' } });
        // A mutable moved overlay must not redate the recorded execution linkage.
        expect(result.coachingHistory.plannedToPerformed.items[0].observedOn).toBe('2026-11-19');
        source.contentHash = 'mismatch';
        const wrongHash = await new LedgerExportService().build('owner', request);
        expect(wrongHash.coachingHistory.plannedToPerformed.items).toEqual([]);
        expect(wrongHash.coachingHistory.plannedToPerformed.state).toBe('invalid');
        source.contentHash = contentHash;
        reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [] });
        const missing = await new LedgerExportService().build('owner', request);
        expect(missing.coachingHistory.plannedToPerformed.state).toBe('unavailable');
        reads.executions.mockResolvedValue({ invalidRecords: 1, executions: [] });
        const partial = await new LedgerExportService().build('owner', request);
        expect(partial.facts.performedTraining.state).toBe('invalid');
        expect(partial.facts.performedTraining.items[0].fields.structuredEntries.state).toBe('not_yet_supported');
    });
    it('exports in-session swaps resolved against each run\'s pinned definition, reading it once', async () => {
        const definition = {
            schemaVersion: 1, id: 'w', revision: 1, title: 'Strength', intent: 'training',
            blocks: [{ id: 'b1', role: 'main',
                steps: [{ id: 'squat', kind: 'exercise', title: 'Back Squat', exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                    alternatives: [{ id: 'alt', title: 'Goblet Squat', exerciseRef: { kind: 'catalog', exerciseId: 'goblet_squat' } }] }],
                optionSets: [{ id: 'knee', appliesAtStepId: 'squat', trigger: { kind: 'athlete_observed', description: 'knee?' },
                    options: [{ id: 'swap', label: 'Swap', actions: [{ kind: 'select_alternative', targetStepId: 'squat', alternativeId: 'alt' }] }] }] }],
        };
        reads.definition.mockResolvedValue({ status: 'AVAILABLE', data: definition, revision: null });
        reads.performed.mockResolvedValue([{ performedOccurrenceId: 'pto-1', status: 'active', localDate: '2026-11-19',
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }] }]);
        reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [{
            execution: { executionId: 'exec-1', date: '2026-11-19', state: 'completed', prescriptionHash: 'p',
                sessionSource: { kind: 'manual', definitionId: 'w', revision: 1, contentHash: 'h' } },
            entries: [{ id: 'ch-1', executionId: 'exec-1', completedAt: '2026-11-19T07:00:00Z', createdAt: '2026-11-19T07:00:00Z', updatedAt: '2026-11-19T07:00:00Z',
                payload: { kind: 'choice', choiceId: 'knee', optionId: 'swap', reason: 'Knee tight' } }],
        }] });
        reads.definition.mockClear();
        const result = await new LedgerExportService().build('owner', request);
        const swaps = result.coachingHistory.overrides.items.filter(item => item.fields.kind.value === 'swapped');
        expect(swaps).toHaveLength(1);
        expect(swaps[0].fields).toMatchObject({ step: { value: 'Back Squat' }, replacement: { value: 'Goblet Squat' }, reason: { value: 'Knee tight' } });
        expect(reads.definition).toHaveBeenCalledTimes(1);
    });

    it('derives placement outcomes from hash-verified executions and never misses an unverifiable one', async () => {
        const plan = { schema: 'external-plan@6', sessions: [{ id: 'session-1' }, { id: 'session-2' }] };
        const contentHash = await computeContentHash(plan);
        reads.plans.mockResolvedValue(available(['plan-1']));
        reads.header.mockResolvedValue(available({ revision: 2, contentHash, importedAt: '2026-11-10T08:00:00Z' }));
        reads.activations.mockResolvedValue(available([]));
        reads.revision.mockResolvedValue(available(plan));
        reads.placement.mockResolvedValue(available({ planId: 'plan-1', revision: 2, assignments: [
            { sessionId: 'session-1', date: '2026-11-18', status: 'planned' },
            { sessionId: 'session-2', date: '2026-11-18', status: 'planned' },
        ] }));
        reads.performed.mockResolvedValue([]);
        const source = (sessionId: string, hash: string) => ({ kind: 'external_plan', planId: 'plan-1', revision: 2, sessionId, contentHash: hash });
        reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [
            { execution: { executionId: 'e1', sessionSource: source('session-1', contentHash), date: '2026-11-18', state: 'abandoned' }, entries: [] },
            { execution: { executionId: 'e2', sessionSource: source('session-2', 'sha256:other'), date: '2026-11-18', state: 'completed' }, entries: [] },
        ] });
        const result = await new LedgerExportService().build('owner', request);
        const outcome = (sessionId: string) => result.coachingHistory.placements.items
            .find(item => item.fields.sessionId.value === sessionId)?.fields.outcome.value;
        expect(outcome('session-1')).toBe('started_not_completed');
        expect(outcome('session-2')).toBe('unknown');
    });

    it('verifies immutable revisions and preserves recorded rationale and mutable placement gaps', async () => {
        const plan = { planId: 'plan-1', revision: 2, schema: 'external-plan@6', notes: 'Aerobic block', sessions: [] };
        const hash = await computeContentHash(plan);
        reads.plans.mockResolvedValue(available(['plan-1']));
        reads.header.mockResolvedValue(available({ planId: 'plan-1', revision: 2, contentHash: hash, importedAt: '2026-11-10T08:00:00Z' }));
        reads.activations.mockResolvedValue(available([{ revision: 2, contentHash: hash, activatedAt: '2026-11-10T08:00:00Z' }]));
        reads.revision.mockResolvedValue(available(plan));
        reads.placement.mockResolvedValue(available({ planId: 'plan-1', revision: 2, assignments: [{ sessionId: 's1', date: AS_OF, status: 'moved' }], updatedAt: '2026-11-15T08:00:00.000Z' }));
        const output = await new LedgerExportService().build('owner', request);
        expect(output.coachingHistory.planRevisions.items[0].fields.authorRationale.value).toBe('Aerobic block');
        expect(output.coachingHistory.placements.items[0].fields.statusHistory.state).toBe('not_yet_supported');
        expect(output.coachingHistory.overrides.items[0].fields.reason.state).toBe('not_yet_supported');
        // A failed history read still makes the whole placement source unavailable.
        reads.history.mockResolvedValueOnce({ status: 'UNAVAILABLE', operation: 'read external plan placement history', retryable: true });
        const failed = await new LedgerExportService().build('owner', request);
        expect(failed.coachingHistory.placements.state).toBe('unavailable');
        expect(failed.sources.find(s => s.source === 'external_plan_placements')?.state).toBe('unavailable');
        // A history beyond the hard scan bound degrades only that revision (#1172): its current
        // overlay stays exported, with statusHistory unavailable rather than partial or absent.
        reads.history.mockResolvedValueOnce({ status: 'UNAVAILABLE', operation: PLACEMENT_HISTORY_TRUNCATED_OPERATION, retryable: false });
        const truncated = await new LedgerExportService().build('owner', request);
        expect(truncated.coachingHistory.placements.state).toBe('measured');
        expect(truncated.sources.find(s => s.source === 'external_plan_placements')?.state).toBe('measured');
        expect(truncated.coachingHistory.placements.items[0].fields.date.value).toBe(AS_OF);
        expect(truncated.coachingHistory.placements.items[0].fields.statusHistory).toMatchObject({ value: null, state: 'unavailable' });
        reads.revision.mockResolvedValue(available({ ...plan, notes: 'tampered' }));
        const corrupt = await new LedgerExportService().build('owner', request);
        expect(corrupt.coachingHistory.planRevisions.state).toBe('invalid');
        expect(corrupt.coachingHistory.planRevisions.items).toEqual([]);
    });
    it.each([
        ['v1 prescription', { prescription: { summary: 'Sum', steps: [{ name: 'a', notes: 'n1' }, { name: 'b' }, { name: 'c', notes: ' ' }] } }],
        ['v2+ definition', { definition: { summary: 'Sum', blocks: [{ steps: [{ notes: 'n1' }, {}] }, { steps: [{ notes: ' ' }] }] } }],
    ])('maps authored %s content onto placements', async (_label, content) => {
        const plan = { schema: 'external-plan@6', sessions: [{ id: 'session-1', title: 'Ride', priority: 'key', scaling: { fallback: 'Spin' }, ...content }] };
        const contentHash = await computeContentHash(plan);
        reads.plans.mockResolvedValue(available(['plan-1']));
        reads.header.mockResolvedValue(available({ revision: 2, contentHash, importedAt: '2026-11-10T08:00:00Z' }));
        reads.activations.mockResolvedValue(available([]));
        reads.revision.mockResolvedValue(available(plan));
        reads.placement.mockResolvedValue(available({ planId: 'plan-1', revision: 2, assignments: [{ sessionId: 'session-1', date: '2026-11-25', status: 'planned' }] }));
        const fields = (await new LedgerExportService().build('owner', request)).coachingHistory.placements.items[0].fields;
        expect(fields.title.value).toBe('Ride');
        expect(fields.priority.value).toBe('key');
        expect(fields.summary.value).toBe('Sum');
        expect(fields.stepNotes.value).toEqual(['n1']);
        expect(fields.fallback.value).toBe('Spin');
    });
    it('reports incomplete bounded evidence rather than claiming a complete empty source', async () => {
        reads.outcomes.mockResolvedValue({ outcomes: [], unreadableCount: 0, truncated: true });
        reads.intent.mockResolvedValue({ blocks: [], unreadableCount: 1, truncated: false });
        reads.assessments.mockResolvedValue({ sources: [], relevanceState: 'incomplete', omittedCount: 1 });
        const output = await new LedgerExportService().build('owner', request);
        expect(output.facts.events.state).toBe('unavailable');
        expect(output.userContext.events.state).toBe('invalid');
        expect(output.facts.assessments.state).toBe('unavailable');
    });
    it('retains older revisions referenced by performed work after placements move out of range', async () => {
        const older = { schema: 'external-plan@6', sessions: [{ id: 's1' }], notes: 'Original rationale' };
        const latest = { ...older, notes: 'New rationale' };
        const oldHash = await computeContentHash(older);
        const newHash = await computeContentHash(latest);
        reads.plans.mockResolvedValue(available(['plan-1']));
        reads.header.mockResolvedValue(available({ revision: 2, contentHash: newHash, importedAt: '2026-11-20T08:00:00Z' }));
        reads.activations.mockResolvedValue(available([{ revision: 1, contentHash: oldHash, activatedAt: '2026-11-01T08:00:00Z' }]));
        reads.revision.mockImplementation((_uid, _plan, revision) => Promise.resolve(available(revision === 1 ? older : latest)));
        reads.placement.mockResolvedValue(available({ planId: 'plan-1', revision: 1, assignments: [{ sessionId: 's1', date: '2026-12-01', status: 'moved' }] }));
        reads.performed.mockResolvedValue([{ performedOccurrenceId: 'pto-1', status: 'active', localDate: '2026-11-19', modality: 'Strength',
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }] }]);
        reads.executions.mockResolvedValue({ invalidRecords: 0, executions: [{
            execution: { executionId: 'exec-1', date: '2026-11-19', sessionSource: { kind: 'external_plan', planId: 'plan-1', revision: 1, sessionId: 's1', contentHash: oldHash } }, entries: [],
        }] });
        const result = await new LedgerExportService().build('owner', request);
        expect(result.coachingHistory.plannedToPerformed.items).toHaveLength(1);
        expect(result.coachingHistory.planRevisions.items.map(item => item.fields.revision.value)).toEqual([1, 2]);
    });
    it.each(['UNAVAILABLE', 'INVALID'] as const)('keeps %s check-ins from claiming unrecorded nutrition adherence', async status => {
        reads.checkins.mockResolvedValue({ status, issues: [] });
        reads.nutrition.mockResolvedValue(available(fullRecords().nutritionDays));
        const result = await new LedgerExportService().build('owner', request);
        expect(result.facts.nutrition.items.length).toBeGreaterThan(0);
        expect(result.facts.nutrition.items.every(item => item.fields.adherence.state === status.toLowerCase())).toBe(true);
    });
    it.each(['header', 'activations', 'revision'])('preserves invalid %s diagnostics', async key => {
        const plan = { schema: 'external-plan@6', sessions: [] };
        const hash = await computeContentHash(plan);
        reads.plans.mockResolvedValue(available(['plan-1']));
        reads.header.mockResolvedValue(available({ revision: 1, contentHash: hash, importedAt: '2026-11-10T08:00:00Z' }));
        reads.activations.mockResolvedValue(available([]));
        reads.revision.mockResolvedValue(available(plan));
        reads.placement.mockResolvedValue({ status: 'MISSING' });
        reads[key].mockResolvedValue({ status: 'INVALID', issues: [] });
        const result = await new LedgerExportService().build('owner', request);
        expect(result.coachingHistory.planRevisions.state).toBe('invalid');
    });
    it('rejects invalid scope/date before any source is read', async () => {
        const service = new LedgerExportService();
        await expect(service.build('', request)).rejects.toThrow();
        await expect(service.build('owner', { ...request, asOfDate: '2026-02-30' })).rejects.toThrow();
        expect(reads.recovery).not.toHaveBeenCalled();
    });

    it('keeps engine-opinion keys out of default exports and isolates opt-in opinions to legacyEngine (OD4)', async () => {
        const service = new LedgerExportService();
        const defaultExport = await service.build('owner', request);
        expect(defaultExport.legacyEngine).toBeNull();
        const serializedDefault = JSON.stringify(defaultExport);
        for (const key of ENGINE_OPINION_KEYS) {
            expect(serializedDefault).not.toContain(`"${key}"`);
        }

        const optedIn = await service.build('owner', {
            ...request,
            legacyEngine: { policyVersion: '9.9.9', verdict: 'proceed' },
        });
        expect(optedIn.legacyEngine).toEqual({ policyVersion: '9.9.9', verdict: 'proceed' });
    });

    describe('revisions referenced only by a future placement', () => {
        const older = { schema: 'external-plan@6', sessions: [{ id: 'old-1', title: 'Old ride', definition: { summary: 'From revision 1', blocks: [] } }] };
        const latest = { schema: 'external-plan@6', sessions: [] };
        const future = { planId: 'plan-1', revision: 1, assignments: [{ sessionId: 'old-1', date: '2026-11-25', status: 'planned' }] };

        async function setup(activations: unknown) {
            const [oldHash, newHash] = [await computeContentHash(older), await computeContentHash(latest)];
            reads.plans.mockResolvedValue(available(['plan-1']));
            reads.header.mockResolvedValue(available({ revision: 2, contentHash: newHash, importedAt: '2026-11-18T08:00:00Z' }));
            reads.activations.mockResolvedValue(typeof activations === 'function' ? activations(oldHash, newHash) : activations);
            reads.revision.mockImplementation((_uid, _plan, revision) => Promise.resolve(available(revision === 1 ? older : latest)));
            // Revision 1 is placed only through the legacy (unscoped) overlay; revision 2 has none.
            reads.placement.mockImplementation((_uid, _plan, revision) => Promise.resolve(revision === undefined || revision === 1
                ? available(future) : { status: 'MISSING' }));
        }

        it('exports the future placement content and a revision-1 header while the header is at revision 2', async () => {
            await setup((oldHash: string, newHash: string) => available([
                { revision: 1, contentHash: oldHash, activatedAt: '2026-11-01T08:00:00Z' },
                { revision: 2, contentHash: newHash, activatedAt: '2026-11-18T08:00:00Z' },
            ]));
            const result = await new LedgerExportService().build('owner', { ...request, purpose: 'morning' });
            const [placement] = result.coachingHistory.placements.items;
            expect(placement.fields).toMatchObject({ revision: { value: 1 }, title: { value: 'Old ride', state: 'measured' },
                summary: { value: 'From revision 1', state: 'measured' } });
            expect(result.coachingHistory.planRevisions.items.map(row => row.id)).toEqual(['plan-1@1', 'plan-1@2']);
        });

        it('reads a revision found only through a future placement and keeps unverifiable content unavailable', async () => {
            await setup({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
            const result = await new LedgerExportService().build('owner', { ...request, purpose: 'morning' });
            expect(reads.revision).toHaveBeenCalledWith('owner', 'plan-1', 1);
            const [placement] = result.coachingHistory.placements.items;
            expect(placement.fields.sessionId.value).toBe('old-1');
            expect(placement.fields.title).toMatchObject({ value: null, state: 'unavailable' });
            expect(result.coachingHistory.planRevisions.items.map(row => row.id)).toEqual(['plan-1@2']);
        });

        it('does not read an older revision whose legacy placement lies outside the bounds', async () => {
            await setup({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
            reads.placement.mockImplementation((_uid, _plan, revision) => Promise.resolve(revision === undefined || revision === 1
                ? available({ ...future, assignments: [{ sessionId: 'old-1', date: '2026-11-28', status: 'planned' }] }) : { status: 'MISSING' }));
            await new LedgerExportService().build('owner', { ...request, purpose: 'morning' });
            expect(reads.revision).not.toHaveBeenCalledWith('owner', 'plan-1', 1);
        });
    });
});
