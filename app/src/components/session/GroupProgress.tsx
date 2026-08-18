import React from 'react';
import type { SessionBlock, SessionEntry, SessionStep } from '../../sessions/models';
import { getGroupProgress } from '../../sessions/groupProgression';

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

    const nextStep = progress.nextStepIndex === null ? null : block.steps[progress.nextStepIndex];
    const label = progress.mode === 'superset' ? 'Superset' : progress.mode === 'alternating' ? 'Alternating pair' : 'Circuit';

    return (
        <div className="group-progress" aria-live="polite">
            <div>
                <strong>{label}</strong>
                <span>{progress.isComplete ? 'Group complete' : `Round ${progress.completedRounds + 1} of ${progress.totalRounds}`}</span>
            </div>
            {nextStep && (
                <button type="button" className="group-next-button" onClick={() => onSelectStep(progress.nextStepIndex!)}>
                    Next: {stepName(nextStep)} →
                </button>
            )}
        </div>
    );
};
