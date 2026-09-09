import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UserPreferences } from '../../engine/models';
import { SCREEN_LABELS } from '../../types/navigation';
import { ModalitySections } from './ModalitySections';
import { PreferencesHeader } from './PreferencesHeader';
import { StyleSections } from './StyleSections';

function buildPreferences(): UserPreferences {
  return {
    userId: 'test-user',
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 45,
    defaultWeekendTimeMin: 60,
    preferredTimeOfDay: 'flexible',
    preferredModalities: ['Running'],
    deprioritizedModalities: [],
    avoidedModalities: [],
    unavailableModalities: [],
    explanationVerbosity: 'detailed',
    conservativeBias: false,
    preferredUnits: {
      distance: 'km',
      weight: 'kg',
      temperature: 'celsius',
    },
    schemaVersion: 1,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  } as UserPreferences;
}

const noopHandlers = {
  addPreferredModality: () => undefined,
  removePreferredModality: () => undefined,
  addAvoidedModality: () => undefined,
  removeAvoidedModality: () => undefined,
  addUnavailableModality: () => undefined,
  removeUnavailableModality: () => undefined,
};

describe('Settings pairing cross-links (#489)', () => {
  it('ModalitySections links unavailable modalities to Training Setup equipment', () => {
    const html = renderToStaticMarkup(
      <ModalitySections preferences={buildPreferences()} onNavigate={() => undefined} {...noopHandlers} />,
    );

    expect(html).toContain('Unavailable Training Types');
    expect(html).toContain('Available equipment');
    expect(html).toContain(`Open ${SCREEN_LABELS.constraints}`);
  });

  it('ModalitySections omits the navigation button without onNavigate', () => {
    const html = renderToStaticMarkup(
      <ModalitySections preferences={buildPreferences()} {...noopHandlers} />,
    );

    expect(html).toContain('Available equipment');
    expect(html).not.toContain(`Open ${SCREEN_LABELS.constraints}`);
  });

  it('StyleSections links default durations to Training Setup time caps', () => {
    const html = renderToStaticMarkup(
      <StyleSections
        preferences={buildPreferences()}
        onNavigate={() => undefined}
        updatePreference={() => undefined}
        updateNestedPreference={() => undefined}
      />,
    );

    expect(html).toContain('Default Available Duration');
    expect(html).toContain('Time and location');
    expect(html).toContain(`Open ${SCREEN_LABELS.constraints}`);
  });

  it('PreferencesHeader states the explicit save model and hard-gate ownership', () => {
    const html = renderToStaticMarkup(<PreferencesHeader hasChanges={false} />);

    expect(html).toContain(SCREEN_LABELS.preferences);
    expect(html).toContain('Save Preferences');
    expect(html).toContain(SCREEN_LABELS.constraints);
  });
});
