import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { assertValidAssessmentTrial } from '../../observations/assessmentTrials';
import { reduceAssessmentTrials } from '../../observations/assessmentReducers';
import type {
    AssessmentAttempt,
    AssessmentTrial,
    AssessmentTrialScalar,
    MeasurementProtocol,
    MetricObservationDevice,
} from '../../observations/models';
import type { PerformanceTestPresentationHints } from '../../observations/performanceTestingCatalog';
import { getComparisonDimensionDefinition } from '../../observations/protocols';
import { buildComparisonContextFromStrings } from '../../observations/testingWorkflow';
import { canImportVelocityFile } from '../../observations/velocityFileImport';
import {
    clearAssessmentDraft,
    loadAssessmentDraft,
    saveAssessmentDraft,
    type DraftTrialRow,
} from '../../utils/assessmentDraftStorage';
import { draftRowsToTrials, hasDeviceWithoutProvider } from '../../utils/assessmentDraftTrials';
import { CanonicalResultPreview } from './CanonicalResultPreview';
import { TrialRow } from './TrialRow';
import { WlAnalysisImportPanel } from './WlAnalysisImportPanel';
import { OpenBarImportPanel } from './OpenBarImportPanel';

interface TrialCaptureTableProps {
    userId: string;
    protocol: MeasurementProtocol;
    attempt: AssessmentAttempt;
    contextValues: Record<string, string>;
    onContextChange: (updated: Record<string, string>) => void;
    defaultDevice: MetricObservationDevice;
    onDefaultDeviceChange: (updated: MetricObservationDevice) => void;
    onSave: (trials: AssessmentTrial[], allowMissingBenchmark: boolean) => Promise<void>;
    saving: boolean;
    presentationHints?: PerformanceTestPresentationHints;
    initialTrials?: readonly AssessmentTrial[];
}

interface TrialCaptureRow extends DraftTrialRow {
    /** UI-only identity: remains stable when display/storage ordinals are renumbered. */
    clientId: string;
}

function persistedDraftRow(row: TrialCaptureRow): DraftTrialRow {
    return {
        ordinal: row.ordinal,
        values: row.values,
        validity: row.validity,
        ...(row.invalidReason !== undefined ? { invalidReason: row.invalidReason } : {}),
        ...(row.notes !== undefined ? { notes: row.notes } : {}),
        ...(row.device !== undefined ? { device: row.device } : {}),
        ...(row.sourceRef !== undefined ? { sourceRef: row.sourceRef } : {}),
        ...(row.context !== undefined ? { context: row.context } : {}),
        ...(row.importReview !== undefined ? { importReview: row.importReview } : {}),
    };
}

