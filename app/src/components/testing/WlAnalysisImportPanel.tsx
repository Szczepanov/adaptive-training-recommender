import React, { useRef, useState } from 'react';
import type {
    AssessmentAttempt,
    MeasurementProtocol,
} from '../../observations/models';
import type { DraftTrialRow } from '../../utils/assessmentDraftStorage';
import { parseWlAnalysisCsv } from '../../observations/wlAnalysisCsv';
import {
    annotateWlBatchDuplicates,
    assignWlOrdinals,
    checkWlApplyBlocked,
    proposeWlTrial,
    sha256Hex,
    wlProposalToDraftRow,
    type WlImportRejection,
    type WlTrialProposal,
} from '../../observations/wlAnalysisImport';

interface WlAnalysisImportPanelProps {
    protocol: MeasurementProtocol;
    attempt: AssessmentAttempt;
    sessionDate: string | null;
    existingSourceRefs: ReadonlySet<string>;
    /** Already-saved (immutable) ordinals: imported files must not target these. */
    storedOrdinals: ReadonlySet<number>;
    /** All current row ordinals, saved or draft: used for the maxTrials capacity check. */
    occupiedOrdinals: ReadonlySet<number>;
    onApply: (rows: DraftTrialRow[]) => void;
    disabled?: boolean;
}

interface PreviewState {
    proposals: WlTrialProposal[];
    rejections: WlImportRejection[];
    blockingErrors: string[];
}

function formatVelocity(value: number): string {
    return `${value.toFixed(3)} m/s`;
}

