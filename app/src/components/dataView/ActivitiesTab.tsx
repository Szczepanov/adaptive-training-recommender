import type { ActivityOverride } from '../../engine/models';
import type { ActivitiesReadModelPolicy } from '../../training-occurrence/activitiesReadModelPolicy';
import { SCREEN_LABELS } from '../../types/navigation';
import { addDaysToLocalDateString } from '../../utils/localDate';
import { ActivityReclassificationModal } from '../ActivityReclassificationModal';
import { ActivityTelemetry } from '../ActivityTelemetry';
import { CanonicalActivitiesPanel } from '../CanonicalActivitiesPanel';
import type { ActivityWindowState, CanonicalWorkoutWindowState } from './useActivitiesTabState';

interface ActivitiesTabProps {
  userId: string;
  briefDate: string | undefined;
  activityWindow: ActivityWindowState | null;
  activityOverrides: Record<string, ActivityOverride>;
  activitiesReadModelPolicy: ActivitiesReadModelPolicy;
  canonicalWorkoutWindow: CanonicalWorkoutWindowState | null;
  canonicalWindowIsCurrent: boolean;
  reclassifyModalOpen: boolean;
  onSetReclassifyModalOpen: (open: boolean) => void;
  onOpenCanonicalBrief: () => void;
  onDownloadActivities: () => void;
  onDetailsFetched: () => void;
  onLoadOverrides: () => void;
  onUnlinkSource: (performedOccurrenceId: string, sourceKey: string) => void;
  onLinkSources: (structuredOccurrenceId: string, providerOccurrenceId: string) => void;
}

export function ActivitiesTab({
  userId,
  briefDate,
  activityWindow,
  activityOverrides,
  activitiesReadModelPolicy,
  canonicalWorkoutWindow,
  canonicalWindowIsCurrent,
  reclassifyModalOpen,
  onSetReclassifyModalOpen,
  onOpenCanonicalBrief,
  onDownloadActivities,
  onDetailsFetched,
  onLoadOverrides,
  onUnlinkSource,
  onLinkSources,
}: ActivitiesTabProps) {
  return (
    <div className="data-section">
      <div className="activities-tab-header">
        <div>
          <h3 style={{ margin: 0 }}>Recent activity telemetry</h3>
          <p className="activities-tab-subtitle">
            Inspect detailed Garmin telemetry. Use the canonical context brief for AI planning; JSON download remains a data export.
          </p>
        </div>
        {activityWindow?.state.status === 'AVAILABLE' && activityWindow.state.data.length > 0 && (
          <div className="activities-header-actions">
            <button
              type="button"
              className="quick-action-btn secondary"
              style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
              onClick={onOpenCanonicalBrief}
              title="Open the canonical Export Context for AI surface for AI planning export"
            >
              📋 Export via {SCREEN_LABELS.brief}
            </button>
            <button
              type="button"
              className="quick-action-btn secondary"
              style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
              onClick={onDownloadActivities}
              title="Download recent activities JSON bundle file"
            >
              💾 Download JSON
            </button>
            <button
              type="button"
              className="quick-action-btn secondary"
              style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
              onClick={() => onSetReclassifyModalOpen(true)}
            >
              ✏️ Correct / Reclassify
            </button>
          </div>
        )}
      </div>
      {activitiesReadModelPolicy === 'canonical-v1' ? (
        <CanonicalActivitiesPanel
          onDetailsFetched={onDetailsFetched}
          userId={userId}
          activityOverrides={activityOverrides}
          workouts={canonicalWindowIsCurrent ? canonicalWorkoutWindow?.workouts ?? null : null}
          failed={canonicalWindowIsCurrent && !!canonicalWorkoutWindow?.error}
          reconciliationSweep={canonicalWindowIsCurrent ? canonicalWorkoutWindow?.reconciliationSweep : undefined}
          range={briefDate ? { from: addDaysToLocalDateString(briefDate, -6), toExclusive: addDaysToLocalDateString(briefDate, 1) } : null}
          onReclassify={() => onSetReclassifyModalOpen(true)}
          onUnlinkSource={onUnlinkSource}
          onLinkSources={onLinkSources}
        />
      ) : (
        <ActivityTelemetry
          onDetailsFetched={onDetailsFetched}
          userId={userId}
          activityOverrides={activityOverrides}
          state={activityWindow && activityWindow.userId === userId && activityWindow.asOfDate === briefDate ? activityWindow.state : null}
          onReclassify={() => onSetReclassifyModalOpen(true)}
        />
      )}
      {activityWindow?.state.status === 'AVAILABLE' && reclassifyModalOpen && (
        <ActivityReclassificationModal
          userId={userId}
          activities={activityWindow.state.data}
          existingOverrides={activityOverrides}
          isOpen={reclassifyModalOpen}
          onClose={() => onSetReclassifyModalOpen(false)}
          onSaved={onLoadOverrides}
        />
      )}
    </div>
  );
}
