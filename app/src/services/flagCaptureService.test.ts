import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataState } from '../engine/dataState';
import type { HealthAnomalyAssessmentRevision } from '../derived/flags/illnessAnomaly/healthAnomalyModels';
import type { PersistedFlagEvaluation } from '../ledger/flagEvaluation';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin, TrainingSettings } from '../ledger/models';
import type { ActiveExternalPlan } from './activeExternalPlanService';
import type { SessionDefinition, SessionOccurrence } from '../sessions/models';
import { captureCurrentFlags, FlagCaptureService, flagCaptureService } from './flagCaptureService';
import { fullRecords } from '../ledger/export/ledgerExportFixtures.testSupport';

vi.mock('../firebase', () => ({ getDb: () => ({}) }));
vi.mock('./sessionOccurrenceService', () => ({ sessionOccurrenceService: {} }));
vi.mock('./sessionExecutionService', () => ({ sessionExecutionService: {} }));
vi.mock('./activeExternalPlanService', () => ({
    activeExternalPlanService: {}, placedSessionsForDate: (active: ActiveExternalPlan, date: string) =>
        active.placed.filter(item => item.date === date && ['planned', 'moved'].includes(item.status)),
}));
vi.mock('../sessions/sessionDefinitionResolver', () => ({ resolveSessionDefinition: vi.fn() }));

const date = '2026-10-28';
const ok = <T,>(data: T): DataState<T> => ({ status: 'AVAILABLE', data, revision: '1' });
const definition: SessionDefinition = { schemaVersion: 1, id: 'definition', revision: 1, title: 'Push',
    intent: 'training', modalities: ['strength'], blocks: [{ id: 'main', role: 'main', executionMode: 'sequential',
        steps: [{ id: 'press', kind: 'exercise', exerciseRef: { kind: 'unresolved_free_text', name: 'Press' }, compositionPatterns: ['upper_push'] }] }] };
const manual = { userId: 'alice', occurrenceId: 'one', date, authority: 'schedule', state: 'scheduled',
    definitionRef: { definitionId: 'definition', revision: 1, contentHash: 'hash' } } as SessionOccurrence;

