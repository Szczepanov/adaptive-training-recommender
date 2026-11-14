import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefChatInput, BriefConfirmChat } from './BriefChatCheckpoint';

describe('BriefChatCheckpoint', () => {
  it('labels the chat input and caps it at 40 characters', () => {
    const html = renderToStaticMarkup(<BriefChatInput value="Coach" onChange={() => {}} onCommit={() => {}} />);
    expect(html).toContain('<span>Chat</span>');
    expect(html).toContain('maxLength="40"');
    expect(html).toContain('value="Coach"');
  });

  it('disables Added to this chat and hints to name the chat when there is none', () => {
    const html = renderToStaticMarkup(<BriefConfirmChat chat="" canConfirm={false} confirmedChat={null} onConfirm={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Added to this chat<\/button>/);
    expect(html).toContain('Name the chat to save a checkpoint.');
  });

  it('enables the button for an exported snapshot and announces the saved checkpoint', () => {
    const ready = renderToStaticMarkup(<BriefConfirmChat chat="Coach" canConfirm confirmedChat={null} onConfirm={() => {}} />);
    expect(ready).not.toContain('disabled');
    const saved = renderToStaticMarkup(<BriefConfirmChat chat="Coach" canConfirm={false} confirmedChat="Coach" onConfirm={() => {}} />);
    expect(saved).toContain('role="status"');
    expect(saved).toContain('Checkpoint saved for &quot;Coach&quot;');
  });
});
