import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefFullContextToggle } from './BriefFullContextToggle';
import { BriefPresetToggle } from './BriefPresetToggle';

// No DOM harness in app/: the toggles are checked through their rendered markup.
describe('BriefFullContextToggle', () => {
  it('is an ordinary opt-in checkbox for the morning export', () => {
    const html = renderToStaticMarkup(<BriefFullContextToggle checked={false} onChange={() => {}} />);
    expect(html).toContain('Include full context');
    expect(html).not.toContain('checked');
    expect(html).not.toContain('disabled');
  });

  it('is fixed on for the new-chat refresh export', () => {
    const html = renderToStaticMarkup(<BriefFullContextToggle checked={false} onChange={() => {}} locked />);
    expect(html).toContain('checked');
    expect(html).toContain('disabled');
    expect(html).toContain('Include full context (always, for a new chat)');
  });
});

describe('BriefPresetToggle new-chat label', () => {
  it('labels the planning preset as the export for a new chat', () => {
    const html = renderToStaticMarkup(<BriefPresetToggle preset="full" onSelect={() => {}} />);
    expect(html).toMatch(/Block Planning · new chat \(\d+ days\)/);
  });
});
