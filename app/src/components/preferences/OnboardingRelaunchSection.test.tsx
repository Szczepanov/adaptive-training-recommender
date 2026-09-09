import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingRelaunchSection } from './OnboardingRelaunchSection';

// Markup-level smoke tests, matching the sibling-section convention: the relaunch
// affordance must be discoverable without allowing a reload to discard pending edits.
describe('OnboardingRelaunchSection', () => {
  it('renders the re-run entry with goal-less gating copy', () => {
    const html = renderToStaticMarkup(
      <OnboardingRelaunchSection userId="u1" />,
    );

    expect(html).toContain('Re-run setup wizard');
    expect(html).toContain('no active goal');
    expect(html).not.toContain('disabled=""');
  });

  it('disables relaunch while Coach Preferences has unsaved changes', () => {
    const html = renderToStaticMarkup(
      <OnboardingRelaunchSection userId="u1" disabled />,
    );

    expect(html).toContain('Save or reset your pending Coach Preferences changes');
    expect(html).toContain('disabled=""');
  });
});
