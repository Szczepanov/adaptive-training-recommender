import React from 'react';
import type { SessionStepSummary } from '../../workouts/strengthSessionEntry';

interface SessionStepNavigatorProps {
    steps: SessionStepSummary[];
    activeExerciseIndex: number | null;
    onSelectStep: (step: SessionStepSummary) => void;
    onAddExerciseClick?: () => void;
}

export const SessionStepNavigator: React.FC<SessionStepNavigatorProps> = ({
    steps,
    activeExerciseIndex,
    onSelectStep,
    onAddExerciseClick,
}) => {
    return (
        <nav aria-label="Session Steps" className="session-step-navigator">
            <div className="session-step-list">
                {steps.map((step, idx) => {
                    const isActive = step.exerciseIndex !== null && step.exerciseIndex === activeExerciseIndex;
                    const isAdded = step.exerciseIndex !== null;

                    let statusBadge = 'Not started';
                    let statusClass = 'status-not-started';
                    if (step.isComplete) {
                        statusBadge = 'Complete';
                        statusClass = 'status-complete';
                    } else if (step.loggedSetsCount > 0) {
                        statusBadge = `${step.loggedSetsCount}/${step.targetSets || '?'} sets`;
                        statusClass = 'status-in-progress';
                    }

                    return (
                        <button
                            key={step.exerciseIndex !== null
                                ? `logged-${step.exerciseIndex}`
                                : `planned-${step.exerciseId ?? step.freeTextName ?? 'step'}-${idx}`}
                            type="button"
                            className={`session-step-item ${isActive ? 'active' : ''} ${step.isComplete ? 'completed' : ''}`}
                            onClick={() => onSelectStep(step)}
                            aria-current={isActive ? 'step' : undefined}
                        >
                            <div className="step-item-main">
                                <div className="step-item-header">
                                    <span className="step-item-index">{idx + 1}</span>
                                    <span className="step-item-title">{step.displayName}</span>
                                    {step.optional && <span className="step-badge optional">Optional</span>}
                                </div>
                                <div className="step-item-targets">
                                    {step.targetSets > 0 && (
                                        <span>
                                            {step.targetSets} × {step.targetReps ? `${step.targetReps} reps` : 'work'}
                                        </span>
                                    )}
                                    {step.targetGauge && (
                                        <span className="target-gauge">
                                            {step.targetGauge.scale === 'rir' && ` · ${step.targetGauge.value} RIR`}
                                            {step.targetGauge.scale === 'rpe_rts' && ` · RPE ${step.targetGauge.value}`}
                                            {step.targetGauge.scale === 'technical' && ' · Crisp quality'}
                                            {step.targetGauge.scale === 'velocity_loss' && ` · <${step.targetGauge.percent}% vel loss`}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="step-item-meta">
                                <span className={`step-status-badge ${statusClass}`}>{statusBadge}</span>
                                {!isAdded && <span className="step-action-hint">Tap to start</span>}
                            </div>
                        </button>
                    );
                })}
            </div>
            {onAddExerciseClick && (
                <div className="session-step-actions">
                    <button
                        type="button"
                        className="btn-add-step"
                        onClick={onAddExerciseClick}
                    >
                        + Add Custom Exercise
                    </button>
                </div>
            )}
        </nav>
    );
};
