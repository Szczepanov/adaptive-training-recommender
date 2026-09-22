import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RegionTissueResponse } from '../../engine/models';
import { TissueResponseSection } from './TissueResponseSection';

const baseProps = {
  tissueSelectId: 'tissue-region',
  pendingTissueRegion: '' as const,
  onPendingTissueRegionChange: vi.fn(),
  open: false,
  onOpenChange: vi.fn(),
  availableBodyRegions: ['knee', 'shoulder'] as Array<'knee' | 'shoulder'>,
  tissueResponses: [],
  onAddTissueRegion: vi.fn(),
  onRemoveTissueRegion: vi.fn(),
  onTissueFieldChange: vi.fn(),
};

describe('TissueResponseSection', () => {
  it('keeps optional local tissue detail collapsed when no area is selected', () => {
    const html = renderToStaticMarkup(<TissueResponseSection {...baseProps} />);

    expect(html).toContain('Local tissue response');
    expect(html).toContain('Optional');
    expect(html).not.toContain('tissue-region-card');
    expect(html).toContain('No local tissue issue reported today.');
  });

  it('reopens saved areas and renders their structured response fields', () => {
    const savedResponse: RegionTissueResponse = {
      region: 'knee',
      morningState: 'moderate',
      nextMorningReaction: 'mild',
    };

    const html = renderToStaticMarkup(
      <TissueResponseSection
        {...baseProps}
        open
        tissueResponses={[savedResponse]}
      />,
    );

    expect(html).toContain('<details class="tissue-response-expanded tissue-response-disclosure" open="">');
    expect(html).toContain('1 area reported');
    expect(html).toContain('Knee');
    expect(html).toContain('Moderate');
    expect(html).toContain('Reaction to yesterday&#x27;s session');
  });
});
