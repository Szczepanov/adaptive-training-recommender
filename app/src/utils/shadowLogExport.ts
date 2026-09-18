import { renderShadowLogCsv } from '../engine/shadowLog';
import { summarizeShadowLog } from '../engine/shadowReadout';
import type { ShadowLogResult } from '../services/shadowLogService';

const SHADOW_EXPORT_SCHEMA_VERSION = 1;

function downloadTextFile(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/** Downloads the two operator artifacts for a Phase 9.0 readout. The CSV has the
 * permitted day-level evidence (including the athlete's own journal note); the manifest
 * is aggregate-only and carries gate, policy-segment, and source-read quality status.
 * Neither filename nor content contains a user identifier or raw wearable payload. */
export function downloadShadowEvidence(result: ShadowLogResult): void {
    const stem = `shadow-evidence_${result.startDate}_to_${result.endDate}`;
    downloadTextFile(`${stem}.csv`, renderShadowLogCsv(result.rows), 'text/csv;charset=utf-8');
    const manifest = {
        schemaVersion: SHADOW_EXPORT_SCHEMA_VERSION,
        startDate: result.startDate,
        endDate: result.endDate,
        unavailableSources: result.unavailableSources,
        readout: summarizeShadowLog(result.rows),
    };
    downloadTextFile(`${stem}.readout.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'application/json;charset=utf-8');
}
