import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrainingIntentProfile } from '../engine/models';

const firestore = vi.hoisted(() => ({ doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn() }));
vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { TrainingIntentProfileService } from './trainingIntentProfileService';
import { validateTrainingIntentProfile } from '../engine/validation';

const profile: TrainingIntentProfile = {
    userId: 'u1', planningMode: 'evergreen', priorities: ['health'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
    organizationPreference: 'auto', schemaVersion: 1,
    createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
};

describe('TrainingIntentProfile persistence boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockReturnValue({ path: 'training_intent/profile' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.getDoc.mockResolvedValue({ exists: () => false });
    });

    it('rejects invalid session ordering, duplicate priorities, and extraneous fields', () => {
        expect(validateTrainingIntentProfile({ ...profile, weeklyCommitment: { minSessions: 4, targetSessions: 3, maxSessions: 4 } }).isValid).toBe(false);
        expect(validateTrainingIntentProfile({ ...profile, priorities: ['health', 'health'] }).isValid).toBe(false);
        expect(validateTrainingIntentProfile({ ...profile, unsupported: true }).isValid).toBe(false);
    });

    it('round-trips a valid singleton profile and never stores a caller-owned user id', async () => {
        const service = new TrainingIntentProfileService();
        const saved = await service.upsert('u1', {
            planningMode: 'evergreen', priorities: ['health'],
            weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
            organizationPreference: 'auto', schemaVersion: 1,
        });
        expect(saved.userId).toBe('u1');
        expect(firestore.setDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'training_intent/profile' }),
            expect.objectContaining({ userId: 'u1', planningMode: 'evergreen' }),
            { merge: true },
        );

        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => saved });
        const state = await service.getProfileState('u1');
        expect(state).toMatchObject({ status: 'AVAILABLE', data: { userId: 'u1', planningMode: 'evergreen' } });
    });

    it('edits an existing profile while preserving its creation timestamp, then reads the edit back', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => profile });
        const service = new TrainingIntentProfileService();
        const saved = await service.upsert('u1', {
            planningMode: 'event_directed', priorities: ['endurance', 'strength_muscle'],
            weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
            organizationPreference: 'auto', schemaVersion: 1,
        });
        expect(saved).toMatchObject({
            userId: 'u1', planningMode: 'event_directed', priorities: ['endurance', 'strength_muscle'],
            weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
            createdAt: profile.createdAt,
        });

        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => saved });
        await expect(service.getProfileState('u1')).resolves.toMatchObject({
            status: 'AVAILABLE', data: { planningMode: 'event_directed', weeklyCommitment: { targetSessions: 4 } },
        });
    });

    it('accepts an absent or well-formed capability-maintenance opt-in and rejects malformed ones (#805)', () => {
        expect(validateTrainingIntentProfile(profile).isValid).toBe(true);
        const all = ['linear_speed_skill', 'acceleration_deceleration', 'multidirectional_change_of_direction', 'sport_skill'];
        expect(validateTrainingIntentProfile({ ...profile, capabilityMaintenance: { enabled: true, capabilities: all } }).isValid).toBe(true);
        expect(validateTrainingIntentProfile({ ...profile, capabilityMaintenance: { enabled: false, capabilities: [] } }).isValid).toBe(true);
        expect(validateTrainingIntentProfile({ ...profile, capabilityMaintenance: { enabled: true, capabilities: [] } }).isValid).toBe(false);
        expect(validateTrainingIntentProfile({ ...profile, capabilityMaintenance: { enabled: true, capabilities: ['football'] } }).isValid).toBe(false);
        expect(validateTrainingIntentProfile({ ...profile, capabilityMaintenance: { enabled: true, capabilities: ['sport_skill', 'sport_skill'] } }).isValid).toBe(false);
        expect(validateTrainingIntentProfile({ ...profile, capabilityMaintenance: { enabled: true, capabilities: ['sport_skill'], intervalDays: 7 } }).isValid).toBe(false);
        expect(validateTrainingIntentProfile({ ...profile, capabilityMaintenance: { enabled: 'yes', capabilities: ['sport_skill'] } }).isValid).toBe(false);
        expect(validateTrainingIntentProfile({ ...profile, capabilityMaintenance: null }).isValid).toBe(false);
    });

    it('opts out by writing enabled: false, because a merge-write cannot delete the field (#805)', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({
            ...profile, capabilityMaintenance: { enabled: true, capabilities: ['sport_skill'] },
        }) });
        const saved = await new TrainingIntentProfileService().upsert('u1', {
            planningMode: 'evergreen', priorities: ['health'],
            weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
            organizationPreference: 'auto', schemaVersion: 1,
            capabilityMaintenance: { enabled: false, capabilities: ['sport_skill'] },
        });
        expect(saved.capabilityMaintenance).toEqual({ enabled: false, capabilities: ['sport_skill'] });
        expect(firestore.setDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ capabilityMaintenance: { enabled: false, capabilities: ['sport_skill'] } }),
            { merge: true },
        );
    });

    it('fails closed for malformed persisted documents', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ ...profile, planningMode: 'unsupported' }) });
        await expect(new TrainingIntentProfileService().getProfileState('u1')).resolves.toMatchObject({ status: 'INVALID' });
    });
});
