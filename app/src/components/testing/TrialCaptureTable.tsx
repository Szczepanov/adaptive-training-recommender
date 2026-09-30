import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    assertValidAssessmentTrial,
    assessmentTrialIdFor,
} from '../../observations/assessmentTrials';
import { reduceAssessmentTrials } from '../../observations/assessmentReducers';
import type {
    AssessmentAttempt,
    AssessmentTrial,
    AssessmentTrialScalar,
    ComparisonContext,
    MeasurementProtocol,
    MetricObservationDevice,
} from '../../observations/models';
import type { PerformanceTestPresentationHints } from '../../observations/performanceTestingCatalog';
import { getComparisonDimensionDefinition } from '../../observations/protocols';
import { buildComparisonContextFromStrings } from '../../observations/testingWorkflow';
import {
    clearAssessmentDraft,
    loadAssessmentDraft,
    saveAssessmentDraft,
    type DraftTrialRow,
} from '../../utils/assessmentDraftStorage';
import { CanonicalResultPreview } from './CanonicalResultPreview';
import { TrialRow } from './TrialRow';

interface TrialCaptureTableProps {
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

function normalizeDevice(device: MetricObservationDevice | undefined): MetricObservationDevice | undefined {
    const provider = device?.provider?.trim();
    if (!device || !provider) return undefined;
    const model = device.model?.trim();
    const deviceId = device.deviceId?.trim();
    return { provider, ...(model ? { model } : {}), ...(deviceId ? { deviceId } : {}) };
}

function hasDeviceWithoutProvider(device: MetricObservationDevice | undefined): boolean {
    return !!device && !device.provider?.trim() && !!(device.model?.trim() || device.deviceId?.trim());
}

function draftRowsToTrials(
    rows: readonly DraftTrialRow[],
    attemptId: string,
    context: ComparisonContext,
    defaultDevice: MetricObservationDevice,
    createdAt: string,
): AssessmentTrial[] {
    const fallbackDevice = normalizeDevice(defaultDevice);
    return rows.map(row => {
        const device = normalizeDevice(row.device) ?? fallbackDevice;
        return {
            id: assessmentTrialIdFor(row.ordinal, 0),
            assessmentAttemptId: attemptId,
            ordinal: row.ordinal,
            correctionIndex: 0,
            validity: row.validity,
            ...(row.invalidReason?.trim() ? { invalidReason: row.invalidReason.trim() } : {}),
            values: row.values,
            context,
            createdAt,
            ...(row.notes?.trim() ? { notes: row.notes.trim() } : {}),
            ...(device ? { device } : {}),
        };
    });
}

export const TrialCaptureTable: React.FC<TrialCaptureTableProps> = ({
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

    const initializeRows = useCallback((): DraftTrialRow[] => {
        const savedDraft = loadAssessmentDraft(attempt.id);

        if (initialTrials && initialTrials.length > 0) {
            const activeByOrdinal = new Map<number, AssessmentTrial>();
            for (const trial of initialTrials) {
                const current = activeByOrdinal.get(trial.ordinal);
                if (!current || trial.correctionIndex > current.correctionIndex) activeByOrdinal.set(trial.ordinal, trial);
            }
            const storedRows: DraftTrialRow[] = [...activeByOrdinal.values()]
                .sort((a, b) => a.ordinal - b.ordinal)
                .map(t => ({
                    ordinal: t.ordinal,
                    values: t.values,
                    validity: t.validity,
                    invalidReason: t.invalidReason,
                    notes: t.notes,
                    device: t.device,
                }));
            const draftOnlyRows = (savedDraft ?? []).filter(row => !activeByOrdinal.has(row.ordinal));
            return [...storedRows, ...draftOnlyRows];
        }
        if (savedDraft) return savedDraft;

        const count = capture.plannedTrials;
        const initial: DraftTrialRow[] = [];
        for (let i = 1; i <= count; i++) {
            initial.push({
                ordinal: i,
                values: {},
                validity: 'valid',
            });
        }
        return initial;
    }, [attempt.id, capture.plannedTrials, initialTrials]);

    const [rows, setRows] = useState<DraftTrialRow[]>(initializeRows);
    const [missingConfirmationRequired, setMissingConfirmationRequired] = useState(false);
    const [clientError, setClientError] = useState<string | null>(null);

    // Persist draft on changes
    useEffect(() => {
        saveAssessmentDraft(attempt.id, rows);
    }, [attempt.id, rows]);

    // Handle carry-forward hints (e.g. standing_reach_cm for CMJ)
    const updateRowWithCarryForward = (index: number, updated: DraftTrialRow) => {
        setRows(current => {
            if (storedOrdinals.has(current[index].ordinal)) return current;
            const next = [...current];
            next[index] = updated;

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
        if (rows.length >= capture.maxTrials) return;
        const nextOrdinal = rows.length + 1;
        const carryValues: Record<string, AssessmentTrialScalar> = {};
        if (presentationHints?.carryForwardFieldIds && rows.length > 0) {
            for (const fieldId of presentationHints.carryForwardFieldIds) {
                const existingVal = rows[0].values[fieldId];
                if (existingVal !== undefined) carryValues[fieldId] = existingVal;
            }
        }

        setRows(current => [
            ...current,
            {
                ordinal: nextOrdinal,
                values: carryValues,
                validity: 'valid',
            },
        ]);
    };

    const removeAttempt = (index: number) => {
        if (rows.length <= 1 || storedOrdinals.has(rows[index].ordinal)) return;
        setRows(current => {
            const filtered = current.filter((_, idx) => idx !== index);
            return filtered.map((row, idx) => ({ ...row, ordinal: idx + 1 }));
        });
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
            clearAssessmentDraft(attempt.id);
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

            <div className="trial-rows-container">
                {rows.map((row, idx) => (
                    <TrialRow
                        key={row.ordinal}
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
