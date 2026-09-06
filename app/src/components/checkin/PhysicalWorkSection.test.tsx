import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PhysicalWorkSection } from './PhysicalWorkSection';
import type { PhysicalWorkCheckin } from '../../engine/models';

describe('PhysicalWorkSection', () => {
  it('renders collapsed checkbox when physical work is not reported', () => {
    const html = renderToStaticMarkup(
      <PhysicalWorkSection value={undefined} onChange={vi.fn()} />,
    );

    expect(html).toContain('Unlogged Physical Work / Manual Labor (Yesterday)');
    expect(html).not.toContain('physical-work-details');
    expect(html).not.toContain('Work duration');
    expect(html).not.toContain('Main strain areas');
  });

  it('renders expanded card with options when physical work is performed', () => {
    const value: PhysicalWorkCheckin = {
      performed: true,
      duration: 'medium',
      intensity: 'hard',
      loadAreas: ['grip_forearms', 'lower_back_spine'],
      notes: 'Cutting trees in the morning',
    };

    const html = renderToStaticMarkup(
      <PhysicalWorkSection value={value} onChange={vi.fn()} />,
    );

    expect(html).toContain('physical-work-details');
    expect(html).toContain('Wearables miss isometric grip');
    expect(html).toContain('&lt; 1 hr');
    expect(html).toContain('1–3 hrs');
    expect(html).toContain('3+ hrs');
    expect(html).toContain('Moderate');
    expect(html).toContain('Hard');
    expect(html).toContain('Exhausting');
    expect(html).toContain('Grip &amp; Forearms');
    expect(html).toContain('Lower Back &amp; Spine');
    expect(html).toContain('Cutting trees in the morning');

    // Check selected aria-pressed state
    expect(html).toContain('aria-pressed="true">1–3 hrs</button>');
    expect(html).toContain('aria-pressed="true">Hard</button>');
    expect(html).toContain('aria-pressed="true">Grip &amp; Forearms</button>');
    expect(html).toContain('aria-pressed="true">Lower Back &amp; Spine</button>');
    expect(html).toContain('aria-pressed="false">Legs &amp; Carrying</button>');
  });

  it('renders single selected load area with aria-pressed', () => {
    const value: PhysicalWorkCheckin = {
      performed: true,
      duration: 'short',
      intensity: 'moderate',
      loadAreas: ['lower_back_spine'],
    };

    const html = renderToStaticMarkup(
      <PhysicalWorkSection value={value} onChange={vi.fn()} />,
    );

    expect(html).toContain('aria-pressed="true">Lower Back &amp; Spine</button>');
    expect(html).toContain('aria-pressed="false">Grip &amp; Forearms</button>');
  });
});
