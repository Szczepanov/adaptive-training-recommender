import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({ doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn() }));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { PreferencesService } from './preferencesService';

const USER_ID = 'u1';
const EXISTING = {
    userId: USER_ID,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 45,
    defaultWeekendTimeMin: 60,
    preferredTimeOfDay: 'flexible',
    preferredModalities: [],
    avoidedModalities: [],
    explanationVerbosity: 'detailed',
    conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
};

function writtenDoc(): Record<string, unknown> {
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    return firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
}

/**
 * #1167 P2-1: an unset setting must stay unset on disk. P2-8 flips what "unset" means, and
 * a default written here would pin every existing account to engine mode forever.
 */
describe('PreferencesService engine recommendations setting', () => {
    let service: PreferencesService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new PreferencesService();
        firestore.doc.mockReturnValue({ path: `users/${USER_ID}/preferences/profile` });
        firestore.setDoc.mockResolvedValue(undefined);
    });

    it('never writes a default on an unrelated update', async () => {
        await service.upsertPreferences(USER_ID, { conservativeBias: true }, { ...EXISTING } as never);
        expect(writtenDoc()).not.toHaveProperty('engineRecommendationsEnabled');
    });

    it('never writes a default when initializing a new account', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        await service.initializeDefaultPreferences(USER_ID);
        expect(writtenDoc()).not.toHaveProperty('engineRecommendationsEnabled');
    });

    it('writes an explicit choice', async () => {
        await service.upsertPreferences(USER_ID, { engineRecommendationsEnabled: false }, { ...EXISTING } as never);
        expect(writtenDoc().engineRecommendationsEnabled).toBe(false);
    });

    it('keeps an explicit choice through an unrelated update', async () => {
        await service.upsertPreferences(
            USER_ID,
            { conservativeBias: true },
            { ...EXISTING, engineRecommendationsEnabled: true } as never,
        );
        expect(writtenDoc().engineRecommendationsEnabled).toBe(true);
    });
});
