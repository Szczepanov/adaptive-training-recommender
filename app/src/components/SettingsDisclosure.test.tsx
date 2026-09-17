import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsDisclosure } from './SettingsDisclosure';

describe('SettingsDisclosure', () => {
  it('keeps non-safety sections collapsed by default', () => {
    const html = renderToStaticMarkup(
      <SettingsDisclosure title="Recovery preferences" titleId="preferences-title">
        <p>Preference content</p>
      </SettingsDisclosure>,
    );

    expect(html).toContain('<details class="settings-disclosure">');
    expect(html).toContain('<summary id="preferences-title"><h2>Recovery preferences</h2></summary>');
    expect(html).not.toContain(' open');
    expect(html).toContain('Preference content');
  });

  it('opens safety limits by default', () => {
    const html = renderToStaticMarkup(
      <SettingsDisclosure title="Safety limits" titleId="guardrails-title" defaultOpen>
        <p>Guardrail content</p>
      </SettingsDisclosure>,
    );

    expect(html).toContain('<details class="settings-disclosure" open="">');
    expect(html).toContain('<summary id="guardrails-title"><h2>Safety limits</h2></summary>');
  });

  it('exposes the title as a heading for screen-reader navigation, not just summary text', () => {
    const html = renderToStaticMarkup(
      <SettingsDisclosure title="Equipment" titleId="equipment-title">
        <p>Equipment content</p>
      </SettingsDisclosure>,
    );

    expect(html).toContain('<h2>Equipment</h2>');
  });
});
