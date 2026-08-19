import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SubjectiveScaleRow } from './SubjectiveScaleRow';

describe('SubjectiveScaleRow', () => {
  it('renders label, accessible description, endpoint labels and value badge', () => {
    const html = renderToStaticMarkup(
      <SubjectiveScaleRow
        id="fatigue"
        label="Physical Fatigue"
        desc="How much physical fatigue do you feel?"
        value={4}
        lowLabel="1 Fresh"
        highLabel="10 Exhausted"
        isInverted={true}
        onChange={() => {}}
      />
    );

    expect(html).toContain('Physical Fatigue');
    expect(html).toContain('aria-description="How much physical fatigue do you feel?"');
    expect(html).toContain('1 Fresh');
    expect(html).toContain('10 Exhausted');
    expect(html).toContain('4');
    expect(html).toContain('status-normal');
  });

  it('renders warning status for elevated inverted scale value', () => {
    const html = renderToStaticMarkup(
      <SubjectiveScaleRow
        id="soreness"
        label="Muscle Soreness"
        value={7}
        lowLabel="1 None"
        highLabel="10 Severe"
        isInverted={true}
        onChange={() => {}}
      />
    );

    expect(html).toContain('Muscle Soreness');
    expect(html).toContain('status-warning');
  });

  it('renders standard non-inverted scale with slider input attributes', () => {
    const html = renderToStaticMarkup(
      <SubjectiveScaleRow
        id="readiness"
        label="Overall Readiness"
        value={8}
        lowLabel="1 Not ready"
        highLabel="10 Fully ready"
        onChange={() => {}}
      />
    );

    expect(html).toContain('Overall Readiness');
    expect(html).toContain('value="8"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="10"');
    expect(html).toContain('status-normal');
  });
});
