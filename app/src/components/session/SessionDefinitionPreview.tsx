import React from 'react';
import type { RangeOrNumber, SessionChoiceAction, SessionDefinition, SessionStep } from '../../sessions/models';
import { EXERCISES } from '../../workouts/exercises';
import './SessionDefinitionPreview.css';

interface SessionDefinitionPreviewProps {
    definition: SessionDefinition;
    onStart?: () => void;
    onChooseDestination?: () => void;
}

function formatRange(value: RangeOrNumber): string {
    return typeof value === 'number' ? String(value) : `${value.min}–${value.max}`;
}

function stepName(step: SessionStep): string {
    if (step.title) return step.title;
    if (step.exerciseRef?.kind === 'catalog') {
        const id = step.exerciseRef.exerciseId;
        const found = EXERCISES.find(e => e.id === id);
        return found ? found.name : id;
    }
    if (step.exerciseRef?.kind === 'unresolved_free_text') return step.exerciseRef.name;
    return step.id;
}

function effortText(step: SessionStep): string | null {
    const effort = step.effort;
    if (!effort) return null;
    if (effort.kind === 'rpe' && effort.target !== undefined) return `RPE ${formatRange(effort.target)}`;
    if (effort.kind === 'rir' && effort.target !== undefined) return `${formatRange(effort.target)} RIR`;
    if (effort.rpe !== undefined) return `RPE ${formatRange(effort.rpe)}`;
    if (effort.rir !== undefined) return `${formatRange(effort.rir)} RIR`;
    return null;
}

function actionText(action: SessionChoiceAction): string {
    switch (action.kind) {
        case 'select_alternative': return `Use alternative ${action.alternativeId}`;
        case 'reduce_load_percent': return `Reduce load ${action.percent}%`;
        case 'reduce_sets': return `Use ${action.sets} sets`;
        case 'reduce_reps': return `Use ${action.reps} reps`;
        case 'omit_step': return 'Omit this movement';
        case 'end_block': return 'End this block';
        case 'end_session': return 'End session';
    }
}

export const SessionDefinitionPreview: React.FC<SessionDefinitionPreviewProps> = ({
    definition,
    onStart,
    onChooseDestination,
}) => {
    return (
        <div className="session-def-preview">
            <header className="preview-header">
                <div className="preview-title-row">
                    <h3>{definition.title}</h3>
                    <span className={`preview-badge modality-${definition.dominantModality ?? 'strength'}`}>
                        {definition.dominantModality ?? definition.intent}
                    </span>
                </div>
                {definition.summary && <p className="preview-summary">{definition.summary}</p>}
                {definition.duration && (
                    <div className="preview-meta">
                        <span>⏱ {definition.duration.min} - {definition.duration.max} min</span>
                        <span>• Revision {definition.revision}</span>
                    </div>
                )}
            </header>

            <div className="preview-blocks-container">
                {definition.blocks.map((block, bIdx) => (
                    <section key={block.id ?? bIdx} className="preview-block-card">
                        <div className="preview-block-header">
                            <h4>{block.title ?? `Block ${bIdx + 1}`}</h4>
                            <span className="block-role-tag">{block.role} · {block.executionMode}{block.rounds !== undefined ? ` · ${formatRange(block.rounds)} rounds` : ''}</span>
                        </div>
                        <ul className="preview-steps-list">
                            {block.steps.map((step, sIdx) => {
                                const effort = effortText(step);
                                const isUnresolved = step.exerciseRef?.kind === 'unresolved_free_text';
                                const ref = step.exerciseRef;
                                const catalogItem = ref?.kind === 'catalog'
                                    ? EXERCISES.find(e => e.id === ref.exerciseId)
                                    : undefined;
                                return <li key={step.id ?? sIdx} className="preview-step-item">
                                    <div className="step-main">
                                        <span className="step-number">{sIdx + 1}.</span>
                                        <div className="step-details">
                                            <span className="step-title">{stepName(step)} {step.optional && <em>(optional)</em>}</span>
                                            {catalogItem && (
                                                <span className="step-catalog-tag">
                                                    Catalog: {catalogItem.name}{catalogItem.equipment.length > 0 ? ` · ${catalogItem.equipment.join(', ')}` : ''}
                                                </span>
                                            )}
                                            {isUnresolved && <span className="step-unresolved">Custom movement</span>}
                                            {step.dose && (
                                                <span className="step-dose">
                                                    {step.dose.kind === 'repetition' && `${step.dose.sets} sets × ${typeof step.dose.reps === 'object' ? `${step.dose.reps.min}-${step.dose.reps.max}` : step.dose.reps} reps`}
                                                    {step.dose.kind === 'duration' && `${step.dose.sets ?? 1} sets × ${formatRange(step.dose.seconds)} sec`}
                                                    {step.dose.kind === 'distance' && `${formatRange(step.dose.meters ?? step.dose.metres ?? 0)} m`}
                                                    {step.dose.kind === 'checkoff' && `${step.dose.rounds ?? 1} rounds`}
                                                </span>
                                            )}
                                            {(effort || step.rest !== undefined || step.tempo) && <span className="step-prescription">
                                                {[effort, step.rest !== undefined ? `Rest ${formatRange(step.rest)} sec` : null, step.tempo ? `Tempo ${step.tempo}` : null].filter(Boolean).join(' · ')}
                                            </span>}
                                        </div>
                                    </div>
                                    {step.notes && <p className="step-notes">{step.notes}</p>}
                                    {step.stopConditions && <p className="step-stop">Stop: {step.stopConditions.join('; ')}</p>}
                                </li>;
                            })}
                        </ul>
                        {block.optionSets && block.optionSets.length > 0 && <div className="preview-option-sets">
                            <h5>Authored choices</h5>
                            {block.optionSets.map(choice => <section key={choice.id} className="preview-option-set">
                                <p><strong>When:</strong> {choice.trigger.description}</p>
                                <ul>{choice.options.map(option => <li key={option.id}><strong>{option.label}</strong>{option.actions.length > 0 && ` — ${option.actions.map(actionText).join('; ')}`}</li>)}</ul>
                            </section>)}
                        </div>}
                    </section>
                ))}
            </div>

            {definition.companionSessions && definition.companionSessions.length > 0 && <section className="preview-companions">
                <h4>Separate companion sessions</h4>
                <ul>{definition.companionSessions.map(companion => <li key={companion.id}><strong>{companion.definitionRef}</strong>{companion.optional ? ' (optional)' : ''}{companion.note ? ` — ${companion.note}` : ''}</li>)}</ul>
            </section>}

            <div className="preview-actions">
                {onStart && (
                    <button type="button" className="btn-primary" onClick={onStart}>
                        Start Session
                    </button>
                )}
                {onChooseDestination && (
                    <button type="button" className="btn-secondary" onClick={onChooseDestination}>
                        Save / Schedule / Replace...
                    </button>
                )}
            </div>
        </div>
    );
};
