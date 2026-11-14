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
    const html = renderToStaticMarkup(<BriefConfirmChat chat="" canConfirm={false} status={null} onConfirm={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Added to this chat<\/button>/);
    expect(html).toContain('Name the chat to save a checkpoint.');
  });

  it('explains the disabled button when nothing was exported for this chat', () => {
    const html = renderToStaticMarkup(<BriefConfirmChat chat="Coach" canConfirm={false} status={null} onConfirm={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('Copy or download the Markdown first.');
  });

  it('enables the button for an exported snapshot and announces the saved checkpoint', () => {
    const ready = renderToStaticMarkup(<BriefConfirmChat chat="Coach" canConfirm status={null} onConfirm={() => {}} />);
    expect(ready).not.toContain('disabled');
    expect(ready).not.toContain('Copy or download');
    const saved = renderToStaticMarkup(<BriefConfirmChat chat="Coach" canConfirm={false} status={{ kind: 'saved', chat: 'Coach' }} onConfirm={() => {}} />);
    expect(saved).toContain('role="status"');
    expect(saved).toContain('Checkpoint saved for &quot;Coach&quot;');
  });

  it('announces a refused older export and a failed save', () => {
    const newer = renderToStaticMarkup(<BriefConfirmChat chat="Coach" canConfirm={false} status={{ kind: 'newer-saved' }} onConfirm={() => {}} />);
    expect(newer).toMatch(/role="status"[^>]*>A newer checkpoint is already saved for this chat\./);
    const failed = renderToStaticMarkup(<BriefConfirmChat chat="Coach" canConfirm={false} status={{ kind: 'not-saved' }} onConfirm={() => {}} />);
    expect(failed).toContain('Could not save the checkpoint on this device.');
  });
});
