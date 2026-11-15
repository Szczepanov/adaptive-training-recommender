import type { BriefPurpose } from '../engine/contextBrief';
import {
  CHECKPOINT_FORMAT_VERSION,
  mergeCheckpoint,
  type CollectionCheckpoint,
  type PreviousContext,
  type UserContextCheckpoint,
} from '../ledger/export/compact/previousContext';

const KEY_PREFIX = 'adaptive-training:context-brief:previous-context:';
const CHAT_KEY_PREFIX = 'adaptive-training:context-brief:chat:';
const PURPOSES: readonly BriefPurpose[] = ['morning', 'planning', 'diagnostic'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CHAT_LABEL_MAX_LENGTH = 40;

/** A confirmed checkpoint as stored on this device: hashes and comparison metadata only. */
export interface StoredCheckpoint extends PreviousContext {
  /** The confirmed export's instant; an older export never overwrites it. */
  exportedAt: string;
}

/** What was exported and copied or downloaded, bound to the account and chat it was exported
 * for, kept in memory until the reader confirms it. */
export interface ExportedSnapshot {
  userId: string;
  purpose: BriefPurpose;
  chat: string;
  asOfDate: string;
  exportedAt: string;
  checkpoint: UserContextCheckpoint;
}

/** `newer-saved`: a later export is already confirmed for this chat, so nothing was written. */
export type ConfirmResult = 'saved' | 'newer-saved' | 'not-saved';

type ExportedBrief = {
  purpose: BriefPurpose;
  asOfDate: string;
  exportedAt?: string;
  contextCheckpoint?: UserContextCheckpoint;
};

/** The chat is a local label only: trimmed and capped, never part of an export. */
export function normalizeChat(raw: string): string {
  return raw.trim().slice(0, CHAT_LABEL_MAX_LENGTH);
}

export function previousContextStorageKey(userId: string, chat: string, purpose: BriefPurpose): string {
  return `${KEY_PREFIX}${userId}:${encodeURIComponent(chat)}:${purpose}`;
}

export function chatStorageKey(userId: string): string {
  return `${CHAT_KEY_PREFIX}${userId}`;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isInstant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

const isDate = (value: unknown): value is string => typeof value === 'string' && DATE_PATTERN.test(value);

function parseCollections(raw: unknown): Record<string, CollectionCheckpoint> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const entries = Object.entries(raw);
  const valid = entries.every(([, meta]) => isPlainObject(meta)
    && typeof meta.scope === 'string' && typeof meta.complete === 'boolean'
    && (meta.from === undefined || isDate(meta.from)));
  if (!valid) return undefined;
  return Object.fromEntries(entries.map(([name, meta]) => {
    const { scope, complete, from } = meta as unknown as CollectionCheckpoint;
    return [name, from === undefined ? { scope, complete } : { scope, complete, from }];
  }));
}

function parseStringMap(raw: unknown, isValue: (value: unknown) => boolean): Record<string, string> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const entries = Object.entries(raw);
  return entries.every(([, value]) => isValue(value)) ? Object.fromEntries(entries) as Record<string, string> : undefined;
}

/** A stored value of another or no format version (legacy) is not a checkpoint: full context. */
function parseStoredCheckpoint(raw: unknown): StoredCheckpoint | undefined {
  if (!isPlainObject(raw) || raw.formatVersion !== CHECKPOINT_FORMAT_VERSION) return undefined;
  const { exportedOn, exportedAt } = raw;
  if (!isDate(exportedOn) || !isInstant(exportedAt)) return undefined;
  const itemHashes = parseStringMap(raw.itemHashes, hash => typeof hash === 'string');
  const selectionDates = parseStringMap(raw.selectionDates, isDate);
  const collections = parseCollections(raw.collections);
  if (!itemHashes || !selectionDates || !collections) return undefined;
  return { formatVersion: CHECKPOINT_FORMAT_VERSION, exportedOn, exportedAt, itemHashes, selectionDates, collections };
}

function readItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Without storage the next export is simply full; nothing is lost.
    return false;
  }
}

function readStored(key: string): StoredCheckpoint | undefined {
  const stored = readItem(key);
  if (stored === null) return undefined;
  try {
    return parseStoredCheckpoint(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

/** What the reader confirmed holding in this chat for this purpose. No chat, no confirmed
 * checkpoint, another user's key, storage errors, legacy values and garbage all mean "full context". */
export function readPreviousContext(userId: string, chat: string, purpose: BriefPurpose): StoredCheckpoint | undefined {
  if (!chat) return undefined;
  return readStored(previousContextStorageKey(userId, chat, purpose));
}

/** The checkpoint to render against; the full-context toggle ignores any stored checkpoint. */
export function previousContextForBrief(
  userId: string, chat: string, purpose: BriefPurpose, fullContext: boolean,
): StoredCheckpoint | undefined {
  return fullContext ? undefined : readPreviousContext(userId, chat, purpose);
}

/** The exported brief's own date, instant and checkpoint for this account and chat, or null
 * when there is nothing to confirm. */
export function snapshotFromBrief(brief: ExportedBrief, userId: string, chat: string): ExportedSnapshot | null {
  const name = normalizeChat(chat);
  if (!name || !userId || !brief.contextCheckpoint || !isInstant(brief.exportedAt)) return null;
  return {
    userId,
    purpose: brief.purpose,
    chat: name,
    asOfDate: brief.asOfDate,
    exportedAt: brief.exportedAt,
    checkpoint: brief.contextCheckpoint,
  };
}

/** The pending confirmation, or null once the account or the chat changed since the export. */
export function pendingSnapshot(held: ExportedSnapshot | null, userId: string, chat: string): ExportedSnapshot | null {
  return held && held.userId === userId && held.chat === chat ? held : null;
}

/**
 * Persists the exported snapshot, never content recomputed since, for its captured account,
 * chat and purpose only. Called only on explicit confirmation. Storage is re-read right before
 * the write, so an older export (another tab, a late click) never overwrites a newer checkpoint.
 */
export function confirmSnapshot(snapshot: ExportedSnapshot): ConfirmResult {
  if (!snapshot.chat || !snapshot.userId) return 'not-saved';
  const key = previousContextStorageKey(snapshot.userId, snapshot.chat, snapshot.purpose);
  const stored = readStored(key);
  if (stored && Date.parse(stored.exportedAt) > Date.parse(snapshot.exportedAt)) return 'newer-saved';
  const value: StoredCheckpoint = {
    ...mergeCheckpoint(stored, snapshot.checkpoint, snapshot.asOfDate),
    exportedAt: snapshot.exportedAt,
  };
  return writeItem(key, JSON.stringify(value)) ? 'saved' : 'not-saved';
}

export function readChatLabel(userId: string): string {
  return normalizeChat(readItem(chatStorageKey(userId)) ?? '');
}

export function writeChatLabel(userId: string, chat: string): void {
  writeItem(chatStorageKey(userId), normalizeChat(chat));
}

/** The earlier purpose-only keys were written on every copy and are no longer read. */
export function removeLegacyPreviousContext(): void {
  if (typeof window === 'undefined') return;
  for (const purpose of PURPOSES) {
    try {
      window.localStorage.removeItem(`${KEY_PREFIX}${purpose}`);
    } catch {
      // Nothing to clean up when storage is unavailable.
    }
  }
}
