import { useEffect, useState } from 'react';
import type { CapabilityMaintenanceResult } from '../../engine/capabilityMaintenance';
import { briefPurposeFor, type BriefWindowPreset } from '../../engine/contextBrief';
import { purposeAlwaysRendersFullContext } from '../../ledger/export/compact/renderLedgerExportCompact';
import type { ContextBriefResult } from '../../services/contextBriefService';
import { downloadContextBriefFile, type ContextBriefExportFormat } from '../../utils/contextBriefExport';
import { buildBriefForPreset, loadStoredBriefPreset, persistBriefPreset } from '../briefPreset';
import { isBriefStale } from '../briefStaleness';
import { useBriefCheckpoint } from '../useBriefCheckpoint';

interface UseContextBriefStateInput {
  active: boolean;
  userId: string;
  briefDate: string | undefined;
  decisionInputDate: string | undefined;
  onNavigateToBrief?: () => void;
  capabilityMaintenance?: CapabilityMaintenanceResult | null;
}

export function useContextBriefState({
  active,
  userId,
  briefDate,
  decisionInputDate,
  onNavigateToBrief,
  capabilityMaintenance,
}: UseContextBriefStateInput) {
  const [brief, setBrief] = useState<ContextBriefResult | null>(null);
  const [briefCapabilityMaintenanceKey, setBriefCapabilityMaintenanceKey] = useState<string | null>(null);
  // Tagged with the date it belongs to, so a failure for one date is not rendered
  // against another. Deriving visibility this way avoids clearing state from inside
  // the effect body, which react-hooks/set-state-in-effect correctly rejects.
  const [briefError, setBriefError] = useState<{ date: string; message: string } | null>(null);
  const [briefCopied, setBriefCopied] = useState(false);
  const [briefPreset, setBriefPreset] = useState<BriefWindowPreset>(loadStoredBriefPreset);
  // Per-view, never persisted: forces the ledger Markdown export to render unchanged context in full.
  const [briefFullContext, setBriefFullContext] = useState(false);
  // What the brief on screen was built with; a mismatch means it is stale and must not be copied.
  const [builtVariant, setBuiltVariant] = useState({ fullContext: false, chat: '' });
  // The planning export starts a new chat, so it is always rendered in full (Phase 4).
  const briefFullContextLocked = purposeAlwaysRendersFullContext(briefPurposeFor(briefPreset));
  const effectiveBriefFullContext = briefFullContext || briefFullContextLocked;
  const checkpoint = useBriefCheckpoint(userId, briefPurposeFor(briefPreset), effectiveBriefFullContext);
  const capabilityMaintenanceKey = JSON.stringify(capabilityMaintenance ?? null);

  useEffect(() => {
    // Keyed on the date the brief was built for and on the active preset, not merely on
    // presence: a scenario switch or a midnight rollover changes `briefDate`, and toggling
    // daily/full changes what should be on screen for the *same* date -- a presence-only
    // guard would leave the previous day's (or previous preset's) brief and range on
    // screen indefinitely.
    // `briefDate` must be defined for the comparison to settle: passing undefined lets the
    // service default to today, whose asOfDate would never equal undefined and would
    // re-trigger this effect on every render.
    // When this view only links to the canonical export surface (#491), never fetch
    // the brief here -- the `brief` screen builds it.
    if (onNavigateToBrief || !active || !briefDate
      || (brief?.asOfDate === briefDate && brief.preset === briefPreset
        && briefCapabilityMaintenanceKey === capabilityMaintenanceKey
        && builtVariant.fullContext === effectiveBriefFullContext && builtVariant.chat === checkpoint.chat)) return;
    let cancelled = false;
    buildBriefForPreset(
      userId,
      briefDate,
      briefPreset,
      undefined,
      decisionInputDate === briefDate ? capabilityMaintenance : undefined,
      { previousContext: checkpoint.previousContext, fullContext: effectiveBriefFullContext },
    )
      .then(result => {
        if (!cancelled) {
          setBrief(result);
          setBriefCapabilityMaintenanceKey(capabilityMaintenanceKey);
          setBuiltVariant({ fullContext: effectiveBriefFullContext, chat: checkpoint.chat });
          setBriefError(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Drop the stale result rather than leaving the previous date's brief and range on
        // screen under an error banner -- Copy would otherwise hand the athlete yesterday's
        // window while the page claims today's.
        setBrief(null);
        setBriefCopied(false);
        setBriefError({ date: briefDate, message: 'Could not assemble the brief. Retry the dashboard refresh.' });
      });
    return () => { cancelled = true; };
  }, [onNavigateToBrief, active, userId, brief?.asOfDate, brief?.preset, briefDate, briefPreset, effectiveBriefFullContext, builtVariant, checkpoint.chat, checkpoint.previousContext, briefCapabilityMaintenanceKey, capabilityMaintenanceKey, capabilityMaintenance, decisionInputDate]);

  const selectBriefPreset = (preset: BriefWindowPreset) => {
    setBriefPreset(preset);
    persistBriefPreset(preset);
  };

  const briefStale = isBriefStale({
    brief, briefDate, briefPreset, builtVariant,
    fullContext: effectiveBriefFullContext, chat: checkpoint.chat, checkpointPending: checkpoint.pending,
    builtCapabilityKey: briefCapabilityMaintenanceKey, capabilityKey: capabilityMaintenanceKey,
  });

  const visibleBriefError = briefError && briefError.date === briefDate ? briefError.message : null;

  const copyBrief = async () => {
    if (!brief || briefStale) return;
    try {
      await navigator.clipboard.writeText(brief.text);
      checkpoint.recordExport(brief);
      setBriefError(null);
      setBriefCopied(true);
      window.setTimeout(() => setBriefCopied(false), 2000);
    } catch {
      // Clipboard permission can be denied; the textarea below is always selectable.
      setBriefCopied(false);
      setBriefError({ date: brief.asOfDate, message: 'Copy was blocked. Select the text below and copy it manually.' });
    }
  };

  const downloadBrief = (format: ContextBriefExportFormat) => {
    if (!brief || (briefStale && format === 'markdown')) return;
    try {
      downloadContextBriefFile(brief, format);
      if (format === 'markdown') checkpoint.recordExport(brief);
      setBriefError(null);
    } catch {
      setBriefError({
        date: brief.asOfDate,
        message: 'Download could not start. Try Copy to clipboard or select the text below.',
      });
    }
  };

  return {
    brief,
    briefCopied,
    briefPreset,
    briefFullContext,
    setBriefFullContext,
    briefFullContextLocked,
    checkpoint,
    briefStale,
    visibleBriefError,
    selectBriefPreset,
    copyBrief,
    downloadBrief,
  };
}
