import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatStorageKey,
  confirmSnapshot,
  normalizeChat,
  previousContextForBrief,
  previousContextStorageKey,
  readChatLabel,
  readPreviousContext,
  removeLegacyPreviousContext,
  snapshotFromBrief,
  writeChatLabel,
} from './briefPreviousContext';

type StorageOverrides = Partial<Record<'getItem' | 'setItem' | 'removeItem', () => never>>;

function stubStorage(overrides: StorageOverrides = {}): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      ...overrides,
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

const BRIEF = { purpose: 'morning' as const, asOfDate: '2026-11-13', contextItemHashes: { a: 'x' } };
const SNAPSHOT = { purpose: 'morning' as const, chat: 'Coach', asOfDate: '2026-11-13', itemHashes: { a: 'x' } };

describe('briefPreviousContext keys', () => {
  it('scopes the key by user, encoded chat and purpose', () => {
    expect(previousContextStorageKey('u1', 'My chat/1', 'morning'))
      .toBe('adaptive-training:context-brief:previous-context:u1:My%20chat%2F1:morning');
    expect(chatStorageKey('u1')).toBe('adaptive-training:context-brief:chat:u1');
  });

  it('normalizes the chat label: trimmed, at most 40 characters', () => {
    expect(normalizeChat('  Coach  ')).toBe('Coach');
    expect(normalizeChat('x'.repeat(60))).toHaveLength(40);
    expect(normalizeChat('   ')).toBe('');
  });
});

describe('confirmed chat checkpoint', () => {
  it('copying alone leaves storage unchanged; the snapshot is only built in memory', () => {
    const store = stubStorage();
    const snapshot = snapshotFromBrief(BRIEF, 'Coach');
    expect(snapshot).toEqual(SNAPSHOT);
    expect(store.size).toBe(0);
  });

  it('confirm writes only the <uid>:<chat>:<purpose> key, with the exported snapshot', () => {
    const store = stubStorage();
    confirmSnapshot('u1', SNAPSHOT);
    expect([...store.keys()]).toEqual(['adaptive-training:context-brief:previous-context:u1:Coach:morning']);
    expect(readPreviousContext('u1', 'Coach', 'morning')).toEqual({ exportedOn: '2026-11-13', itemHashes: { a: 'x' } });
  });

  it('a different user, chat or purpose reads nothing', () => {
    stubStorage();
    confirmSnapshot('u1', SNAPSHOT);
    expect(readPreviousContext('u2', 'Coach', 'morning')).toBeUndefined();
    expect(readPreviousContext('u1', 'New chat', 'morning')).toBeUndefined();
    expect(readPreviousContext('u1', 'Coach', 'planning')).toBeUndefined();
  });

  it('an empty chat reads nothing and cannot be confirmed', () => {
    const store = stubStorage();
    confirmSnapshot('u1', SNAPSHOT);
    expect(readPreviousContext('u1', '', 'morning')).toBeUndefined();
    expect(snapshotFromBrief(BRIEF, '  ')).toBeNull();
    const before = store.size;
    confirmSnapshot('u1', { ...SNAPSHOT, chat: '' });
    expect(store.size).toBe(before);
  });

  it('a brief without item hashes yields no snapshot', () => {
    expect(snapshotFromBrief({ purpose: 'morning', asOfDate: '2026-11-13' }, 'Coach')).toBeNull();
  });

  it('the full-context toggle ignores the checkpoint', () => {
    stubStorage();
    confirmSnapshot('u1', SNAPSHOT);
    expect(previousContextForBrief('u1', 'Coach', 'morning', false)).toBeDefined();
    expect(previousContextForBrief('u1', 'Coach', 'morning', true)).toBeUndefined();
  });

  it('removes the legacy purpose-only keys once', () => {
    const store = stubStorage();
    store.set('adaptive-training:context-brief:previous-context:morning', '{}');
    store.set('adaptive-training:context-brief:previous-context:planning', '{}');
    confirmSnapshot('u1', SNAPSHOT);
    removeLegacyPreviousContext();
    expect([...store.keys()]).toEqual(['adaptive-training:context-brief:previous-context:u1:Coach:morning']);
  });
});

describe('briefPreviousContext resilience', () => {
  it('reads return undefined when storage throws or JSON is malformed', () => {
    stubStorage({ getItem: () => { throw new Error('denied'); } });
    expect(readPreviousContext('u1', 'Coach', 'morning')).toBeUndefined();
    expect(readChatLabel('u1')).toBe('');
    const store = stubStorage();
    store.set(previousContextStorageKey('u1', 'Coach', 'morning'), '{not json');
    expect(readPreviousContext('u1', 'Coach', 'morning')).toBeUndefined();
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
    store.set(previousContextStorageKey('u1', 'Coach', 'morning'), raw);
    expect(readPreviousContext('u1', 'Coach', 'morning')).toBeUndefined();
  });

  it('writes and removals swallow storage errors', () => {
    stubStorage({ setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } });
    expect(() => confirmSnapshot('u1', SNAPSHOT)).not.toThrow();
    expect(() => writeChatLabel('u1', 'Coach')).not.toThrow();
    expect(() => removeLegacyPreviousContext()).not.toThrow();
  });

  it('remembers the chat label per user, normalized', () => {
    stubStorage();
    writeChatLabel('u1', '  Coach ');
    expect(readChatLabel('u1')).toBe('Coach');
    expect(readChatLabel('u2')).toBe('');
  });
});
