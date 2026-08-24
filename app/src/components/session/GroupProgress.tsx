import React from 'react';
import type { SessionBlock, SessionEntry, SessionStep } from '../../sessions/models';
import { getGroupProgress, targetEntriesForGroupStep } from '../../sessions/groupProgression';

function stepName(step: SessionStep): string {
    if (step.title) return step.title;
    if (step.exerciseRef?.kind === 'catalog') return step.exerciseRef.exerciseId;
    if (step.exerciseRef?.kind === 'unresolved_free_text') return step.exerciseRef.name;
    return step.id;
}

interface GroupProgressProps {
    block: SessionBlock;
    entries: readonly SessionEntry[];
    activeStepIndex: number;
    onSelectStep: (stepIndex: number) => void;
}

/** A visible, non-authoritative guide for a circuit, superset, or alternating group. */
export const GroupProgress: React.FC<GroupProgressProps> = ({ block, entries, activeStepIndex, onSelectStep }) => {
    const progress = getGroupProgress(block, entries, activeStepIndex);
    if (!progress) return null;

    const activeStep = block.steps[activeStepIndex];
    const nextStep = progress.nextStepIndex === null ? null : block.steps[progress.nextStepIndex];
    const label = progress.mode === 'superset' ? 'Superset' : progress.mode === 'alternating' ? 'Alternating pair' : 'Circuit';

    const activeCompleted = activeStep ? entries.filter(e => e.stepId === activeStep.id && e.payload.kind !== 'choice').length : 0;
    const activeTarget = activeStep ? targetEntriesForGroupStep(block, activeStep) : 1;

    const nextCompleted = nextStep ? entries.filter(e => e.stepId === nextStep.id && e.payload.kind !== 'choice').length : 0;
    const nextTarget = nextStep ? targetEntriesForGroupStep(block, nextStep) : 1;

    return (
        <div className="group-progress" aria-live="polite">
            <div className="group-progress-main">
                <strong>{label} · {progress.isComplete ? 'Group complete' : `Round ${progress.completedRounds + 1} of ${progress.totalRounds}`}</strong>
                {activeStep && !progress.isComplete && (
                    <span className="group-current-indicator">
                        Current: {stepName(activeStep)} (Set {Math.min(activeCompleted + 1, activeTarget)} of {activeTarget})
                    </span>
                )}
            </div>
            {nextStep && !progress.isComplete && (
                <button type="button" className="group-next-button" onClick={() => onSelectStep(progress.nextStepIndex!)}>
                    Next: {stepName(nextStep)} ({nextCompleted + 1}/{nextTarget}) →
                </button>
            )}
        </div>
    );
};
