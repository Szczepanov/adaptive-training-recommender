import React, { useEffect, useId, useRef, useState } from 'react';
import type { AssessmentAttempt, MeasurementProtocol } from '../../observations/models';
import type { DraftTrialRow } from '../../utils/assessmentDraftStorage';
import { CONCENTRIC_SEGMENTATION_V2 } from '../../observations/concentricSegmentation';
import { OPENBAR_MAX_FILE_BYTES, parseOpenBarAnalysis } from '../../observations/openBarAnalysis';
import {
    assignOpenBarOrdinals, openBarProposalToDraftRow, proposeOpenBarTrial, type OpenBarTrialProposal,
} from '../../observations/openBarAnalysisImport';
import { checkVelocityImportApplyBlocked, sha256Hex } from '../../observations/velocityFileImport';

interface AvailabilityProps {
    protocol: MeasurementProtocol;
    existingSourceRefs: ReadonlySet<string>;
    existingSourceVideoHashes: ReadonlySet<string>;
    storedOrdinals: ReadonlySet<number>;
    occupiedOrdinals: ReadonlySet<number>;
    /** Saved or populated rows; an untouched planned row can receive an import. */
    unavailableOrdinals: ReadonlySet<number>;
}
interface PreviewState {
    proposals: OpenBarTrialProposal[];
    rejections: { fileName: string; reason: string }[];
}
interface PreviewProps extends AvailabilityProps {
    preview: PreviewState;
    loads: Readonly<Record<string, string>>;
    onLoadChange: (sourceRef: string, value: string) => void;
    onApply: (rows: DraftTrialRow[]) => void;
    onClear: () => void;
    disabled?: boolean;
}

/** Stateless preview used by the panel and the synthetic visual/component fixtures. */
export const OpenBarImportPreview: React.FC<PreviewProps> = ({
    protocol, existingSourceRefs, existingSourceVideoHashes, storedOrdinals, occupiedOrdinals,
    unavailableOrdinals, preview, loads, onLoadChange, onApply, onClear, disabled = false,
}) => {
    const previewId = useId();
    const proposals = preview.proposals.map(proposal => ({ ...proposal }));
    const errors: string[] = [];
    const loadErrors = new Map<string, string>();
    const rows: DraftTrialRow[] = [];
    const maxTrials = protocol.capture?.maxTrials ?? 0;
    try {
        assignOpenBarOrdinals(proposals, unavailableOrdinals, maxTrials);
        errors.push(...checkVelocityImportApplyBlocked(proposals, storedOrdinals, occupiedOrdinals, maxTrials));
    } catch (error) {
        errors.push(error instanceof Error ? error.message : 'These files do not fit into this attempt.');
    }
    for (const proposal of proposals) {
        if (existingSourceRefs.has(proposal.sourceRef) || existingSourceVideoHashes.has(proposal.sourceVideoSha256)) {
            errors.push(`${proposal.fileName}: this file or video is already in the attempt. Clear the preview and choose another video.`);
        }
        const input = loads[proposal.sourceRef] ?? '';
        if (!input.trim()) {
            loadErrors.set(proposal.sourceRef, 'Enter the load in kg.');
            continue;
        }
        try {
            rows.push(openBarProposalToDraftRow({ ...proposal, loadKg: Number(input) }, proposal.assignedOrdinal ?? 1, protocol));
        } catch (error) {
            loadErrors.set(proposal.sourceRef, error instanceof Error ? error.message : 'Enter a valid load in kg.');
        }
    }
    const loadField = protocol.capture?.fields.find(field => field.id === 'load_kg');
    const minLoad = loadField?.valueKind === 'number' ? loadField.minimum : undefined;
    const maxLoad = loadField?.valueKind === 'number' ? loadField.maximum : undefined;
    return (
        <div className="openbar-preview-list">
            {preview.rejections.map((rejection, index) => (
                <div key={`${rejection.fileName}-${index}`} className="openbar-file-card wl-rejected" role="alert">
                    <strong>{rejection.fileName}</strong><p>Not imported: {rejection.reason}</p>
                </div>
            ))}
            {proposals.map(proposal => (
                <div key={proposal.sourceRef} className="openbar-file-card">
                    <strong>{proposal.fileName}</strong>
                    <p>Attempt {proposal.assignedOrdinal ?? '?'} (order assumed — confirm)</p>
                    <label className="trial-field-label">
                        <span>Load in kg</span>
                        <input type="number" inputMode="decimal" step="any" min={minLoad} max={maxLoad}
                            value={loads[proposal.sourceRef] ?? ''} disabled={disabled}
                            onChange={event => onLoadChange(proposal.sourceRef, event.target.value)}
                            required aria-invalid={Boolean((loads[proposal.sourceRef] ?? '').trim() && loadErrors.has(proposal.sourceRef))}
                            aria-describedby={loadErrors.has(proposal.sourceRef) ? `${previewId}-${proposal.sourceRef}` : undefined}
                            aria-label={`Load in kilograms for ${proposal.fileName}`} className="trial-input" />
                    </label>
                    {loadErrors.has(proposal.sourceRef) && (
                        <p id={`${previewId}-${proposal.sourceRef}`} className="testing-note" role={(loads[proposal.sourceRef] ?? '').trim() ? 'alert' : undefined}>{loadErrors.get(proposal.sourceRef)}</p>
                    )}
                    <p>{proposal.repCount} rep{proposal.repCount === 1 ? '' : 's'} detected · {proposal.eligibleRepCount} usable · selected rep {proposal.selectedRep}</p>
                    <p>Mean {proposal.meanVelocityMps.toFixed(3)} m/s · peak {proposal.peakVelocityMps.toFixed(3)} m/s · ROM {proposal.romCm.toFixed(1)} cm</p>
                    <p>Will save as {proposal.validity}{proposal.autoDetectedSuccess ? `, ${proposal.successful ? 'successful' : 'miss'} (auto-detected — confirm)` : ''}.</p>
                    {proposal.excludedReps.map(rep => (
                        <p key={rep.index} className="testing-note">Rep {rep.index + 1} not used: {rep.exclusion === 'spans_gap' ? 'tracking gap' : 'movement starts or ends at the edge of the clip'}.</p>
                    ))}
                </div>
            ))}
            {errors.map((error, index) => <p key={index} role="alert" className="testing-error">{error}</p>)}
            <div className="testing-actions">
                <button type="button" className="testing-secondary" onClick={onClear} disabled={disabled}>Clear OpenBar preview</button>
                {proposals.length > 0 && (
                    <button type="button" className="testing-primary" disabled={disabled || errors.length > 0 || loadErrors.size > 0}
                        onClick={() => onApply(rows)}>Apply OpenBar to draft rows ({proposals.length})</button>
                )}
            </div>
        </div>
    );
};

