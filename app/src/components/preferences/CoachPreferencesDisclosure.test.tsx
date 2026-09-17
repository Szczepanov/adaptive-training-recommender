import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UserPreferences } from '../../engine/models';
import { GarminConnectionSection } from './GarminConnectionSection';
import { GoogleHealthConnectionSection } from './GoogleHealthConnectionSection';
import { HealthRunYogaPresetSection } from './HealthRunYogaPresetSection';
import { OnboardingRelaunchSection } from './OnboardingRelaunchSection';
import { ModalitySections } from './ModalitySections';
import { PerformanceSections } from './PerformanceSections';
import { StyleSections } from './StyleSections';
import { TrainingPlanSection } from './TrainingPlanSection';
import type { TrainingIntentProfileDraft } from './usePreferences';

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

function buildTrainingIntentProfile(): TrainingIntentProfileDraft {
  return {
    planningMode: 'evergreen',
    priorities: [],
    weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
  } as unknown as TrainingIntentProfileDraft;
}

const noopModalityHandlers = {
  addPreferredModality: () => undefined,
  removePreferredModality: () => undefined,
  addAvoidedModality: () => undefined,
  removeAvoidedModality: () => undefined,
  addUnavailableModality: () => undefined,
  removeUnavailableModality: () => undefined,
};

function expectDisclosure(html: string, titleId: string, title: string, defaultOpen = false) {
  const summary = `<summary id="${titleId}"><h2>${title}</h2></summary>`;
  const summaryIndex = html.indexOf(summary);
  expect(summaryIndex).toBeGreaterThan(-1);

  const detailsStart = html.lastIndexOf('<details', summaryIndex);
  const detailsEnd = html.indexOf('>', detailsStart);
  expect(detailsStart).toBeGreaterThan(-1);
  expect(detailsEnd).toBeGreaterThan(detailsStart);

  const openingTag = html.slice(detailsStart, detailsEnd + 1);
  expect(openingTag).toContain('class="settings-disclosure"');
  if (defaultOpen) {
    expect(openingTag).toContain('open=""');
  } else {
    expect(openingTag).not.toContain('open=""');
  }
}

// Coach Preferences never adopted the SettingsDisclosure treatment #589/#620 gave its
// sibling Training Setup page (issue #623), so it rendered as one long, fully-expanded
// page. These assert every section component now collapses behind a <details> summary,
// with only the hard-exclusion section (mirroring Training Setup's "Safety limits")
// defaulting open.
describe('Coach Preferences progressive disclosure (#623)', () => {
  it('collapses Garmin, Google Health, Quick setup, and Setup wizard by default', () => {
    const garmin = renderToStaticMarkup(<GarminConnectionSection userId="u1" />);
    const googleHealth = renderToStaticMarkup(<GoogleHealthConnectionSection userId="u1" />);
    const quickSetup = renderToStaticMarkup(<HealthRunYogaPresetSection userId="u1" onApplied={async () => undefined} />);
    const setupWizard = renderToStaticMarkup(<OnboardingRelaunchSection userId="u1" />);

    expectDisclosure(garmin, 'garmin-connection-title', 'Garmin wearable');
    expectDisclosure(googleHealth, 'google-health-title', 'Google Health');
    expectDisclosure(quickSetup, 'quick-setup-title', 'Quick setup');
    expectDisclosure(setupWizard, 'setup-wizard-title', 'Setup wizard');
  });

  it('collapses Training Plan by default', () => {
    const html = renderToStaticMarkup(
      <TrainingPlanSection
        trainingIntentProfile={buildTrainingIntentProfile()}
        updateTrainingIntentProfile={() => undefined}
        toggleTrainingPriority={() => undefined}
        moveTrainingPriority={() => undefined}
        updateWeeklyCommitment={() => undefined}
      />,
    );

    expectDisclosure(html, 'training-plan-title', 'Training Plan');
  });

  it('opens Unavailable Training Types by default while its soft-preference siblings stay collapsed', () => {
    const html = renderToStaticMarkup(
      <ModalitySections preferences={buildPreferences()} {...noopModalityHandlers} />,
    );

    expectDisclosure(html, 'modality-preferred-title', 'Training I Enjoy');
    expectDisclosure(html, 'modality-unavailable-title', 'Unavailable Training Types', true);
    expectDisclosure(html, 'modality-avoided-title', 'Training I&#x27;d Rather Avoid');
  });

  it('collapses every Style section by default', () => {
    const html = renderToStaticMarkup(
      <StyleSections
        preferences={buildPreferences()}
        updatePreference={() => undefined}
        updateNestedPreference={() => undefined}
      />,
    );

    for (const [titleId, title] of [
      ['style-decision-title', 'Training Decision Style'],
      ['style-journal-title', 'Decision Journal'],
      ['style-recovery-title', 'Recovery Day Style'],
      ['style-duration-title', 'Default Available Duration'],
      ['style-time-of-day-title', 'Preferred Time of Day'],
      ['style-explanation-title', 'Explanation Detail'],
      ['style-units-title', 'Units of Measurement'],
    ] as const) {
      expectDisclosure(html, titleId, title);
    }
  });

  it('collapses every Performance section, including conditional Garmin sections, by default', () => {
    const preferences = {
      ...buildPreferences(),
      gearTracker: {
        items: [{
          gearPk: 'shoe-1',
          displayName: 'Test shoe',
          totalDistanceKm: 100,
          status: 'active',
        }],
      },
      performanceProfile: {
        racePredictions: { fiveKmSec: 1200 },
      },
    } as unknown as UserPreferences;

    const html = renderToStaticMarkup(
      <PerformanceSections
        preferences={preferences}
        updateCapability={() => undefined}
        updatePerformanceProfile={() => undefined}
        updateEstimated1Rm={() => undefined}
      />,
    );

    for (const [titleId, title] of [
      ['performance-biometrics-title', 'Body Composition &amp; Biometrics'],
      ['performance-devices-title', 'Measurement Devices &amp; Equipment'],
      ['performance-targets-title', 'Training Targets'],
      ['performance-gear-title', 'Shoes &amp; Equipment Mileage'],
      ['performance-race-predictions-title', 'Garmin Race Predictions'],
    ] as const) {
      expectDisclosure(html, titleId, title);
    }
  });
});
