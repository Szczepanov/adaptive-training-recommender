import { describe, expect, it, vi } from 'vitest';
import type { AssessmentAttempt } from '../observations/models';
import {
    STANDING_BROAD_JUMP_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL_V2,
} from '../observations/physicalCapitalProtocols';
import { AssessmentExportService } from './assessmentExportService';
import type { AssessmentAttemptService } from './assessmentAttemptService';
import type { AssessmentTrialService } from './assessmentTrialService';
import type { MetricObservationService } from './metricObservationService';

describe('AssessmentExportService', () => {
    it('joins attempts only to their exact immutable protocol revision', async () => {
        const rev1Attempt: AssessmentAttempt = {
            id: 'jump-r1',
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
            scheduledDate: '2026-10-01',
            state: 'completed',
            purpose: 'baseline',
            completedAt: '2026-10-01T10:00:00.000Z',
        };
        const rev2Attempt: AssessmentAttempt = {
            id: 'jump-r2',
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL_V2.id, revision: 2 },
            scheduledDate: '2026-10-25',
            state: 'completed',
            purpose: 'checkpoint',
            completedAt: '2026-10-25T10:00:00.000Z',
        };

        const attemptService = {
            listAttemptsForProtocol: vi.fn(async (_userId: string, protocolId: string) =>
                protocolId === STANDING_BROAD_JUMP_PROTOCOL.id ? [rev1Attempt, rev2Attempt] : []),
        } as unknown as AssessmentAttemptService;

        const trialService = {
            listTrialsForAttempt: vi.fn().mockResolvedValue([]),
        } as unknown as AssessmentTrialService;

        const observationService = {
            getHead: vi.fn().mockResolvedValue(null),
            listRevisionsForObservation: vi.fn().mockResolvedValue([]),
        } as unknown as MetricObservationService;

        const service = new AssessmentExportService(attemptService, trialService, observationService);
        const exported = await service.loadDiagnosticExport('user-1');

        expect(exported.attempts.map(attempt => attempt.id).sort()).toEqual(['jump-r1', 'jump-r2']);
        expect(exported.protocols).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 }),
            expect.objectContaining({ id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 }),
        ]));

        const trialCalls = vi.mocked(trialService.listTrialsForAttempt).mock.calls
            .filter(([, protocol]) => protocol.id === STANDING_BROAD_JUMP_PROTOCOL.id)
            .map(([, protocol, attemptId]) => [protocol.revision, attemptId]);
        expect(trialCalls).toEqual([[1, 'jump-r1'], [2, 'jump-r2']]);
    });
});
