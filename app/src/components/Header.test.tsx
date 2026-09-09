import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Screen } from '../types/navigation';
import { SCREEN_LABELS } from '../types/navigation';
import { PRIMARY_NAV_ITEMS } from './navigationGroups';
import { Header } from './Header';

function renderHeader(screen: Screen, desktopSettingsOpen = true): string {
  return renderToStaticMarkup(
    <Header
      screen={screen}
      handleNavigate={vi.fn()}
      loadDecisionInput={vi.fn()}
      desktopSettingsOpen={desktopSettingsOpen}
      setDesktopSettingsOpen={vi.fn()}
    />,
  );
}

describe('Header primary navigation', () => {
  it('promotes the shared daily-loop primaries with canonical labels', () => {
    const markup = renderHeader('home', false);

    for (const destination of PRIMARY_NAV_ITEMS) {
      expect(markup).toContain(`>${SCREEN_LABELS[destination.screen]}<`);
    }
    expect(markup).toContain('>More<');
  });

  it('does not promote secondary destinations to the top level', () => {
    const markup = renderHeader('home', false);

    expect(markup).not.toContain(`>${SCREEN_LABELS.sessions}<`);
    expect(markup).not.toContain(`>${SCREEN_LABELS.testing}<`);
    expect(markup).not.toContain(`>${SCREEN_LABELS.goals}<`);
    expect(markup).not.toContain(`>${SCREEN_LABELS.data}<`);
  });

  it('uses disclosure semantics for the More overflow and intent-labelled groups', () => {
    const markup = renderHeader('sessions');

    expect(markup).toContain('aria-controls="desktop-more-panel"');
    expect(markup).toContain('id="desktop-more-panel"');
    expect(markup).not.toContain('role="menu"');
    expect(markup).not.toContain('role="menuitem"');
    expect(markup).toContain('aria-labelledby="desktop-more-train-title"');
    expect(markup).toContain('aria-labelledby="desktop-more-configure-title"');
    expect(markup).toContain('aria-labelledby="desktop-more-understand-title"');
    expect(markup).toContain(`${SCREEN_LABELS.sessions}</button>`);
    expect(markup).toContain(`${SCREEN_LABELS.plan}</button>`);
    expect(markup).toContain(`${SCREEN_LABELS.brief}</button>`);
  });

  it('keeps the More button inactive on primary screens', () => {
    for (const { screen } of PRIMARY_NAV_ITEMS) {
      const markup = renderHeader(screen, false);
      expect(markup).not.toContain('nav-link more-btn active');
    }
  });

  it('marks the More button active on overflow screens with exact current-page state', () => {
    const markup = renderHeader('sessions');

    expect(markup).toContain('nav-link more-btn active');
    expect(markup).toMatch(/class="dropdown-item active"[^>]*aria-current="page"[^>]*>.*?Sessions/s);
  });

  it('keeps Plan current in both the primary set and the Train group', () => {
    const markup = renderHeader('plan');

    expect(markup.match(/aria-current="page"/g)).toHaveLength(2);
    expect(markup).toMatch(/class="nav-link active"[^>]*aria-current="page"[^>]*>.*?Plan/s);
    expect(markup).toMatch(/class="dropdown-item active"[^>]*aria-current="page"[^>]*>.*?Plan/s);
  });
});
