import React, { useState } from 'react';
import { assessmentTrialIdFor } from '../../observations/assessmentTrials';
import type {
    AssessmentAttempt,
    AssessmentTrial,
    AssessmentTrialScalar,
    ComparisonContext,
    MeasurementProtocol,
    MetricObservationDevice,
    MetricObservationRevision,
    ObservationValidity,
} from '../../observations/models';
import { assessmentCaptureService } from '../../services/assessmentCaptureService';

interface TrialCorrectionPanelProps {
    userId: string;
    protocol: MeasurementProtocol;
    attempt: AssessmentAttempt;
    trials: readonly AssessmentTrial[];
    context: ComparisonContext;
    observedAt: string;
    device?: MetricObservationDevice;
    onCorrectionComplete: (updatedTrials: readonly AssessmentTrial[], updatedObs: readonly MetricObservationRevision[]) => void;
}

const VALIDITIES: readonly ObservationValidity[] = ['valid', 'invalid', 'practice', 'questionable'];

export const TrialCorrectionPanel: React.FC<TrialCorrectionPanelProps> = ({
    userId,
    protocol,
    attempt,
    trials,
    context,
    observedAt,
    device,
    onCorrectionComplete,
}) => {
    const capture = protocol.capture!;
    const [editingTrial, setEditingTrial] = useState<AssessmentTrial | null>(null);
    const [correctionReason, setCorrectionReason] = useState('');
    const [fieldValues, setFieldValues] = useState<Record<string, AssessmentTrialScalar>>({});
    const [validity, setValidity] = useState<ObservationValidity>('valid');
    const [invalidReason, setInvalidReason] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Group trials by ordinal to identify active head vs superseded trials
    const activeTrialByOrdinal = new Map<number, AssessmentTrial>();
    for (const t of trials) {
        const cur = activeTrialByOrdinal.get(t.ordinal);
        if (!cur || t.correctionIndex > cur.correctionIndex) {
            activeTrialByOrdinal.set(t.ordinal, t);
        }
    }

    const startEditing = (trial: AssessmentTrial) => {
        setEditingTrial(trial);
        setCorrectionReason('');
        setFieldValues({ ...trial.values });
        setValidity(trial.validity);
        setInvalidReason(trial.invalidReason ?? '');
        setNotes(trial.notes ?? '');
        setError(null);
    };

    const handleSaveCorrection = async () => {
        if (!editingTrial) return;
        if (!correctionReason.trim()) {
            setError('Correction reason is required.');
            return;
        }
        if (validity === 'invalid' && !invalidReason.trim()) {
            setError('Invalid attempts require a reason.');
            return;
        }

        setBusy(true);
        setError(null);

        const newCorrectionIndex = editingTrial.correctionIndex + 1;
        const correctedTrial: AssessmentTrial = {
            id: assessmentTrialIdFor(editingTrial.ordinal, newCorrectionIndex),
            assessmentAttemptId: attempt.id,
            ordinal: editingTrial.ordinal,
            correctionIndex: newCorrectionIndex,
            supersedesTrialId: editingTrial.id,
            correctionReason: correctionReason.trim(),
            validity,
            ...(validity === 'invalid' ? { invalidReason: invalidReason.trim() } : {}),
            values: fieldValues,
            // A correction fixes a recorded trial; it never re-locks the attempt's context.
            context: editingTrial.context,
            createdAt: new Date().toISOString(),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(editingTrial.device ? { device: editingTrial.device } : device ? { device } : {}),
        };

        try {
            const result = await assessmentCaptureService.correctTrial({
                userId,
                protocol,
                attempt,
                trial: correctedTrial,
                context,
                observedAt,
                device,
            });
            onCorrectionComplete(result.trials, result.observations);
            setEditingTrial(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Correction failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="trial-correction-section">
            <h4>Raw trials & corrections</h4>
            <div className="trial-history-table-container">
                <table className="trial-history-table">
                    <thead>
                        <tr>
                            <th>Attempt</th>
                            <th>Status</th>
                            {capture.fields.map(f => (
                                <th key={f.id}>{f.label}</th>
                            ))}
                            <th>Validity</th>
                            <th>Notes</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {trials.map(t => {
                            const isActive = activeTrialByOrdinal.get(t.ordinal)?.id === t.id;
                            return (
                                <tr key={t.id} className={isActive ? 'trial-active' : 'trial-superseded'}>
                                    <td>
                                        <strong>{t.ordinal}</strong>
                                        {t.correctionIndex > 0 && <small> (c{t.correctionIndex})</small>}
                                    </td>
                                    <td>
                                        <span className={`trial-badge ${isActive ? 'badge-active' : 'badge-superseded'}`}>
                                            {isActive ? 'Active' : 'Superseded'}
                                        </span>
                                    </td>
                                    {capture.fields.map(f => {
                                        const val = t.values[f.id];
                                        const unit = f.valueKind === 'number' ? f.unit : '';
                                        return (
                                            <td key={f.id}>
                                                {typeof val === 'boolean'
                                                    ? val ? 'Yes' : 'No'
                                                    : val !== undefined ? `${val} ${unit}`.trim() : '—'}
                                            </td>
                                        );
                                    })}
                                    <td>
                                        {t.validity}
                                        {t.invalidReason ? `: ${t.invalidReason}` : ''}
                                    </td>
                                    <td>
                                        {t.correctionReason ? <em>Correction: {t.correctionReason}. </em> : ''}
                                        {t.notes ?? ''}
                                    </td>
                                    <td>
                                        {isActive && (
                                            <button
                                                type="button"
                                                className="testing-secondary trial-correct-btn"
                                                onClick={() => startEditing(t)}
                                                disabled={busy}
                                            >
                                                Correct
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {editingTrial && (
                <div className="testing-card trial-edit-modal">
                    <h4>Correct Attempt {editingTrial.ordinal} ({editingTrial.id})</h4>
                    <p>
                        This appends an immutable supersession record (c{editingTrial.correctionIndex + 1})
                        and re-derives canonical observations.
                    </p>

                    {error && (
                        <p className="testing-error" role="alert">
                            {error}
                        </p>
                    )}

                    <div className="testing-grid">
                        {capture.fields.map(field => (
                            <label key={field.id}>
                                {field.label} {field.valueKind === 'number' && field.unit ? `(${field.unit})` : ''}
                                {field.valueKind === 'boolean' ? (
                                    <select
                                        value={fieldValues[field.id] === undefined ? '' : String(fieldValues[field.id])}
                                        onChange={e => {
                                            const next = { ...fieldValues };
                                            if (e.target.value === 'true') {
                                                next[field.id] = true;
                                            } else if (e.target.value === 'false') {
                                                next[field.id] = false;
                                            } else {
                                                delete next[field.id];
                                            }
                                            setFieldValues(next);
                                        }}
                                    >
                                        <option value="">Select result…</option>
                                        <option value="true">Successful lift</option>
                                        <option value="false">Miss / Failed</option>
                                    </select>
                                ) : (
                                    <input
                                        inputMode="decimal"
                                        type="number"
                                        step="any"
                                        value={fieldValues[field.id] === undefined ? '' : String(fieldValues[field.id])}
                                        onChange={e => {
                                            const next = { ...fieldValues };
                                            if (e.target.value.trim() === '') {
                                                delete next[field.id];
                                            } else {
                                                const num = Number(e.target.value);
                                                if (Number.isFinite(num)) {
                                                    next[field.id] = num;
                                                }
                                            }
                                            setFieldValues(next);
                                        }}
                                    />
                                )}
                            </label>
                        ))}
                    </div>

                    <fieldset className="testing-validity">
                        <legend>Trial validity</legend>
                        {VALIDITIES.map(v => (
                            <label key={v}>
                                <input
                                    type="radio"
                                    name="correction-validity"
                                    checked={validity === v}
                                    onChange={() => setValidity(v)}
                                />{' '}
                                {v}
                            </label>
                        ))}
                    </fieldset>

                    {validity === 'invalid' && (
                        <label>
                            Invalid reason <span className="required-indicator">*</span>
                            <input
                                type="text"
                                value={invalidReason}
                                onChange={e => setInvalidReason(e.target.value)}
                                required
                            />
                        </label>
                    )}

                    <label>
                        Correction reason <span className="required-indicator">*</span>
                        <input
                            type="text"
                            placeholder="e.g. Corrected misread display or adjusted measurement"
                            value={correctionReason}
                            onChange={e => setCorrectionReason(e.target.value)}
                            required
                        />
                    </label>

                    <label>
                        Notes (optional)
                        <input
                            type="text"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                        />
                    </label>

                    <div className="testing-actions">
                        <button
                            type="button"
                            className="testing-secondary"
                            onClick={() => setEditingTrial(null)}
                            disabled={busy}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="testing-primary"
                            onClick={handleSaveCorrection}
                            disabled={busy}
                        >
                            {busy ? 'Saving correction…' : 'Save correction'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
