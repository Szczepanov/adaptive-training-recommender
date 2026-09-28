import React from 'react';
import type { SessionBlock, SessionEntry } from '../../sessions/models';
import { getGroupProgress, targetEntriesForGroupStep } from '../../sessions/groupProgression';
import { stepName } from '../../sessions/stepDisplay';
import { completedPrescribedSets } from '../../sessions/workSets';

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
    const nextStep = progress.nextStepIndex === null || progress.nextStepIndex === activeStepIndex
        ? null : block.steps[progress.nextStepIndex];
    const label = progress.mode === 'superset' ? 'Superset' : progress.mode === 'alternating' ? 'Alternating pair' : 'Circuit';

    const activeCompleted = activeStep ? completedPrescribedSets(activeStep, entries) : 0;
    const activeTarget = activeStep ? targetEntriesForGroupStep(block, activeStep) : 1;

    const nextCompleted = nextStep ? completedPrescribedSets(nextStep, entries) : 0;
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
