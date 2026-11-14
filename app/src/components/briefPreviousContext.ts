import type { BriefPurpose } from '../engine/contextBrief';
import type { PreviousContext } from '../ledger/export/compact/previousContext';

const KEY_PREFIX = 'adaptive-training:context-brief:previous-context:';
const CHAT_KEY_PREFIX = 'adaptive-training:context-brief:chat:';
const PURPOSES: readonly BriefPurpose[] = ['morning', 'planning', 'diagnostic'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CHAT_LABEL_MAX_LENGTH = 40;

/** What was exported and copied or downloaded, kept in memory until the reader confirms it. */
export interface ExportedSnapshot {
  purpose: BriefPurpose;
  chat: string;
  asOfDate: string;
  itemHashes: Readonly<Record<string, string>>;
}

type ExportedBrief = { purpose: BriefPurpose; asOfDate: string; contextItemHashes?: Readonly<Record<string, string>> };

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

function parsePreviousContext(raw: unknown): PreviousContext | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { exportedOn, itemHashes } = raw as Record<string, unknown>;
  if (typeof exportedOn !== 'string' || !DATE_PATTERN.test(exportedOn)) return undefined;
  if (typeof itemHashes !== 'object' || itemHashes === null || Array.isArray(itemHashes)) return undefined;
  const entries = Object.entries(itemHashes);
  if (!entries.every(([, hash]) => typeof hash === 'string')) return undefined;
  return { exportedOn, itemHashes: Object.fromEntries(entries) as Record<string, string> };
}

function readItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Without storage the next export is simply full; nothing is lost.
  }
}

/** What the reader confirmed holding in this chat for this purpose. No chat, no confirmed
 * checkpoint, another user's key, storage errors and garbage all mean "full context". */
export function readPreviousContext(userId: string, chat: string, purpose: BriefPurpose): PreviousContext | undefined {
  if (!chat) return undefined;
  const stored = readItem(previousContextStorageKey(userId, chat, purpose));
  if (stored === null) return undefined;
  try {
    return parsePreviousContext(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

/** The checkpoint to render against; the full-context toggle ignores any stored checkpoint. */
export function previousContextForBrief(
  userId: string, chat: string, purpose: BriefPurpose, fullContext: boolean,
): PreviousContext | undefined {
  return fullContext ? undefined : readPreviousContext(userId, chat, purpose);
}

/** The exported brief's own date and hashes, or null when there is nothing to confirm. */
export function snapshotFromBrief(brief: ExportedBrief, chat: string): ExportedSnapshot | null {
  const name = normalizeChat(chat);
  if (!name || !brief.contextItemHashes) return null;
  return { purpose: brief.purpose, chat: name, asOfDate: brief.asOfDate, itemHashes: brief.contextItemHashes };
}

/** Persists the exported snapshot, never content recomputed since. Called only on explicit confirmation. */
export function confirmSnapshot(userId: string, snapshot: ExportedSnapshot): void {
  if (!snapshot.chat) return;
  const value: PreviousContext = { exportedOn: snapshot.asOfDate, itemHashes: snapshot.itemHashes };
  writeItem(previousContextStorageKey(userId, snapshot.chat, snapshot.purpose), JSON.stringify(value));
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
