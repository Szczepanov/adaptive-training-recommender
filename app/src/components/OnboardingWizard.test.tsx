import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExerciseDaysSlider, OnboardingWizard } from './OnboardingWizard';
import { weeklyCommitmentFromExerciseDays } from './onboarding/weeklyCommitment';

describe('OnboardingWizard', () => {
  it('renders Step 1 welcome screen by default', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizard userId="athlete-1" onCompleted={() => {}} />
    );

    expect(html).toContain('Welcome to Adaptive Training');
    expect(html).toContain('Let&#x27;s Set Up Your Profile →');
  });
});

describe('ExerciseDaysSlider', () => {
  it('renders a native 1-7 day range with an associated visible label', () => {
    const html = renderToStaticMarkup(
      <ExerciseDaysSlider value={4} onChange={() => {}} />
    );

    expect(html).toContain('How many days a week can you exercise?');
    expect(html).toContain('for="onboarding-days-slider"');
    expect(html).toContain('id="onboarding-days-slider"');
    expect(html).toContain('type="range"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="7"');
    expect(html).toContain('step="1"');
    expect(html).toContain('4');
    expect(html).toContain('days / week');
    expect(html).toContain('1 day');
    expect(html).toContain('7 days');
    expect(html).not.toContain('aria-label="How many days a week can you exercise"');
    expect(html).not.toContain('days-pill');
    expect(html).not.toContain('10 / week');
  });

  it('uses singular day copy at the lower bound', () => {
    const html = renderToStaticMarkup(
      <ExerciseDaysSlider value={1} onChange={() => {}} />
    );

    expect(html).toContain('<strong>1</strong> day / week');
  });
});

describe('weeklyCommitmentFromExerciseDays', () => {
  it('maps available days onto the session-based planning contract with one-session flexibility', () => {
    expect(weeklyCommitmentFromExerciseDays(1)).toEqual({
      minSessions: 1,
      targetSessions: 1,
      maxSessions: 2,
    });
    expect(weeklyCommitmentFromExerciseDays(4)).toEqual({
      minSessions: 3,
      targetSessions: 4,
      maxSessions: 5,
    });
    expect(weeklyCommitmentFromExerciseDays(7)).toEqual({
      minSessions: 6,
      targetSessions: 7,
      maxSessions: 8,
    });
  });

  it('defensively clamps non-slider inputs to the supported 1-7 day range', () => {
    expect(weeklyCommitmentFromExerciseDays(0).targetSessions).toBe(1);
    expect(weeklyCommitmentFromExerciseDays(9).targetSessions).toBe(7);
  });
});
