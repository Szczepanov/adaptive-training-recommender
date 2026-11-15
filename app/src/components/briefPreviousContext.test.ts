import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECKPOINT_FORMAT_VERSION } from '../ledger/export/compact/previousContext';
import {
  chatStorageKey,
  confirmSnapshot,
  normalizeChat,
  pendingSnapshot,
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

const CHECKPOINT = {
  formatVersion: CHECKPOINT_FORMAT_VERSION,
  itemHashes: { 'goals/a': 'x', 'availability/b': 'y' },
  selectionDates: { 'availability/b': '2026-11-14' },
  collections: {
    goals: { scope: 'all-active', complete: true },
    availability: { scope: 'from:2026-11-12', complete: true, from: '2026-11-12' },
  },
};
const T1 = '2026-11-13T06:00:00.000Z';
const T2 = '2026-11-13T07:00:00.000Z';
const BRIEF = { purpose: 'morning' as const, asOfDate: '2026-11-13', exportedAt: T1, contextCheckpoint: CHECKPOINT };
const SNAPSHOT = { userId: 'u1', purpose: 'morning' as const, chat: 'Coach', asOfDate: '2026-11-13', exportedAt: T1, checkpoint: CHECKPOINT };
const KEY = 'adaptive-training:context-brief:previous-context:u1:Coach:morning';
const STORED = { ...CHECKPOINT, exportedOn: '2026-11-13', exportedAt: T1 };

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
    expect(snapshotFromBrief(BRIEF, 'u1', 'Coach')).toEqual(SNAPSHOT);
    expect(store.size).toBe(0);
  });

  it('confirm writes only the captured <uid>:<chat>:<purpose> key, with the exported snapshot', () => {
    const store = stubStorage();
    expect(confirmSnapshot(SNAPSHOT)).toBe('saved');
    expect([...store.keys()]).toEqual([KEY]);
    expect(readPreviousContext('u1', 'Coach', 'morning')).toEqual(STORED);
  });

  it('a different user, chat or purpose reads nothing, and another user key is never read', () => {
    stubStorage();
    confirmSnapshot(SNAPSHOT);
    const getItem = vi.spyOn(window.localStorage, 'getItem');
    expect(readPreviousContext('u2', 'Coach', 'morning')).toBeUndefined();
    expect(readPreviousContext('u1', 'New chat', 'morning')).toBeUndefined();
    expect(readPreviousContext('u1', 'Coach', 'planning')).toBeUndefined();
    expect(getItem.mock.calls.map(([key]) => key)).not.toContain(KEY);
  });

  it('an empty chat reads nothing and cannot be confirmed', () => {
    const store = stubStorage();
    confirmSnapshot(SNAPSHOT);
    expect(readPreviousContext('u1', '', 'morning')).toBeUndefined();
    expect(snapshotFromBrief(BRIEF, 'u1', '  ')).toBeNull();
    const before = store.size;
    expect(confirmSnapshot({ ...SNAPSHOT, chat: '' })).toBe('not-saved');
    expect(store.size).toBe(before);
  });

  it('a brief without a checkpoint or a valid exportedAt yields no snapshot', () => {
    expect(snapshotFromBrief({ purpose: 'morning', asOfDate: '2026-11-13' }, 'u1', 'Coach')).toBeNull();
    expect(snapshotFromBrief({ ...BRIEF, exportedAt: 'later' }, 'u1', 'Coach')).toBeNull();
  });

  it('an account or chat switch invalidates the pending confirmation', () => {
    expect(pendingSnapshot(SNAPSHOT, 'u1', 'Coach')).toBe(SNAPSHOT);
    expect(pendingSnapshot(SNAPSHOT, 'u2', 'Coach')).toBeNull();
    expect(pendingSnapshot(SNAPSHOT, 'u1', 'Other')).toBeNull();
    expect(pendingSnapshot(null, 'u1', 'Coach')).toBeNull();
  });

  it('an older export never overwrites a newer checkpoint, re-reading storage at write time', () => {
    const store = stubStorage();
    const older = snapshotFromBrief(BRIEF, 'u1', 'Coach');
    // Another tab confirms a newer export after this one was taken.
    expect(confirmSnapshot({ ...SNAPSHOT, exportedAt: T2, asOfDate: '2026-11-14' })).toBe('saved');
    const newer = store.get(KEY);
    expect(older && confirmSnapshot(older)).toBe('newer-saved');
    expect(store.get(KEY)).toBe(newer);
  });

  it('re-confirming the same export, or confirming a newer one, is saved', () => {
    stubStorage();
    confirmSnapshot(SNAPSHOT);
    expect(confirmSnapshot(SNAPSHOT)).toBe('saved');
    expect(confirmSnapshot({ ...SNAPSHOT, exportedAt: T2 })).toBe('saved');
    expect(readPreviousContext('u1', 'Coach', 'morning')?.exportedAt).toBe(T2);
  });

  it('a failed collection read keeps the prior hashes for that collection', () => {
    stubStorage();
    confirmSnapshot(SNAPSHOT);
    const failed = {
      ...SNAPSHOT,
      exportedAt: T2,
      checkpoint: {
        ...CHECKPOINT,
        itemHashes: { 'availability/b': 'z' },
        collections: { ...CHECKPOINT.collections, goals: { scope: 'all-active', complete: false } },
      },
    };
    expect(confirmSnapshot(failed)).toBe('saved');
    expect(readPreviousContext('u1', 'Coach', 'morning')?.itemHashes).toEqual({ 'goals/a': 'x', 'availability/b': 'z' });
  });

  it('a legacy stored value is replaced on confirmation', () => {
    const store = stubStorage();
    store.set(KEY, JSON.stringify({ exportedOn: '2026-11-20', itemHashes: { 'goals/old': 'q' } }));
    expect(confirmSnapshot(SNAPSHOT)).toBe('saved');
    expect(readPreviousContext('u1', 'Coach', 'morning')).toEqual(STORED);
  });

  it('the full-context toggle ignores the checkpoint', () => {
    stubStorage();
    confirmSnapshot(SNAPSHOT);
    expect(previousContextForBrief('u1', 'Coach', 'morning', false)).toBeDefined();
    expect(previousContextForBrief('u1', 'Coach', 'morning', true)).toBeUndefined();
  });

  it('removes the legacy purpose-only keys once', () => {
    const store = stubStorage();
    store.set('adaptive-training:context-brief:previous-context:morning', '{}');
    store.set('adaptive-training:context-brief:previous-context:planning', '{}');
    confirmSnapshot(SNAPSHOT);
    removeLegacyPreviousContext();
    expect([...store.keys()]).toEqual([KEY]);
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

  const valid = JSON.stringify(STORED);
  it.each([
    ['null', 'null'],
    ['array', '[]'],
    ['legacy (no formatVersion)', JSON.stringify({ exportedOn: '2026-11-13', itemHashes: {} })],
    ['another formatVersion', valid.replace(`"formatVersion":${CHECKPOINT_FORMAT_VERSION}`, '"formatVersion":999')],
    ['format version 1', valid.replace(`"formatVersion":${CHECKPOINT_FORMAT_VERSION}`, '"formatVersion":1')],
    ['missing selection dates', valid.replace(/"selectionDates":\{[^}]*\},/, '')],
    ['non-date selection date', valid.replace('"availability/b":"2026-11-14"', '"availability/b":"soon"')],
    ['non-date collection bound', valid.replace('"from":"2026-11-12"', '"from":12')],
    ['missing exportedOn', valid.replace('"exportedOn":"2026-11-13",', '')],
    ['bad date', valid.replace('"exportedOn":"2026-11-13"', '"exportedOn":"yesterday"')],
    ['missing exportedAt', valid.replace(`,"exportedAt":"${T1}"`, '')],
    ['non-object hashes', valid.replace(/"itemHashes":\{[^}]*\}/, '"itemHashes":[]')],
    ['non-string hash', valid.replace('"goals/a":"x"', '"goals/a":1')],
    ['bad collection metadata', valid.replace('"complete":true', '"complete":"yes"')],
  ])('rejects malformed shape: %s', (_name, raw) => {
    const store = stubStorage();
    store.set(previousContextStorageKey('u1', 'Coach', 'morning'), raw);
    expect(readPreviousContext('u1', 'Coach', 'morning')).toBeUndefined();
  });

  it('writes and removals swallow storage errors', () => {
    stubStorage({ setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } });
    expect(confirmSnapshot(SNAPSHOT)).toBe('not-saved');
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
