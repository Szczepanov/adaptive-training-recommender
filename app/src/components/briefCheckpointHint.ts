/** Why **Added to this chat** is disabled for the brief on screen, so the hint can say so. */
export type ConfirmBlock = 'no-chat' | 'unsupported' | 'stale' | 'switched' | 'not-exported';

export interface ConfirmState {
  chat: string;
  /** The brief carries a context checkpoint and `exportedAt` (ledger mode only). */
  ledgerMode: boolean;
  /** The brief on screen is being rebuilt for the current chat or toggle. */
  stale: boolean;
  /** An exported snapshot of this brief is held for the current account and chat. */
  held: boolean;
  /** A held snapshot was dropped by an account or chat switch. */
  invalidated: boolean;
}

/** First matching reason wins; null means the export on screen can be confirmed. */
export function confirmBlock(state: ConfirmState): ConfirmBlock | null {
  if (!state.chat) return 'no-chat';
  if (!state.ledgerMode) return 'unsupported';
  if (state.stale) return 'stale';
  if (state.held) return null;
  return state.invalidated ? 'switched' : 'not-exported';
}

const HINTS: Readonly<Record<ConfirmBlock, string>> = {
  'no-chat': 'Name the chat to save a checkpoint.',
  unsupported: 'Checkpoints are available in ledger mode.',
  stale: 'Wait for the brief to finish updating.',
  switched: 'Copy again for this chat.',
  'not-exported': 'Copy or download the Markdown first.',
};

export function confirmHint(block: ConfirmBlock | null): string {
  return block ? HINTS[block] : '';
}
