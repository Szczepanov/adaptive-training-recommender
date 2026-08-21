import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalDataService } from './localDataService';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

function htmlFallbackResponse(): Response {
    // What a SPA host (or a Vite dev server with no raw_cache.json fixture in
    // app/public) actually returns for an unmatched static path: index.html, 200 OK.
    return new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
    });
}

describe('LocalDataService', () => {
    const fetchSpy = vi.fn();

    beforeEach(() => {
        fetchSpy.mockReset();
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('never fetches the dev fixture outside DEV (no build ever ships raw_cache.json)', async () => {
        vi.stubEnv('DEV', false);
        const service = new LocalDataService();

        const snapshot = await service.getRecoverySnapshot('2026-08-21', 'u1');

        expect(snapshot).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('treats an HTML SPA-fallback response as "no cache" instead of a JSON parse error', async () => {
        vi.stubEnv('DEV', true);
        fetchSpy.mockResolvedValue(htmlFallbackResponse());
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const service = new LocalDataService();

        const snapshot = await service.getRecoverySnapshot('2026-08-21', 'u1');

        expect(snapshot).toBeNull();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('caches a miss so repeated lookups do not keep re-fetching', async () => {
        vi.stubEnv('DEV', true);
        fetchSpy.mockResolvedValue(htmlFallbackResponse());
        const service = new LocalDataService();

        await service.getRecoverySnapshot('2026-08-19', 'u1');
        await service.getRecoverySnapshot('2026-08-20', 'u1');
        await service.getAvailableDates();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('still reads a real fixture in DEV when one is present', async () => {
        vi.stubEnv('DEV', true);
        fetchSpy.mockResolvedValue(jsonResponse({ '2026-08-21': { sleepScore: 80 } }));
        const service = new LocalDataService();

        const snapshot = await service.getRecoverySnapshot('2026-08-21', 'u1');

        expect(snapshot?.raw.sleepScore).toBe(80);
    });
});
