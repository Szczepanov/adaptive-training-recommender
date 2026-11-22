import { useCallback, useEffect, useState } from 'react';
import type { DataState } from '../../engine/dataState';
import type { ActivityOverride, NormalizedGarminActivity } from '../../engine/models';
import { activityOverrideService } from '../../services/activityOverrideService';
import { activityService } from '../../services/activityService';
import { configuredActivitiesReadModelPolicy } from '../../training-occurrence/activitiesReadModelPolicy';
import { loadCanonicalActivitiesWindow } from '../../training-occurrence/canonicalActivitiesWindow';
import type { CompletedWorkoutView, ReconciliationSweepStatus } from '../../training-occurrence/completedWorkoutView';
import { downloadActivitiesJsonFile, exportActivitiesBundleToJson } from '../../utils/activityJsonExport';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate';
import { linkCompletedWorkoutSources, unlinkCompletedWorkoutSource } from '../completedWorkoutActions';

interface UseActivitiesTabStateInput {
  active: boolean;
  userId: string;
  briefDate: string | undefined;
}

export interface CanonicalWorkoutWindowState {
  userId: string;
  asOfDate: string;
  workouts: CompletedWorkoutView[] | null;
  reconciliationSweep?: ReconciliationSweepStatus;
  /** Set when the canonical read itself rejected -- `workouts` stays null so the UI can
   * tell "still loading" (canonicalWorkoutWindow is null/stale) apart from "read failed"
   * (this flag set) instead of showing an indefinite loading state for a real failure. */
  error?: boolean;
}

export interface ActivityWindowState {
  userId: string;
  asOfDate: string;
  state: DataState<NormalizedGarminActivity[]>;
}

export function useActivitiesTabState({ active, userId, briefDate }: UseActivitiesTabStateInput) {
  const [activityWindow, setActivityWindow] = useState<ActivityWindowState | null>(null);
  const [reclassifyModalOpen, setReclassifyModalOpen] = useState(false);
  const [activityOverrides, setActivityOverrides] = useState<Record<string, ActivityOverride>>({});
  // ADR-0034 PR2: canonical Activities read model, gated by VITE_TRAINING_OCCURRENCE_ACTIVITIES_POLICY.
  // Default 'off' leaves activityWindow/ActivityTelemetry above as the sole, unchanged
  // production path -- this state and its effect are inert unless explicitly enabled.
  const activitiesReadModelPolicy = configuredActivitiesReadModelPolicy();
  const [canonicalWorkoutWindow, setCanonicalWorkoutWindow] = useState<CanonicalWorkoutWindowState | null>(null);

  const loadOverrides = useCallback(() => {
    activityOverrideService.getAllOverrides(userId).then(setActivityOverrides);
  }, [userId]);

  useEffect(() => {
    loadOverrides();
  }, [loadOverrides]);

  const handleActivityDetailsFetched = useCallback(() => {
    setActivityWindow(null);
    setCanonicalWorkoutWindow(null);
  }, []);

  const canonicalWindowIsCurrent = canonicalWorkoutWindow !== null
    && canonicalWorkoutWindow.userId === userId
    && canonicalWorkoutWindow.asOfDate === briefDate;

  useEffect(() => {
    // Both userId and asOfDate must match the cached window, or a user switch on the same
    // calendar date would skip the fetch and later render the previous user's activities.
    if (!active || !briefDate
      || (activityWindow?.userId === userId && activityWindow.asOfDate === briefDate)) return;
    let cancelled = false;
    const startInclusive = addDaysToLocalDateString(briefDate, -6);
    const throughExclusive = addDaysToLocalDateString(briefDate, 1);
    activityService.getActivitiesInRange(userId, startInclusive, throughExclusive).then((state) => {
      if (!cancelled) setActivityWindow({ userId, asOfDate: briefDate, state });
    });
    return () => { cancelled = true; };
  }, [active, userId, briefDate, activityWindow?.userId, activityWindow?.asOfDate]);

  // ADR-0034 PR2 dual-read: only runs when the cutover flag is explicitly enabled. Mirrors
  // the raw-activity window above so the (if enabled) canonical UI covers the exact same
  // 7-day window. Comparison recording lives solely in getCompletedWorkoutsInRange
  // itself now -- it already has the exact-range Garmin snapshot it hydrated from, so a
  // second UI-level comparison against this view's separately-fetched activityWindow
  // could log a false difference caused by the two fetches' timing, not by the read
  // models actually disagreeing.
  useEffect(() => {
    if (activitiesReadModelPolicy === 'off' || !active || !briefDate
      || (canonicalWorkoutWindow?.userId === userId && canonicalWorkoutWindow.asOfDate === briefDate)) return;
    let cancelled = false;
    const startInclusive = addDaysToLocalDateString(briefDate, -6);
    const throughExclusive = addDaysToLocalDateString(briefDate, 1);
    loadCanonicalActivitiesWindow(userId, startInclusive, throughExclusive).then((window) => {
      if (cancelled) return;
      setCanonicalWorkoutWindow(window.status === 'available'
        ? { userId, asOfDate: briefDate, workouts: window.workouts, reconciliationSweep: window.reconciliationSweep }
        : { userId, asOfDate: briefDate, workouts: null, error: true, reconciliationSweep: window.reconciliationSweep });
    }).catch(err => {
      console.warn('[training-occurrence] canonical activities read failed', err);
      if (!cancelled) setCanonicalWorkoutWindow({ userId, asOfDate: briefDate, workouts: null, error: true });
    });
    return () => { cancelled = true; };
  }, [activitiesReadModelPolicy, active, userId, briefDate, canonicalWorkoutWindow?.userId, canonicalWorkoutWindow?.asOfDate]);

  const handleDownloadActivities = () => {
    if (!activityWindow || activityWindow.state.status !== 'AVAILABLE' || activityWindow.state.data.length === 0) return;
    const startInclusive = addDaysToLocalDateString(briefDate ?? getLocalDateString(), -6);
    const throughDateExclusive = addDaysToLocalDateString(briefDate ?? getLocalDateString(), 1);
    const bundle = exportActivitiesBundleToJson(activityWindow.state.data, {
      userId,
      startDateInclusive: startInclusive,
      throughDateExclusive,
    });
    const filename = `activities_${userId}_${startInclusive}_to_${throughDateExclusive}`;
    downloadActivitiesJsonFile(filename, bundle);
  };

  const handleUnlinkSource = (performedOccurrenceId: string, sourceKey: string) => {
    unlinkCompletedWorkoutSource(userId, performedOccurrenceId, sourceKey, userId)
      .then(() => setCanonicalWorkoutWindow(null))
      .catch(err => console.warn('[training-occurrence] unlink failed', err));
  };

  const handleLinkSources = (structuredOccurrenceId: string, providerOccurrenceId: string) => {
    linkCompletedWorkoutSources(userId, structuredOccurrenceId, providerOccurrenceId, userId)
      .then(() => setCanonicalWorkoutWindow(null))
      .catch(err => console.warn('[training-occurrence] manual link failed', err));
  };

  return {
    activityWindow,
    activityOverrides,
    loadOverrides,
    activitiesReadModelPolicy,
    canonicalWorkoutWindow,
    canonicalWindowIsCurrent,
    reclassifyModalOpen,
    setReclassifyModalOpen,
    handleActivityDetailsFetched,
    handleDownloadActivities,
    handleUnlinkSource,
    handleLinkSources,
  };
}
