import { useState, useEffect, useCallback } from 'react';
import { preferencesService } from '../../services/preferencesService';
import { trainingIntentProfileService } from '../../services/trainingIntentProfileService';
import { DEFAULT_TRAINING_INTENT_PROFILE } from '../../engine/evergreenStrategy';
import type { UserPreferences, TrainingIntentProfile, TrainingPriority } from '../../engine/models';
import { getErrorMessage } from '../../utils/errors';

export type TrainingIntentProfileDraft = Omit<TrainingIntentProfile, 'userId' | 'createdAt' | 'updatedAt'>;

export function defaultTrainingIntentProfile(): TrainingIntentProfileDraft {
  return {
    ...DEFAULT_TRAINING_INTENT_PROFILE,
    priorities: [...DEFAULT_TRAINING_INTENT_PROFILE.priorities],
    weeklyCommitment: { ...DEFAULT_TRAINING_INTENT_PROFILE.weeklyCommitment },
  };
}

export function usePreferences(userId: string) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [trainingIntentProfile, setTrainingIntentProfile] = useState<TrainingIntentProfileDraft>(defaultTrainingIntentProfile());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const loadPreferences = useCallback(async () => {
    try {
      setLoading(true);
      const [prefs, profileState] = await Promise.all([
        preferencesService.getPreferences(userId),
        trainingIntentProfileService.getProfileState(userId),
      ]);

      if (!prefs) {
        // Initialize with defaults
        const defaults = await preferencesService.initializeDefaultPreferences(userId);
        setPreferences(defaults);
      } else {
        setPreferences(prefs);
      }
      if (profileState.status === 'AVAILABLE') {
        setTrainingIntentProfile({
          planningMode: profileState.data.planningMode,
          priorities: profileState.data.priorities,
          weeklyCommitment: profileState.data.weeklyCommitment,
          organizationPreference: profileState.data.organizationPreference,
          schemaVersion: profileState.data.schemaVersion,
        });
      } else {
        setTrainingIntentProfile(defaultTrainingIntentProfile());
        if (profileState.status !== 'MISSING') setError('Training intent could not be loaded. Defaults are shown, but saving may fail until the service is available.');
      }
    } catch (err) {
      console.error('Error loading preferences:', err);
      setError('Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const handleSave = async () => {
    if (!preferences) return;

    try {
      setSaving(true);
      setError(null);
      await Promise.all([
        preferencesService.upsertPreferences(userId, preferences),
        trainingIntentProfileService.upsert(userId, trainingIntentProfile),
      ]);
      setHasChanges(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    loadPreferences();
    setHasChanges(false);
  };

  const updatePreference = useCallback(<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setPreferences(current => {
      if (!current) return current;
      setHasChanges(true);
      return { ...current, [key]: value };
    });
  }, []);

  const updateNestedPreference = useCallback(<K extends keyof UserPreferences['preferredUnits']>(
    key: K,
    value: UserPreferences['preferredUnits'][K]
  ) => {
    setPreferences(current => {
      if (!current) return current;
      setHasChanges(true);
      return {
        ...current,
        preferredUnits: {
          ...current.preferredUnits,
          [key]: value
        }
      };
    });
  }, []);

  const updatePerformanceProfile = useCallback((
    key: 'ftpWatts' | 'thresholdPaceSecPerKm' | 'lthrBpm' | 'cyclingLthr' | 'weightKg' | 'bodyFatPct',
    value: string
  ) => {
    setPreferences(current => {
      if (!current) return current;
      const profile = current.performanceProfile ?? {};
      const numericValue = value.trim() === '' ? null : Number(value);
      const now = new Date().toISOString();

      const cycling = { ...profile.cycling };
      const running = { ...profile.running };
      const targetSources = { ...profile.targetSources };

      if (key === 'ftpWatts') {
        cycling.ftpWatts = numericValue;
        cycling.measuredAt = now;
        targetSources.ftpWatts = 'manual';
      } else if (key === 'cyclingLthr') {
        cycling.lthrBpm = numericValue;
        cycling.measuredAt = now;
        targetSources.cyclingLthr = 'manual';
      } else if (key === 'thresholdPaceSecPerKm') {
        running.thresholdPaceSecPerKm = numericValue;
        running.measuredAt = now;
        targetSources.thresholdPaceSecPerKm = 'manual';
      } else if (key === 'lthrBpm') {
        running.lthrBpm = numericValue;
        running.measuredAt = now;
        targetSources.lthrBpm = 'manual';
      } else if (key === 'weightKg') {
        targetSources.weightKg = 'manual';
      } else if (key === 'bodyFatPct') {
        targetSources.bodyFatPct = 'manual';
      }

      setHasChanges(true);
      return {
        ...current,
        performanceProfile: {
          ...profile,
          // Legacy & top-level sync
          ftpWatts: key === 'ftpWatts' ? numericValue : profile.ftpWatts,
          thresholdPaceSecPerKm: key === 'thresholdPaceSecPerKm' ? numericValue : profile.thresholdPaceSecPerKm,
          lthrBpm: key === 'lthrBpm' ? numericValue : profile.lthrBpm,
          weightKg: key === 'weightKg' ? numericValue : profile.weightKg,
          bodyFatPct: key === 'bodyFatPct' ? numericValue : profile.bodyFatPct,
          weightMeasuredAt: key === 'weightKg' || key === 'bodyFatPct' ? now : profile.weightMeasuredAt,
          targetSources,
          cycling,
          running,
          measuredAt: now
        }
      };
    });
  }, []);

  const updateCapability = useCallback((key: 'powerMeter' | 'heartRateMonitor' | 'cadenceData', enabled: boolean) => {
    setPreferences(current => {
      if (!current) return current;
      const profile = current.performanceProfile ?? {};
      setHasChanges(true);
      return {
        ...current,
        performanceProfile: {
          ...profile,
          capabilities: {
            ...profile.capabilities,
            [key]: enabled
          }
        }
      };
    });
  }, []);

  const updateEstimated1Rm = useCallback((exerciseId: string, value: string) => {
    setPreferences(current => {
      if (!current) return current;
      const estimated1RmKg = { ...(current.performanceProfile?.estimated1RmKg ?? {}) };
      if (value.trim() === '') delete estimated1RmKg[exerciseId];
      else estimated1RmKg[exerciseId] = Number(value);
      setHasChanges(true);
      return {
        ...current,
        performanceProfile: {
          ...current.performanceProfile,
          estimated1RmKg,
          measuredAt: new Date().toISOString()
        }
      };
    });
  }, []);

  const addPreferredModality = useCallback((modality: string) => {
    setPreferences(current => {
      if (!current || !modality.trim()) return current;
      const trimmed = modality.trim();
      const updatedPreferred = [...current.preferredModalities];
      if (!updatedPreferred.includes(trimmed)) {
        updatedPreferred.push(trimmed);
      }
      // Clean cross-list conflict automatically (Mutual Exclusion for preferences)
      const updatedAvoided = current.avoidedModalities.filter(m => m !== trimmed);

      setHasChanges(true);
      return {
        ...current,
        preferredModalities: updatedPreferred,
        avoidedModalities: updatedAvoided,
      };
    });
  }, []);

  const removePreferredModality = useCallback((modality: string) => {
    setPreferences(current => {
      if (!current) return current;
      const updated = current.preferredModalities.filter(m => m !== modality);
      setHasChanges(true);
      return { ...current, preferredModalities: updated };
    });
  }, []);

  const addAvoidedModality = useCallback((modality: string) => {
    setPreferences(current => {
      if (!current || !modality.trim()) return current;
      const trimmed = modality.trim();
      const updatedAvoided = [...current.avoidedModalities];
      if (!updatedAvoided.includes(trimmed)) {
        updatedAvoided.push(trimmed);
      }
      // Clean cross-list conflict automatically (Mutual Exclusion for preferences)
      const updatedPreferred = current.preferredModalities.filter(m => m !== trimmed);

      setHasChanges(true);
      return {
        ...current,
        preferredModalities: updatedPreferred,
        avoidedModalities: updatedAvoided,
      };
    });
  }, []);

  const removeAvoidedModality = useCallback((modality: string) => {
    setPreferences(current => {
      if (!current) return current;
      const updated = current.avoidedModalities.filter(m => m !== modality);
      setHasChanges(true);
      return { ...current, avoidedModalities: updated };
    });
  }, []);

  const updateTrainingIntentProfile = useCallback((update: Partial<TrainingIntentProfileDraft>) => {
    setTrainingIntentProfile(current => ({ ...current, ...update }));
    setHasChanges(true);
  }, []);

  const updateWeeklyCommitment = useCallback((key: keyof TrainingIntentProfileDraft['weeklyCommitment'], value: number) => {
    setTrainingIntentProfile(current => {
      setHasChanges(true);
      return {
        ...current,
        weeklyCommitment: { ...current.weeklyCommitment, [key]: value },
      };
    });
  }, []);

  const toggleTrainingPriority = useCallback((priority: TrainingPriority) => {
    setTrainingIntentProfile(current => {
      const priorities = current.priorities.includes(priority)
        ? current.priorities.filter(item => item !== priority)
        : [...current.priorities, priority];
      setHasChanges(true);
      return { ...current, priorities };
    });
  }, []);

  const moveTrainingPriority = useCallback((priority: TrainingPriority, direction: -1 | 1) => {
    setTrainingIntentProfile(current => {
      const index = current.priorities.indexOf(priority);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.priorities.length) return current;
      const priorities = [...current.priorities];
      [priorities[index], priorities[nextIndex]] = [priorities[nextIndex], priorities[index]];
      setHasChanges(true);
      return { ...current, priorities };
    });
  }, []);

  const addUnavailableModality = useCallback((modality: NonNullable<UserPreferences['unavailableModalities']>[number]) => {
    setPreferences(current => {
      if (!current || !modality) return current;
      const unavailableModalities = current.unavailableModalities ?? [];
      if (unavailableModalities.includes(modality)) return current;

      setHasChanges(true);
      return {
        ...current,
        unavailableModalities: [...unavailableModalities, modality],
        preferredModalities: current.preferredModalities.filter(item => item !== modality),
        avoidedModalities: current.avoidedModalities.filter(item => item !== modality),
      };
    });
  }, []);

  const removeUnavailableModality = useCallback((modality: NonNullable<UserPreferences['unavailableModalities']>[number]) => {
    setPreferences(current => {
      if (!current) return current;
      setHasChanges(true);
      return {
        ...current,
        unavailableModalities: (current.unavailableModalities ?? []).filter(item => item !== modality)
      };
    });
  }, []);

  return {
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
  };
}
