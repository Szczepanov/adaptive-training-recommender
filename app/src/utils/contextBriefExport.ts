import type { BriefPurpose, BriefWindowPreset } from '../engine/contextBrief';

export const CONTEXT_BRIEF_EXPORT_SCHEMA_VERSION = 'context_brief_export_v1' as const;

export type ContextBriefExportFormat = 'markdown' | 'json';

export interface ContextBriefExportSource {
  text: string;
  startDate: string;
  asOfDate: string;
  windowDays: number;
  preset: BriefWindowPreset;
  purpose: BriefPurpose;
  unavailableSources: readonly string[];
}

export interface ContextBriefJsonExport {
  schemaVersion: typeof CONTEXT_BRIEF_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  source: 'adaptive-training-recommender';
  preset: BriefWindowPreset;
  purpose: BriefPurpose;
  dateRange: {
    startDate: string;
    asOfDate: string;
    windowDays: number;
  };
  unavailableSources: string[];
  contentType: 'text/markdown';
  content: string;
}

/**
 * JSON is deliberately a transport envelope around the canonical Markdown brief, not a
 * parallel structured-context schema. That keeps clipboard, Markdown-file and JSON-file
 * exports semantically identical as the brief evolves.
 */
export function buildContextBriefJsonExport(
  brief: ContextBriefExportSource,
  exportedAt: string = new Date().toISOString(),
): ContextBriefJsonExport {
  return {
    schemaVersion: CONTEXT_BRIEF_EXPORT_SCHEMA_VERSION,
    exportedAt,
    source: 'adaptive-training-recommender',
    preset: brief.preset,
    purpose: brief.purpose,
    dateRange: {
      startDate: brief.startDate,
      asOfDate: brief.asOfDate,
      windowDays: brief.windowDays,
    },
    unavailableSources: [...brief.unavailableSources],
    contentType: 'text/markdown',
    content: brief.text,
  };
}

export function contextBriefExportFilename(
  brief: ContextBriefExportSource,
  format: ContextBriefExportFormat,
): string {
  const extension = format === 'markdown' ? 'md' : 'json';
  return `context-brief_${brief.purpose}_${brief.startDate}_to_${brief.asOfDate}.${extension}`;
}

export function formatContextBriefExport(
  brief: ContextBriefExportSource,
  format: ContextBriefExportFormat,
  exportedAt?: string,
): string {
  if (format === 'markdown') return brief.text;
  return JSON.stringify(buildContextBriefJsonExport(brief, exportedAt), null, 2);
}

function triggerTextDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    if (link.parentNode) link.parentNode.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export function downloadContextBriefFile(
  brief: ContextBriefExportSource,
  format: ContextBriefExportFormat,
): void {
  const mimeType = format === 'markdown'
    ? 'text/markdown;charset=utf-8'
    : 'application/json;charset=utf-8';
  triggerTextDownload(
    contextBriefExportFilename(brief, format),
    formatContextBriefExport(brief, format),
    mimeType,
  );
}
