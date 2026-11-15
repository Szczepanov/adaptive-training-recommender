import { confirmHint, type ConfirmBlock } from './briefCheckpointHint';
import { CHAT_LABEL_MAX_LENGTH } from './briefPreviousContext';

interface BriefChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}

/** A local label for the AI chat the exports are pasted into. It is never part of an export. */
export function BriefChatInput({ value, onChange, onCommit }: BriefChatInputProps) {
  return (
    <label className="brief-chat">
      <span>Chat</span>
      <input
        type="text"
        value={value}
        maxLength={CHAT_LABEL_MAX_LENGTH}
        placeholder="Name this chat"
        autoComplete="off"
        onChange={event => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={event => { if (event.key === 'Enter') onCommit(); }}
      />
    </label>
  );
}

/** The outcome of the last "Added to this chat" for the export on screen. */
export type ConfirmStatus =
  | { kind: 'saved'; chat: string }
  | { kind: 'newer-saved' }
  | { kind: 'not-saved' };

interface BriefConfirmChatProps {
  canConfirm: boolean;
  /** Why the button is disabled, for an accurate hint; null when it is not blocked. */
  blocked: ConfirmBlock | null;
  status: ConfirmStatus | null;
  onConfirm: () => void;
}

function statusText(status: ConfirmStatus | null): string {
  if (!status) return '';
  if (status.kind === 'saved') return `Checkpoint saved for "${status.chat}"`;
  if (status.kind === 'newer-saved') return 'A newer checkpoint is already saved for this chat.';
  return 'Could not save the checkpoint on this device.';
}

/** Confirms that the exported Markdown was pasted into the named chat, which advances the checkpoint. */
export function BriefConfirmChat({ canConfirm, blocked, status, onConfirm }: BriefConfirmChatProps) {
  const hint = status ? '' : confirmHint(blocked);
  return (
    <>
      <button type="button" className="brief-copy" disabled={!canConfirm} onClick={onConfirm}>
        Added to this chat
      </button>
      {hint && <span className="brief-range">{hint}</span>}
      <span role="status" className="brief-range">{statusText(status)}</span>
    </>
  );
}
