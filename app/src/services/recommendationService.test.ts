import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecommendation, Recommendation } from '../engine/models';
import { TEMPLATES } from '../engine/templates';

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

describe('RecommendationService persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockReturnValue({ path: 'recommendation' });
        firestore.batch.commit.mockResolvedValue(undefined);
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
});
