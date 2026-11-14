import { useEffect, useMemo, useState } from 'react';
import type { BriefPurpose } from '../engine/contextBrief';
import {
  confirmSnapshot,
  normalizeChat,
  previousContextForBrief,
  readChatLabel,
  removeLegacyPreviousContext,
  snapshotFromBrief,
  writeChatLabel,
  type ExportedSnapshot,
} from './briefPreviousContext';

const CHAT_DEBOUNCE_MS = 600;

type ExportedBrief = Parameters<typeof snapshotFromBrief>[0];
interface HeldSnapshot { snapshot: ExportedSnapshot; source: ExportedBrief }

/**
 * The chat label and the confirmed-delivery checkpoint behind the unchanged-context
 * abbreviation. Copying or downloading only remembers the exported snapshot in memory; the
 * checkpoint changes when the reader confirms it was added to the chat (spec 2c).
 */
export function useBriefCheckpoint(userId: string, purpose: BriefPurpose, fullContext: boolean) {
  const [committed, setCommitted] = useState(() => ({ userId, chat: readChatLabel(userId) }));
  const chat = committed.userId === userId ? committed.chat : readChatLabel(userId);
  const [draft, setDraft] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [held, setHeld] = useState<HeldSnapshot | null>(null);
  const [confirmed, setConfirmed] = useState<ExportedSnapshot | null>(null);

  useEffect(() => { removeLegacyPreviousContext(); }, []);

  const commit = (raw: string) => {
    const next = normalizeChat(raw);
    setDraft(null);
    if (next === chat) return;
    writeChatLabel(userId, next);
    setCommitted({ userId, chat: next });
  };

  const pending = draft !== null && normalizeChat(draft) !== chat;
  useEffect(() => {
    if (!pending || draft === null) return;
    const timer = window.setTimeout(() => commit(draft), CHAT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // commit closes over chat/userId, which are inputs of `pending`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, draft]);

  // `version` re-reads storage after a confirmation so the next rebuild sees it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previousContext = useMemo(() => previousContextForBrief(userId, chat, purpose, fullContext), [userId, chat, purpose, fullContext, version]);

  const recordExport = (brief: ExportedBrief) => {
    const snapshot = snapshotFromBrief(brief, chat);
    setHeld(snapshot ? { snapshot, source: brief } : null);
    setConfirmed(null);
  };

  const confirm = () => {
    if (!held) return;
    confirmSnapshot(userId, held.snapshot);
    setConfirmed(held.snapshot);
    setVersion(current => current + 1);
  };

  const heldFor = (brief: ExportedBrief | null) => (brief && held?.source === brief ? held : null);

  return {
    chat,
    chatInput: draft ?? chat,
    setChatInput: setDraft,
    commitChat: () => commit(draft ?? chat),
    pending,
    previousContext,
    recordExport,
    confirm,
    canConfirm: (brief: ExportedBrief | null) => heldFor(brief) !== null && confirmed !== held?.snapshot,
    confirmedChat: (brief: ExportedBrief | null) => {
      const current = heldFor(brief);
      return current && confirmed === current.snapshot ? current.snapshot.chat : null;
    },
  };
}
