import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingRelaunchSection } from './OnboardingRelaunchSection';

// Markup-level smoke test, matching the sibling-section convention: the relaunch
// affordance must be discoverable on the Preferences surface for skipped users.
describe('OnboardingRelaunchSection', () => {
  it('renders the re-run entry with goal-less gating copy', () => {
    const html = renderToStaticMarkup(
      <OnboardingRelaunchSection userId="u1" />,
    );

    expect(html).toContain('Re-run setup wizard');
    expect(html).toContain('no active goal');
  });
});
