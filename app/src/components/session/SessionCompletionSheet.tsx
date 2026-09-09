import React, { useState, useMemo } from 'react';
import type { BodyRegion, TissueResponseLevel } from '../../engine/models';
import type { SessionStepSummary } from '../../workouts/strengthSessionEntry';
import {
    COMPLETION_TISSUE_LEVEL_OPTIONS,
    resolveSubmittedTissueFeedback,
    type CompletionTissueFeedback,
} from './sessionCompletionOptions';

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
    /** Fraction of the prescribed session completed, expressed from 0 to 1. */
    completedFraction?: number;
    /** Athlete-reported fatigue that was unexpected for this session. */
    unexpectedFatigue?: boolean;
    notes?: string;
    tissueFeedback?: CompletionTissueFeedback[];
}

export type SessionCompletionRecordKind = 'SessionExecution' | 'AssessmentAttempt';

interface SessionCompletionSheetProps {
    startedAt: string;
    totalSets: number;
    steps: SessionStepSummary[];
    onComplete: (payload: SessionCompletionPayload) => Promise<void>;
    onAbandon: () => Promise<void>;
    onCancel: () => void;
    /** Optional secondary authoring action. Kept inside the completion dialog so it is not
     * a peer of in-session controls and is unavailable from the abandon confirmation. */
    onSaveTemplate?: () => void;
    /** Keep the completion form mounted while another modal owns focus so draft feedback survives. */
    hidden?: boolean;
    /** Provenance context shown in chrome. Completion always persists SessionExecution first;
     * the linked AssessmentAttempt lifecycle continues separately until observations are saved. */
    recordKind?: SessionCompletionRecordKind;
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
    onSaveTemplate,
    hidden = false,
    recordKind = 'SessionExecution',
    saving,
    openAbandonConfirmation = false,
    error = null,
}) => {
    const [sessionRpe, setSessionRpe] = useState<number | undefined>(7);
    const [completedFraction, setCompletedFraction] = useState(1);
    const [unexpectedFatigue, setUnexpectedFatigue] = useState(false);
    const [notes, setNotes] = useState('');
    const [selectedRegion, setSelectedRegion] = useState<BodyRegion | ''>('');
    const [reportedPain, setReportedPain] = useState<TissueResponseLevel>('mild');
    const [tissueFeedback, setTissueFeedback] = useState<CompletionTissueFeedback[]>([]);
    const [showAbandonConfirm, setShowAbandonConfirm] = useState(openAbandonConfirmation);
    const [elapsedMinutes] = useState(() => Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 60000)));

    // ⚡ Bolt: Memoize step array filters to prevent redundant O(N) operations on every form state change (e.g. typing in notes)
    const missingRequiredSteps = useMemo(() => steps.filter(s => s.isPlanned && !s.optional && !s.isComplete), [steps]);
    const completedExercisesCount = useMemo(() => steps.filter(s => s.loggedSetsCount > 0).length, [steps]);
    const abandoningAssessment = recordKind === 'AssessmentAttempt';

    const handleConfirmComplete = async () => {
        const submittedTissueFeedback = resolveSubmittedTissueFeedback(tissueFeedback, selectedRegion, reportedPain);
        const payload: SessionCompletionPayload = {
            sessionRpe,
            completedFraction,
            unexpectedFatigue,
            notes: notes.trim() || undefined,
            tissueFeedback: submittedTissueFeedback.length > 0 ? submittedTissueFeedback : undefined,
        };
        await onComplete(payload);
    };

    const addTissueFeedback = () => {
        if (!selectedRegion || tissueFeedback.some(item => item.region === selectedRegion)) return;
        setTissueFeedback(previous => [
            ...previous,
            { region: selectedRegion, painDuringTraining: reportedPain, afterTrainingState: reportedPain },
        ]);
        setSelectedRegion('');
        setReportedPain('mild');
    };

    return (
        <div
            className="session-completion-modal-overlay"
            role="dialog"
            aria-modal={hidden ? undefined : true}
            aria-labelledby="completion-title"
            hidden={hidden}
        >
            <div className="session-completion-sheet">
                {error && <p className="session-runner-error" role="alert">{error}</p>}
                {showAbandonConfirm ? (
                    <div className="abandon-confirmation-view">
                        <h3 id="completion-title" className="danger-text">
                            {abandoningAssessment ? 'Abandon Locked Assessment?' : 'Abandon Session?'}
                        </h3>
                        {abandoningAssessment ? (
                            <p>
                                This permanently abandons the locked AssessmentAttempt. It is terminal, cannot be resumed, and will never produce a benchmark observation. To test again, you must start a fresh attempt.
                            </p>
                        ) : (
                            <p>Are you sure you want to abandon this session?</p>
                        )}
                        <p className="abandon-subtext">
                            <strong>{abandoningAssessment ? 'What is retained:' : 'Note:'}</strong> Partial sets you have logged ({totalSets} sets) are permanently retained in your history and will not be deleted.
                        </p>
                        <div className="sheet-actions">
                            <button
                                type="button"
                                className="btn-danger-confirm"
                                onClick={onAbandon}
                                disabled={saving}
                            >
                                {saving
                                    ? 'Abandoning...'
                                    : abandoningAssessment
                                        ? 'Yes, Abandon Assessment'
                                        : 'Yes, Abandon Session'}
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
                        <p className="completion-record-provenance">
                            {recordKind === 'AssessmentAttempt'
                                ? 'Finishing saves a SessionExecution for this AssessmentAttempt. The AssessmentAttempt is completed only after its observations are saved.'
                                : 'Finishing saves a SessionExecution record.'}
                        </p>

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
                                <span className="metric-value">{completedExercisesCount}</span>
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
                                    {COMMON_REGIONS.filter(r => !tissueFeedback.some(item => item.region === r.id)).map(r => (
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
                                {selectedRegion && (
                                    <button type="button" className="btn-secondary" onClick={addTissueFeedback}>
                                        Add region
                                    </button>
                                )}
                            </div>
                            {tissueFeedback.length > 0 && (
                                <ul className="tissue-feedback-list">
                                    {tissueFeedback.map(item => (
                                        <li key={item.region}>
                                            <span>
                                                {COMMON_REGIONS.find(region => region.id === item.region)?.label ?? item.region}
                                                {` — ${item.painDuringTraining}`}
                                            </span>
                                            <button
                                                type="button"
                                                className="btn-link-danger"
                                                onClick={() => setTissueFeedback(previous => previous.filter(entry => entry.region !== item.region))}
                                            >
                                                Remove
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="form-group completion-evidence-group">
                            <label htmlFor="completed-fraction-input">
                                <strong>How much of the planned session did you complete?</strong>
                            </label>
                            <select
                                id="completed-fraction-input"
                                value={completedFraction}
                                onChange={e => setCompletedFraction(Number(e.target.value))}
                                className="select-input"
                            >
                                <option value={1}>All of it (100%)</option>
                                <option value={0.75}>Most of it (75%)</option>
                                <option value={0.5}>About half (50%)</option>
                                <option value={0.25}>Only a little (25%)</option>
                                <option value={0}>None (0%)</option>
                            </select>
                        </div>

                        <label className="checkbox-label" htmlFor="unexpected-fatigue-input">
                            <input
                                id="unexpected-fatigue-input"
                                type="checkbox"
                                checked={unexpectedFatigue}
                                onChange={e => setUnexpectedFatigue(e.target.checked)}
                            />
                            <span>Unexpected fatigue during or after this session</span>
                        </label>

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

                        {onSaveTemplate && (
                            <div className="sheet-actions">
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={onSaveTemplate}
                                    disabled={saving}
                                    title="Save adjusted workout as a new template"
                                    data-testid="completion-save-template-button"
                                >
                                    💾 Save as template
                                </button>
                            </div>
                        )}

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