export const TrialCaptureTable: React.FC<TrialCaptureTableProps> = ({
    userId,
    protocol,
    attempt,
    contextValues,
    onContextChange,
    defaultDevice,
    onDefaultDeviceChange,
    onSave,
    saving,
    presentationHints,
    initialTrials,
}) => {
    const capture = protocol.capture!;
    const isStrength = protocol.metricIds.includes('strength_1rm_kg');

    // Trials already persisted by an interrupted save are immutable evidence: they win over any
    // local draft for their ordinal and render read-only, so a resubmission cannot diverge.
    const storedOrdinals = useMemo(
        () => new Set((initialTrials ?? []).map(trial => trial.ordinal)),
        [initialTrials],
    );

    const initializeRows = useCallback((): TrialCaptureRow[] => {
        const savedDraft = loadAssessmentDraft(userId, attempt.id);
        let nextClientSequence = 1;
        const attachClientId = (row: DraftTrialRow): TrialCaptureRow => ({
            ...row,
            clientId: `trial-row-${attempt.id}-${nextClientSequence++}`,
        });

        if (initialTrials && initialTrials.length > 0) {
            const activeByOrdinal = new Map<number, AssessmentTrial>();
            for (const trial of initialTrials) {
                const current = activeByOrdinal.get(trial.ordinal);
                if (!current || trial.correctionIndex > current.correctionIndex) activeByOrdinal.set(trial.ordinal, trial);
            }
            const storedRows: TrialCaptureRow[] = [...activeByOrdinal.values()]
                .sort((a, b) => a.ordinal - b.ordinal)
                .map(t => attachClientId({
                    ordinal: t.ordinal,
                    values: t.values,
                    validity: t.validity,
                    invalidReason: t.invalidReason,
                    notes: t.notes,
                    device: t.device,
                    sourceRef: t.sourceRef,
                    context: { ...t.context },
                }));
            const draftOnlyRows = (savedDraft ?? [])
                .filter(row => !activeByOrdinal.has(row.ordinal))
                .map(attachClientId);
            return [...storedRows, ...draftOnlyRows];
        }
        if (savedDraft) return savedDraft.map(attachClientId);

        const count = capture.plannedTrials;
        const initial: TrialCaptureRow[] = [];
        for (let i = 1; i <= count; i++) {
            initial.push(attachClientId({
                ordinal: i,
                values: {},
                validity: 'valid',
            }));
        }
        return initial;
    }, [attempt.id, capture.plannedTrials, initialTrials, userId]);

    const [rows, setRows] = useState<TrialCaptureRow[]>(initializeRows);
    const [missingConfirmationRequired, setMissingConfirmationRequired] = useState(false);
    const [clientError, setClientError] = useState<string | null>(null);

    const wlImportAllowed = canImportVelocityFile(protocol, attempt);
    const existingSourceRefs = useMemo(() => {
        const refs = new Set<string>();
        for (const row of rows) {
            if (row.sourceRef) refs.add(row.sourceRef);
        }
        for (const trial of initialTrials ?? []) {
            if (trial.sourceRef) refs.add(trial.sourceRef);
        }
        return refs;
    }, [rows, initialTrials]);
    const occupiedOrdinals = useMemo(() => new Set(rows.map(row => row.ordinal)), [rows]);
    const existingSourceVideoHashes = useMemo(() => new Set(
        [...rows, ...(initialTrials ?? [])].map(row => row.context?.openbar_source_video_sha256)
            .filter((hash): hash is string => typeof hash === 'string'),
    ), [rows, initialTrials]);
    const unavailableImportOrdinals = useMemo(() => new Set([
        ...storedOrdinals,
        ...rows.filter(row => Object.keys(row.values).length > 0 || row.sourceRef || row.notes || row.invalidReason || row.device || Object.keys(row.context ?? {}).length > 0 || row.validity !== 'valid')
            .map(row => row.ordinal),
    ]), [rows, storedOrdinals]);

    const handleImportApply = (imported: DraftTrialRow[]) => {
        setClientError(null);
        setRows(current => {
            let nextClientSequence = current.reduce((maxSequence, row) => {
                const match = row.clientId.match(/-(\d+)$/);
                const sequence = match ? Number(match[1]) : 0;
                return Math.max(maxSequence, sequence);
            }, 0);
            const next = [...current];
            for (const importedRow of imported) {
                if (storedOrdinals.has(importedRow.ordinal)) return current;
                const index = next.findIndex(row => row.ordinal === importedRow.ordinal);
                if (index === -1) {
                    nextClientSequence += 1;
                    next.push({
                        ...importedRow,
                        clientId: `trial-row-${attempt.id}-${nextClientSequence}`,
                    });
                } else {
                    next[index] = { ...importedRow, clientId: next[index].clientId };
                }
            }
            return next.sort((a, b) => a.ordinal - b.ordinal);
        });
    };

    // Persist draft on changes
    useEffect(() => {
        saveAssessmentDraft(userId, attempt.id, rows.map(persistedDraftRow));
    }, [attempt.id, rows, userId]);

    // Handle carry-forward hints (e.g. standing_reach_cm for CMJ)
    const updateRowWithCarryForward = (index: number, updated: DraftTrialRow) => {
        setRows(current => {
            if (storedOrdinals.has(current[index].ordinal)) return current;
            const next = [...current];
            next[index] = { ...updated, clientId: current[index].clientId };

            if (index === 0 && presentationHints?.carryForwardFieldIds) {
                for (const fieldId of presentationHints.carryForwardFieldIds) {
                    const firstVal = updated.values[fieldId];
                    if (firstVal !== undefined) {
                        for (let j = 1; j < next.length; j++) {
                            if (next[j].values[fieldId] === undefined && !storedOrdinals.has(next[j].ordinal)) {
                                next[j] = {
                                    ...next[j],
                                    values: {
                                        ...next[j].values,
                                        [fieldId]: firstVal,
                                    },
                                };
                            }
                        }
                    }
                }
            }
            return next;
        });
    };

    const addAttempt = () => {
        setRows(current => {
            if (current.length >= capture.maxTrials) return current;
            const usedOrdinals = new Set(current.map(row => row.ordinal));
            let nextOrdinal = 1;
            while (nextOrdinal <= capture.maxTrials && usedOrdinals.has(nextOrdinal)) nextOrdinal += 1;
            if (nextOrdinal > capture.maxTrials) return current;
            const carryValues: Record<string, AssessmentTrialScalar> = {};
            if (presentationHints?.carryForwardFieldIds && current.length > 0) {
                for (const fieldId of presentationHints.carryForwardFieldIds) {
                    const existingVal = current[0].values[fieldId];
                    if (existingVal !== undefined) carryValues[fieldId] = existingVal;
                }
            }
            const nextClientSequence = current.reduce((maxSequence, row) => {
                const match = row.clientId.match(/-(\d+)$/);
                const sequence = match ? Number(match[1]) : 0;
                return Math.max(maxSequence, sequence);
            }, 0) + 1;

            const nextRow: TrialCaptureRow = {
                ordinal: nextOrdinal,
                values: carryValues,
                validity: 'valid',
                clientId: `trial-row-${attempt.id}-${nextClientSequence}`,
            };
            return [...current, nextRow].sort((a, b) => a.ordinal - b.ordinal);
        });
    };

    const removeAttempt = (index: number) => {
        if (rows.length <= 1 || storedOrdinals.has(rows[index].ordinal)) return;
        setRows(current => current.filter((_, idx) => idx !== index));
    };

    // Live preview only: the reducers read trial values and validity, not context or provenance.
    const [previewCreatedAt] = useState(() => new Date().toISOString());
    const previewTrials: AssessmentTrial[] = useMemo(
        () => draftRowsToTrials(rows, attempt.id, {}, { provider: '' }, previewCreatedAt),
        [rows, attempt.id, previewCreatedAt],
    );

    // Build the persisted trial records: typed comparison context (same parsing as the derived
    // observations), normalized device provenance and one createdAt per save.
    const buildTrialsForSave = (): { trials: AssessmentTrial[] } | { error: string } => {
        if (rows.length === 0) return { error: 'At least one trial is required.' };
        const pendingImportReview = rows.find(row => row.importReview
            && (!row.importReview.loadKgConfirmed
                || !row.importReview.successConfirmed
                || !row.importReview.validityConfirmed));
        if (pendingImportReview) {
            const missing: string[] = [];
            if (!pendingImportReview.importReview?.loadKgConfirmed) missing.push('load unit');
            if (!pendingImportReview.importReview?.successConfirmed) missing.push('success/miss');
            if (!pendingImportReview.importReview?.validityConfirmed) missing.push('validity');
            return {
                error: `Attempt ${pendingImportReview.ordinal}: confirm imported ${missing.join(', ')} before saving.`,
            };
        }
        const incompleteDevice = rows.find(row => hasDeviceWithoutProvider(row.device));
        if (incompleteDevice) return { error: `Trial ${incompleteDevice.ordinal} device override requires a provider.` };
        try {
            const context = buildComparisonContextFromStrings(protocol, contextValues);
            const built = draftRowsToTrials(rows, attempt.id, context, defaultDevice, new Date().toISOString());
            built.forEach(trial => assertValidAssessmentTrial(trial, protocol));
            return { trials: built };
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Invalid trial data' };
        }
    };

    const handleSave = async (allowMissingBenchmark = false) => {
        setClientError(null);
        const built = buildTrialsForSave();
        if ('error' in built) {
            setClientError(built.error);
            return;
        }
        const { trials } = built;

        const outcomes = reduceAssessmentTrials(protocol, attempt.id, trials);
        const hasMissing = outcomes.some(o => o.status === 'no_valid_trial');
        if (hasMissing && !allowMissingBenchmark) {
            setMissingConfirmationRequired(true);
            return;
        }

        try {
            await onSave(trials, allowMissingBenchmark);
            clearAssessmentDraft(userId, attempt.id);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Save failed';
            if (msg.includes('Confirmation required')) {
                setMissingConfirmationRequired(true);
            } else {
                setClientError(msg);
            }
        }
    };

    const rawVideoInstruction = protocol.instructions.find(i => i.id === 'raw-video');

    return (
        <section className="testing-card trial-capture-section">
            <header className="trial-capture-header">
                <h3>Record assessment trials</h3>
                <p>
                    Attempt <code>{attempt.id}</code> · {protocol.title} (rev {protocol.revision})
                </p>
            </header>

            {rawVideoInstruction && (
                <div className="testing-card raw-video-reminder" role="note">
                    <strong>Raw video reminder:</strong> {rawVideoInstruction.text}
                </div>
            )}

            {clientError && (
                <p className="testing-error" role="alert">
                    {clientError}
                </p>
            )}

            <details className="testing-card attempt-setup-details">
                <summary>Attempt context & device setup (shared across trials)</summary>
                <div className="testing-grid">
                    {protocol.comparisonContext.required.map(dimension => {
                        const definition = getComparisonDimensionDefinition(dimension);
                        return (
                            <label key={dimension}>
                                {dimension} <small>({definition.description})</small>
                                <input
                                    type="text"
                                    value={contextValues[dimension] ?? ''}
                                    onChange={e =>
                                        onContextChange({
                                            ...contextValues,
                                            [dimension]: e.target.value,
                                        })
                                    }
                                />
                            </label>
                        );
                    })}
                </div>
                <h4>Default recording device</h4>
                <div className="testing-grid three">
                    <label>
                        Provider
                        <input
                            type="text"
                            placeholder="e.g. Garmin / Favero"
                            value={defaultDevice.provider}
                            onChange={e =>
                                onDefaultDeviceChange({
                                    ...defaultDevice,
                                    provider: e.target.value,
                                })
                            }
                        />
                    </label>
                    <label>
                        Model
                        <input
                            type="text"
                            value={defaultDevice.model ?? ''}
                            onChange={e =>
                                onDefaultDeviceChange({
                                    ...defaultDevice,
                                    model: e.target.value,
                                })
                            }
                        />
                    </label>
                    <label>
                        Device ID
                        <input
                            type="text"
                            value={defaultDevice.deviceId ?? ''}
                            onChange={e =>
                                onDefaultDeviceChange({
                                    ...defaultDevice,
                                    deviceId: e.target.value,
                                })
                            }
                        />
                    </label>
                </div>
            </details>

            <CanonicalResultPreview
                protocol={protocol}
                assessmentAttemptId={attempt.id}
                trials={previewTrials}
            />

            {wlImportAllowed && (
                <WlAnalysisImportPanel
                    protocol={protocol}
                    attempt={attempt}
                    sessionDate={attempt.scheduledDate ?? null}
                    existingSourceRefs={existingSourceRefs}
                    storedOrdinals={storedOrdinals}
                    occupiedOrdinals={occupiedOrdinals}
                    onApply={handleImportApply}
                    disabled={saving}
                />
            )}
            {wlImportAllowed && (
                <OpenBarImportPanel key={attempt.id} protocol={protocol} attempt={attempt}
                    existingSourceRefs={existingSourceRefs} existingSourceVideoHashes={existingSourceVideoHashes}
                    storedOrdinals={storedOrdinals} occupiedOrdinals={occupiedOrdinals}
                    unavailableOrdinals={unavailableImportOrdinals} onApply={handleImportApply} disabled={saving} />
            )}

            <div className="trial-rows-container">
                {rows.map((row, idx) => (
                    <TrialRow
                        key={row.clientId}
                        row={row}
                        fields={capture.fields}
                        onChange={updated => updateRowWithCarryForward(idx, updated)}
                        onRemove={() => removeAttempt(idx)}
                        canRemove={rows.length > 1 && !storedOrdinals.has(row.ordinal)}
                        locked={storedOrdinals.has(row.ordinal)}
                        isStrength={isStrength}
                    />
                ))}
            </div>

            {rows.length < capture.maxTrials && (
                <button
                    type="button"
                    className="testing-secondary add-attempt-btn"
                    onClick={addAttempt}
                    disabled={saving}
                >
                    + Add {isStrength ? 'attempt' : 'trial'} ({rows.length} of {capture.maxTrials})
                </button>
            )}

            {missingConfirmationRequired ? (
                <div className="testing-card missing-benchmark-warning" role="alert">
                    <p>
                        No valid trial was recorded for one or more metrics. Saving will complete the attempt
                        without creating a benchmark observation for those metrics.
                    </p>
                    <div className="testing-actions">
                        <button
                            type="button"
                            className="testing-secondary"
                            onClick={() => setMissingConfirmationRequired(false)}
                            disabled={saving}
                        >
                            Return to capture
                        </button>
                        <button
                            type="button"
                            className="testing-primary"
                            onClick={() => handleSave(true)}
                            disabled={saving}
                        >
                            {saving ? 'Saving…' : 'Confirm & complete without benchmark'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="testing-actions">
                    <button
                        type="button"
                        className="testing-primary"
                        onClick={() => handleSave(false)}
                        disabled={saving}
                    >
                        {saving ? 'Saving…' : 'Save assessment trials'}
                    </button>
                </div>
            )}
        </section>
    );
};
