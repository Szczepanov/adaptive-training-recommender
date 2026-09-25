import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { BriefPresetToggle } from './BriefPresetToggle';
import {
  BRIEF_PRESET_STORAGE_KEY,
  buildBriefForPreset,
  loadStoredBriefPreset,
  persistBriefPreset,
} from './briefPreset';
import type { BriefWindowPreset } from '../engine/contextBrief';

vi.mock('../services/contextBriefService', () => ({
  contextBriefService: { build: vi.fn() },
}));

// This repo has no DOM component-test harness (no jsdom / @testing-library), so the
// toggle is exercised by rendering markup and by invoking the rendered buttons' onClick
// handlers directly; the effect-side wiring goes through the same exported helpers
// DataView calls.
type ButtonElement = ReactElement<{ onClick: () => void; children: string; 'aria-pressed': boolean }>;

function buttons(preset: BriefWindowPreset, onSelect: (p: BriefWindowPreset) => void): ButtonElement[] {
  const group = BriefPresetToggle({ preset, onSelect }) as ReactElement<{ children: ButtonElement[] }>;
  return group.props.children;
}

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BriefPresetToggle (#811)', () => {
  it('marks exactly the active purpose with aria-pressed', () => {
    const html = renderToStaticMarkup(<BriefPresetToggle preset="diagnostic" onSelect={() => {}} />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true">🔬 Diagnostic \(14 days\)/);
  });

  it('selecting Diagnostic persists it and builds the diagnostic brief over the 14-day window', async () => {
    const store = stubStorage();
    const build = vi.fn(async () => ({}) as never);
    let selected: BriefWindowPreset | null = null;
    const diagnostic = buttons('daily', preset => {
      selected = preset;
      persistBriefPreset(preset);
    }).find(button => String(button.props.children).includes('Diagnostic'))!;

    diagnostic.props.onClick();
    expect(selected).toBe('diagnostic');
    expect(store.get(BRIEF_PRESET_STORAGE_KEY)).toBe('diagnostic');
    expect(loadStoredBriefPreset()).toBe('diagnostic');

    await buildBriefForPreset('u1', '2026-08-20', loadStoredBriefPreset(), { build });
    expect(build).toHaveBeenCalledWith('u1', '2026-08-20', 14, 'diagnostic');
  });

  it('falls back to daily for an unknown stored value', () => {
    const store = stubStorage();
    store.set(BRIEF_PRESET_STORAGE_KEY, 'weekly');
    expect(loadStoredBriefPreset()).toBe('daily');
  });
});
