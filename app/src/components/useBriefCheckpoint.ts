import { useEffect, useMemo, useState } from 'react';
import type { BriefPurpose } from '../engine/contextBrief';
import type { ConfirmStatus } from './BriefChatCheckpoint';
import { confirmBlock, type ConfirmBlock } from './briefCheckpointHint';
import {
  confirmSnapshot,
  normalizeChat,
  pendingSnapshot,
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
interface Outcome { snapshot: ExportedSnapshot; status: ConfirmStatus }

/**
 * The chat label and the confirmed-delivery checkpoint behind the unchanged-context
 * abbreviation. Copying or downloading only remembers the exported snapshot in memory, bound to
 * the account and chat it was exported for; the checkpoint changes when the reader confirms it
 * was added to that chat (spec 2c). An account or chat switch drops the pending confirmation.
 */
export function useBriefCheckpoint(userId: string, purpose: BriefPurpose, fullContext: boolean) {
  const [committed, setCommitted] = useState(() => ({ userId, chat: readChatLabel(userId) }));
  const chat = committed.userId === userId ? committed.chat : readChatLabel(userId);
  const [draft, setDraft] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [held, setHeld] = useState<HeldSnapshot | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [invalidated, setInvalidated] = useState(false);

  useEffect(() => { removeLegacyPreviousContext(); }, []);

  // Bound to the export's account and chat: render-time checks disable the button at once,
  // and this clears the pending state so switching back cannot revive it.
  const live = held && pendingSnapshot(held.snapshot, userId, chat) ? held : null;
  useEffect(() => {
    if (held && !live) {
      setHeld(null);
      setOutcome(null);
      setInvalidated(true);
    }
  }, [held, live]);

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
    const snapshot = snapshotFromBrief(brief, userId, chat);
    setHeld(snapshot ? { snapshot, source: brief } : null);
    setOutcome(null);
    setInvalidated(false);
  };

  const confirm = () => {
    if (!live) return;
    const result = confirmSnapshot(live.snapshot);
    const status: ConfirmStatus = result === 'saved' ? { kind: 'saved', chat: live.snapshot.chat } : { kind: result };
    setOutcome({ snapshot: live.snapshot, status });
    if (result === 'saved') setVersion(current => current + 1);
  };

  const heldFor = (brief: ExportedBrief | null) => (brief && live?.source === brief ? live : null);

  return {
    chat,
    chatInput: draft ?? chat,
    setChatInput: setDraft,
    commitChat: () => commit(draft ?? chat),
    pending,
    previousContext,
    recordExport,
    confirm,
    // A failed write may be retried; a saved or refused confirmation is final for that export.
    canConfirm: (brief: ExportedBrief | null) => heldFor(brief) !== null
      && (outcome?.snapshot !== live?.snapshot || outcome?.status.kind === 'not-saved'),
    confirmBlock: (brief: ExportedBrief | null, stale: boolean): ConfirmBlock | null => confirmBlock({
      chat,
      ledgerMode: Boolean(brief?.contextCheckpoint && brief.exportedAt),
      stale,
      held: heldFor(brief) !== null,
      invalidated: invalidated || (held !== null && live === null),
    }),
    confirmStatus: (brief: ExportedBrief | null): ConfirmStatus | null => {
      const current = heldFor(brief);
      return current && outcome?.snapshot === current.snapshot ? outcome.status : null;
    },
  };
}
