import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HungerSection } from './HungerSection';

describe('HungerSection component (ADR-0039 D-BC-HUNGER)', () => {
  it('renders no prefilled score or timing and requires timing before rating', () => {
    const html = renderToStaticMarkup(
      <HungerSection
        hunger1To10={null}
        hungerTiming={null}
        onChange={() => {}}
      />
    );

    expect(html).toContain('Hunger Right Now');
    expect(html).toContain('1 = Not hungry at all');
    expect(html).toContain('5 = Moderate / typical');
    expect(html).toContain('10 = Extremely hungry');
    expect(html).toContain('Measurement Timing');
    expect(html).toContain('Morning (pre-breakfast)');
    expect(html).toContain('Other timing');
    expect(html).toContain('Choose timing context before rating');

    for (let i = 1; i <= 10; i++) {
      expect(html).toContain(`aria-label="Hunger ${i} of 10"`);
    }
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('aria-label="Clear hunger score"');
    expect(html).not.toContain('checked=""');
  });

  it('renders persisted timing and clear button when score is set', () => {
    const html = renderToStaticMarkup(
      <HungerSection
        hunger1To10={7}
        hungerTiming="morning_pre_breakfast"
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-label="Hunger 7 of 10"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Clear hunger score"');
    expect(html).toContain('Measurement Timing');
    expect(html).toContain('Morning (pre-breakfast)');
    expect(html).toContain('Other timing');
    expect(html).toContain('checked=""');
    expect(html).not.toContain('Choose timing context before rating');
  });
});
