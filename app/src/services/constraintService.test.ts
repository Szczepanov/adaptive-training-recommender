import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserConstraint } from '../engine/models';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    getDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({ id: 'mock-db' })) }));

import { constraintService, LegacyConstraintService } from './constraintService';

describe('LegacyConstraintService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'users/athlete-1/constraints' });
    });

    it('fetches and filters constraints matching the requested userId', async () => {
        const mockConstraint1: UserConstraint = {
            userId: 'athlete-1',
            key: 'has_pull_up_bar',
            label: 'has_pull_up_bar',
            valueType: 'boolean',
            type: 'boolean',
            value: true,
            severity: 'hard',
            isActive: true,
            category: 'equipment',
            displayName: 'Pull-up Bar',
            description: null,
            schemaVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };

        const mockConstraint2: UserConstraint = {
            userId: 'athlete-2', // Mismatched userId to test filtering
            key: 'max_60_min_weekday',
            label: 'max_60_min_weekday',
            valueType: 'boolean',
            type: 'boolean',
            value: true,
            severity: 'hard',
            isActive: true,
            category: 'schedule',
            displayName: 'Max 60m Weekday',
            description: null,
            schemaVersion: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };

        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => mockConstraint1 },
                { data: () => mockConstraint2 },
            ],
        });

        const service = new LegacyConstraintService();
        const result = await service.listConstraints('athlete-1');

        expect(firestore.collection).toHaveBeenCalledWith(
            { id: 'mock-db' },
            'users',
            'athlete-1',
            'constraints'
        );
        expect(firestore.getDocs).toHaveBeenCalledWith({ path: 'users/athlete-1/constraints' });
        expect(result).toEqual([mockConstraint1]);
    });

    it('returns an empty array when no constraints exist', async () => {
        firestore.getDocs.mockResolvedValue({ docs: [] });

        const result = await constraintService.listConstraints('athlete-1');

        expect(result).toEqual([]);
    });
});
