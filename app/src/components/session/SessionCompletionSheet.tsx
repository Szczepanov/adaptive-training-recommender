import React, { useState } from 'react';
import type { BodyRegion, TissueResponseLevel } from '../../engine/models';
import type { SessionStepSummary } from '../../workouts/strengthSessionEntry';
import { COMPLETION_TISSUE_LEVEL_OPTIONS } from './sessionCompletionOptions';

const COMMON_REGIONS: Array<{ id: BodyRegion; label: string }> = [
    { id: 'knee', label: 'Knee' },
    { id: 'hamstring', label: 'Hamstring' },
    { id: 'achilles', label: 'Achilles' },
    { id: 'calf', label: 'Calf' },
    { id: 'ankle', label: 'Ankle' },
    { id: 'lower_back', label: 'Lower Back' },
    { id: 'shoulder', label: 'Shoulder' },
    { id: 'quadriceps', label: 'Quadriceps' },
    { id: 'hip', label: 'Hip' },
    { id: 'adductor_groin', label: 'Adductor / Groin' },
    { id: 'elbow', label: 'Elbow' },
    { id: 'wrist', label: 'Wrist' },
];

export interface SessionCompletionPayload {
    sessionRpe?: number;
    notes?: string;
    tissueFeedback?: Array<{
        region: BodyRegion;
        painDuringTraining: TissueResponseLevel;
        afterTrainingState?: TissueResponseLevel;
    }>;
}

interface SessionCompletionSheetProps {
    startedAt: string;
    totalSets: number;
    steps: SessionStepSummary[];
    onComplete: (payload: SessionCompletionPayload) => Promise<void>;
    onAbandon: () => Promise<void>;
    onCancel: () => void;
    saving: boolean;
    openAbandonConfirmation?: boolean;
    error?: string | null;
}

export const SessionCompletionSheet: React.FC<SessionCompletionSheetProps> = ({
    startedAt,
    totalSets,
    steps,
    onComplete,
    onAbandon,
    onCancel,
    saving,
    openAbandonConfirmation = false,
    error = null,
}) => {
    const [sessionRpe, setSessionRpe] = useState<number | undefined>(7);
    const [notes, setNotes] = useState('');
    const [selectedRegion, setSelectedRegion] = useState<BodyRegion | ''>('');
    const [reportedPain, setReportedPain] = useState<TissueResponseLevel>('mild');
    const [showAbandonConfirm, setShowAbandonConfirm] = useState(openAbandonConfirmation);
    const [elapsedMinutes] = useState(() => Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 60000)));

    const missingRequiredSteps = steps.filter(s => s.isPlanned && !s.optional && !s.isComplete);

    const handleConfirmComplete = async () => {
        const payload: SessionCompletionPayload = {
            sessionRpe,
            notes: notes.trim() || undefined,
            tissueFeedback: selectedRegion
                ? [{ region: selectedRegion, painDuringTraining: reportedPain, afterTrainingState: reportedPain }]
                : undefined,
        };
        await onComplete(payload);
    };

    return (
        <div className="session-completion-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="completion-title">
            <div className="session-completion-sheet">
                {error && <p className="session-runner-error" role="alert">{error}</p>}
                {showAbandonConfirm ? (
                    <div className="abandon-confirmation-view">
                        <h3 className="danger-text">Abandon Session?</h3>
                        <p>
                            Are you sure you want to abandon this session?
                        </p>
                        <p className="abandon-subtext">
                            <strong>Note:</strong> Partial sets you have logged ({totalSets} sets) are permanently retained in your history and will not be deleted.
                        </p>
                        <div className="sheet-actions">
                            <button
                                type="button"
                                className="btn-danger-confirm"
                                onClick={onAbandon}
                                disabled={saving}
                            >
                                {saving ? 'Abandoning...' : 'Yes, Abandon Session'}
                            </button>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setShowAbandonConfirm(false)}
                                disabled={saving}
                            >
                                Go Back
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <h2 id="completion-title" className="completion-sheet-title">Complete Session</h2>

                        <div className="completion-summary-metrics">
                            <div className="metric-pill">
                                <span className="metric-label">Duration</span>
                                <span className="metric-value">{elapsedMinutes} min</span>
                            </div>
                            <div className="metric-pill">
                                <span className="metric-label">Total Sets</span>
                                <span className="metric-value">{totalSets}</span>
                            </div>
                            <div className="metric-pill">
                                <span className="metric-label">Exercises</span>
                                <span className="metric-value">{steps.filter(s => s.loggedSetsCount > 0).length}</span>
                            </div>
                        </div>

                        {missingRequiredSteps.length > 0 && (
                            <div className="completion-warning-box">
                                <strong>Incomplete Required Steps ({missingRequiredSteps.length}):</strong>
                                <ul>
                                    {missingRequiredSteps.map(step => (
                                        <li key={step.exerciseId ?? step.displayName}>
                                            {step.displayName} ({step.loggedSetsCount}/{step.targetSets} sets)
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="form-group rpe-picker-group">
                            <label htmlFor="session-rpe-input">
                                <strong>Whole-Session Effort (sRPE 1–10)</strong>
                                <span className="helper-text">1 = Rest, 5 = Moderate, 7 = Hard, 10 = Max Effort</span>
                            </label>
                            <div className="rpe-button-row">
                                {[4, 5, 6, 7, 8, 9, 10].map(val => (
                                    <button
                                        key={val}
                                        type="button"
                                        className={`rpe-pill-btn ${sessionRpe === val ? 'selected' : ''}`}
                                        onClick={() => setSessionRpe(val)}
                                    >
                                        {val}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="form-group tissue-feedback-group">
                            <label htmlFor="tissue-region-select">
                                <strong>Any unusual pain or joint irritation? (Optional)</strong>
                            </label>
                            <div className="tissue-inputs-row">
                                <select
                                    id="tissue-region-select"
                                    value={selectedRegion}
                                    onChange={e => setSelectedRegion(e.target.value as BodyRegion | '')}
                                    className="select-input"
                                >
                                    <option value="">No joint/tissue issues</option>
                                    {COMMON_REGIONS.map(r => (
                                        <option key={r.id} value={r.id}>{r.label}</option>
                                    ))}
                                </select>

                                {selectedRegion && (
                                    <select
                                        value={reportedPain}
                                        onChange={e => setReportedPain(e.target.value as TissueResponseLevel)}
                                        className="select-input pain-level-select"
                                        aria-label="Pain severity level"
                                    >
                                        {COMPLETION_TISSUE_LEVEL_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="session-notes-input">
                                <strong>Session Notes (Optional)</strong>
                            </label>
                            <textarea
                                id="session-notes-input"
                                rows={2}
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="E.g. Bar felt fast today, clean catch was crisp."
                                className="notes-textarea"
                            />
                        </div>

                        <div className="sheet-actions main-actions">
                            <button
                                type="button"
                                className="btn-primary btn-finalize"
                                onClick={handleConfirmComplete}
                                disabled={saving}
                            >
                                {saving ? 'Saving...' : 'Finish & Save Session'}
                            </button>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={onCancel}
                                disabled={saving}
                            >
                                Keep Training
                            </button>
                        </div>

                        <div className="danger-zone-divider">
                            <button
                                type="button"
                                className="btn-link-danger"
                                onClick={() => setShowAbandonConfirm(true)}
                                disabled={saving}
                            >
                                Abandon Session...
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
