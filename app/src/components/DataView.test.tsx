import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataView } from './DataView';

describe('DataView null-input empty state', () => {
  it('offers retry and a way home instead of a dead-end banner (#493)', () => {
    const html = renderToStaticMarkup(
      <DataView decisionInput={null} userId="athlete-1" onBack={() => {}} onRetry={() => {}} />,
    );

    expect(html).toContain('No data available');
    expect(html).toContain('Retry');
    expect(html).toContain('Back to Home');
  });

  it('still offers a way home when no retry handler is injected (#493)', () => {
    const html = renderToStaticMarkup(
      <DataView decisionInput={null} userId="athlete-1" onBack={() => {}} />,
    );

    expect(html).toContain('No data available');
    expect(html).toContain('Back to Home');
    // No retry button without an injected handler (the guidance copy may still
    // name the dashboard refresh as the recourse).
    expect(html).not.toContain('>Retry<');
  });
});
