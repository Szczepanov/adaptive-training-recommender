import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingWizard } from './OnboardingWizard';

describe('OnboardingWizard', () => {
  it('renders Step 1 welcome screen by default', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizard userId="athlete-1" onCompleted={() => {}} />
    );

    expect(html).toContain('Welcome to Adaptive Training');
    expect(html).toContain('Let&#x27;s Set Up Your Profile →');
  });

  it('renders Step 3 with exercise days slider (min 1, max 7) instead of session pill buttons', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizard userId="athlete-1" onCompleted={() => {}} initialStep={3} />
    );

    // Prompt & slider
    expect(html).toContain('How many days a week can you exercise?');
    expect(html).toContain('id="onboarding-days-slider"');
    expect(html).toContain('type="range"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="7"');
    expect(html).toContain('step="1"');

    // Default 4 days / week badge
    expect(html).toContain('4');
    expect(html).toContain('days / week');

    // Min and max scale tick markers
    expect(html).toContain('1 min');
    expect(html).toContain('7 max');

    // Old pill buttons are replaced
    expect(html).not.toContain('days-pill');
    expect(html).not.toContain('10 / week');
  });
});
