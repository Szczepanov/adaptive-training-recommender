import { describe, expect, it } from 'vitest';
import { confirmBlock, confirmHint } from './briefCheckpointHint';

const READY = { chat: 'Coach', ledgerMode: true, stale: false, held: false, invalidated: false };

describe('briefCheckpointHint', () => {
  it.each([
    ['no chat', { ...READY, chat: '' }, 'no-chat', 'Name the chat to save a checkpoint.'],
    ['engine mode', { ...READY, ledgerMode: false }, 'unsupported', 'Checkpoints are available in ledger mode.'],
    ['brief updating', { ...READY, stale: true, held: true }, 'stale', 'Wait for the brief to finish updating.'],
    ['account or chat switched', { ...READY, invalidated: true }, 'switched', 'Copy again for this chat.'],
    ['nothing exported', READY, 'not-exported', 'Copy or download the Markdown first.'],
  ] as const)('%s', (_name, state, block, hint) => {
    expect(confirmBlock(state)).toBe(block);
    expect(confirmHint(block)).toBe(hint);
  });

  it('an exported snapshot for this chat is not blocked and needs no hint', () => {
    expect(confirmBlock({ ...READY, held: true })).toBeNull();
    expect(confirmHint(null)).toBe('');
  });
});
