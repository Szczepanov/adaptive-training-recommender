import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Screen } from '../types/navigation';
import { SCREEN_LABELS } from '../types/navigation';
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
  it('promotes the daily-loop primaries with canonical labels', () => {
    const markup = renderHeader('home', false);

    expect(markup).toContain(`>${SCREEN_LABELS.home}<`);
    expect(markup).toContain(`>${SCREEN_LABELS.checkin}<`);
    expect(markup).toContain(`>${SCREEN_LABELS.plan}<`);
    expect(markup).toContain('>More<');
  });

  it('does not promote secondary destinations to the top level', () => {
    const markup = renderHeader('home', false);

    expect(markup).not.toContain(`>${SCREEN_LABELS.sessions}<`);
    expect(markup).not.toContain(`>${SCREEN_LABELS.testing}<`);
    expect(markup).not.toContain(`>${SCREEN_LABELS.goals}<`);
    expect(markup).not.toContain(`>${SCREEN_LABELS.data}<`);
  });

  it('groups the More overflow by intent like the mobile drawer', () => {
    const markup = renderHeader('sessions');

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('aria-label="More"');
    expect(markup).toContain('>Train<');
    expect(markup).toContain('>Configure<');
    expect(markup).toContain('>Understand<');
    expect(markup).toContain(`${SCREEN_LABELS.sessions}</button>`);
    expect(markup).toContain(`${SCREEN_LABELS.plan}</button>`);
    expect(markup).toContain(`${SCREEN_LABELS.brief}</button>`);
  });

  it('keeps the More button inactive on primary screens', () => {
    for (const screen of ['home', 'checkin', 'plan'] as const) {
      const markup = renderHeader(screen, false);
      expect(markup).not.toContain('nav-link more-btn active');
    }
  });

  it('marks the More button active on overflow screens with exact item state', () => {
    const markup = renderHeader('sessions');

    expect(markup).toContain('nav-link more-btn active');
    expect(markup).toMatch(/class="dropdown-item active"[^>]*>.*?Sessions/s);
  });

  it('keeps Plan current in both the primary set and the Train group', () => {
    const markup = renderHeader('plan');

    expect(markup).toMatch(/class="nav-link active"[^>]*>.*?Plan/s);
    expect(markup).toMatch(/class="dropdown-item active"[^>]*>.*?Plan/s);
  });
});
