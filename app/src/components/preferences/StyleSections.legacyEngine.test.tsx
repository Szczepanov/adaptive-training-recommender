import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UserPreferences } from '../../engine/models';
import { StyleSections } from './StyleSections';

function buildPreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
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
    ...overrides,
  } as UserPreferences;
}

function findButtonByAriaLabel(node: ReactNode, label: string): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (node.type === 'button' && props['aria-label'] === label) {
    return node as ReactElement<Record<string, unknown>>;
  }
  const children = props.children as ReactNode;
  for (const child of Children.toArray(children)) {
    const found = findButtonByAriaLabel(child, label);
    if (found) return found;
  }
  return null;
}

describe('StyleSections Advanced: legacy engine recommendations toggle (P2-8, OQ5)', () => {
  it('reads effective state (unset/false vs true) and states D-EVAL block termination', () => {
    for (const [value, expectedPressed] of [
      [undefined, 'false'],
      [false, 'false'],
      [true, 'true'],
    ] as const) {
      const html = renderToStaticMarkup(
        <StyleSections
          preferences={buildPreferences(value === undefined ? {} : { engineRecommendationsEnabled: value })}
          updatePreference={() => undefined}
          updateNestedPreference={() => undefined}
        />,
      );

      expect(html).toContain('Advanced: legacy engine recommendations');
      expect(html).toContain('Turning it on during a D-EVAL block ends the block');
      expect(html).toContain('aria-label="Toggle legacy engine recommendations"');
      expect(html).toContain(`aria-pressed="${expectedPressed}"`);
    }
  });

  it('calls updatePreference with engineRecommendationsEnabled: true when off/unset and false when on', () => {
    const updatePreference = vi.fn();

    const unsetTree = StyleSections({
      preferences: buildPreferences(),
      updatePreference,
      updateNestedPreference: () => undefined,
    });
    const unsetButton = findButtonByAriaLabel(unsetTree, 'Toggle legacy engine recommendations');
    expect(unsetButton).not.toBeNull();
    (unsetButton!.props.onClick as () => void)();
    expect(updatePreference).toHaveBeenNthCalledWith(1, 'engineRecommendationsEnabled', true);

    const falseTree = StyleSections({
      preferences: buildPreferences({ engineRecommendationsEnabled: false }),
      updatePreference,
      updateNestedPreference: () => undefined,
    });
    const falseButton = findButtonByAriaLabel(falseTree, 'Toggle legacy engine recommendations');
    (falseButton!.props.onClick as () => void)();
    expect(updatePreference).toHaveBeenNthCalledWith(2, 'engineRecommendationsEnabled', true);

    const trueTree = StyleSections({
      preferences: buildPreferences({ engineRecommendationsEnabled: true }),
      updatePreference,
      updateNestedPreference: () => undefined,
    });
    const trueButton = findButtonByAriaLabel(trueTree, 'Toggle legacy engine recommendations');
    (trueButton!.props.onClick as () => void)();
    expect(updatePreference).toHaveBeenNthCalledWith(3, 'engineRecommendationsEnabled', false);
  });
});