interface OpenBarImportPanelProps extends AvailabilityProps {
    attempt: AssessmentAttempt;
    onApply: (rows: DraftTrialRow[]) => void;
    disabled?: boolean;
}
export const OpenBarImportPanel: React.FC<OpenBarImportPanelProps> = ({ attempt, onApply, disabled = false, ...availability }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const generation = useRef(0);
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [loads, setLoads] = useState<Record<string, string>>({});
    const [appliedMessage, setAppliedMessage] = useState<string | null>(null);
    useEffect(() => () => { generation.current += 1; }, []);
    const clear = () => {
        setPreview(null); setLoads({});
        if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.focus(); }
    };
    const handleFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        const currentGeneration = ++generation.current;
        setBusy(true); setAppliedMessage(null); setPreview(null); setLoads({});
        const result: PreviewState = { proposals: [], rejections: [] };
        const seenRefs = new Set(availability.existingSourceRefs);
        const seenVideos = new Set(availability.existingSourceVideoHashes);
        try {
            for (const file of [...files]) {
                try {
                    if (file.size > OPENBAR_MAX_FILE_BYTES) throw new Error('This OpenBar file exceeds 20 MB. Export a shorter clip.');
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    const fileHash = await sha256Hex(bytes);
                    if (generation.current !== currentGeneration) return;
                    const parsed = parseOpenBarAnalysis(new TextDecoder('utf-8', { fatal: true }).decode(bytes), CONCENTRIC_SEGMENTATION_V2);
                    const outcome = proposeOpenBarTrial({ fileName: file.name, fileHash, parsed }, seenRefs, seenVideos);
                    if (outcome.status === 'proposed') {
                        result.proposals.push(outcome.proposal);
                        seenRefs.add(outcome.proposal.sourceRef); seenVideos.add(parsed.sourceVideoSha256);
                    } else result.rejections.push(outcome.rejection);
                } catch (error) {
                    result.rejections.push({ fileName: file.name, reason: error instanceof Error ? error.message : 'Could not read this OpenBar file.' });
                }
            }
            if (generation.current === currentGeneration) setPreview(result);
        } finally {
            if (generation.current === currentGeneration) setBusy(false);
        }
    };
    return (
        <section className="testing-card openbar-import-panel" aria-label="OpenBar analysis import">
            <h4>Import OpenBar analysis (JSON)</h4>
            <p className="testing-note">One analysis per filmed attempt. Files stay on this phone: only the numbers, provenance and a content fingerprint are kept.</p>
            <input ref={fileInputRef} type="file" accept=".json,application/json" multiple disabled={busy || disabled}
                onChange={event => void handleFiles(event.target.files)} aria-label="Choose OpenBar analysis files" className="openbar-file-input" />
            {busy && <p role="status">Reading OpenBar files…</p>}
            {appliedMessage && <p role="status">{appliedMessage}</p>}
            {preview && <OpenBarImportPreview {...availability} preview={preview} loads={loads} disabled={busy || disabled}
                onLoadChange={(sourceRef, value) => setLoads(current => ({ ...current, [sourceRef]: value }))} onClear={clear}
                onApply={rows => { onApply(rows); setAppliedMessage(`Applied ${rows.length} OpenBar row(s) to the draft. Confirm the result and technical validity below before saving.`); clear(); }} />}
            <span className="testing-note">Attempt {attempt.id} · nothing is saved until you press Save below.</span>
        </section>
    );
};
