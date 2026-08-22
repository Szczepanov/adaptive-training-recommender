import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthRunYogaPresetSection } from './HealthRunYogaPresetSection';
import { derivePresetOutcome } from '../../utils/healthRunYogaPreset';

// This repo has no interactive component-test harness (no @testing-library/react) --
// markup-level smoke test below, matching the existing convention for sibling components
// (GarminSyncNowButton.test.tsx). The outcome-selection logic that a review comment
// flagged (a failed post-apply refresh must not overwrite a full/partial preset-save
// message) is factored into the pure derivePresetOutcome() below and tested directly.

function fulfilled(): PromiseFulfilledResult<undefined> {
  return { status: 'fulfilled', value: undefined };
}

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: 'rejected', reason };
}

describe('HealthRunYogaPresetSection', () => {
  it('renders the apply button by default', () => {
    const html = renderToStaticMarkup(
      <HealthRunYogaPresetSection userId="u1" onApplied={async () => {}} />,
    );

    expect(html).toContain('Apply Health + Running + Yoga');
  });
});

describe('derivePresetOutcome', () => {
  it('reports full success when both writes fulfill and the refresh also succeeds', () => {
    const outcome = derivePresetOutcome([fulfilled(), fulfilled()], false);

    expect(outcome.failed).toBe(false);
    expect(outcome.text).toContain('applied');
    expect(outcome.text).not.toContain('Reload');
  });

  it('tells the user to reload when both writes fulfill but the refresh fails', () => {
    const outcome = derivePresetOutcome([fulfilled(), fulfilled()], true);

    expect(outcome.failed).toBe(false);
    expect(outcome.text).toContain('Reload');
  });

  it('reports a partial-save message when one write rejects, regardless of refresh outcome', () => {
    const withRefreshOk = derivePresetOutcome([fulfilled(), rejected(new Error('boom'))], false);
    const withRefreshFailed = derivePresetOutcome(
      [fulfilled(), rejected(new Error('boom'))],
      true,
    );

    for (const outcome of [withRefreshOk, withRefreshFailed]) {
      expect(outcome.failed).toBe(true);
      expect(outcome.text).toContain('only partly applied');
      expect(outcome.text).toContain('boom');
    }
  });

  it('reports full failure when both writes reject', () => {
    const outcome = derivePresetOutcome(
      [rejected(new Error('first')), rejected(new Error('second'))],
      false,
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.text).toBe('first');
  });

  it('falls back to a generic message when the rejection carries no readable detail', () => {
    const outcome = derivePresetOutcome([rejected(''), fulfilled()], false);

    expect(outcome.failed).toBe(true);
    expect(outcome.text).toContain('One preset save failed.');
  });
});
