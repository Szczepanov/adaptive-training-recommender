import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExerciseDaysSlider, OnboardingWizard } from './OnboardingWizard';
import { skipOnboardingForNow } from './onboarding/skipOnboarding';
import { weeklyCommitmentFromExerciseDays } from './onboarding/weeklyCommitment';
import { goalService } from '../services/goalService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { trainingIntentProfileService } from '../services/trainingIntentProfileService';
import { getOnboardingDoneStorageKey } from '../utils/onboardingStorage';
import { usabilityMetrics } from '../utils/usabilityMetrics';

describe('OnboardingWizard', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, String(value)),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    usabilityMetrics.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    usabilityMetrics.clear();
  });

  it('renders Step 1 welcome screen by default', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizard userId="athlete-1" onCompleted={() => {}} />
    );

    expect(html).toContain('Welcome to Adaptive Training');
    expect(html).toContain('Let&#x27;s Set Up Your Profile →');
  });

  it('offers an explicit Skip path on the welcome step without starting setup', () => {
    const html = renderToStaticMarkup(
      <OnboardingWizard userId="athlete-1" onCompleted={() => {}} />
    );

    expect(html).toContain('Skip for now');
  });

  it('dismisses and records Skip without writing settings, intent, or goals', () => {
    const settingsWrite = vi.spyOn(trainingSettingsService, 'updateTrainingSettings');
    const intentWrite = vi.spyOn(trainingIntentProfileService, 'upsert');
    const goalList = vi.spyOn(goalService, 'listGoals');
    const goalWrite = vi.spyOn(goalService, 'createGoal');
    const onCompleted = vi.fn();

    const persisted = skipOnboardingForNow('athlete-1', 'focus', 1500, onCompleted);

    expect(persisted).toBe(true);
    expect(settingsWrite).not.toHaveBeenCalled();
    expect(intentWrite).not.toHaveBeenCalled();
    expect(goalList).not.toHaveBeenCalled();
    expect(goalWrite).not.toHaveBeenCalled();
    expect(storage.get(getOnboardingDoneStorageKey('athlete-1'))).toBe('true');
    expect(onCompleted).toHaveBeenCalledTimes(1);

    const report = usabilityMetrics.generateSummaryReport();
    expect(report.wizardSkips).toBe(1);
    expect(report.wizardSkipsByStage).toEqual({ focus: 1 });
  });

  it('reports a blocked dismissal so the wizard can show storage-blocked guidance (#493)', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error('blocked'); },
        removeItem: () => {},
      },
    });
    const onCompleted = vi.fn();

    const persisted = skipOnboardingForNow('athlete-1', 'welcome', 500, onCompleted);

    expect(persisted).toBe(false);
    // Telemetry still records the skip; the caller decides whether to dismiss.
    expect(onCompleted).toHaveBeenCalledTimes(1);
    const report = usabilityMetrics.generateSummaryReport();
    expect(report.wizardSkips).toBe(1);
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
