import { useEffect, useState } from 'react';
import type { CapabilityMaintenanceResult } from '../engine/capabilityMaintenance';
import type { DailyDecisionInput } from '../engine/models';
import { recommendationService } from '../services/recommendationService';
import { SCREEN_LABELS } from '../types/navigation';
import { BodyCompositionPanel } from './anthropometry/BodyCompositionPanel';
import { NutritionPanel } from './nutrition/NutritionPanel';
import { StrengthOverloadHistory } from './StrengthOverloadHistory';
import { ActivitiesTab } from './dataView/ActivitiesTab';
import { AdherenceTab, CheckinTab } from './dataView/CheckinAndAdherenceTabs';
import { ContextBriefTab } from './dataView/ContextBriefTab';
import type { AdherenceStats, DataViewTab } from './dataView/dataViewFormat';
import { ConstraintsTab, GoalsTab, PreferencesTab } from './dataView/ProfileDataTabs';
import { RecoveryTab } from './dataView/RecoveryTab';
import { useActivitiesTabState } from './dataView/useActivitiesTabState';
import { useContextBriefState } from './dataView/useContextBriefState';
import './DataView.css';

interface DataViewProps {
  decisionInput: DailyDecisionInput | null;
  userId: string;
  onBack: () => void;
  /** Retry recomposing the daily decision input (App `loadDecisionInput`). Rendered as
   * the forward action on the null-input empty state (#493); absent only in harnesses
   * that render DataView without the App shell. */
  onRetry?: () => void;
  initialTab?: DataViewTab;
  /** When provided, Context-brief and AI-export affordances deep-link to the canonical
   * `brief` screen. The canonical `brief` screen omits this prop so it renders the full
   * brief while still routing any in-view AI export action back to that brief tab. */
  onNavigateToBrief?: () => void;
  /** Same-date result from the app's planner resolution; absent means the brief must keep
   * capability cadence unknown rather than deriving it independently. */
  capabilityMaintenance?: CapabilityMaintenanceResult | null;
}

