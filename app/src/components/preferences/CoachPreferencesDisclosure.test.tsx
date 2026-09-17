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

    for (const html of [garmin, googleHealth, quickSetup, setupWizard]) {
      expect(html).toContain('<details class="settings-disclosure">');
      expect(html).not.toContain('<details class="settings-disclosure" open');
    }
    expect(garmin).toContain('<summary id="garmin-connection-title">Garmin wearable</summary>');
    expect(googleHealth).toContain('<summary id="google-health-title">Google Health</summary>');
    expect(quickSetup).toContain('<summary id="quick-setup-title">Quick setup</summary>');
    expect(setupWizard).toContain('<summary id="setup-wizard-title">Setup wizard</summary>');
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

    expect(html).toContain('<details class="settings-disclosure">');
    expect(html).toContain('<summary id="training-plan-title">Training Plan</summary>');
  });

  it('opens Unavailable Training Types by default (the hard-exclusion gate) while its siblings stay collapsed', () => {
    const html = renderToStaticMarkup(
      <ModalitySections preferences={buildPreferences()} {...noopModalityHandlers} />,
    );

    expect(html).toContain('<summary id="modality-unavailable-title">Unavailable Training Types</summary>');
    const unavailableIndex = html.indexOf('modality-unavailable-title');
    const detailsStart = html.lastIndexOf('<details', unavailableIndex);
    expect(html.slice(detailsStart, unavailableIndex)).toContain('open=""');

    expect(html).toContain('<summary id="modality-preferred-title">Training I Enjoy</summary>');
    expect(html).toContain('<summary id="modality-avoided-title">Training I&#x27;d Rather Avoid</summary>');
    const preferredIndex = html.indexOf('modality-preferred-title');
    const preferredDetailsStart = html.lastIndexOf('<details', preferredIndex);
    expect(html.slice(preferredDetailsStart, preferredIndex)).not.toContain('open=""');
  });

  it('collapses every Style section by default', () => {
    const html = renderToStaticMarkup(
      <StyleSections
        preferences={buildPreferences()}
        updatePreference={() => undefined}
        updateNestedPreference={() => undefined}
      />,
    );

    for (const titleId of [
      'style-decision-title', 'style-journal-title', 'style-recovery-title',
      'style-duration-title', 'style-time-of-day-title', 'style-explanation-title', 'style-units-title',
    ]) {
      const index = html.indexOf(titleId);
      expect(index).toBeGreaterThan(-1);
      const detailsStart = html.lastIndexOf('<details', index);
      expect(html.slice(detailsStart, index)).not.toContain('open=""');
    }
  });

  it('collapses every Performance section by default', () => {
    const html = renderToStaticMarkup(
      <PerformanceSections
        preferences={buildPreferences()}
        updateCapability={() => undefined}
        updatePerformanceProfile={() => undefined}
        updateEstimated1Rm={() => undefined}
      />,
    );

    for (const titleId of ['performance-biometrics-title', 'performance-devices-title', 'performance-targets-title']) {
      const index = html.indexOf(titleId);
      expect(index).toBeGreaterThan(-1);
      const detailsStart = html.lastIndexOf('<details', index);
      expect(html.slice(detailsStart, index)).not.toContain('open=""');
    }
  });
});
