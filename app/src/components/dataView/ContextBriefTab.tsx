import { briefWindowDaysFor, type BriefWindowPreset } from '../../engine/contextBrief';
import type { ContextBriefResult } from '../../services/contextBriefService';
import { SCREEN_LABELS } from '../../types/navigation';
import type { ContextBriefExportFormat } from '../../utils/contextBriefExport';
import { BriefChatInput, BriefConfirmChat } from '../BriefChatCheckpoint';
import { BriefFullContextToggle } from '../BriefFullContextToggle';
import { BriefPresetToggle } from '../BriefPresetToggle';
import { ContextBriefExportActions } from '../ContextBriefExportActions';
import { LedgerExportButton } from '../LedgerExportButton';
import type { useBriefCheckpoint } from '../useBriefCheckpoint';

interface ContextBriefTabProps {
  userId: string;
  briefDate: string | undefined;
  onNavigateToBrief?: () => void;
  brief: ContextBriefResult | null;
  briefCopied: boolean;
  briefPreset: BriefWindowPreset;
  briefFullContext: boolean;
  briefFullContextLocked: boolean;
  briefStale: boolean;
  visibleBriefError: string | null;
  checkpoint: ReturnType<typeof useBriefCheckpoint>;
  onSelectPreset: (preset: BriefWindowPreset) => void;
  onChangeFullContext: (checked: boolean) => void;
  onCopy: () => void;
  onDownload: (format: ContextBriefExportFormat) => void;
}

export function ContextBriefTab({
  userId,
  briefDate,
  onNavigateToBrief,
  brief,
  briefCopied,
  briefPreset,
  briefFullContext,
  briefFullContextLocked,
  briefStale,
  visibleBriefError,
  checkpoint,
  onSelectPreset,
  onChangeFullContext,
  onCopy,
  onDownload,
}: ContextBriefTabProps) {
  // Deep-link fallback: the Context-brief tab navigates to the canonical export
  // surface directly (#491), so this branch is only reachable if the tab is active
  // while a navigate handler is set.
  if (onNavigateToBrief) {
    return (
      <div className="data-section">
        <h3>Context brief</h3>
        <p className="brief-intro">
          Export for AI lives in one place now — open {SCREEN_LABELS.brief} for the
          canonical daily (2-day), planning (14-day) or diagnostic (14-day) brief with char and token counts.
          {' '}Read-only: generating it changes nothing.
        </p>
        <div className="brief-actions">
          <button className="brief-copy" onClick={onNavigateToBrief}>
            Open {SCREEN_LABELS.brief}
          </button>
        </div>
      </div>
    );
  }

  const approxTokens = brief ? Math.ceil(brief.text.length / 4) : null;
  return (
    <div className="data-section">
      <h3>Context brief</h3>
      <p className="brief-intro">
        {briefPreset === 'daily'
          ? "High-signal briefing for your daily chat with an external AI coach — includes yesterday's closed loop, today's recovery, and today's full session prescription."
          : briefPreset === 'full'
            ? `Use this export when starting a new chat. Compact ${briefWindowDaysFor('full')}-day planning context with the full user context (never shortened against an earlier chat) and the sessions planned for the next 14 days.`
            : `Full ${briefWindowDaysFor('diagnostic')}-day forensic export — per-lap and per-zone activity telemetry plus observation-only candidate baselines, for debugging ingestion or analysing a workout. Not needed for planning.`}
        {' '}Read-only: generating it changes nothing.
      </p>
      <BriefPresetToggle preset={briefPreset} onSelect={onSelectPreset} />
      <BriefFullContextToggle checked={briefFullContext} onChange={onChangeFullContext} locked={briefFullContextLocked} />
      <BriefChatInput value={checkpoint.chatInput} onChange={checkpoint.setChatInput} onCommit={checkpoint.commitChat} />
      {visibleBriefError && <p className="data-state-notice">{visibleBriefError}</p>}
      {(!brief || briefStale) && !visibleBriefError && <p role="status">Assembling...</p>}
      {brief && (
        <>
          {brief.unavailableSources.length > 0 && (
            <p className="data-state-notice">
              Could not read: {brief.unavailableSources.join(', ')}. The brief below is incomplete.
            </p>
          )}
          <div className="brief-actions">
            <ContextBriefExportActions
              copied={briefCopied}
              markdownDisabled={briefStale}
              onCopy={onCopy}
              onDownloadMarkdown={() => onDownload('markdown')}
              onDownloadJson={() => onDownload('json')}
            >
              {brief.asOfDate === briefDate && brief.preset === briefPreset && <LedgerExportButton
                key={`${userId}:${brief.asOfDate}:${briefPreset}`}
                userId={userId}
                asOfDate={brief.asOfDate}
                purpose={brief.purpose}
                window={{ startDate: brief.startDate, endDate: brief.asOfDate }}
              />}
            </ContextBriefExportActions>
            {/* The new-chat refresh export never reads a checkpoint, so confirming it would save nothing useful. */}
            {!briefFullContextLocked && <BriefConfirmChat
              canConfirm={!briefStale && checkpoint.canConfirm(brief)}
              blocked={checkpoint.confirmBlock(brief, briefStale)}
              status={checkpoint.confirmStatus(brief)}
              onConfirm={checkpoint.confirm}
            />}
            <span className="brief-range">{brief.startDate} → {brief.asOfDate}</span>
            <span className="brief-size">
              {brief.text.length.toLocaleString()} chars · ~{approxTokens?.toLocaleString()} tokens
            </span>
          </div>
          <textarea className="brief-text" readOnly value={brief.text} rows={24} spellCheck={false} />
        </>
      )}
    </div>
  );
}
