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
});
