import { beforeEach, describe, expect, it, vi } from 'vitest';

/** S1.1 pins the offline-durability contract in `getDb()`. Every service test mocks
 *  `../firebase` wholesale, so without this file nothing exercises the real
 *  initialization path and the persistent cache could be dropped without a single test
 *  turning red -- on a feature whose entire purpose is surviving a gym with no signal. */

const initializeFirestore = vi.fn<(app: unknown, settings: Record<string, unknown>) => { tag: string }>(
    () => ({ tag: 'persistent-db' }),
);
const getFirestore = vi.fn(() => ({ tag: 'fallback-db' }));
const persistentLocalCache = vi.fn((settings: unknown) => ({ kind: 'persistent', settings }));
const persistentMultipleTabManager = vi.fn(() => ({ kind: 'multi-tab' }));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({ name: 'test-app' })) }));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn(() => ({ tag: 'auth' })) }));
vi.mock('firebase/firestore', () => ({
    initializeFirestore,
    getFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
}));

async function loadFirebaseModule() {
    vi.resetModules();
    return import('./firebase');
}

describe('getDb offline durability contract (S1.1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        initializeFirestore.mockReturnValue({ tag: 'persistent-db' });
    });

    it('configures a persistent local cache so offline writes survive a reload', async () => {
        const { getDb } = await loadFirebaseModule();
        getDb();

        expect(initializeFirestore).toHaveBeenCalledTimes(1);
        const settings = initializeFirestore.mock.calls[0][1];
        expect(settings.localCache).toEqual({ kind: 'persistent', settings: { tabManager: { kind: 'multi-tab' } } });
        expect(persistentLocalCache).toHaveBeenCalledTimes(1);
    });

    it('uses the multi-tab manager, since the app may be open more than once', async () => {
        const { getDb } = await loadFirebaseModule();
        getDb();

        expect(persistentMultipleTabManager).toHaveBeenCalledTimes(1);
    });

    it('keeps ignoreUndefinedProperties, which every service write already relies on', async () => {
        const { getDb } = await loadFirebaseModule();
        getDb();

        const settings = initializeFirestore.mock.calls[0][1];
        expect(settings.ignoreUndefinedProperties).toBe(true);
    });

    it('memoizes, so a second caller never re-initializes Firestore', async () => {
        const { getDb } = await loadFirebaseModule();
        const first = getDb();
        const second = getDb();

        expect(first).toBe(second);
        expect(initializeFirestore).toHaveBeenCalledTimes(1);
    });

    it('falls back to getFirestore when initialization is rejected', async () => {
        initializeFirestore.mockImplementation(() => {
            throw new Error('Firestore has already been started');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { getDb } = await loadFirebaseModule();
        expect(getDb()).toEqual({ tag: 'fallback-db' });
        expect(getFirestore).toHaveBeenCalledTimes(1);

        warn.mockRestore();
    });

    it('warns on fallback rather than dropping durability silently', async () => {
        initializeFirestore.mockImplementation(() => {
            throw new Error('cache unavailable');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { getDb } = await loadFirebaseModule();
        getDb();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/offline durability/i);

        warn.mockRestore();
    });
});
