import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildContextBriefJsonExport,
  contextBriefExportFilename,
  downloadContextBriefFile,
  downloadLedgerExportFile,
  formatContextBriefExport,
  type ContextBriefExportSource,
} from './contextBriefExport';

const BRIEF: ContextBriefExportSource = {
  text: '# Training context brief\n\nHigh-signal content.',
  startDate: '2026-09-15',
  asOfDate: '2026-09-28',
  windowDays: 14,
  preset: 'diagnostic',
  purpose: 'diagnostic',
  contractVersion: '2026-09-context-brief-contract-v2',
  unavailableSources: ['recovery:2026-09-20'],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contextBriefExport', () => {
  it('keeps Markdown byte-for-byte equivalent to the canonical rendered brief', () => {
    expect(formatContextBriefExport(BRIEF, 'markdown')).toBe(BRIEF.text);
    expect(contextBriefExportFilename(BRIEF, 'markdown'))
      .toBe('context-brief_diagnostic_2026-09-15_to_2026-09-28.md');
  });

  it('wraps the same Markdown in a versioned JSON transport envelope', () => {
    const exportedAt = '2026-09-28T07:00:00.000Z';
    const payload = buildContextBriefJsonExport(BRIEF, exportedAt);

    expect(payload).toEqual({
      schemaVersion: 'context_brief_export_v2',
      exportedAt,
      source: 'adaptive-training-recommender',
      preset: 'diagnostic',
      purpose: 'diagnostic',
      contractVersion: '2026-09-context-brief-contract-v2',
      dateRange: {
        startDate: '2026-09-15',
        asOfDate: '2026-09-28',
        windowDays: 14,
      },
      unavailableSources: ['recovery:2026-09-20'],
      contentType: 'text/markdown',
      content: BRIEF.text,
    });
    expect(JSON.parse(formatContextBriefExport(BRIEF, 'json', exportedAt))).toEqual(payload);
    expect(contextBriefExportFilename(BRIEF, 'json'))
      .toBe('context-brief_diagnostic_2026-09-15_to_2026-09-28.json');
  });

  it('downloads with the expected filename, MIME type and URL cleanup', async () => {
    const click = vi.fn();
    const appendChild = vi.fn((node: { parentNode?: unknown }) => {
      node.parentNode = body;
      return node;
    });
    const removeChild = vi.fn((node: { parentNode?: unknown }) => {
      node.parentNode = null;
      return node;
    });
    const body = { appendChild, removeChild };
    const link = { href: '', download: '', click, parentNode: null as unknown };
    const createObjectURL = vi.fn((blob: Blob) => `blob:context-brief:${blob.type}`);
    const revokeObjectURL = vi.fn();

    vi.stubGlobal('document', {
      body,
      createElement: vi.fn(() => link),
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    downloadContextBriefFile(BRIEF, 'markdown');

    expect(link.download).toBe('context-brief_diagnostic_2026-09-15_to_2026-09-28.md');
    expect(click).toHaveBeenCalledOnce();
    expect(removeChild).toHaveBeenCalledWith(link);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:context-brief:text/markdown;charset=utf-8');

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    expect(await blob.text()).toBe(BRIEF.text);
  });

  it('includes measuredBenchmarks in JSON export envelope when present', () => {
    const briefWithBenchmarks: ContextBriefExportSource = {
      ...BRIEF,
      measuredBenchmarks: [
        {
          protocolId: 'standing-broad-jump',
          protocolRevision: 1,
          metricId: 'jump_distance_cm',
          title: 'Standing Broad Jump',
          comparisonSeriesKey: 'standing-broad-jump:1:jump_distance_cm:default',
          status: 'improving',
          current: { value: 215, unit: 'cm', date: '2026-09-28' },
          best: { value: 220, unit: 'cm', date: '2026-09-20' },
          baseline: { value: 200, unit: 'cm', date: '2026-09-01' },
        },
      ],
    };
    const exported = buildContextBriefJsonExport(briefWithBenchmarks, '2026-09-28T07:00:00.000Z');
    expect(exported.measuredBenchmarks).toBeDefined();
    expect(exported.measuredBenchmarks).toHaveLength(1);
    expect(exported.measuredBenchmarks?.[0].best?.value).toBe(220);
    expect(exported.measuredBenchmarks?.[0].current.value).toBe(215);

    // Verify omission when undefined
    const exportedWithout = buildContextBriefJsonExport(BRIEF, '2026-09-28T07:00:00.000Z');
    expect(exportedWithout.measuredBenchmarks).toBeUndefined();
    expect('measuredBenchmarks' in exportedWithout).toBe(false);
  });
});


describe('ledger export download', () => {
  it('downloads the canonical structured JSON and cleans up if the click fails', async () => {
    const { buildLedgerExport } = await import('../ledger/export/buildLedgerExport');
    const ledger = buildLedgerExport({ records: {}, asOfDate: '2026-10-26', purpose: 'planning', exportedAt: '2026-10-26T08:00:00Z' });
    const click = vi.fn(() => { throw new Error('blocked'); });
    const link = { href: '', download: '', click, parentNode: null as unknown };
    const removeChild = vi.fn();
    const body = { appendChild: vi.fn(() => { link.parentNode = { removeChild }; }) };
    vi.stubGlobal('document', { createElement: () => link, body });
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:ledger');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    expect(() => downloadLedgerExportFile(ledger)).toThrow('blocked');
    expect(link.download).toBe('ledger_planning_2026-10-13_to_2026-10-26.json');
    expect(JSON.parse(await (createObjectURL.mock.calls[0][0] as Blob).text())).toEqual(ledger);
    expect(removeChild).toHaveBeenCalledWith(link);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ledger');
  });
});
