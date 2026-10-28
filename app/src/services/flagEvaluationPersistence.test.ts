import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlagEvaluation } from '../derived/flags/flagEvaluation';

const db = vi.hoisted(() => ({
    docs: new Map<string, unknown>(), writes: 0,
    page: vi.fn(),
}));
vi.mock('../firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
    collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
    doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
    where: (...args: unknown[]) => args, orderBy: (...args: unknown[]) => args,
    documentId: () => '__name__', limit: (n: number) => n, startAfter: (v: unknown) => v,
    query: (...args: unknown[]) => args, getDocs: (...args: unknown[]) => db.page(...args),
    runTransaction: async (_db: unknown, fn: (tx: unknown) => unknown) => fn({
        get: async (path: string) => ({ exists: () => db.docs.has(path), data: () => db.docs.get(path) }),
        set: (path: string, value: unknown) => { db.docs.set(path, value); db.writes++; },
    }),
}));

import { buildFlagEvaluationRevision, flagEvaluationRepository, parsePersistedFlagEvaluation } from './flagEvaluationPersistence';
const evaluation: FlagEvaluation = {
    id: 'illness_risk_symptom', active: false, state: 'measured', reasonCode: 'no_illness_symptoms',
    definitionVersion: 'illness_risk_symptom-v1', threshold: 'Recorded illness symptoms',
    inputs: [{ name: 'illness_symptoms', value: { value: false, source: 'daily_subjective_checkin', state: 'measured' } }],
};
const revision = (evaluatedAt = '2026-10-28T08:00:00.000Z', flag = evaluation) => buildFlagEvaluationRevision({
    userId: 'alice', observedOn: '2026-10-28', evaluatedAt, evaluation: flag,
});

describe('immutable flag evaluations', () => {
    beforeEach(() => { db.docs.clear(); db.writes = 0; db.page.mockReset(); });
    it('deduplicates identical observations without moving the original evaluation time', async () => {
        const first = await revision();
        const retry = await revision('2026-10-28T09:00:00.000Z');
        expect(retry.revisionId).toBe(first.revisionId);
        await flagEvaluationRepository.persistImmutable(first);
        expect(await flagEvaluationRepository.persistImmutable(retry)).toEqual(first);
        expect(db.writes).toBe(1);
    });
    it('creates distinct identities for changed input, evaluator and session scope', async () => {
        const first = await revision();
        const changed = await revision(undefined, { ...evaluation, active: true });
        const version = await revision(undefined, { ...evaluation, definitionVersion: 'v2' });
        const scoped = await buildFlagEvaluationRevision({ userId: 'alice', observedOn: '2026-10-28',
            evaluatedAt: first.evaluatedAt, evaluation: { ...evaluation, id: 'injury_constraint_touches_session' }, sessionRef: 'occurrence:one' });
        expect(new Set([first, changed, version, scoped].map(r => r.revisionId)).size).toBe(4);
    });
    it('rejects bad dates, owner mismatch, identity mismatch and non-finite nested evidence', async () => {
        const first = await revision();
        expect(() => parsePersistedFlagEvaluation({ ...first, observedOn: '2026-02-30' }, 'alice')).toThrow();
        expect(() => parsePersistedFlagEvaluation(first, 'bob')).toThrow();
        expect(() => parsePersistedFlagEvaluation(first, 'alice', 'different')).toThrow();
        expect(() => parsePersistedFlagEvaluation({ ...first, inputs: [{ name: 'x', value: { value: NaN, source: 'x', state: 'measured' } }] }, 'alice')).toThrow();
        expect(() => parsePersistedFlagEvaluation({ ...first, active: true, state: 'missing' }, 'alice')).toThrow();
    });
    it('returns a readable empty collection distinctly from query failure', async () => {
        db.page.mockResolvedValueOnce({ docs: [] });
        expect(await flagEvaluationRepository.getInRangeState('alice', '2026-10-01', '2026-10-28')).toMatchObject({ status: 'AVAILABLE', data: [] });
        db.page.mockRejectedValueOnce(new Error('read failed'));
        expect(await flagEvaluationRepository.getInRangeState('alice', '2026-10-01', '2026-10-28')).toMatchObject({ status: 'UNAVAILABLE' });
    });
    it('discards corrupt history rather than returning partial successes', async () => {
        const good = await revision();
        db.page.mockResolvedValueOnce({ docs: [{ id: good.revisionId, data: () => good }, { id: 'bad', data: () => ({ userId: 'alice' }) }] });
        expect(await flagEvaluationRepository.getInRangeState('alice', '2026-10-01', '2026-10-28')).toMatchObject({ status: 'INVALID' });
    });
    it('bounds scans at 2000 plus a sentinel and discards truncated results', async () => {
        const good = await revision();
        const row = { id: good.revisionId, data: () => good };
        db.page.mockResolvedValue({ docs: Array.from({ length: 200 }, () => row) });
        expect(await flagEvaluationRepository.getInRangeState('alice', '2026-10-01', '2026-10-28'))
            .toMatchObject({ status: 'UNAVAILABLE', operation: 'scan_limit_exceeded' });
        expect(db.page).toHaveBeenCalledTimes(11);
    });
});