describe('dated flag capture', () => {
    const reads = {
        recovery: vi.fn<() => Promise<DataState<DailyRecoverySnapshot>>>(),
        checkin: vi.fn<() => Promise<DataState<DailySubjectiveCheckin>>>(),
        settings: vi.fn<() => Promise<DataState<TrainingSettings>>>(),
        plan: vi.fn<() => Promise<DataState<ActiveExternalPlan>>>(),
        occurrences: vi.fn<() => Promise<DataState<SessionOccurrence[]>>>(),
        executions: vi.fn(),
        resolve: vi.fn(),
        healthAnomaly: vi.fn<() => Promise<HealthAnomalyAssessmentRevision | { revision: HealthAnomalyAssessmentRevision | null; unreadableCount: number } | null>>(),
        persist: vi.fn(),
        priorFlags: vi.fn<() => Promise<DataState<PersistedFlagEvaluation[]>>>(),
    };
    let saved: PersistedFlagEvaluation[];
    let service: FlagCaptureService;
    beforeEach(() => {
        vi.clearAllMocks(); saved = [];
        reads.recovery.mockResolvedValue({ status: 'MISSING' });
        reads.checkin.mockResolvedValue({ status: 'MISSING' });
        reads.settings.mockResolvedValue(ok({ injuries: [{ region: 'shoulder', severity: 'limit' }] } as TrainingSettings));
        reads.plan.mockResolvedValue({ status: 'MISSING' });
        reads.occurrences.mockResolvedValue(ok([]));
        reads.executions.mockResolvedValue({ executions: [], invalidRecords: 0 });
        reads.resolve.mockResolvedValue(ok(definition));
        reads.healthAnomaly.mockResolvedValue(null);
        reads.persist.mockImplementation(async (v: PersistedFlagEvaluation) => { saved.push(v); return v; });
        reads.priorFlags.mockResolvedValue(ok([]));
        service = new FlagCaptureService(reads);
    });
    const capture = () => service.captureForDate('alice', date, date, '2026-10-28T08:00:00.000Z');
    it('records a confirmed rest day as not applicable and missing illness_anomaly when no assessment exists', async () => {
        await capture();
        expect(saved).toHaveLength(4);
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')).toMatchObject({
            active: false, state: 'not_applicable', reasonCode: 'no_planned_session',
        });
        expect(saved.find(f => f.id === 'illness_anomaly')).toMatchObject({
            active: null, state: 'missing', reasonCode: 'no_assessment',
        });
    });
    it('evaluates illness_anomaly from the latest health anomaly assessment revision', async () => {
        const makeRevision = (state: 'possible_illness_or_systemic_stress' | 'watch_unexplained' | 'normal'): HealthAnomalyAssessmentRevision => ({
            schemaVersion: 1,
            userId: 'alice',
            date,
            revisionId: `ha-${'0'.repeat(16)}`,
            idempotencyKey: `${date}:${'0'.repeat(16)}`,
            computedAt: '2026-10-28T07:00:00.000Z',
            policyVersion: 'health-anomaly/ha3-v1',
            thresholdPolicy: {
                policyVersion: 'health-anomaly-thresholds/visible-early-warning-v1',
                moderateDeviation: 1.5,
                strongDeviation: 2.5,
                minimumCoreSignalsForMultiSignal: 2,
                persistenceDaysForEscalation: 2,
                minimumHistoryCount: 14,
                minimumRecentDayCoverage: 4 / 7,
                maxBaselineAgeDays: 3,
                estimatorBySignal: { rhr: 'mean-stdev-28d', respiration: 'median-mad-28d', hrv: 'log-mean-stdev-28d' },
            },
            mode: 'visible-v1',
            source: {
                timezone: 'Europe/Warsaw',
                recoverySnapshotRevision: 'r1',
                checkinRevision: null,
                historyWindowStart: '2026-09-30',
                historyWindowEndExclusive: date,
                historySnapshotRevisions: [],
                travelContextRevision: null,
                persistenceLookbackStart: '2026-10-25',
            },
            assessment: {
                state,
                evidenceLevel: state === 'possible_illness_or_systemic_stress' ? 'high' : 'low',
                coreSignals: [
                    { signal: 'rhr', estimator: 'mean-stdev-28d', direction: 'high', status: 'moderate_anomaly', currentValue: 58, baselineValue: 50, scaleValue: 4, standardizedDeviation: 2.0, baselineVersion: 5 },
                    { signal: 'respiration', estimator: 'median-mad-28d', direction: 'high', status: 'normal', currentValue: 14, baselineValue: 14, scaleValue: 0.5, standardizedDeviation: 0, baselineVersion: 5 },
                    { signal: 'hrv', estimator: 'log-mean-stdev-28d', direction: 'low', status: 'normal', currentValue: 60, baselineValue: 62, scaleValue: 5, standardizedDeviation: -0.2, baselineVersion: 5 },
                ],
                supportingSignals: [],
                explanations: [],
                unexplainedEvidence: ['rhr'],
                persistenceDays: 2,
                episodeId: 'ep-1',
                episodeDay: 2,
                dataQuality: [],
                rationale: { facts: [], explanations: [], cautions: [] },
                policyVersion: 'health-anomaly/ha3-v1',
                thresholdPolicyVersion: 'health-anomaly-thresholds/visible-early-warning-v1',
                mode: 'visible-v1',
            },
        });

        reads.healthAnomaly.mockResolvedValue(makeRevision('possible_illness_or_systemic_stress'));
        await capture();
        expect(saved.find(f => f.id === 'illness_anomaly')).toMatchObject({
            active: true,
            state: 'measured',
            reasonCode: 'possible_illness_or_systemic_stress',
        });

        saved = [];
        reads.healthAnomaly.mockResolvedValue(makeRevision('watch_unexplained'));
        await capture();
        expect(saved.find(f => f.id === 'illness_anomaly')).toMatchObject({
            active: false,
            state: 'measured',
            reasonCode: 'watch_unexplained',
        });

        saved = [];
        reads.healthAnomaly.mockRejectedValue(new Error('firestore down'));
        await capture();
        expect(saved.find(f => f.id === 'illness_anomaly')).toMatchObject({
            active: null,
            state: 'unavailable',
            reasonCode: 'source_unavailable',
        });
    });
    it('records the actual recovery comparison values, not just an opaque evidence digest', async () => {
        const snapshot = structuredClone(fullRecords().recovery![0]);
        snapshot.date = date;
        snapshot.raw.hrvOvernightAvg = 65;
        snapshot.derived.deltas.hrvVs7d = -5;
        snapshot.derived.hrv28dStdev = 4;
        snapshot.dataQuality.baseline7dReady = true;
        snapshot.dataQuality.baseline28dReady = true;
        delete snapshot.source.metricDates;
        reads.recovery.mockResolvedValue(ok(snapshot));
        await capture();
        const flag = saved.find(f => f.id === 'recovery_beyond_baseline')!;
        expect(flag.inputs.find(input => input.name === 'hrv_delta7d')?.value)
            .toMatchObject({ value: snapshot.derived.deltas.hrvVs7d, unit: 'ms' });
        expect(flag.inputs.find(input => input.name === 'hrv_band')?.value.value).toBeTypeOf('number');
    });
    it.each(['UNAVAILABLE', 'INVALID'] as const)('preserves %s source failures instead of claiming user non-entry', async status => {
        const failure = status === 'INVALID' ? { status, issues: [] } : { status, operation: 'test', retryable: true };
        reads.recovery.mockResolvedValue(failure);
        reads.checkin.mockResolvedValue(failure);
        reads.settings.mockResolvedValue(failure);
        await capture();
        for (const id of ['recovery_beyond_baseline', 'illness_risk_symptom', 'injury_constraint_touches_session']) {
            const flag = saved.find(f => f.id === id);
            expect(flag).toMatchObject({ active: null, state: status.toLowerCase() });
            expect(flag?.inputs.some(i => i.value.state === status.toLowerCase())).toBe(true);
        }
    });
    it('records manual sessions with stable occurrence references', async () => {
        reads.occurrences.mockResolvedValue(ok([manual]));
        await capture();
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')).toMatchObject({
            active: true, sessionRef: 'occurrence:one',
        });
    });
    it('resolves unlaunched legacy external sessions without a definition', async () => {
        reads.settings.mockResolvedValue(ok({ injuries: [{ region: 'knee', severity: 'limit' }] } as TrainingSettings));
        reads.plan.mockResolvedValue(ok({ header: { contentHash: 'pinned-plan-hash' },
            plan: { planId: 'legacy', revision: 1 }, placed: [{
                session: { id: 'run', prescription: { summary: 'Easy run' } }, date, status: 'planned',
            }],
        } as unknown as ActiveExternalPlan));
        reads.resolve.mockResolvedValue(ok({ ...definition, modalities: ['running'] }));
        await capture();
        expect(reads.resolve).toHaveBeenCalledWith('alice', {
            kind: 'external_plan', planId: 'legacy', revision: 1, sessionId: 'run', contentHash: 'pinned-plan-hash',
        });
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')).toMatchObject({
            active: true, sessionRef: 'external_plan:legacy@1:run',
        });
    });
    it('recaptures the recorded reduced prescription after launch and ignores abandoned sessions', async () => {
        reads.occurrences.mockResolvedValue(ok([manual]));
        await capture();
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')?.active).toBe(true);
        saved = [];
        const reduced = { ...definition, blocks: [] };
        reads.executions.mockResolvedValue({ executions: [{ execution: { occurrenceId: manual.occurrenceId, prescriptionHash: 'reduced-hash' } }], invalidRecords: 0 });
        reads.resolve.mockResolvedValue(ok(reduced));
        await capture();
        expect(reads.resolve).toHaveBeenCalledWith('alice', expect.anything(), 'reduced-hash');
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')?.active).toBe(false);
        saved = [];
        reads.occurrences.mockResolvedValue(ok([{ ...manual, state: 'abandoned' }]));
        await capture();
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')).toMatchObject({
            state: 'not_applicable', reasonCode: 'no_planned_session',
        });
    });
    it('does not call a failed or corrupt plan read a rest day', async () => {
        reads.plan.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'plans', retryable: true });
        await capture();
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')).toMatchObject({ active: null, state: 'unavailable' });
    });
    it('includes an unlaunched external placement and deduplicates its matching occurrence', async () => {
        const active = { plan: { planId: 'block', revision: 2 }, placed: [{
            session: { id: 'press', definition }, date, status: 'planned', moved: false,
        }] } as unknown as ActiveExternalPlan;
        reads.plan.mockResolvedValue(ok(active));
        await capture();
        expect(saved.filter(f => f.id === 'injury_constraint_touches_session')).toHaveLength(1);
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')?.sessionRef).toBe('external_plan:block@2:press');
        saved = [];
        reads.occurrences.mockResolvedValue(ok([{
            ...manual, authority: 'external_plan', definitionRef: undefined,
            externalPlanRef: { planId: 'block', revision: 2, sessionId: 'press', contentHash: 'hash' },
        } as unknown as SessionOccurrence]));
        await capture();
        expect(saved.filter(f => f.id === 'injury_constraint_touches_session')).toHaveLength(1);
        expect(reads.resolve).toHaveBeenCalledWith('alice', expect.objectContaining({ kind: 'external_plan', revision: 2 }), undefined);
    });
    it('keeps failed pinned definitions explicit instead of falling back to an authored no-touch', async () => {
        reads.occurrences.mockResolvedValue(ok([manual]));
        reads.resolve.mockResolvedValue({ status: 'INVALID', issues: [] });
        await capture();
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')).toMatchObject({
            active: null, state: 'invalid', sessionRef: 'occurrence:one',
        });
    });
    it('creates a revision when the constraints change even if the resulting flag stays the same', async () => {
        reads.occurrences.mockResolvedValue(ok([manual]));
        await capture();
        const first = saved.find(f => f.id === 'injury_constraint_touches_session')!;
        saved = [];
        reads.settings.mockResolvedValue(ok({ injuries: [{ region: 'shoulder', severity: 'exclude' }] } as TrainingSettings));
        await capture();
        const next = saved.find(f => f.id === 'injury_constraint_touches_session')!;
        expect(next.active).toBe(first.active);
        expect(next.revisionId).not.toBe(first.revisionId);
    });
    it('records A to B to A settings revisions and deduplicates a retry', async () => {
        reads.occurrences.mockResolvedValue(ok([manual]));
        const ids: string[] = [];
        for (const [revision, severity] of [['1', 'limit'], ['2', 'exclude'], ['3', 'limit'], ['3', 'limit']]) {
            reads.settings.mockResolvedValue({ status: 'AVAILABLE', revision,
                data: { injuries: [{ region: 'shoulder', severity }] } as TrainingSettings });
            saved = [];
            await capture();
            ids.push(saved.find(f => f.id === 'injury_constraint_touches_session')!.revisionId);
        }
        expect(new Set(ids.slice(0, 3)).size).toBe(3);
        expect(ids[3]).toBe(ids[2]);
    });
    it.each([false, true])('selects the active redo regardless of header order (reversed: %s)', async reversed => {
        reads.occurrences.mockResolvedValue(ok([manual]));
        const headers = [
            { execution: { occurrenceId: 'one', prescriptionHash: 'reduced', state: 'completed', startedAt: '2026-10-28T08:00:00Z' } },
            { execution: { occurrenceId: 'one', prescriptionHash: 'authored', state: 'in_progress', startedAt: '2026-10-28T09:00:00Z' } },
        ];
        reads.executions.mockResolvedValue({ executions: reversed ? headers.reverse() : headers, invalidRecords: 0 });
        reads.resolve.mockImplementation(async (_user: string, _source: unknown, hash: string) =>
            ok(hash === 'reduced' ? { ...definition, blocks: [] } : definition));
        await capture();
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')?.active).toBe(true);
    });
    it('does not mint a new revision for diary edits', async () => {
        const execution = { occurrenceId: manual.occurrenceId, prescriptionHash: 'hash', updatedAt: '2026-10-28T08:00:00.000Z' };
        reads.occurrences.mockResolvedValue(ok([manual]));
        reads.executions.mockResolvedValue({ executions: [{ execution, entries: [] }], invalidRecords: 0 });
        await capture();
        const first = saved.find(f => f.id === 'injury_constraint_touches_session')!;
        saved = [];
        reads.executions.mockResolvedValue({ executions: [{
            execution: { ...execution, updatedAt: '2026-10-28T09:30:00.000Z' }, entries: [{ setIndex: 1 }],
        }], invalidRecords: 0 });
        await capture();
        expect(saved.find(f => f.id === 'injury_constraint_touches_session')!.revisionId).toBe(first.revisionId);
    });
    it('never captures a historical date using current settings', async () => {
        await expect(service.captureForDate('alice', '2026-10-27', date)).rejects.toThrow();
        expect(reads.persist).not.toHaveBeenCalled();
    });
    it('marks illness_anomaly invalid when unreadable revisions exist in diagnostics read', async () => {
        reads.healthAnomaly.mockResolvedValue({ revision: null, unreadableCount: 2 });
        await capture();
        const flag = saved.find(f => f.id === 'illness_anomaly');
        expect(flag).toMatchObject({
            active: null,
            state: 'invalid',
        });
        expect(flag?.inputs.some(i => i.value.state === 'invalid')).toBe(true);
    });
    it('re-captures a result that repeats an older revision as a newer revision after a failed capture', async () => {
        const store = new Map<string, PersistedFlagEvaluation>();
        reads.persist.mockImplementation(async (v: PersistedFlagEvaluation) => {
            const existing = store.get(v.revisionId);
            if (existing) return existing; // persistImmutable keeps the first document's evaluatedAt
            store.set(v.revisionId, v); saved.push(v); return v;
        });
        reads.priorFlags.mockImplementation(async () => ok([...store.values()]));
        const anomaly = (at: string) => service.captureForDate('alice', date, date, at)
            .then(() => [...store.values()].filter(f => f.id === 'illness_anomaly')
                .sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt)).at(-1)!);
        const first = await anomaly('2026-10-28T08:00:00.000Z');
        expect(first.state).toBe('missing');
        reads.healthAnomaly.mockRejectedValueOnce(new Error('offline'));
        expect((await anomaly('2026-10-28T09:00:00.000Z')).state).toBe('unavailable');
        const again = await anomaly('2026-10-28T10:00:00.000Z');
        expect(again).toMatchObject({ state: 'missing', evaluatedAt: '2026-10-28T10:00:00.000Z' });
        expect(again.revisionId).not.toBe(first.revisionId);
        expect(again.inputs.find(i => i.name === 'supersedes_revision')).toBeDefined();
        // A repeat of the latest revision stays idempotent and keeps the chain stable.
        const count = store.size;
        expect((await anomaly('2026-10-28T11:00:00.000Z')).revisionId).toBe(again.revisionId);
        expect(store.size).toBe(count);
        for (const flag of store.values()) expect(flag.inputs.length).toBeLessThanOrEqual(16);
    });
    it('keeps first-capture revision ids unchanged when no prior flags exist or the prior read fails', async () => {
        await capture();
        const ids = saved.map(f => f.revisionId);
        saved = [];
        reads.priorFlags.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        await capture();
        expect(saved.map(f => f.revisionId)).toEqual(ids);
        expect(saved.every(f => f.inputs.every(i => i.name !== 'supersedes_revision'))).toBe(true);
    });
});

