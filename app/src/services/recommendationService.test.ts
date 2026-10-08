import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecommendation, Recommendation, RecommendationAudit } from '../engine/models';
import { TEMPLATES } from '../engine/templates';
import { POLICY_VERSION } from '../engine/policy';

const firestore = vi.hoisted(() => {
    const deleteMarker = Symbol('delete-field');
    const batch = { set: vi.fn(), commit: vi.fn() };
    return {
        collection: vi.fn(),
        deleteField: vi.fn(() => deleteMarker),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        limit: vi.fn(),
        orderBy: vi.fn(),
        query: vi.fn(),
        runTransaction: vi.fn(),
        setDoc: vi.fn(),
        where: vi.fn(),
        writeBatch: vi.fn(() => batch),
        batch,
        deleteMarker,
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { RecommendationService } from './recommendationService';

function sortKeysDeep<T>(value: T): T {
    if (Array.isArray(value)) return value.map(sortKeysDeep) as unknown as T;
    if (value && typeof value === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        }
        return sorted as T;
    }
    return value;
}

describe('RecommendationService persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockReturnValue({ path: 'recommendation' });
        firestore.batch.commit.mockResolvedValue(undefined);
        firestore.setDoc.mockResolvedValue(undefined);
    });

    it('deletes a removed prescription in the same revision/archive batch', async () => {
        const template = TEMPLATES[0];
        const existing = {
            userId: 'athlete', date: '2026-08-07', templateId: template.id, templateTitle: template.title,
            category: template.category, modality: template.modality, mode: 'train', rationale: 'Keep it easy.',
            schemaVersion: 2, revision: 1, createdAt: '2026-08-07T08:00:00.000Z', updatedAt: '2026-08-07T08:00:00.000Z',
            prescription: { workoutId: 'cycling_technical_01', displayBlocks: [] },
            adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        } as unknown as DailyRecommendation;
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => existing });
        const recommendation: Recommendation = { template, mode: 'train', rationale: 'Keep it easy.' };

        await new RecommendationService().saveRecommendation('athlete', '2026-08-07', recommendation);

        expect(firestore.batch.set).toHaveBeenCalledTimes(2);
        const updatedDocument = firestore.batch.set.mock.calls[1][1] as Record<string, unknown>;
        expect(updatedDocument.prescription).toBe(firestore.deleteMarker);
        expect(firestore.batch.commit).toHaveBeenCalledOnce();
    });

    it('persists recommendation with mergeFields listing all write keys for wholesale map replacement (D3)', async () => {
        const template = TEMPLATES[0];
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        const audit: RecommendationAudit = {
            policyVersion: POLICY_VERSION, evaluatedAt: '2026-09-28T08:30:00.000Z',
            decisionContextRevision: 'history-r1', safetyStatus: 'complete',
            history: { completedEventCount: 0, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            candidateScores: [],
            droppedContributorObjectives: [],
        };
        const recommendation: Recommendation = { template, mode: 'train', rationale: 'Keep it easy.', recommendationAudit: audit };

        await new RecommendationService().saveRecommendation('athlete', '2026-08-07', recommendation);

        expect(firestore.setDoc).toHaveBeenCalledOnce();
        const writeData = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        const options = firestore.setDoc.mock.calls[0][2] as { mergeFields: string[] };
        expect(options).toBeDefined();
        expect(options.mergeFields).toEqual(Object.keys(writeData));
        expect(options.mergeFields).toContain('recommendationAudit');
    });

    it('persists the exact imported-event advisory verdict instead of collapsing it to train/proceed', async () => {
        const template = TEMPLATES[0];
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        const recommendation: Recommendation = {
            template,
            mode: 'train',
            rationale: 'Event is a fixed commitment; advice only.',
            externalVerdict: {
                decision: 'advisory',
                gateFailures: [],
                rationale: 'Do not replace or cancel the target event.',
            },
        };

        const saved = await new RecommendationService().saveRecommendation('athlete', '2026-08-07', recommendation);

        expect(saved).not.toBeNull();
        expect(firestore.setDoc).toHaveBeenCalledOnce();
        const writeData = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(writeData.engineVerdict).toBe('advisory');
        expect(writeData.mode).toBe('train');
    });

    function replacementStore() {
        const date = '2026-10-05';
        const path = `users/athlete/daily_recommendations/${date}`;
        const manualSource = { kind: 'manual' as const, definitionId: 'manual-def', revision: 1, contentHash: 'a'.repeat(64) };
        const binding = { occurrenceId: 'occ-manual', sessionSource: manualSource, prescriptionHash: 'b'.repeat(64) };
        const audit: RecommendationAudit = {
            policyVersion: POLICY_VERSION, evaluatedAt: '2026-10-05T08:00:00Z', safetyStatus: 'complete',
            decisionContextRevision: 'history-r1',
            history: { completedEventCount: 0, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            candidateScores: [], droppedContributorObjectives: [],
            authoredOccurrence: { occurrenceId: binding.occurrenceId, decision: 'proceed' }, primarySession: binding,
        };
        const template = TEMPLATES[0];
        const prior: DailyRecommendation = {
            userId: 'athlete', date, templateId: template.id, templateTitle: template.title,
            category: template.category, modality: template.modality, mode: 'train', rationale: 'External decision',
            schemaVersion: 3, revision: 2, createdAt: '2026-10-05T07:00:00Z', updatedAt: '2026-10-05T07:00:00Z',
            adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
            primarySession: { occurrenceId: 'occ-external', sessionSource: { kind: 'external_plan', planId: 'plan', revision: 1, sessionId: 'am', contentHash: 'c'.repeat(64) }, prescriptionHash: 'd'.repeat(64) },
            recommendationAudit: { ...audit, authoredOccurrence: undefined, primarySession: undefined },
        };
        const common = { userId: 'athlete', date, state: 'scheduled', createdAt: prior.createdAt, updatedAt: prior.updatedAt };
        const store = new Map<string, unknown>([
            [path, prior],
            ['users/athlete/session_occurrences/occ-external', { ...common, occurrenceId: 'occ-external', authority: 'external_plan', externalPlanRef: { planId: 'plan', revision: 1, sessionId: 'am', contentHash: 'c'.repeat(64) } }],
            ['users/athlete/session_occurrences/occ-manual', { ...common, occurrenceId: 'occ-manual', authority: 'replace_recommendation', definitionRef: { definitionId: manualSource.definitionId, revision: manualSource.revision, contentHash: manualSource.contentHash } }],
        ]);
        firestore.doc.mockImplementation((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }));
        const read = vi.fn(async (ref: { path: string }) => ({ ref, exists: () => store.has(ref.path), data: () => store.get(ref.path) }));
        firestore.getDoc.mockImplementation(read);
        const transaction = { get: read, set: vi.fn(), delete: vi.fn() };
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<void>) => {
            await callback(transaction);
            for (const [ref, value] of transaction.set.mock.calls) store.set(ref.path, value);
        });
        const rec: Recommendation = { template, mode: 'train', rationale: 'Accepted replacement', primarySession: binding, recommendationAudit: audit };
        return { store, transaction, prior, rec, path, date };
    }

    it('atomically commits accepted manual authority, the prior revision, and scheduled-primary supersession', async () => {
        const { store, transaction, prior, rec, path, date } = replacementStore();
        const saved = await new RecommendationService().saveRecommendation('athlete', date, rec);
        expect(saved?.recommendationAudit?.authoredOccurrence?.occurrenceId).toBe('occ-manual');
        expect(saved?.revision).toBe(3);
        expect(store.get(`${path}/revisions/2`)).toMatchObject({ revision: 2, primarySession: prior.primarySession });
        expect(store.get('users/athlete/session_occurrences/occ-external')).toMatchObject({ state: 'superseded' });
        expect(store.get(path)).toMatchObject({ revision: 3, primarySession: rec.primarySession, recommendationAudit: rec.recommendationAudit });
        expect(transaction.set).toHaveBeenCalledTimes(3);
        expect(firestore.batch.commit).not.toHaveBeenCalled();
    });

    it('fails closed when the recommendation changes before the hand-off transaction', async () => {
        const { transaction, rec, date } = replacementStore();
        transaction.get = vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ changed: true }) });
        const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await new RecommendationService().saveRecommendation('athlete', date, rec)).toBeNull();
        expect(transaction.set).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it.each(['scheduled', 'active', 'completed', 'abandoned'])('preserves a committed %s replacement against a stale ordinary recompute', async state => {
        const { store, transaction, rec, prior, path, date } = replacementStore();
        const committed = { ...prior, primarySession: rec.primarySession, recommendationAudit: rec.recommendationAudit, rationale: rec.rationale };
        store.set(path, committed);
        const occPath = 'users/athlete/session_occurrences/occ-manual';
        store.set(occPath, { ...(store.get(occPath) as object), state });
        const saved = await new RecommendationService().saveRecommendation('athlete', date, { template: TEMPLATES[0], mode: 'recover', rationale: 'Later recompute' });
        expect(saved).toBe(committed);
        expect(transaction.set).not.toHaveBeenCalled();
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('atomically binds a new recommendation revision to one immutable context record', async () => {
        const template = TEMPLATES[0];
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        const audit: RecommendationAudit = {
            policyVersion: POLICY_VERSION, evaluatedAt: '2026-09-28T08:30:00.000Z',
            decisionContextRevision: 'history-r1', safetyStatus: 'complete',
            history: { completedEventCount: 0, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Hard' },
            candidateScores: [], droppedContributorObjectives: [], knowledgeLineage: [],
        };
        const evaluatorInputs = {
            userId: 'athlete', date: '2026-09-28', readiness: { subjective: {}, objective: {} }, context: {},
            events: [], fixedActivities: [], authoredPlanBlocks: [], trainingIntentProfile: null,
            preferences: null, externalPlan: null, externalRest: null, scheduleOverlays: [],
            confirmedProgressionOverrides: new Map<string, number>(), mechanicalCheckinHistory: [],
        } as never;
        const recommendation: Recommendation = { template, mode: 'train', rationale: 'Keep it easy.', recommendationAudit: audit };
        const capture = {
            evaluatedAt: audit.evaluatedAt, minimumSafetyStatus: 'complete' as const,
            evaluatorInputs, performedTrainingFacts: { asOfDate: '2026-09-28', windowDays: 7, revision: 'facts-r1', exposures: [], coverageCredits: [] }, mechanicalCheckinHistory: [],
        };

        const service = new RecommendationService();
        const saved = await service.saveRecommendation('athlete', '2026-09-28', recommendation, capture);

        expect(firestore.batch.commit).toHaveBeenCalledOnce();
        expect(firestore.batch.set).toHaveBeenCalledTimes(2);
        const context = firestore.batch.set.mock.calls[1][1] as Record<string, unknown>;
        expect(context).toMatchObject({ userId: 'athlete', date: '2026-09-28', recommendationRevision: 1 });
        expect(context).not.toHaveProperty('preparedHistorySnapshot');
        expect(context).not.toHaveProperty('historyProvider');
        expect(saved?.recommendationAudit?.decisionContext).toEqual({
            path: 'users/athlete/daily_recommendations/2026-09-28/decision_contexts/1',
            revision: 1,
            contentHash: context.contentHash,
        });

        firestore.setDoc.mockClear();
        firestore.batch.set.mockClear();
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => saved });
        await service.saveRecommendation('athlete', '2026-09-28', recommendation, capture);
        expect(firestore.setDoc).toHaveBeenCalledOnce();
        expect(firestore.batch.set).not.toHaveBeenCalled();
    });

    it('refuses a context binding when its policy or evaluation instant differs from the audit', async () => {
        const template = TEMPLATES[0];
        const evaluatorInputs = {
            userId: 'athlete', date: '2026-09-28', readiness: { subjective: {}, objective: {} }, context: {},
            events: [], fixedActivities: [], authoredPlanBlocks: [], trainingIntentProfile: null,
            preferences: null, externalPlan: null, externalRest: null, scheduleOverlays: [],
            confirmedProgressionOverrides: new Map<string, number>(), mechanicalCheckinHistory: [],
        } as never;
        const baseAudit: RecommendationAudit = {
            policyVersion: POLICY_VERSION, evaluatedAt: '2026-09-28T08:30:00.000Z',
            decisionContextRevision: 'history-r1', safetyStatus: 'complete',
            history: { completedEventCount: 0, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Hard' },
            candidateScores: [], droppedContributorObjectives: [], knowledgeLineage: [],
        };
        const service = new RecommendationService();
        firestore.getDoc.mockResolvedValue({ exists: () => false });

        const wrongPolicy = await service.saveRecommendation('athlete', '2026-09-28', {
            template, mode: 'train', rationale: 'Keep it easy.',
            recommendationAudit: { ...baseAudit, policyVersion: 'different-policy' },
        }, {
            evaluatedAt: baseAudit.evaluatedAt, minimumSafetyStatus: 'complete', evaluatorInputs,
            performedTrainingFacts: { asOfDate: '2026-09-28', windowDays: 7, revision: 'facts-r1', exposures: [], coverageCredits: [] }, mechanicalCheckinHistory: [],
        });
        expect(wrongPolicy).toBeNull();
        expect(firestore.batch.commit).not.toHaveBeenCalled();
        expect(firestore.setDoc).not.toHaveBeenCalled();

        const wrongInstant = await service.saveRecommendation('athlete', '2026-09-28', {
            template, mode: 'train', rationale: 'Keep it easy.', recommendationAudit: baseAudit,
        }, {
            evaluatedAt: '2026-09-28T08:31:00.000Z', minimumSafetyStatus: 'complete', evaluatorInputs,
            performedTrainingFacts: { asOfDate: '2026-09-28', windowDays: 7, revision: 'facts-r1', exposures: [], coverageCredits: [] }, mechanicalCheckinHistory: [],
        });
        expect(wrongInstant).toBeNull();
        expect(firestore.batch.commit).not.toHaveBeenCalled();
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    describe('degrades to an unbound, not-replayable revision when capture cannot be persisted', () => {
        const auditFor = (evaluatedAt: string): RecommendationAudit => ({
            policyVersion: POLICY_VERSION, evaluatedAt,
            decisionContextRevision: 'history-r1', safetyStatus: 'complete',
            history: { completedEventCount: 0, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Hard' },
            candidateScores: [], droppedContributorObjectives: [], knowledgeLineage: [],
        });
        const captureFor = (evaluatedAt: string, overrides: Record<string, unknown> = {}) => ({
            evaluatedAt,
            minimumSafetyStatus: 'complete' as const,
            evaluatorInputs: {
                userId: 'athlete', date: '2026-09-28', readiness: { subjective: {}, objective: {} }, context: {},
                events: [], fixedActivities: [], authoredPlanBlocks: [], trainingIntentProfile: null,
                preferences: null, externalPlan: null, externalRest: null, scheduleOverlays: [],
                confirmedProgressionOverrides: new Map<string, number>(), mechanicalCheckinHistory: [],
                ...overrides,
            } as never,
            performedTrainingFacts: { asOfDate: '2026-09-28', windowDays: 7, revision: 'facts-r1', exposures: [], coverageCredits: [] },
            mechanicalCheckinHistory: [],
        });

        it('persists the recommendation without a binding when the context cannot be built', async () => {
            const evaluatedAt = '2026-09-28T08:30:00.000Z';
            firestore.getDoc.mockResolvedValue({ exists: () => false });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            const saved = await new RecommendationService().saveRecommendation('athlete', '2026-09-28', {
                template: TEMPLATES[0], mode: 'train', rationale: 'Keep it easy.', recommendationAudit: auditFor(evaluatedAt),
            }, captureFor(evaluatedAt, { readiness: { subjective: {}, objective: { hrv: Number.NaN } } }));

            expect(saved?.revision).toBe(1);
            expect(saved?.recommendationAudit).toBeDefined();
            expect(saved?.recommendationAudit).not.toHaveProperty('decisionContext');
            expect(firestore.setDoc).toHaveBeenCalledOnce();
            expect(firestore.batch.commit).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('Decision context capture failed'), expect.anything());
            warn.mockRestore();
        });

        it('retries once without the binding when the atomic context batch is rejected', async () => {
            const evaluatedAt = '2026-09-28T08:30:00.000Z';
            firestore.getDoc.mockResolvedValue({ exists: () => false });
            firestore.batch.commit.mockRejectedValueOnce(new Error('context document rejected'));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            const saved = await new RecommendationService().saveRecommendation('athlete', '2026-09-28', {
                template: TEMPLATES[0], mode: 'train', rationale: 'Keep it easy.', recommendationAudit: auditFor(evaluatedAt),
            }, captureFor(evaluatedAt));

            expect(firestore.batch.commit).toHaveBeenCalledOnce();
            expect(firestore.setDoc).toHaveBeenCalledOnce();
            const written = firestore.setDoc.mock.calls[0][1] as { recommendationAudit?: RecommendationAudit };
            expect(written.recommendationAudit).not.toHaveProperty('decisionContext');
            expect(saved?.recommendationAudit).not.toHaveProperty('decisionContext');
            warn.mockRestore();
        });

        it('keeps a changed decision current even when a bound revision has no new capture', async () => {
            const firstAt = '2026-09-28T08:30:00.000Z';
            firestore.getDoc.mockResolvedValue({ exists: () => false });
            const service = new RecommendationService();
            const bound = await service.saveRecommendation('athlete', '2026-09-28', {
                template: TEMPLATES[0], mode: 'train', rationale: 'Keep it easy.', recommendationAudit: auditFor(firstAt),
            }, captureFor(firstAt));
            expect(bound?.recommendationAudit?.decisionContext?.revision).toBe(1);

            vi.clearAllMocks();
            firestore.doc.mockReturnValue({ path: 'recommendation' });
            firestore.batch.commit.mockResolvedValue(undefined);
            firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => bound });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const changed = await service.saveRecommendation('athlete', '2026-09-28', {
                template: TEMPLATES[0], mode: 'modify', rationale: 'Back off today.', recommendationAudit: auditFor('2026-09-28T12:00:00.000Z'),
            });

            expect(changed?.revision).toBe(2);
            expect(changed?.mode).toBe('modify');
            expect(changed?.recommendationAudit).not.toHaveProperty('decisionContext');
            expect(firestore.batch.commit).toHaveBeenCalledOnce();
            warn.mockRestore();
        });
    });

    it('stores a write-once not-applicable gate record without evaluator history', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        const saved = await new RecommendationService().saveNotApplicableContext(
            'athlete', '2026-09-28', 'incomplete', '2026-09-28T08:30:00.000Z',
        );

        expect(saved).toBe(true);
        expect(firestore.setDoc).toHaveBeenCalledOnce();
        const context = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(context).toMatchObject({
            userId: 'athlete', date: '2026-09-28', recommendationRevision: 0,
            minimumSafetyStatus: 'incomplete', evaluatorInputs: null, performedTrainingFacts: null,
        });
        expect(context).not.toHaveProperty('mechanicalCheckinHistory');
    });

    it('backfills a logical verdict onto a legacy recommendation without manufacturing a decision revision', async () => {
        const template = TEMPLATES[0];
        const existing = {
            userId: 'athlete', date: '2026-08-07', templateId: template.id, templateTitle: template.title,
            category: template.category, modality: template.modality, mode: 'train', rationale: 'Keep it easy.',
            schemaVersion: 1, revision: 1, createdAt: '2026-08-07T08:00:00.000Z', updatedAt: '2026-08-07T08:00:00.000Z',
            adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        } as unknown as DailyRecommendation;
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => existing });
        const recommendation: Recommendation = { template, mode: 'train', rationale: 'Keep it easy.' };

        await new RecommendationService().saveRecommendation('athlete', '2026-08-07', recommendation);

        expect(firestore.batch.set).not.toHaveBeenCalled();
        expect(firestore.batch.commit).not.toHaveBeenCalled();
        expect(firestore.setDoc).toHaveBeenCalledOnce();
        const writeData = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(writeData.engineVerdict).toBe('proceed');
        expect(writeData.revision).toBe(1);
    });

    it('backfills advisory onto a legacy train row without fabricating a revision for evidence that was never stored exactly', async () => {
        const template = TEMPLATES[0];
        const existing = {
            userId: 'athlete', date: '2026-08-07', templateId: template.id, templateTitle: template.title,
            category: template.category, modality: template.modality, mode: 'train', rationale: 'Same visible recommendation.',
            schemaVersion: 1, revision: 1, createdAt: '2026-08-07T08:00:00.000Z', updatedAt: '2026-08-07T08:00:00.000Z',
            adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        } as unknown as DailyRecommendation;
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => existing });
        const recommendation: Recommendation = {
            template,
            mode: 'train',
            rationale: 'Same visible recommendation.',
            externalVerdict: { decision: 'advisory', gateFailures: [], rationale: 'Event advice only.' },
        };

        await new RecommendationService().saveRecommendation('athlete', '2026-08-07', recommendation);

        expect(firestore.batch.set).not.toHaveBeenCalled();
        expect(firestore.batch.commit).not.toHaveBeenCalled();
        const writeData = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(writeData.engineVerdict).toBe('advisory');
        expect(writeData.revision).toBe(1);
    });

    it('treats an exact verdict change as a decision change even when template and three-value mode are unchanged', async () => {
        const template = TEMPLATES[0];
        const existing = {
            userId: 'athlete', date: '2026-08-07', templateId: template.id, templateTitle: template.title,
            category: template.category, modality: template.modality, mode: 'train', engineVerdict: 'proceed', rationale: 'Same visible recommendation.',
            schemaVersion: 1, revision: 1, createdAt: '2026-08-07T08:00:00.000Z', updatedAt: '2026-08-07T08:00:00.000Z',
            adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        };
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => existing });
        const recommendation: Recommendation = {
            template,
            mode: 'train',
            rationale: 'Same visible recommendation.',
            externalVerdict: { decision: 'advisory', gateFailures: [], rationale: 'Event advice only.' },
        };

        await new RecommendationService().saveRecommendation('athlete', '2026-08-07', recommendation);

        expect(firestore.batch.set).toHaveBeenCalledTimes(2);
        const archive = firestore.batch.set.mock.calls[0][1] as Record<string, unknown>;
        const current = firestore.batch.set.mock.calls[1][1] as Record<string, unknown>;
        expect(archive.engineVerdict).toBe('proceed');
        expect(current.engineVerdict).toBe('advisory');
        expect(current.revision).toBe(2);
    });

    it('does not treat an unchanged prescription as changed when Firestore returns its keys re-sorted', async () => {
        const template = TEMPLATES[0];
        const prescriptionAsConstructed = {
            id: '2026-08-07_cycling_technical_01_default',
            userId: 'athlete',
            date: '2026-08-07',
            workoutId: 'cycling_technical_01',
            workoutVersion: 1,
            variantId: 'default',
            targetDurationMin: 30,
            adjustedBlocks: [{ id: 'b1', name: 'Main', role: 'main', steps: [] }],
            displayBlocks: [{
                id: 'b1', name: 'Main', role: 'main',
                steps: [{ id: 's1', name: 'Warmup', dose: '10 min easy', targets: ['RPE 3'] }],
            }],
            resolvedParameters: { cadence: 90 },
            rationale: ['Low-fatigue cadence practice.', 'Default variant.'],
            adjustmentReasons: [],
            source: { recommendationEngineVersion: 'daily-recommendation-v2' },
            status: 'recommended',
        };

        const existing = {
            userId: 'athlete', date: '2026-08-07', templateId: template.id, templateTitle: template.title,
            category: template.category, modality: template.modality, mode: 'train', rationale: 'Keep it easy.',
            schemaVersion: 2, revision: 1, createdAt: '2026-08-07T08:00:00.000Z', updatedAt: '2026-08-07T08:00:00.000Z',
            prescription: sortKeysDeep(prescriptionAsConstructed),
            adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        } as unknown as DailyRecommendation;
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => existing });

        const recommendation = {
            template, mode: 'train', rationale: 'Keep it easy.',
            prescription: prescriptionAsConstructed,
        } as unknown as Recommendation;

        await new RecommendationService().saveRecommendation('athlete', '2026-08-07', recommendation);

        expect(firestore.batch.set).not.toHaveBeenCalled();
        expect(firestore.batch.commit).not.toHaveBeenCalled();
        expect(firestore.setDoc).toHaveBeenCalledOnce();
        const [, writeData] = firestore.setDoc.mock.calls[0];
        expect((writeData as Record<string, unknown>).revision).toBe(1);
        expect((writeData as Record<string, unknown>).engineVerdict).toBe('proceed');
    });

    describe('listRecommendationRevisions (PR-C M-5)', () => {
        const archive = (revision: number, audit?: Record<string, unknown>) => ({
            id: String(revision),
            data: () => ({
                revision,
                templateId: 'rest_01',
                templateTitle: 'Total Rest',
                category: 'Rest',
                modality: 'None',
                mode: 'recover',
                rationale: 'Gate withheld the imported session.',
                engineVerdict: 'defer',
                ...(audit ? { recommendationAudit: audit } : {}),
            }),
        });
        const externalAudit = {
            externalPlan: { planId: 'autumn-block', revision: 2, sessionId: 'ride-1', contentHash: 'a'.repeat(64) },
        };

        it('lists one date revision archive in revision order', async () => {
            firestore.getDocs.mockResolvedValue({ docs: [archive(1, externalAudit), archive(2)] });
            const result = await new RecommendationService().listRecommendationRevisions('u1', '2026-09-20');
            expect(result).toMatchObject({ status: 'AVAILABLE' });
            if (result.status !== 'AVAILABLE') throw new Error('expected available');
            expect(result.data.map(item => item.revision)).toEqual([1, 2]);
            expect(result.data[0].recommendationAudit?.externalPlan).toMatchObject({ planId: 'autumn-block' });
            expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), 'users', 'u1', 'daily_recommendations', '2026-09-20', 'revisions');
        });

        it('returns an empty available listing when no revision was archived', async () => {
            firestore.getDocs.mockResolvedValue({ docs: [] });
            const result = await new RecommendationService().listRecommendationRevisions('u1', '2026-09-20');
            expect(result).toMatchObject({ status: 'AVAILABLE', data: [] });
        });

        it('reports invalid instead of trusting a malformed archive partially', async () => {
            firestore.getDocs.mockResolvedValue({ docs: [archive(1, externalAudit), { id: '2', data: () => ({ revision: 2 }) }] });
            const result = await new RecommendationService().listRecommendationRevisions('u1', '2026-09-20');
            expect(result.status).toBe('INVALID');
        });

        it('bounds archive hydration and fails closed instead of silently truncating an oversized date', async () => {
            firestore.getDocs.mockResolvedValue({
                docs: Array.from({ length: 129 }, (_, index) => archive(index + 1, index === 0 ? externalAudit : undefined)),
            });
            const result = await new RecommendationService().listRecommendationRevisions('u1', '2026-09-20');
            expect(result).toMatchObject({
                status: 'INVALID',
                issues: [{ code: 'recommendation-archive-too-large' }],
            });
            expect(firestore.limit).toHaveBeenCalledWith(129);
        });

        it('reports unavailable when the archive listing cannot be read', async () => {
            firestore.getDocs.mockRejectedValue(new Error('offline'));
            const result = await new RecommendationService().listRecommendationRevisions('u1', '2026-09-20');
            expect(result).toMatchObject({ status: 'UNAVAILABLE', operation: 'read recommendation revision archive' });
        });
    });
});
