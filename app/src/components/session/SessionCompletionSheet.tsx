import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useOverlayDialog } from '../useOverlayDialog';
import '../overlayContract.css';
import './SessionCompletionSheet.css';
import type { BodyRegion, TissueResponseLevel } from '../../engine/models';
import type { SessionStepSummary } from '../../workouts/strengthSessionEntry';
import {
    COMPLETION_TISSUE_LEVEL_OPTIONS,
    buildCompletionPayload,
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
    const [sessionRpe, setSessionRpe] = useState<number | undefined>(undefined);
    const [completedFraction, setCompletedFraction] = useState<number | undefined>(undefined);
    const [unexpectedFatigue, setUnexpectedFatigue] = useState<boolean | undefined>(undefined);
    const [notes, setNotes] = useState('');
    const [selectedRegion, setSelectedRegion] = useState<BodyRegion | ''>('');
    const [reportedPain, setReportedPain] = useState<TissueResponseLevel>('mild');
    const [tissueFeedback, setTissueFeedback] = useState<CompletionTissueFeedback[]>([]);
    const [showAbandonConfirm, setShowAbandonConfirm] = useState(openAbandonConfirmation);
    const panelRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const dismiss = showAbandonConfirm && !openAbandonConfirmation
        ? () => setShowAbandonConfirm(false)
        : onCancel;
    useOverlayDialog(true, panelRef, saving || hidden ? undefined : dismiss, '#completion-title');
    useEffect(() => {
        titleRef.current?.focus();
    }, [showAbandonConfirm]);
    const [elapsedMinutes] = useState(() => Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 60000)));

    // ⚡ Bolt: Memoize step array filters to prevent redundant O(N) operations on every form state change (e.g. typing in notes)
    const missingRequiredSteps = useMemo(() => steps.filter(s => s.isPlanned && !s.optional && !s.isComplete), [steps]);
    const completedExercisesCount = useMemo(() => steps.filter(s => s.loggedSetsCount > 0).length, [steps]);
    const reportedRegionIds = useMemo(() => new Set(tissueFeedback.map(item => item.region)), [tissueFeedback]);
    const availableRegions = useMemo(
        () => COMMON_REGIONS.filter(r => !reportedRegionIds.has(r.id)),
        [reportedRegionIds],
    );
    const abandoningAssessment = recordKind === 'AssessmentAttempt';

    const handleConfirmComplete = async () => {
        const payload: SessionCompletionPayload = buildCompletionPayload({
            sessionRpe,
            completedFraction,
            unexpectedFatigue,
            notes,
            tissueFeedback,
            selectedRegion,
            reportedPain,
            missingRequiredStepCount: missingRequiredSteps.length,
        });
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
            className="session-completion-modal-overlay overlay-viewport"
            role="dialog"
            aria-modal={hidden ? undefined : true}
            aria-labelledby="completion-title"
            hidden={hidden}
        >
            <div ref={panelRef} className="session-completion-sheet overlay-panel" tabIndex={-1}>
                {showAbandonConfirm ? (
                    <div className="abandon-confirmation-view">
                        <h2 ref={titleRef} id="completion-title" tabIndex={-1} className="completion-sheet-title">
                            {abandoningAssessment ? 'Abandon Locked Assessment?' : 'Abandon Session?'}
                        </h2>
                        {error && <p className="session-runner-error" role="alert">{error}</p>}
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
                                onClick={dismiss}
                                disabled={saving}
                            >
                                Go Back
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="completion-sheet-body">
                            <h2 ref={titleRef} id="completion-title" tabIndex={-1} className="completion-sheet-title">Complete Session</h2>
                            <p className="completion-record-provenance">
                                {recordKind === 'AssessmentAttempt'
                                    ? 'Finishing saves a SessionExecution for this AssessmentAttempt. The AssessmentAttempt is completed only after its observations are saved.'
                                    : 'Add any feedback you want to save with your workout.'}
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
                                <details className="completion-warning-box">
                                    <summary><strong>Incomplete Required Steps ({missingRequiredSteps.length})</strong></summary>
                                    <ul>
                                        {missingRequiredSteps.map((step, idx) => (
                                            <li key={step.exerciseId ?? `${step.exerciseIndex ?? idx}-${step.displayName}`}>
                                                {step.displayName} ({step.loggedSetsCount}/{step.targetSets} sets)
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}

                            <div className="form-group rpe-picker-group">
                                <div className="completion-field-heading">
                                    <strong id="session-rpe-label">Whole-session effort</strong>
                                    <span className="helper-text" id="session-rpe-status" data-testid="srpe-status" aria-live="polite">
                                        {sessionRpe === undefined ? 'Not answered' : `Selected: ${sessionRpe}`}
                                    </span>
                                </div>
                                <span className="helper-text" id="session-rpe-guide">1 = very easy · 5 = moderate · 10 = maximum effort. Select again to clear.</span>
                                <div className="rpe-button-row" role="group" aria-labelledby="session-rpe-label" aria-describedby="session-rpe-guide session-rpe-status">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => (
                                        <button
                                            key={val}
                                            type="button"
                                            className={`rpe-pill-btn ${sessionRpe === val ? 'selected' : ''}`}
                                            aria-pressed={sessionRpe === val}
                                            onClick={() => setSessionRpe(previous => (previous === val ? undefined : val))}
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
                                        <option value="">Select an affected area</option>
                                        {availableRegions.map(r => (
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
                                    value={completedFraction ?? ''}
                                    onChange={e => setCompletedFraction(e.target.value === '' ? undefined : Number(e.target.value))}
                                    className="select-input"
                                >
                                    <option value="">Not answered</option>
                                    <option value={1} disabled={missingRequiredSteps.length > 0}>All of it (100%)</option>
                                    <option value={0.75}>Most of it (75%)</option>
                                    <option value={0.5}>About half (50%)</option>
                                    <option value={0.25}>Only a little (25%)</option>
                                    <option value={0}>None (0%)</option>
                                </select>
                                {missingRequiredSteps.length > 0 && (
                                    <span className="helper-text">100% isn't available while required steps are unfinished.</span>
                                )}
                            </div>

                            <div className="form-group fatigue-answer-group">
                                <div className="completion-field-heading">
                                    <strong id="unexpected-fatigue-label">Unexpected fatigue during or after this session?</strong>
                                    <span className="helper-text" id="unexpected-fatigue-status" data-testid="fatigue-status" aria-live="polite">
                                        {unexpectedFatigue === undefined ? 'Not answered' : `Selected: ${unexpectedFatigue ? 'Yes' : 'No'}`}
                                    </span>
                                </div>
                                <span className="helper-text" id="unexpected-fatigue-guide">Select again to clear.</span>
                                <div className="fatigue-button-row" role="group" aria-labelledby="unexpected-fatigue-label" aria-describedby="unexpected-fatigue-guide unexpected-fatigue-status">
                                    {([false, true] as const).map(value => (
                                        <button
                                            key={String(value)}
                                            type="button"
                                            className={`rpe-pill-btn ${unexpectedFatigue === value ? 'selected' : ''}`}
                                            aria-pressed={unexpectedFatigue === value}
                                            onClick={() => setUnexpectedFatigue(previous => (previous === value ? undefined : value))}
                                        >
                                            {value ? 'Yes' : 'No'}
                                        </button>
                                    ))}
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

                            {recordKind === 'AssessmentAttempt' && (
                                <div className="assessment-completion-guidance" role="status">
                                    <span>🏁 <strong>Physical session complete!</strong> Next, enter the measurements from your attempts to calculate your new benchmark.</span>
                                </div>
                            )}

                            <div className="completion-secondary-actions">
                                {onSaveTemplate && (
                                    <button
                                        type="button"
                                        className="completion-text-action"
                                        onClick={onSaveTemplate}
                                        disabled={saving}
                                        title="Save adjusted workout as a new template"
                                        data-testid="completion-save-template-button"
                                    >
                                        Save as template
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="btn-link-danger"
                                    onClick={() => setShowAbandonConfirm(true)}
                                    disabled={saving}
                                >
                                    Abandon Session...
                                </button>
                            </div>
                        </div>
                        <div className="completion-footer">
                            {error && <p className="session-runner-error" role="alert">{error}</p>}
                            <div className="sheet-actions">
                                <button type="button" className="btn-primary" onClick={handleConfirmComplete} disabled={saving}>
                                    {saving ? 'Saving...' : 'Finish & Save Session'}
                                </button>
                                <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
                                    Keep Training
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
