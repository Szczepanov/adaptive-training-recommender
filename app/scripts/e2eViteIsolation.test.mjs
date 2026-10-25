import { resolve } from 'node:path';
import { loadConfigFromFile } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

async function loadCacheDir(port) {
  vi.stubEnv('E2E_APP_PORT', port);
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'e2e' },
    resolve('vite.config.ts'),
  );
  return loaded.config.cacheDir;
}

it('keeps concurrent E2E servers from writing the same dependency cache', async () => {
  expect(await loadCacheDir('22105')).toBe('node_modules/.vite-e2e-22105');
  expect(await loadCacheDir('22115')).toBe('node_modules/.vite-e2e-22115');
});

it('keeps the default Vite cache for runs without leased E2E ports', async () => {
  expect(await loadCacheDir(undefined)).toBeUndefined();
});
