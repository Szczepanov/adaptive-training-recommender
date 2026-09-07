import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalPlanSessionOccurrence, ManualOccurrenceRef, SessionOccurrence } from '../sessions/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    setDoc: vi.fn(),
    getDoc: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(),
    runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { SessionOccurrenceService, deterministicExternalPlanOccurrenceId } from './sessionOccurrenceService';

const definitionRef: ManualOccurrenceRef = {
    definitionId: 'def-1', revision: 1, contentHash: 'a'.repeat(64),
};

function occurrenceDoc(overrides: Partial<SessionOccurrence>): SessionOccurrence {
    return {
        userId: 'u1', occurrenceId: 'occ-1', date: '2026-08-18',
        authority: 'schedule', definitionRef, state: 'scheduled',
        createdAt: '2026-08-18T00:00:00Z', updatedAt: '2026-08-18T00:00:00Z',
        ...overrides,
    } as SessionOccurrence;
}

describe('SessionOccurrenceService authority methods (M3.3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockReturnValue({ path: 'session_occurrences/x' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.collection.mockReturnValue({ path: 'session_occurrences' });
        firestore.query.mockReturnValue({});
    });

    it('scheduleOccurrence saves a scheduled occurrence with schedule authority', async () => {
        const service = new SessionOccurrenceService();
        const result = await service.scheduleOccurrence('u1', '2026-08-20', definitionRef);

        expect(result.authority).toBe('schedule');
        expect(result.state).toBe('scheduled');
        const [, payload] = firestore.setDoc.mock.calls[0];
        expect(payload.authority).toBe('schedule');
        expect(payload.date).toBe('2026-08-20');
        expect(payload.definitionRef).toEqual(definitionRef);
    });

    it('replaceRecommendationOccurrence saves with replace_recommendation authority', async () => {
        const service = new SessionOccurrenceService();
        const result = await service.replaceRecommendationOccurrence('u1', '2026-08-18', definitionRef);
        expect(result.authority).toBe('replace_recommendation');
        expect(firestore.setDoc.mock.calls[0][1].authority).toBe('replace_recommendation');
    });

    it('addAdditionalSessionOccurrence saves with additional_session authority and an optional placementOrder', async () => {
        const service = new SessionOccurrenceService();
        const result = await service.addAdditionalSessionOccurrence('u1', '2026-08-18', definitionRef, 2);
        expect(result.authority).toBe('additional_session');
        expect(result.placementOrder).toBe(2);
        expect(firestore.setDoc.mock.calls[0][1].placementOrder).toBe(2);
    });

    it('each authority method produces a distinct occurrenceId', async () => {
        const service = new SessionOccurrenceService();
        const a = await service.scheduleOccurrence('u1', '2026-08-20', definitionRef);
        const b = await service.scheduleOccurrence('u1', '2026-08-21', definitionRef);
        expect(a.occurrenceId).not.toBe(b.occurrenceId);
    });

    it('getReplaceOccurrenceForDate returns only an active replace_recommendation occurrence', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => occurrenceDoc({ occurrenceId: 'occ-a', authority: 'schedule' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-b', authority: 'replace_recommendation', state: 'superseded' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-c', authority: 'replace_recommendation', state: 'active' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionOccurrenceService();
        const result = await service.getReplaceOccurrenceForDate('u1', '2026-08-18');
        expect(result?.occurrenceId).toBe('occ-c');
    });

    it('getReplaceOccurrenceForDate returns null when nothing is replacing today', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [{ data: () => occurrenceDoc({ authority: 'schedule' }), ref: { path: 'x' } }],
        });
        const service = new SessionOccurrenceService();
        expect(await service.getReplaceOccurrenceForDate('u1', '2026-08-18')).toBeNull();
    });

    it('fails closed instead of choosing by query order when replacement authority is ambiguous', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => occurrenceDoc({ occurrenceId: 'occ-b', authority: 'replace_recommendation', state: 'scheduled' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-a', authority: 'replace_recommendation', state: 'active' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionOccurrenceService();
        await expect(service.getReplaceOccurrenceForDate('u1', '2026-08-18')).rejects.toThrow('authority is ambiguous');
    });

    it('getAdditionalOccurrencesForDate returns only active additional_session occurrences', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => occurrenceDoc({ occurrenceId: 'occ-a', authority: 'additional_session', state: 'scheduled' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-b', authority: 'additional_session', state: 'completed' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-c', authority: 'replace_recommendation', state: 'active' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionOccurrenceService();
        const result = await service.getAdditionalOccurrencesForDate('u1', '2026-08-18');
        expect(result.map(item => item.occurrenceId)).toEqual(['occ-a']);
    });

    it('orders additional occurrences by placementOrder and occurrenceId', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => occurrenceDoc({ occurrenceId: 'occ-z', authority: 'additional_session', placementOrder: 1 }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-b', authority: 'additional_session', placementOrder: 0 }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-a', authority: 'additional_session', placementOrder: 0 }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionOccurrenceService();
        const result = await service.getAdditionalOccurrencesForDate('u1', '2026-08-18');
        expect(result.map(item => item.occurrenceId)).toEqual(['occ-a', 'occ-b', 'occ-z']);
    });

    describe('claimOccurrenceLaunch (ADR-0036 D-REASSESS)', () => {
        it('successfully claims a scheduled occurrence and transitions state to active', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.claimOccurrenceLaunch('u1', 'occ-1', '2026-08-18T10:00:00Z');

            expect(result.state).toBe('active');
            expect(result.updatedAt).toBe('2026-08-18T10:00:00Z');
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.objectContaining({ path: 'session_occurrences/x' }),
                expect.objectContaining({ state: 'active', updatedAt: '2026-08-18T10:00:00Z' }),
            );
        });

        it('throws when occurrence does not exist', async () => {
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => false,
                    data: () => null,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            await expect(service.claimOccurrenceLaunch('u1', 'occ-missing')).rejects.toThrow(
                'Occurrence occ-missing not found.',
            );
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('throws when occurrence state is not scheduled', async () => {
            const active = occurrenceDoc({ occurrenceId: 'occ-1', state: 'active' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => active,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            await expect(service.claimOccurrenceLaunch('u1', 'occ-1')).rejects.toThrow(
                "Occurrence occ-1 cannot be claimed; state is 'active', expected 'scheduled'.",
            );
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('throws when occurrence document cannot be parsed', async () => {
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => ({ invalid: 'document' }),
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            await expect(service.claimOccurrenceLaunch('u1', 'occ-1')).rejects.toThrow(
                'Occurrence occ-1 could not be parsed',
            );
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('executes onBeforeClaim hook atomically before claiming occurrence', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const onBeforeClaim = vi.fn().mockResolvedValue(undefined);
            const service = new SessionOccurrenceService();
            const result = await service.claimOccurrenceLaunch('u1', 'occ-1', {
                now: '2026-08-18T10:00:00Z',
                onBeforeClaim,
            });

            expect(onBeforeClaim).toHaveBeenCalledWith(mockTx, expect.objectContaining({ occurrenceId: 'occ-1', state: 'scheduled' }));
            expect(result.state).toBe('active');
            expect(mockTx.set).toHaveBeenCalledTimes(1);
        });

        it('aborts transaction and does not set occurrence when onBeforeClaim fails', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const onBeforeClaim = vi.fn().mockRejectedValue(new Error('Revision mismatch'));
            const service = new SessionOccurrenceService();
            await expect(
                service.claimOccurrenceLaunch('u1', 'occ-1', { onBeforeClaim }),
            ).rejects.toThrow('Revision mismatch');

            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('prevents onBeforeClaim from mutating the committed occurrence', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled', date: '2026-08-18' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const onBeforeClaim = vi.fn().mockImplementation((_tx, occ: unknown) => {
                // Attempt to mutate the passed occurrence
                const mutable = occ as { date: string; definitionRef: { definitionId: string } };
                mutable.date = '2099-01-01';
                mutable.definitionRef.definitionId = 'hijacked-def';
            });
            const service = new SessionOccurrenceService();
            const result = await service.claimOccurrenceLaunch('u1', 'occ-1', {
                now: '2026-08-18T10:00:00Z',
                onBeforeClaim,
            });

            expect(result.date).toBe('2026-08-18');
            expect(result.definitionRef?.definitionId).toBe('def-1');
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    date: '2026-08-18',
                    definitionRef: expect.objectContaining({ definitionId: 'def-1' }),
                    state: 'active',
                }),
            );
        });

        it('successfully claims an external-plan occurrence and defensively copies externalPlanRef', async () => {
            const extPlanRef = { planId: 'p-1', revision: 1, sessionId: 's-1', contentHash: 'c'.repeat(64) };
            const extScheduled = {
                userId: 'u1',
                occurrenceId: 'occ-ext-1',
                date: '2026-08-18',
                authority: 'external_plan' as const,
                externalPlanRef: extPlanRef,
                state: 'scheduled' as const,
                createdAt: '2026-08-18T00:00:00Z',
                updatedAt: '2026-08-18T00:00:00Z',
            };
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => extScheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const onBeforeClaim = vi.fn().mockImplementation((_tx, occ: unknown) => {
                const o = occ as { externalPlanRef?: { planId: string } };
                if (o.externalPlanRef) o.externalPlanRef.planId = 'tampered';
            });

            const service = new SessionOccurrenceService();
            const result = await service.claimOccurrenceLaunch('u1', 'occ-ext-1', {
                now: '2026-08-18T10:00:00Z',
                onBeforeClaim,
            });

            expect(result.state).toBe('active');
            expect((result as ExternalPlanSessionOccurrence).externalPlanRef.planId).toBe('p-1');
            expect('definitionRef' in result).toBe(false);
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    state: 'active',
                    externalPlanRef: expect.objectContaining({ planId: 'p-1' }),
                }),
            );
        });
    });

    describe('External-plan occurrence management (Issue #434 PR 2)', () => {
        const extPlanRef = { planId: 'p-1', revision: 1, sessionId: 's-1', contentHash: 'c'.repeat(64) };

        it('scheduleExternalPlanOccurrence persists with external_plan authority and scheduled state', async () => {
            const service = new SessionOccurrenceService();
            const result = await service.scheduleExternalPlanOccurrence('u1', '2026-08-18', extPlanRef, 1);

            expect(result.authority).toBe('external_plan');
            expect(result.state).toBe('scheduled');
            expect(result.externalPlanRef).toEqual(extPlanRef);
            expect(result.placementOrder).toBe(1);
            expect(firestore.setDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    authority: 'external_plan',
                    state: 'scheduled',
                    externalPlanRef: extPlanRef,
                }),
            );
        });

        it('getOrCreateExternalPlanOccurrence returns existing occurrence transactionally if document exists at deterministic ID', async () => {
            firestore.getDocs.mockResolvedValue({ docs: [] });
            const existing = {
                userId: 'u1',
                occurrenceId: 'ext_2026-08-18_0123456789abcdef01234567',
                date: '2026-08-18',
                authority: 'external_plan' as const,
                externalPlanRef: extPlanRef,
                state: 'scheduled' as const,
                createdAt: '2026-08-18T00:00:00Z',
                updatedAt: '2026-08-18T00:00:00Z',
            };
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => existing,
                    ref: { path: 'users/u1/session_occurrences/ext_2026-08-18_0123456789abcdef01234567' },
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.getOrCreateExternalPlanOccurrence('u1', '2026-08-18', extPlanRef);

            expect(result.occurrenceId).toBe('ext_2026-08-18_0123456789abcdef01234567');
            expect(result.state).toBe('scheduled');
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('getOrCreateExternalPlanOccurrence transactionally creates a new occurrence with deterministic ID if none exists', async () => {
            firestore.getDocs.mockResolvedValue({ docs: [] });
            const mockTx = {
                get: vi.fn().mockResolvedValue({ exists: () => false }),
                set: vi.fn(),
                delete: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.getOrCreateExternalPlanOccurrence('u1', '2026-08-18', extPlanRef);

            expect(result.authority).toBe('external_plan');
            expect(result.state).toBe('scheduled');
            expect(result.occurrenceId).toMatch(/^ext_2026-08-18_[a-f0-9]{24}$/);
            expect(mockTx.set).toHaveBeenCalledTimes(1);
        });

        describe('D-WINDOW exclusivity and re-import supersession (H4 #434 PR 3, plan steps 4a/4b)', () => {
            const windowBinding = {
                windowId: 'window-1', bundleId: 'bundle-1', order: 0,
                boundStartLocal: '07:00', boundEndLocal: '08:00',
                startInstant: '2026-08-18T05:00:00Z', endInstant: '2026-08-18T06:00:00Z',
            };

            it('claims the window reservation alongside a fresh occurrence create', async () => {
                firestore.getDocs.mockResolvedValue({ docs: [] });
                const mockTx = {
                    // Call order: occurrence ref, then the window reservation ref (no
                    // prior-revision candidate found, so no priorRef get in between).
                    get: vi.fn()
                        .mockResolvedValueOnce({ exists: () => false })
                        .mockResolvedValueOnce({ exists: () => false }),
                    set: vi.fn(),
                    delete: vi.fn(),
                };
                firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

                const service = new SessionOccurrenceService();
                const result = await service.getOrCreateExternalPlanOccurrence('u1', '2026-08-18', extPlanRef, { windowBinding });

                expect((result as ExternalPlanSessionOccurrence).windowBinding).toEqual(windowBinding);
                expect(mockTx.set).toHaveBeenCalledTimes(2);
                expect(mockTx.set).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.objectContaining({ windowId: 'window-1', occurrenceId: expect.stringMatching(/^ext_/) }),
                );
            });

            it('rejects the create when the window is already reserved by an unrelated occurrence', async () => {
                firestore.getDocs.mockResolvedValue({ docs: [] });
                const mockTx = {
                    get: vi.fn()
                        .mockResolvedValueOnce({ exists: () => false }) // occurrence: absent
                        .mockResolvedValueOnce({ exists: () => true, data: () => ({ occurrenceId: 'occ-someone-else' }) }), // reservation: taken
                    set: vi.fn(),
                    delete: vi.fn(),
                };
                firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

                const service = new SessionOccurrenceService();
                await expect(
                    service.getOrCreateExternalPlanOccurrence('u1', '2026-08-18', extPlanRef, { windowBinding }),
                ).rejects.toThrow("Window 'window-1' on 2026-08-18 is already bound to occurrence 'occ-someone-else'.");
                expect(mockTx.set).not.toHaveBeenCalled();
            });

            it('supersedes a scheduled prior-revision occurrence for the same (planId, sessionId) in the same transaction', async () => {
                const priorOccurrence = {
                    userId: 'u1', occurrenceId: 'ext_2026-08-18_prior000000000000000000',
                    date: '2026-08-18', authority: 'external_plan' as const,
                    externalPlanRef: { ...extPlanRef, revision: 1 },
                    state: 'scheduled' as const,
                    createdAt: '2026-08-18T00:00:00Z', updatedAt: '2026-08-18T00:00:00Z',
                };
                firestore.getDocs.mockResolvedValue({ docs: [{ data: () => priorOccurrence, ref: { path: 'x' } }] });
                const revisedRef = { ...extPlanRef, revision: 2 };
                const mockTx = {
                    // Call order: new-occurrence ref (absent), prior-occurrence ref (found,
                    // still scheduled), no windowBinding so no reservation get.
                    get: vi.fn()
                        .mockResolvedValueOnce({ exists: () => false })
                        .mockResolvedValueOnce({ exists: () => true, data: () => priorOccurrence }),
                    set: vi.fn(),
                    delete: vi.fn(),
                };
                firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

                const service = new SessionOccurrenceService();
                const result = await service.getOrCreateExternalPlanOccurrence('u1', '2026-08-18', revisedRef);

                expect(result.occurrenceId).not.toBe(priorOccurrence.occurrenceId);
                expect(mockTx.set).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.objectContaining({ occurrenceId: priorOccurrence.occurrenceId, state: 'superseded' }),
                );
                expect(mockTx.set).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.objectContaining({ externalPlanRef: revisedRef, state: 'scheduled' }),
                );
            });

            it('never supersedes a prior occurrence that already started or completed', async () => {
                const activePrior = {
                    userId: 'u1', occurrenceId: 'ext_2026-08-18_prior000000000000000000',
                    date: '2026-08-18', authority: 'external_plan' as const,
                    externalPlanRef: { ...extPlanRef, revision: 1 },
                    state: 'active' as const,
                    createdAt: '2026-08-18T00:00:00Z', updatedAt: '2026-08-18T00:00:00Z',
                };
                // The pre-transaction query only ever considers 'scheduled' candidates
                // (see the `occ.state === 'scheduled'` filter), so an active/completed
                // predecessor is never even proposed as priorRef -- there is nothing to
                // read a second time inside the transaction.
                firestore.getDocs.mockResolvedValue({ docs: [{ data: () => activePrior, ref: { path: 'x' } }] });
                const mockTx = {
                    get: vi.fn().mockResolvedValueOnce({ exists: () => false }),
                    set: vi.fn(),
                    delete: vi.fn(),
                };
                firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

                const service = new SessionOccurrenceService();
                await service.getOrCreateExternalPlanOccurrence('u1', '2026-08-18', { ...extPlanRef, revision: 2 });

                expect(mockTx.get).toHaveBeenCalledTimes(1);
                expect(mockTx.set).not.toHaveBeenCalledWith(
                    expect.anything(),
                    expect.objectContaining({ state: 'superseded' }),
                );
            });

            it('releases the prior occurrence\'s window reservation when the successor binds a different window', async () => {
                const priorOccurrence = {
                    userId: 'u1', occurrenceId: 'ext_2026-08-18_prior000000000000000000',
                    date: '2026-08-18', authority: 'external_plan' as const,
                    externalPlanRef: { ...extPlanRef, revision: 1 },
                    state: 'scheduled' as const,
                    windowBinding: { ...windowBinding, windowId: 'window-old' },
                    createdAt: '2026-08-18T00:00:00Z', updatedAt: '2026-08-18T00:00:00Z',
                };
                firestore.getDocs.mockResolvedValue({ docs: [{ data: () => priorOccurrence, ref: { path: 'x' } }] });
                const mockTx = {
                    // occurrence (absent), prior (found), new window reservation (absent).
                    get: vi.fn()
                        .mockResolvedValueOnce({ exists: () => false })
                        .mockResolvedValueOnce({ exists: () => true, data: () => priorOccurrence })
                        .mockResolvedValueOnce({ exists: () => false }),
                    set: vi.fn(),
                    delete: vi.fn(),
                };
                firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

                const service = new SessionOccurrenceService();
                await service.getOrCreateExternalPlanOccurrence(
                    'u1', '2026-08-18', { ...extPlanRef, revision: 2 }, { windowBinding },
                );

                expect(mockTx.delete).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe('deterministicExternalPlanOccurrenceId', () => {
        it('produces collision-resistant deterministic hex ID without string collapsing', async () => {
            const id1 = await deterministicExternalPlanOccurrenceId('2026-08-18', {
                planId: 'plan a',
                sessionId: 'session b',
                revision: 1,
                contentHash: 'a'.repeat(64),
            });
            const id2 = await deterministicExternalPlanOccurrenceId('2026-08-18', {
                planId: 'plan_a',
                sessionId: 'session_b',
                revision: 1,
                contentHash: 'a'.repeat(64),
            });
            const id3 = await deterministicExternalPlanOccurrenceId('2026-08-18', {
                planId: 'plan a',
                sessionId: 'session b',
                revision: 1,
                contentHash: 'a'.repeat(64),
            });

            expect(id1).toBe(id3);
            expect(id1).not.toBe(id2);
            expect(id1).toMatch(/^ext_2026-08-18_[a-f0-9]{24}$/);
        });

        it('produces distinct IDs for colon-containing identifiers that would otherwise collide', async () => {
            const idA = await deterministicExternalPlanOccurrenceId('2026-08-18', {
                planId: 'plan:part1',
                sessionId: 'part2',
                revision: 1,
                contentHash: 'a'.repeat(64),
            });
            const idB = await deterministicExternalPlanOccurrenceId('2026-08-18', {
                planId: 'plan',
                sessionId: 'part1:part2',
                revision: 1,
                contentHash: 'a'.repeat(64),
            });

            expect(idA).not.toBe(idB);
        });
    });

    describe('transitionOccurrenceState (lifecycle)', () => {
        it('transitions active occurrence to completed', async () => {
            const active = occurrenceDoc({ occurrenceId: 'occ-1', state: 'active' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => active,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.transitionOccurrenceState('u1', 'occ-1', 'completed', '2026-08-18T11:00:00Z');

            expect(result.state).toBe('completed');
            expect(result.updatedAt).toBe('2026-08-18T11:00:00Z');
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ state: 'completed', updatedAt: '2026-08-18T11:00:00Z' }),
            );
        });

        it('transitions scheduled occurrence to completed (production state before PR 3 claims)', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.transitionOccurrenceState('u1', 'occ-1', 'completed', '2026-08-18T11:00:00Z');

            expect(result.state).toBe('completed');
            expect(result.updatedAt).toBe('2026-08-18T11:00:00Z');
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ state: 'completed', updatedAt: '2026-08-18T11:00:00Z' }),
            );
        });

        it('transitions scheduled occurrence to abandoned', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.transitionOccurrenceState('u1', 'occ-1', 'abandoned', '2026-08-18T11:00:00Z');

            expect(result.state).toBe('abandoned');
            expect(result.updatedAt).toBe('2026-08-18T11:00:00Z');
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ state: 'abandoned', updatedAt: '2026-08-18T11:00:00Z' }),
            );
        });

        it('transitions scheduled occurrence to skipped', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.transitionOccurrenceState('u1', 'occ-1', 'skipped');

            expect(result.state).toBe('skipped');
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ state: 'skipped' }),
            );
        });

        it('no-ops when occurrence is already in the target state', async () => {
            const active = occurrenceDoc({ occurrenceId: 'occ-1', state: 'active' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => active,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.transitionOccurrenceState('u1', 'occ-1', 'active');

            expect(result.state).toBe('active');
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('throws when attempting an illegal transition (e.g. active to scheduled, completed to active)', async () => {
            const active = occurrenceDoc({ occurrenceId: 'occ-2', state: 'active' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({ exists: () => true, data: () => active }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            await expect(
                service.transitionOccurrenceState('u1', 'occ-2', 'scheduled'),
            ).rejects.toThrow("Cannot transition occurrence occ-2 from 'active' to 'scheduled'.");
        });

        it('throws when transitioning from a terminal state', async () => {
            const completed = occurrenceDoc({ occurrenceId: 'occ-1', state: 'completed' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => completed,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            await expect(
                service.transitionOccurrenceState('u1', 'occ-1', 'active'),
            ).rejects.toThrow("Cannot transition occurrence occ-1 from 'completed' to 'active'.");

            expect(mockTx.set).not.toHaveBeenCalled();
        });
    });
});
