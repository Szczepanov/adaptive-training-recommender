import type { BriefPurpose } from '../engine/contextBrief';
import type { PreviousContext } from '../ledger/export/compact/previousContext';

const KEY_PREFIX = 'adaptive-training:context-brief:previous-context:';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function previousContextStorageKey(purpose: BriefPurpose): string {
  return `${KEY_PREFIX}${purpose}`;
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

/** What the reader already holds from the last Markdown export of this purpose. Storage can be
 * unavailable or hold garbage; either way the export simply renders in full. */
export function readPreviousContext(purpose: BriefPurpose): PreviousContext | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.localStorage.getItem(previousContextStorageKey(purpose));
    return stored === null ? undefined : parsePreviousContext(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

export function writePreviousContext(purpose: BriefPurpose, value: PreviousContext): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(previousContextStorageKey(purpose), JSON.stringify(value));
  } catch {
    // Without storage the next export is simply full; nothing is lost.
  }
}
