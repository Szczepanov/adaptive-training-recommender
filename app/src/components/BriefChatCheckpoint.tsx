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

interface BriefConfirmChatProps {
  chat: string;
  canConfirm: boolean;
  confirmedChat: string | null;
  onConfirm: () => void;
}

/** Confirms that the exported Markdown was pasted into the named chat, which advances the checkpoint. */
export function BriefConfirmChat({ chat, canConfirm, confirmedChat, onConfirm }: BriefConfirmChatProps) {
  return (
    <>
      <button type="button" className="brief-copy" disabled={!canConfirm} onClick={onConfirm}>
        Added to this chat
      </button>
      {!chat && <span className="brief-range">Name the chat to save a checkpoint.</span>}
      <span role="status" className="brief-range">
        {confirmedChat ? `Checkpoint saved for "${confirmedChat}"` : ''}
      </span>
    </>
  );
}
