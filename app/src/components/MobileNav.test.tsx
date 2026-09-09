import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Screen } from '../types/navigation';
import { MobileNav } from './MobileNav';

function renderNav(screen: Screen): string {
  return renderToStaticMarkup(
    <MobileNav
      screen={screen}
      handleNavigate={vi.fn()}
      loadDecisionInput={vi.fn()}
      mobileMoreOpen
      setMobileMoreOpen={vi.fn()}
    />,
  );
}

describe('MobileNav More drawer', () => {
  it('renders the three intent groups with programmatic labels and descriptions', () => {
    const markup = renderNav('sessions');

    expect(markup.match(/role="group"/g)).toHaveLength(3);
    expect(markup).toContain('aria-labelledby="mobile-more-train-title"');
    expect(markup).toContain('aria-labelledby="mobile-more-configure-title"');
    expect(markup).toContain('aria-labelledby="mobile-more-understand-title"');
    expect(markup).toContain('class="drawer-group-description">Sessions, assessments, and the week-ahead plan</span>');
    expect(markup).toContain('class="drawer-group-description">Goals, setup, and coaching preferences</span>');
    expect(markup).toContain('class="drawer-group-description">Data review and AI context export</span>');
  });

  it('exposes the selected drawer destination as the current page', () => {
    const markup = renderNav('sessions');

    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toMatch(/class="drawer-item active" aria-current="page"[^>]*>.*?Sessions/s);
  });

  it('keeps Plan current in both the primary tab set and the Train group', () => {
    const markup = renderNav('plan');

    expect(markup.match(/aria-current="page"/g)).toHaveLength(2);
    expect(markup).toMatch(/class="nav-item active"[^>]*aria-current="page"[^>]*>.*?Plan/s);
    expect(markup).toMatch(/class="drawer-item active" aria-current="page"[^>]*>.*?Plan/s);
  });
});
