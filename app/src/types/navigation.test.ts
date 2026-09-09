import { describe, expect, it } from 'vitest';
import { SCREEN_LABELS } from './navigation';
import type { Screen } from './navigation';

describe('SCREEN_LABELS', () => {
  it('keeps the constraints screen identifier separate from its user-facing label', () => {
    const screen: Screen = 'constraints';

    expect(screen).toBe('constraints');
    expect(SCREEN_LABELS[screen]).toBe('Training Setup');
  });
});
