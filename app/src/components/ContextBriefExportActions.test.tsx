import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextBriefExportActions } from './ContextBriefExportActions';

describe('ContextBriefExportActions', () => {
  it('offers clipboard, Markdown, and JSON export actions', () => {
    const html = renderToStaticMarkup(
      <ContextBriefExportActions
        copied={false}
        onCopy={() => {}}
        onDownloadMarkdown={() => {}}
        onDownloadJson={() => {}}
      />,
    );

    expect(html).toContain('Copy to clipboard');
    expect(html).toContain('Download Markdown');
    expect(html).toContain('Download JSON');
    expect(html.match(/type="button"/g)).toHaveLength(3);
  });

  it('shows clipboard confirmation without changing file actions', () => {
    const html = renderToStaticMarkup(
      <ContextBriefExportActions
        copied
        onCopy={() => {}}
        onDownloadMarkdown={() => {}}
        onDownloadJson={() => {}}
      />,
    );

    expect(html).toContain('Copied');
    expect(html).toContain('Download Markdown');
    expect(html).toContain('Download JSON');
  });

  it('disables Copy and Download Markdown, not JSON, while the brief is rebuilding', () => {
    const html = renderToStaticMarkup(
      <ContextBriefExportActions
        copied={false}
        markdownDisabled
        onCopy={() => {}}
        onDownloadMarkdown={() => {}}
        onDownloadJson={() => {}}
      />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toMatch(/disabled="" class="brief-copy">|class="brief-copy" disabled=""/);
  });
});
