/**
 * The Activities body when the canonical read model is enabled. Splits the window outcome into
 * three states that must never look alike: still loading, read failed (#895 state 8), and a
 * real -- possibly empty -- list. Extracted from `DataView` so the branching is unit-testable.
 */
import type { CompletedWorkoutView, ReconciliationSweepStatus } from '../training-occurrence/completedWorkoutView';
import { CompletedWorkoutList } from './CompletedWorkoutList';
import type { ActivityOverride } from '../engine/models';
import { WorkoutWindowProjectionFailed, type DiagnosticsWindow } from './WorkoutSourceDiagnostics';

interface CanonicalActivitiesPanelProps {
  userId?: string;
  onDetailsFetched?: () => void;
  activityOverrides?: Record<string, ActivityOverride>;
  /** `null` while loading (or when the cached window belongs to another user/date). */
  workouts: CompletedWorkoutView[] | null;
  /** The canonical read rejected: `workouts` is `null` but this is a failure, not loading. */
  failed: boolean;
  range: DiagnosticsWindow | null;
  /** The window's reconciliation sweep outcome (see `loadCanonicalActivitiesWindow`). */
  reconciliationSweep?: ReconciliationSweepStatus;
  onReclassify?: (activityId: string) => void;
  onUnlinkSource?: (performedOccurrenceId: string, sourceKey: string) => void;
  onLinkSources?: (structuredOccurrenceId: string, providerOccurrenceId: string) => void;
}

export function CanonicalActivitiesPanel({ workouts, failed, range, reconciliationSweep, onReclassify, onUnlinkSource, onLinkSources, userId, activityOverrides, onDetailsFetched }: CanonicalActivitiesPanelProps) {
  if (failed) return <WorkoutWindowProjectionFailed range={range} sweep={reconciliationSweep} />;
  return (
    <CompletedWorkoutList
      userId={userId}
      onDetailsFetched={onDetailsFetched}
      activityOverrides={activityOverrides}
      workouts={workouts}
      exportWindow={range}
      windowSweep={reconciliationSweep}
      onReclassify={onReclassify}
      onUnlinkSource={onUnlinkSource}
      onLinkSources={onLinkSources}
    />
  );
}
