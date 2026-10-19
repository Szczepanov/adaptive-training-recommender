import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assertValidAssessmentTrial } from '../../observations/assessmentTrials';
import { reduceAssessmentTrials } from '../../observations/assessmentReducers';
import type {
    AssessmentAttempt,
    AssessmentTrial,
    AssessmentTrialScalar,
    ComparisonDimension,
    MeasurementProtocol,
    MetricObservationDevice,
} from '../../observations/models';
import type { PerformanceTestPresentationHints } from '../../observations/performanceTestingCatalog';
import { getComparisonDimensionDefinition } from '../../observations/protocols';
import { buildComparisonContextFromStrings } from '../../observations/testingWorkflow';
import { canImportVelocityFile } from '../../observations/velocityFileImport';
import { isFixedLoadVelocityProtocol } from '../../observations/fixedLoadVelocity';
import { velocityMeasurementMethodId } from '../../observations/openBarAnalysisImport';
import {
    clearAssessmentDraft,
    loadAssessmentDraft,
    saveAssessmentDraft,
    type DraftTrialRow,
} from '../../utils/assessmentDraftStorage';
import { draftRowsToTrials, hasDeviceWithoutProvider, isRowUntouched } from '../../utils/assessmentDraftTrials';
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
    onAbandon?: () => Promise<void> | void;
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
    onAbandon,
}) => {
    const capture = protocol.capture!;
    const isFixedLoad = isFixedLoadVelocityProtocol(protocol);
    const isStrength = protocol.metricIds.includes('strength_1rm_kg') || isFixedLoad;

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
    const [abandonConfirmationRequired, setAbandonConfirmationRequired] = useState(false);
    const [clientError, setClientError] = useState<string | null>(null);
    const [rowValidationErrors, setRowValidationErrors] = useState<Record<number, { invalidFields: string[]; error?: string }>>({});
    const [missingContextKeys, setMissingContextKeys] = useState<Set<ComparisonDimension>>(new Set());
    const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
    const [setupDetailsOpen, setSetupDetailsOpen] = useState(() =>
        isFixedLoad || protocol.comparisonContext.required.some(dim => !contextValues[dim]?.trim()),
    );
    const bottomErrorRef = useRef<HTMLDivElement | null>(null);

    const scrollToFirstError = () => {
        setTimeout(() => {
            const firstInvalid = document.querySelector<HTMLElement>(
                '.trial-input-invalid, .testing-input-invalid, [aria-invalid="true"]'
            );
            if (firstInvalid) {
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                firstInvalid.focus();
            } else if (bottomErrorRef.current) {
                bottomErrorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
    };

    const importedMethod = useMemo(() => {
        if (!isFixedLoad) return undefined;
        const importedEvidence = rows.filter(row => row.validity === 'valid'
            && row.values.mean_concentric_velocity_mps !== undefined
            && ('wl_parser_version' in (row.context ?? {}) || 'openbar_parser_version' in (row.context ?? {})));
        try {
            const methods = new Set(importedEvidence.map(row => velocityMeasurementMethodId(row.device, row.context)));
            return methods.size === 1 ? [...methods][0] : undefined;
        } catch {
            return undefined;
        }
    }, [isFixedLoad, rows]);

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
        if (isFixedLoad) {
            try {
                const existingEvidence = rows.filter(row => row.validity === 'valid' && row.values.mean_concentric_velocity_mps !== undefined);
                const importedEvidence = imported.filter(row => row.validity === 'valid');
                const methods = new Set([...existingEvidence, ...importedEvidence].map(row => velocityMeasurementMethodId(row.device, row.context)));
                if (methods.size > 1) throw new Error('These repetitions use different velocity methods. Use a separate fixed-load attempt, or mark the other-method rows as practice before importing.');
                const method = [...methods][0];
                if (method && storedOrdinals.size === 0 && existingEvidence.length === 0) {
                    onContextChange({ ...contextValues, measurement_method_id: method });
                } else if (method && method !== contextValues.measurement_method_id) {
                    throw new Error('Imported velocity differs from the locked measurement method. Use a separate fixed-load attempt.');
                }
            } catch (reason) {
                setClientError(reason instanceof Error ? reason.message : 'Could not identify imported velocity method.');
                return;
            }
        }
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
        saveAssessmentDraft(userId, attempt.id, rows.map(persistedDraftRow), { contextValues, defaultDevice });
    }, [attempt.id, contextValues, defaultDevice, rows, userId]);

    // Handle carry-forward hints (e.g. standing_reach_cm for CMJ)
    const updateRowWithCarryForward = (index: number, updated: DraftTrialRow) => {
        const ordinal = rows[index]?.ordinal;
        if (ordinal && rowValidationErrors[ordinal]) {
            setRowValidationErrors(curr => {
                const next = { ...curr };
                delete next[ordinal];
                return next;
            });
        }
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
        const ordinal = rows[index].ordinal;
        if (rowValidationErrors[ordinal]) {
            setRowValidationErrors(curr => {
                const next = { ...curr };
                delete next[ordinal];
                return next;
            });
        }
        setRows(current => current.filter((_, idx) => idx !== index));
    };

    // Fixed-load previews use the same typed context and provenance gates as persistence.
    const [previewCreatedAt] = useState(() => new Date().toISOString());
    const previewTrials: AssessmentTrial[] = useMemo(
        () => {
            try {
                const context = isFixedLoad ? buildComparisonContextFromStrings(protocol, contextValues) : {};
                const activeRows = rows.filter(row => storedOrdinals.has(row.ordinal) || !isRowUntouched(row, presentationHints?.carryForwardFieldIds));
                return draftRowsToTrials(activeRows, attempt.id, context, defaultDevice, previewCreatedAt);
            } catch {
                return [];
            }
        },
        [rows, attempt.id, previewCreatedAt, isFixedLoad, protocol, contextValues, defaultDevice, storedOrdinals, presentationHints?.carryForwardFieldIds],
    );

    // Build the persisted trial records: typed comparison context (same parsing as the derived
    // observations), normalized device provenance and one createdAt per save.
    const buildTrialsForSave = (): { trials: AssessmentTrial[] } | { error: string } => {
        setHasAttemptedSave(true);
        const activeRows = rows.filter(row => storedOrdinals.has(row.ordinal) || !isRowUntouched(row, presentationHints?.carryForwardFieldIds));
        if (activeRows.length === 0) {
            return { error: 'At least one trial is required. Please record attempt values before saving.' };
        }

        const newMissingContext = new Set<ComparisonDimension>();
        for (const dim of protocol.comparisonContext.required) {
            const raw = contextValues[dim];
            if (raw === undefined || raw.trim() === '') {
                newMissingContext.add(dim);
            }
        }

        const pendingImportReview = activeRows.find(row => row.importReview
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
        const incompleteDevice = activeRows.find(row => hasDeviceWithoutProvider(row.device));
        if (incompleteDevice) return { error: `Trial ${incompleteDevice.ordinal} device override requires a provider.` };

        const newRowErrors: Record<number, { invalidFields: string[]; error?: string }> = {};
        for (const row of activeRows) {
            const rowInvalidFields: string[] = [];
            if (row.validity === 'valid' || row.validity === 'questionable') {
                for (const field of capture.fields) {
                    if (field.required) {
                        const val = row.values[field.id];
                        if (val === undefined || (field.valueKind === 'number' && !Number.isFinite(val))) {
                            rowInvalidFields.push(field.id);
                        }
                    }
                    if (field.id in row.values) {
                        const val = row.values[field.id];
                        if (field.valueKind === 'number' && typeof val === 'number') {
                            if (val < field.minimum || val > field.maximum) {
                                rowInvalidFields.push(field.id);
                            }
                        }
                    }
                }
            }
            if (row.validity === 'invalid' && (!row.invalidReason || row.invalidReason.trim() === '')) {
                rowInvalidFields.push('invalidReason');
            }
            if (rowInvalidFields.length > 0) {
                newRowErrors[row.ordinal] = {
                    invalidFields: rowInvalidFields,
                    error: `${isStrength ? 'Attempt' : 'Trial'} ${row.ordinal} is missing required fields (${rowInvalidFields.map(f => {
                        if (f === 'invalidReason') return 'Reason';
                        const fDef = capture.fields.find(cf => cf.id === f);
                        return fDef ? fDef.label : f;
                    }).join(', ')}).`,
                };
            }
        }

        setMissingContextKeys(newMissingContext);
        setRowValidationErrors(newRowErrors);

        if (newMissingContext.size > 0) {
            setSetupDetailsOpen(true);
            const dimNames = [...newMissingContext].map(d => getComparisonDimensionDefinition(d).description || d);
            return { error: `Please complete required attempt setup: ${dimNames.join(', ')}.` };
        }

        const firstRowError = Object.values(newRowErrors)[0];
        if (firstRowError) {
            return { error: firstRowError.error ?? 'Please complete all required attempt fields.' };
        }

        try {
            const context = buildComparisonContextFromStrings(protocol, contextValues);
            const built = draftRowsToTrials(activeRows, attempt.id, context, defaultDevice, new Date().toISOString());
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
            scrollToFirstError();
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
                scrollToFirstError();
            }
        }
    };

    const rawVideoInstruction = protocol.instructions.find(i => i.id === 'raw-video');

    return (
        <section className="testing-card trial-capture-section">
            <header className="trial-capture-header">
                <div className="trial-capture-step-badge">Step 2 of 2 · Log Measurements</div>
                <h3>Record assessment trials</h3>
                <p className="trial-capture-subtitle">
                    Enter the measurements from the attempts you just completed in the workout session.
                </p>
                <p className="trial-attempt-meta">
                    Attempt <code>{attempt.id}</code> · {protocol.title} (rev {protocol.revision})
                </p>
            </header>

            {rawVideoInstruction && (
                <div className="testing-card raw-video-reminder" role="note">
                    <strong>Raw video reminder:</strong> {rawVideoInstruction.text}
                </div>
            )}

            {isFixedLoad && <p>Use the same exact load and equipment/camera setup for every benchmark repetition. Imported files lock their actual measurement method. Failed or off-load repetitions must be practice or invalid.</p>}
            <details
                className="testing-card attempt-setup-details"
                open={setupDetailsOpen}
                onToggle={e => setSetupDetailsOpen(e.currentTarget.open)}
            >
                <summary>Attempt context &amp; device setup (shared across trials)</summary>
                <div className="testing-grid">
                    {protocol.comparisonContext.required.map(dimension => {
                        const definition = getComparisonDimensionDefinition(dimension);
                        const isMissing = missingContextKeys.has(dimension) || (hasAttemptedSave && (!contextValues[dimension] || contextValues[dimension].trim() === ''));
                        return (
                            <label key={dimension} className="dimension-field-group">
                                <span>
                                    <strong>{definition.displayName}</strong> <span className="dimension-technical-id">({dimension})</span>
                                    <span className="required-indicator" aria-hidden="true">*</span>
                                </span>
                                {definition.athleteGuidance && (
                                    <span className="dimension-guidance">{definition.athleteGuidance}</span>
                                )}
                                {definition.presets && definition.presets.length > 0 && !(isFixedLoad && storedOrdinals.size > 0) && (
                                    <div className="dimension-presets" role="group" aria-label={`Suggested options for ${definition.displayName}`}>
                                        {definition.presets.map(preset => (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                className={`preset-chip ${contextValues[dimension] === preset.id ? 'active' : ''}`}
                                                disabled={saving}
                                                onClick={() => {
                                                    onContextChange({
                                                        ...contextValues,
                                                        [dimension]: preset.id,
                                                    });
                                                    if (missingContextKeys.has(dimension)) {
                                                        setMissingContextKeys(prev => {
                                                            const next = new Set(prev);
                                                            next.delete(dimension);
                                                            return next;
                                                        });
                                                    }
                                                }}
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <input
                                    type={definition.valueKind === 'number' ? 'number' : 'text'}
                                    step={definition.valueKind === 'number' ? 'any' : undefined}
                                    value={contextValues[dimension] ?? ''}
                                    readOnly={isFixedLoad && (storedOrdinals.size > 0
                                        || (dimension === 'measurement_method_id' && importedMethod !== undefined
                                            && contextValues[dimension] === importedMethod))}
                                    disabled={saving}
                                    placeholder={definition.athleteGuidance ?? `Enter ${definition.displayName}`}
                                    className={isMissing ? 'trial-input trial-input-invalid' : 'trial-input'}
                                    aria-invalid={isMissing ? 'true' : undefined}
                                    aria-required="true"
                                    onChange={e => {
                                        const val = e.target.value;
                                        onContextChange({
                                            ...contextValues,
                                            [dimension]: val,
                                        });
                                        if (missingContextKeys.has(dimension) && val.trim()) {
                                            setMissingContextKeys(prev => {
                                                const next = new Set(prev);
                                                next.delete(dimension);
                                                return next;
                                            });
                                        }
                                    }}
                                />
                                {isMissing && (
                                    <span className="testing-field-error" role="alert">This field is required</span>
                                )}
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
                        invalidFields={rowValidationErrors[row.ordinal]?.invalidFields}
                        rowError={rowValidationErrors[row.ordinal]?.error}
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

            {clientError && (
                <div className="testing-error testing-error-bottom" role="alert" tabIndex={-1} ref={bottomErrorRef}>
                    <strong>Validation error:</strong> {clientError}
                </div>
            )}

            {abandonConfirmationRequired ? (
                <div className="testing-card abandon-attempt-warning" role="alert">
                    <p>
                        Abandoning will cancel this assessment attempt. No benchmark observations will be saved.
                    </p>
                    <div className="testing-actions">
                        <button
                            type="button"
                            className="testing-secondary"
                            onClick={() => setAbandonConfirmationRequired(false)}
                            disabled={saving}
                        >
                            Return to capture
                        </button>
                        <button
                            type="button"
                            className="testing-secondary testing-danger-btn"
                            onClick={async () => {
                                if (onAbandon) await onAbandon();
                            }}
                            disabled={saving}
                        >
                            Confirm & abandon attempt
                        </button>
                    </div>
                </div>
            ) : missingConfirmationRequired ? (
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
                <>
                    <div className="testing-actions">
                        {onAbandon && (
                            <button
                                type="button"
                                className="testing-secondary testing-danger-btn"
                                onClick={() => setAbandonConfirmationRequired(true)}
                                disabled={saving}
                            >
                                Abandon attempt
                            </button>
                        )}
                        <button
                            type="button"
                            className="testing-primary"
                            onClick={() => handleSave(false)}
                            disabled={saving}
                        >
                            {saving ? 'Saving…' : 'Save assessment trials'}
                        </button>
                    </div>
                </>
            )}
        </section>
    );
};