export function DataView({ decisionInput, userId, initialTab = 'recovery', onNavigateToBrief, onRetry, onBack, capabilityMaintenance }: DataViewProps) {
  const [activeTab, setActiveTab] = useState<DataViewTab>(initialTab);
  // null doubles as "not loaded yet" -- once getAdherenceStats resolves it's always a
  // real (possibly all-zero) stats object, so this alone distinguishes loading from an
  // answer of "nothing recorded yet" without a separate loading flag.
  const [adherenceStats, setAdherenceStats] = useState<AdherenceStats | null>(null);
  const briefDate = decisionInput?.date;

  const briefState = useContextBriefState({
    active: activeTab === 'brief',
    userId,
    briefDate,
    decisionInputDate: decisionInput?.date,
    onNavigateToBrief,
    capabilityMaintenance,
  });

  const activitiesState = useActivitiesTabState({
    active: activeTab === 'activities',
    userId,
    briefDate,
  });

  useEffect(() => {
    if (activeTab !== 'adherence' || adherenceStats) return;
    let cancelled = false;
    recommendationService.getAdherenceStats(userId, 30).then(stats => {
      if (!cancelled) setAdherenceStats(stats);
    });
    return () => { cancelled = true; };
  }, [activeTab, userId, adherenceStats]);

  const openCanonicalBrief = () => {
    if (onNavigateToBrief) {
      onNavigateToBrief();
      return;
    }
    setActiveTab('brief');
  };

  if (!decisionInput) {
    return (
      <div className="data-view-container">
        <div className="data-view-header">
          <h1>{initialTab === 'brief' ? SCREEN_LABELS.brief : SCREEN_LABELS.data}</h1>
        </div>
        <div className="no-data">
          <p>No data available</p>
          <p className="data-state-notice">Today&apos;s decision input could not be composed. Retry the dashboard refresh, or return Home.</p>
          <div className="brief-actions">
            {onRetry && (
              <button type="button" className="brief-copy" onClick={onRetry}>
                Retry
              </button>
            )}
            <button type="button" className="brief-copy" onClick={onBack}>
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="data-view-container">
      <div className="data-view-header">
        <div>
          <h1>{initialTab === 'brief' ? SCREEN_LABELS.brief : SCREEN_LABELS.data}</h1>
          <p className="header-subtitle">Inspect engine inputs, recovery metrics, activity telemetry, and adherence.</p>
        </div>
      </div>

      <div className="data-view-tabs">
        <button
          className={activeTab === 'recovery' ? 'active' : ''}
          onClick={() => setActiveTab('recovery')}
        >
          Recovery
        </button>
        <button
          className={activeTab === 'activities' ? 'active' : ''}
          onClick={() => setActiveTab('activities')}
        >
          Activities
        </button>
        <button
          className={activeTab === 'strength' ? 'active' : ''}
          onClick={() => setActiveTab('strength')}
        >
          Strength History
        </button>
        <button
          className={activeTab === 'nutrition' ? 'active' : ''}
          onClick={() => setActiveTab('nutrition')}
        >
          Nutrition
        </button>
        <button
          className={activeTab === 'body' ? 'active' : ''}
          onClick={() => setActiveTab('body')}
        >
          Body & Fueling
        </button>
        <button
          className={activeTab === 'checkin' ? 'active' : ''}
          onClick={() => setActiveTab('checkin')}
        >
          Check-in
        </button>
        <button
          className={activeTab === 'goals' ? 'active' : ''}
          onClick={() => setActiveTab('goals')}
        >
          Goals
        </button>
        <button
          className={activeTab === 'constraints' ? 'active' : ''}
          onClick={() => setActiveTab('constraints')}
        >
          {SCREEN_LABELS.constraints}
        </button>
        <button
          className={activeTab === 'preferences' ? 'active' : ''}
          onClick={() => setActiveTab('preferences')}
        >
          {SCREEN_LABELS.preferences}
        </button>
        <button
          className={activeTab === 'adherence' ? 'active' : ''}
          onClick={() => setActiveTab('adherence')}
        >
          Adherence
        </button>
        <button
          className={activeTab === 'brief' ? 'active' : ''}
          onClick={openCanonicalBrief}
        >
          Context brief
        </button>
      </div>

      <div className="data-view-content">
        {activeTab === 'recovery' && (
          <RecoveryTab
            recoverySnapshot={decisionInput.recoverySnapshot}
            sourceStateStatus={decisionInput.sourceStates?.recoverySnapshot.status}
          />
        )}
        {activeTab === 'activities' && (
          <ActivitiesTab
            userId={userId}
            briefDate={briefDate}
            activityWindow={activitiesState.activityWindow}
            activityOverrides={activitiesState.activityOverrides}
            activitiesReadModelPolicy={activitiesState.activitiesReadModelPolicy}
            canonicalWorkoutWindow={activitiesState.canonicalWorkoutWindow}
            canonicalWindowIsCurrent={activitiesState.canonicalWindowIsCurrent}
            reclassifyModalOpen={activitiesState.reclassifyModalOpen}
            onSetReclassifyModalOpen={activitiesState.setReclassifyModalOpen}
            onOpenCanonicalBrief={openCanonicalBrief}
            onDownloadActivities={activitiesState.handleDownloadActivities}
            onDetailsFetched={activitiesState.handleActivityDetailsFetched}
            onLoadOverrides={activitiesState.loadOverrides}
            onUnlinkSource={activitiesState.handleUnlinkSource}
            onLinkSources={activitiesState.handleLinkSources}
          />
        )}
        {activeTab === 'strength' && (
          <div className="data-section">
            <StrengthOverloadHistory userId={userId} />
          </div>
        )}
        {activeTab === 'nutrition' && (
          <NutritionPanel userId={userId} asOfDate={briefDate} />
        )}
        {activeTab === 'body' && (
          <BodyCompositionPanel userId={userId} asOfDate={briefDate} />
        )}
        {activeTab === 'checkin' && (
          <CheckinTab
            subjectiveCheckin={decisionInput.subjectiveCheckin}
            sourceStateStatus={decisionInput.sourceStates?.subjectiveCheckin.status}
          />
        )}
        {activeTab === 'goals' && <GoalsTab activeGoals={decisionInput.activeGoals} />}
        {activeTab === 'constraints' && <ConstraintsTab trainingSettings={decisionInput.trainingSettings} />}
        {activeTab === 'adherence' && <AdherenceTab adherenceStats={adherenceStats} />}
        {activeTab === 'preferences' && <PreferencesTab preferences={decisionInput.preferences} />}
        {activeTab === 'brief' && (
          <ContextBriefTab
            userId={userId}
            briefDate={briefDate}
            onNavigateToBrief={onNavigateToBrief}
            brief={briefState.brief}
            briefCopied={briefState.briefCopied}
            briefPreset={briefState.briefPreset}
            briefFullContext={briefState.briefFullContext}
            briefFullContextLocked={briefState.briefFullContextLocked}
            briefStale={briefState.briefStale}
            visibleBriefError={briefState.visibleBriefError}
            checkpoint={briefState.checkpoint}
            onSelectPreset={briefState.selectBriefPreset}
            onChangeFullContext={briefState.setBriefFullContext}
            onCopy={briefState.copyBrief}
            onDownload={briefState.downloadBrief}
          />
        )}
      </div>
    </div>
  );
}
