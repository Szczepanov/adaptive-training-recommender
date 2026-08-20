import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import type { SessionResponse } from '../responses/models';
import type { DailySubjectiveCheckin } from '../engine/models';

const resolverMocks = vi.hoisted(() => ({
    resolveSessionDefinition: vi.fn(),
}));
vi.mock('../sessions/sessionDefinitionResolver', () => ({
    resolveSessionDefinition: resolverMocks.resolveSessionDefinition,
}));

import { SessionOutcomeReportService } from './sessionOutcomeReportService';
import type { SessionExecutionService } from './sessionExecutionService';
import type { SessionResponseService } from './sessionResponseService';
import type { CheckinService } from './checkinService';

function execution(overrides: Partial<NormalizedExecutionRecord['execution']> = {}): NormalizedExecutionRecord['execution'] {
    return {
        userId: 'u1',
        executionId: 'exec-1',
        sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fixture-1' },
        date: '2026-08-18',
        startedAt: '2026-08-18T10:00:00Z',
        completedAt: '2026-08-18T11:00:00Z',
        updatedAt: '2026-08-18T11:00:00Z',
        state: 'completed',
        schemaVersion: 1,
        ...overrides,
    };
}

function fakeExecutionService(records: NormalizedExecutionRecord[]) {
    return {
        getExecutionsInRange: vi.fn().mockResolvedValue({ executions: records, invalidRecords: 0 }),
    } as unknown as SessionExecutionService;
}

function fakeResponseService(bySourceId: Record<string, SessionResponse[]>) {
    return {
        getResponsesForSource: vi.fn(async (_userId: string, source: { id: string }) => bySourceId[source.id] ?? []),
    } as unknown as SessionResponseService;
}

function fakeCheckinService(checkins: DailySubjectiveCheckin[]) {
    return {
        getCheckinsInRange: vi.fn().mockResolvedValue(checkins),
    } as unknown as CheckinService;
}

function response(overrides: Partial<SessionResponse> = {}): SessionResponse {
    return {
        userId: 'u1',
        responseId: 'resp-1',
        sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
        window: 'later_day',
        date: '2026-08-18',
        checkinRef: { date: '2026-08-19' },
        createdAt: '2026-08-19T07:00:00Z',
        updatedAt: '2026-08-19T07:00:00Z',
        ...overrides,
    };
}

