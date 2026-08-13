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

/** Simulates a Firestore round trip: map fields come back with keys sorted
 * alphabetically, regardless of the order they were written in. */
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

    // Regression test for the bug reported as "Permission denied saving recommendation":
    // Firestore returns map fields with keys sorted alphabetically, which does not match
    // the construction order of a freshly-built prescription. Comparing via
    // JSON.stringify (the prior implementation) treated an unchanged, round-tripped
    // prescription as "changed" on every single save, spuriously bumping the revision
    // and rewriting the audit -- both of which firestore.rules rejects for a decision
    // that (by its own, order-insensitive comparison) never actually changed.
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
            // What Firestore actually hands back on read: same content, keys sorted.
            prescription: sortKeysDeep(prescriptionAsConstructed),
            adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        } as unknown as DailyRecommendation;
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => existing });

        const recommendation = {
            template, mode: 'train', rationale: 'Keep it easy.',
            prescription: prescriptionAsConstructed,
        } as unknown as Recommendation;

        await new RecommendationService().saveRecommendation('athlete', '2026-08-07', recommendation);

        // Unchanged decision -> single merge write, no revision bump, no archive batch.
        expect(firestore.batch.set).not.toHaveBeenCalled();
        expect(firestore.batch.commit).not.toHaveBeenCalled();
        expect(firestore.setDoc).toHaveBeenCalledOnce();
        const [, writeData] = firestore.setDoc.mock.calls[0];
        expect((writeData as Record<string, unknown>).revision).toBe(1);
    });
});
