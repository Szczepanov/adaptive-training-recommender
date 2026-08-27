import { usePreferences } from './usePreferences';
import { PreferencesHeader } from './PreferencesHeader';
import { PreferencesFooter } from './PreferencesFooter';
import { TrainingPlanSection } from './TrainingPlanSection';
import { ModalitySections } from './ModalitySections';
import { StyleSections } from './StyleSections';
import { PerformanceSections } from './PerformanceSections';
import { GarminConnectionSection } from './GarminConnectionSection';
import { GoogleHealthConnectionSection } from './GoogleHealthConnectionSection';
import { HealthRunYogaPresetSection } from './HealthRunYogaPresetSection';
import type { Screen } from '../../types/navigation';
import '../Preferences.css';

interface PreferencesProps {
  userId: string;
  onNavigate?: (screen: Screen) => void;
}

export function Preferences({ userId }: PreferencesProps) {
  const {
    preferences,
    trainingIntentProfile,
    loading,
    saving,
    error,
    hasChanges,
    loadPreferences,
    handleSave,
    handleReset,
    updatePreference,
    updateNestedPreference,
    updatePerformanceProfile,
    updateCapability,
    updateEstimated1Rm,
    addPreferredModality,
    removePreferredModality,
    addAvoidedModality,
    removeAvoidedModality,
    updateTrainingIntentProfile,
    updateWeeklyCommitment,
    toggleTrainingPriority,
    moveTrainingPriority,
    addUnavailableModality,
    removeUnavailableModality
  } = usePreferences(userId);

  if (loading) {
    return (
      <div className="preferences-container">
        <div className="loading-state">
          <p>Loading preferences...</p>
        </div>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="preferences-container">
        <div className="error-state">
          <p>Failed to load preferences</p>
          <button onClick={loadPreferences}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="preferences-container">
      <PreferencesHeader hasChanges={hasChanges} />

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="preferences-content">
        <GarminConnectionSection />

        <GoogleHealthConnectionSection userId={userId} />

        <HealthRunYogaPresetSection
          userId={userId}
          onApplied={loadPreferences}
        />

        <TrainingPlanSection
          trainingIntentProfile={trainingIntentProfile}
          updateTrainingIntentProfile={updateTrainingIntentProfile}
          toggleTrainingPriority={toggleTrainingPriority}
          moveTrainingPriority={moveTrainingPriority}
          updateWeeklyCommitment={updateWeeklyCommitment}
        />

        <ModalitySections
          preferences={preferences}
          addPreferredModality={addPreferredModality}
          removePreferredModality={removePreferredModality}
          addAvoidedModality={addAvoidedModality}
          removeAvoidedModality={removeAvoidedModality}
          addUnavailableModality={addUnavailableModality}
          removeUnavailableModality={removeUnavailableModality}
        />

        <StyleSections
          preferences={preferences}
          updatePreference={updatePreference}
          updateNestedPreference={updateNestedPreference}
        />

        <PerformanceSections
          preferences={preferences}
          updateCapability={updateCapability}
          updatePerformanceProfile={updatePerformanceProfile}
          updateEstimated1Rm={updateEstimated1Rm}
        />
      </div>

      <PreferencesFooter
        hasChanges={hasChanges}
        saving={saving}
        handleSave={handleSave}
        handleReset={handleReset}
      />
    </div>
  );
}