describe('SessionOutcomeReportService', () => {
    beforeEach(() => {
        resolverMocks.resolveSessionDefinition.mockReset();
    });

    it('excludes in-progress executions from the report', async () => {
        const service = new SessionOutcomeReportService(
            fakeExecutionService([{ execution: execution({ state: 'in_progress', completedAt: undefined }), entries: [] }]),
            fakeResponseService({}),
            fakeCheckinService([]),
        );
        const outcomes = await service.buildReport('u1', '2026-08-01', '2026-09-01');
        expect(outcomes).toEqual([]);
    });

    it('produces an unknown outcome for a completed execution with no responses or tissue data', async () => {
        resolverMocks.resolveSessionDefinition.mockResolvedValue({ status: 'MISSING' });
        const service = new SessionOutcomeReportService(
            fakeExecutionService([{ execution: execution(), entries: [] }]),
            fakeResponseService({}),
            fakeCheckinService([]),
        );
        const [outcome] = await service.buildReport('u1', '2026-08-01', '2026-09-01');
        expect(outcome.status).toBe('unknown');
        expect(outcome.sourceSession).toEqual({ kind: 'execution', id: 'exec-1', date: '2026-08-18' });
    });

    it('attributes only the tissue regions whose sourceSessionRef matches this execution', async () => {
        resolverMocks.resolveSessionDefinition.mockResolvedValue({ status: 'MISSING' });
        const service = new SessionOutcomeReportService(
            fakeExecutionService([{ execution: execution(), entries: [] }]),
            fakeResponseService({ 'exec-1': [response()] }),
            fakeCheckinService([{
                userId: 'u1',
                date: '2026-08-19',
                tissueResponses: {
                    knee: { region: 'knee', morningState: 'moderate', sourceSessionRef: { kind: 'execution', id: 'exec-1', date: '2026-08-18' } },
                    hip: { region: 'hip', morningState: 'severe', sourceSessionRef: { kind: 'execution', id: 'exec-other', date: '2026-08-17' } },
                },
            } as unknown as DailySubjectiveCheckin]),
        );
        const [outcome] = await service.buildReport('u1', '2026-08-01', '2026-09-01');
        expect(outcome.sourceFacts.tissueRegions).toEqual(['knee']);
        expect(outcome.status).toBe('reactive');
    });

    it('discovers a tissue reaction linked directly to the execution even with no SessionResponse ever recorded', async () => {
        // Regression: a manually-flagged check-in tissue response sets sourceSessionRef
        // without necessarily going through sessionResponseService.recordResponse (the legacy
        // M1.7-era manual flag path M5.2 left unchanged). Discovery must not depend on a
        // SessionResponse existing.
        resolverMocks.resolveSessionDefinition.mockResolvedValue({ status: 'MISSING' });
        const service = new SessionOutcomeReportService(
            fakeExecutionService([{ execution: execution(), entries: [] }]),
            fakeResponseService({}),
            fakeCheckinService([{
                userId: 'u1',
                date: '2026-08-19',
                tissueResponses: {
                    knee: { region: 'knee', morningState: 'severe', sourceSessionRef: { kind: 'execution', id: 'exec-1', date: '2026-08-18' } },
                },
            } as unknown as DailySubjectiveCheckin]),
        );
        const [outcome] = await service.buildReport('u1', '2026-08-01', '2026-09-01');
        expect(outcome.sourceFacts.tissueRegions).toEqual(['knee']);
        expect(outcome.status).toBe('reactive');
    });

    it('queries check-ins across the report range extended by the tissue lookahead buffer', async () => {
        resolverMocks.resolveSessionDefinition.mockResolvedValue({ status: 'MISSING' });
        const checkins = fakeCheckinService([]);
        const service = new SessionOutcomeReportService(
            fakeExecutionService([{ execution: execution(), entries: [] }]),
            fakeResponseService({}),
            checkins,
        );
        await service.buildReport('u1', '2026-08-01', '2026-09-01');
        expect(checkins.getCheckinsInRange).toHaveBeenCalledWith('u1', '2026-08-01', '2026-09-08');
    });

    it('resolves a planned/performed comparison only for a completed execution whose prescription still resolves', async () => {
        resolverMocks.resolveSessionDefinition.mockResolvedValue({
            status: 'AVAILABLE',
            data: {
                schemaVersion: 1, id: 'def-1', revision: 1, title: 'Lower', intent: 'strength',
                blocks: [{ id: 'b1', title: 'Block', executionMode: 'sequential', steps: [] }],
            },
        });
        const service = new SessionOutcomeReportService(
            fakeExecutionService([{ execution: execution(), entries: [] }]),
            fakeResponseService({ 'exec-1': [response()] }),
            fakeCheckinService([]),
        );
        const [outcome] = await service.buildReport('u1', '2026-08-01', '2026-09-01');
        expect(outcome.override.totalPlannedSteps).toBe(0);
        expect(resolverMocks.resolveSessionDefinition).toHaveBeenCalledWith('u1', execution().sessionSource, undefined);
    });

    it('never calls the resolver for an abandoned execution', async () => {
        const service = new SessionOutcomeReportService(
            fakeExecutionService([{ execution: execution({ state: 'abandoned' }), entries: [] }]),
            fakeResponseService({}),
            fakeCheckinService([]),
        );
        await service.buildReport('u1', '2026-08-01', '2026-09-01');
        expect(resolverMocks.resolveSessionDefinition).not.toHaveBeenCalled();
    });

    it('sorts the report chronologically by execution date then id', async () => {
        resolverMocks.resolveSessionDefinition.mockResolvedValue({ status: 'MISSING' });
        const service = new SessionOutcomeReportService(
            fakeExecutionService([
                { execution: execution({ executionId: 'exec-b', date: '2026-08-19' }), entries: [] },
                { execution: execution({ executionId: 'exec-a', date: '2026-08-18' }), entries: [] },
            ]),
            fakeResponseService({}),
            fakeCheckinService([]),
        );
        const outcomes = await service.buildReport('u1', '2026-08-01', '2026-09-01');
        expect(outcomes.map(outcome => outcome.sourceSession.id)).toEqual(['exec-a', 'exec-b']);
    });
});