describe('captureCurrentFlags', () => {
    it('runs overlapping captures for one user one at a time, and other users independently', async () => {
        const order: string[] = [];
        const releases: Array<() => void> = [];
        const spy = vi.spyOn(flagCaptureService, 'captureForDate').mockImplementation(async (userId: string) => {
            order.push('start:' + userId);
            await new Promise<void>(resolve => releases.push(resolve));
            order.push('end:' + userId);
        });
        const first = captureCurrentFlags('alice');
        const second = captureCurrentFlags('alice');
        const other = captureCurrentFlags('bob');
        await vi.waitFor(() => expect(order).toEqual(['start:alice', 'start:bob']));
        releases.shift()!();
        await first;
        await vi.waitFor(() => expect(order).toContain('start:alice'));
        expect(order.filter(e => e === 'start:alice')).toHaveLength(2);
        expect(order.indexOf('end:alice')).toBeLessThan(order.lastIndexOf('start:alice'));
        while (releases.length) releases.shift()!();
        await Promise.all([second, other]);
        spy.mockRestore();
    });
    it('keeps the queue moving after a failed capture', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const spy = vi.spyOn(flagCaptureService, 'captureForDate')
            .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
        await Promise.all([captureCurrentFlags('alice'), captureCurrentFlags('alice')]);
        expect(spy).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledTimes(1);
        spy.mockRestore(); warn.mockRestore();
    });
});
