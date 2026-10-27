import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fullRecords, AS_OF } from '../ledger/export/ledgerExportFixtures.testSupport';
import { computeContentHash } from '../engine/externalPlanHash';
import { SOURCE_KEYS } from '../ledger/export/inputs';
const reads = vi.hoisted(() => Object.fromEntries([
'recovery', 'checkins', 'activities', 'preferences', 'goals', 'fixed', 'blocks', 'anthropometry', 'constraints', 'schedule', 'responses', 'outcomes', 'intent', 'assessments', 'executions', 'occurrences', 'settings', 'plans', 'header', 'activations', 'revision', 'placement', 'performed',
].map(key => [key, vi.fn()])));
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
vi.mock('../training-occurrence/repository', () => ({ performedTrainingOccurrenceRepository: { queryActiveInDateWindow: reads.performed } }));
vi.mock('./externalPlanService', () => ({ externalPlanService: {
    listPlanIds: reads.plans, getHeaderState: reads.header, getActivationState: reads.activations,
    getRevisionState: reads.revision, getPlacementState: reads.placement,
} }));
import { LedgerExportService } from './ledgerExportService';
const available = <T,>(data: T) => ({ status: 'AVAILABLE', data, revision: null });
const request = { asOfDate: AS_OF, purpose: 'planning' as const, exportedAt: '2026-10-26T08:00:00Z' };
describe('LedgerExportService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        for (const key of ['recovery', 'checkins', 'activities', 'goals', 'fixed', 'blocks', 'schedule', 'responses', 'nutrition', 'occurrences']) reads[key].mockResolvedValue(available([]));
        reads.settings.mockResolvedValue({ status: 'MISSING' });
        reads.preferences.mockResolvedValue({ status: 'MISSING' });
        for (const key of ['anthropometry', 'constraints', 'performed']) reads[key].mockResolvedValue([]);
        reads.plans.mockResolvedValue(available([]));
        reads.executions.mockResolvedValue({ executions: [], invalidRecords: 0 });
        reads.intent.mockResolvedValue({ blocks: [], unreadableCount: 0, truncated: false });
        reads.outcomes.mockResolvedValue({ outcomes: [], unreadableCount: 0, truncated: false });
        reads.assessments.mockResolvedValue({ sources: [], relevanceState: 'available', omittedCount: 0 });
    });
    it('reads every source with user scoping and the purpose window, without writing defaults', async () => {
        const output = await new LedgerExportService().build('owner', request);
        expect(output.sources.map(s => s.source)).toEqual([...SOURCE_KEYS]);
        expect(output.sources.every(s => s.state !== 'unavailable')).toBe(true);
        expect(reads.recovery).toHaveBeenCalledWith('owner', '2026-11-07', '2026-11-21');
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
    it('verifies immutable revisions and preserves recorded rationale and mutable placement gaps', async () => {
        const plan = { planId: 'plan-1', revision: 2, schema: 'external-plan@6', notes: 'Aerobic block', sessions: [] };
        const hash = await computeContentHash(plan);
        reads.plans.mockResolvedValue(available(['plan-1']));
        reads.header.mockResolvedValue(available({ planId: 'plan-1', revision: 2, contentHash: hash, importedAt: '2026-11-10T08:00:00Z' }));
        reads.activations.mockResolvedValue(available([{ revision: 2, contentHash: hash, activatedAt: '2026-11-10T08:00:00Z' }]));
        reads.revision.mockResolvedValue(available(plan));
        reads.placement.mockResolvedValue(available({ planId: 'plan-1', revision: 2, assignments: [{ sessionId: 's1', date: AS_OF, status: 'moved' }] }));
        const output = await new LedgerExportService().build('owner', request);
        expect(output.coachingHistory.planRevisions.items[0].fields.authorRationale.value).toBe('Aerobic block');
        expect(output.coachingHistory.placements.items[0].fields.statusHistory.state).toBe('not_yet_supported');
        expect(output.coachingHistory.overrides.items[0].fields.reason.state).toBe('not_yet_supported');
        reads.revision.mockResolvedValue(available({ ...plan, notes: 'tampered' }));
        const corrupt = await new LedgerExportService().build('owner', request);
        expect(corrupt.coachingHistory.planRevisions.state).toBe('invalid');
        expect(corrupt.coachingHistory.planRevisions.items).toEqual([]);
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
});
