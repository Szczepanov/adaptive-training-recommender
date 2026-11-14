import { afterEach, describe, expect, it, vi } from 'vitest';
import { previousContextStorageKey, readPreviousContext, writePreviousContext } from './briefPreviousContext';

function stubStorage(overrides: Partial<Record<'getItem' | 'setItem', () => never>> = {}): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      ...overrides,
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('briefPreviousContext', () => {
  it('round-trips a value per purpose under the documented key', () => {
    const store = stubStorage();
    const value = { exportedOn: '2026-11-13', itemHashes: { a: 'x' } };
    writePreviousContext('morning', value);
    expect(store.has('adaptive-training:context-brief:previous-context:morning')).toBe(true);
    expect(previousContextStorageKey('planning')).toBe('adaptive-training:context-brief:previous-context:planning');
    expect(readPreviousContext('morning')).toEqual(value);
    expect(readPreviousContext('planning')).toBeUndefined();
  });

  it('readPreviousContext returns undefined when storage throws or JSON is malformed', () => {
    stubStorage({ getItem: () => { throw new Error('denied'); } });
    expect(readPreviousContext('morning')).toBeUndefined();
    const store = stubStorage();
    store.set(previousContextStorageKey('morning'), '{not json');
    expect(readPreviousContext('morning')).toBeUndefined();
  });

  it.each([
    ['null', 'null'],
    ['array', '[]'],
    ['missing exportedOn', '{"itemHashes":{}}'],
    ['bad date', '{"exportedOn":"yesterday","itemHashes":{}}'],
    ['non-object hashes', '{"exportedOn":"2026-11-13","itemHashes":[]}'],
    ['non-string hash', '{"exportedOn":"2026-11-13","itemHashes":{"a":1}}'],
  ])('rejects malformed shape: %s', (_name, raw) => {
    const store = stubStorage();
    store.set(previousContextStorageKey('morning'), raw);
    expect(readPreviousContext('morning')).toBeUndefined();
  });

  it('writePreviousContext swallows errors', () => {
    stubStorage({ setItem: () => { throw new Error('quota'); } });
    expect(() => writePreviousContext('morning', { exportedOn: '2026-11-13', itemHashes: {} })).not.toThrow();
  });
});