/** Scope of attempt states: the panel mounts only where `canImportWlAnalysis` holds. */
export const WlAnalysisImportPanel: React.FC<WlAnalysisImportPanelProps> = ({
    protocol,
    attempt,
    sessionDate,
    existingSourceRefs,
    storedOrdinals,
    occupiedOrdinals,
    onApply,
    disabled = false,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [loadOverrides, setLoadOverrides] = useState<Record<string, number>>({});
    const [appliedMessage, setAppliedMessage] = useState<string | null>(null);
    const maxTrials = protocol.capture?.maxTrials ?? 0;

    const clear = () => {
        setPreview(null);
        setLoadOverrides({});
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setBusy(true);
        setAppliedMessage(null);
        try {
            const proposals: WlTrialProposal[] = [];
            const rejections: WlImportRejection[] = [];
            const summaries = new Map<string, string>();
            const seenSourceRefs = new Set(existingSourceRefs);
            for (const file of [...files]) {
                try {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    const hash = await sha256Hex(bytes);
                    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
                    const parsed = parseWlAnalysisCsv(text);
                    const outcome = proposeWlTrial(
                        { fileName: file.name, fileHash: hash, parsed },
                        sessionDate,
                        seenSourceRefs,
                    );
                    if (outcome.status === 'proposed') {
                        proposals.push(outcome.proposal);
                        seenSourceRefs.add(outcome.proposal.sourceRef);
                        summaries.set(outcome.proposal.sourceRef, parsed.summarySignature);
                    } else {
                        rejections.push(outcome.rejection);
                    }
                } catch (err) {
                    rejections.push({
                        fileName: file.name,
                        reason: err instanceof Error ? err.message : 'Could not read this file.',
                    });
                }
            }
            annotateWlBatchDuplicates(proposals, summaries);
            const blockingErrors: string[] = [];
            try {
                assignWlOrdinals(proposals, maxTrials);
            } catch (err) {
                blockingErrors.push(err instanceof Error ? err.message : 'These files cannot be ordered.');
            }
            if (blockingErrors.length === 0) {
                blockingErrors.push(...checkWlApplyBlocked(proposals, storedOrdinals, occupiedOrdinals, maxTrials));
            }
            setPreview({ proposals, rejections, blockingErrors });
            setLoadOverrides({});
        } finally {
            setBusy(false);
        }
    };

    const handleApply = () => {
        if (!preview || preview.blockingErrors.length > 0) return;
        try {
            const rows = preview.proposals.map((proposal, index) => {
                const loadKg = loadOverrides[`${proposal.fileName}::${index}`] ?? proposal.loadKg;
                return wlProposalToDraftRow({ ...proposal, loadKg }, proposal.assignedOrdinal ?? 1, protocol);
            });
            onApply(rows);
            setAppliedMessage(
                `Applied ${rows.length === 1 ? '1 row' : `${rows.length} rows`} to the draft. Confirm the imported load unit, result and validity below before saving.`,
            );
            clear();
        } catch (err) {
            setPreview({
                ...preview,
                blockingErrors: [err instanceof Error ? err.message : 'Could not apply the import.'],
            });
        }
    };

    return (
        <section className="testing-card wl-import-panel" aria-label="WL Analysis CSV import">
            <div className="testing-card-header-row">
                <h4>Import WL Analysis CSV</h4>
            </div>
            <p className="testing-note">
                One exported file per filmed attempt. Files stay on this phone: only the numbers,
                the parser version and a content fingerprint are kept.
            </p>
            <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                multiple
                disabled={busy || disabled}
                onChange={e => void handleFiles(e.target.files)}
                aria-label="Choose WL Analysis CSV files"
                className="wl-file-input"
            />
            {busy && <p role="status">Reading files…</p>}
            {appliedMessage && <p role="status">{appliedMessage}</p>}

            {preview && (
                <div className="wl-preview-list">
                    {preview.rejections.map(rejection => (
                        <div key={rejection.fileName} className="wl-file-card wl-rejected" role="alert">
                            <strong>{rejection.fileName}</strong>
                            <p>Not imported: {rejection.reason}</p>
                        </div>
                    ))}
                    {preview.proposals.map((proposal, index) => {
                        // Index-scoped: two files can share a name (e.g. repeated phone exports).
                        const key = `${proposal.fileName}::${index}`;
                        const loadKg = loadOverrides[key] ?? proposal.loadKg;
                        return (
                            <div key={key} className="wl-file-card">
                                <strong>{proposal.fileName}</strong>
                                <p>
                                    Attempt {proposal.assignedOrdinal ?? '?'}
                                    {proposal.ambiguousOrder && ' (order assumed — confirm)'}
                                </p>
                                <label className="trial-field-label">
                                    <span>Load in kg (the file has no unit — confirm)</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="any"
                                        min={1}
                                        max={500}
                                        value={String(loadKg)}
                                        onChange={e => {
                                            const next = Number(e.target.value);
                                            setLoadOverrides(current => ({ ...current, [key]: next }));
                                        }}
                                        className="trial-input"
                                        aria-label={`Load in kilograms for ${proposal.fileName}`}
                                    />
                                </label>
                                <p>
                                    {proposal.repCount === 1
                                        ? '1 rep detected'
                                        : `${proposal.repCount} reps detected, fastest is rep ${proposal.selectedRep}`}
                                    {' '}· mean {formatVelocity(proposal.meanVelocityMps)}
                                    {' '}· peak {formatVelocity(proposal.peakVelocityMps)}
                                    {' '}· ROM {proposal.romCm.toFixed(1)} cm
                                </p>
                                <p>
                                    {proposal.repCount === 1 && proposal.autoDetectedSuccess
                                        ? `Will save as ${proposal.validity}, ${proposal.successful ? 'successful' : 'miss'} (auto-detected — confirm).`
                                        : `Will save as ${proposal.validity}.`}
                                </p>
                                {proposal.warnings.map(warning => (
                                    <p key={warning} className="testing-note">Note: {warning}</p>
                                ))}
                            </div>
                        );
                    })}
                    {preview.blockingErrors.map(error => (
                        <p key={error} className="testing-error" role="alert">{error}</p>
                    ))}
                    {preview.proposals.length > 0 && (
                        <div className="testing-actions">
                            <button
                                type="button"
                                className="testing-secondary"
                                onClick={clear}
                                disabled={busy}
                            >
                                Clear preview
                            </button>
                            <button
                                type="button"
                                className="testing-primary"
                                onClick={handleApply}
                                disabled={busy || preview.blockingErrors.length > 0}
                            >
                                {busy ? 'Reading…' : `Apply to draft rows (${preview.proposals.length})`}
                            </button>
                        </div>
                    )}
                    {preview.proposals.length === 0 && preview.rejections.length === 0 && (
                        <p role="status">No usable files selected.</p>
                    )}
                </div>
            )}
            <span className="testing-note">Attempt {attempt.id} · nothing is saved until you press Save below.</span>
        </section>
    );
};
