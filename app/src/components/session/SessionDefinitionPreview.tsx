import React from 'react';
import type { SessionDefinition } from '../../sessions/models';
import './SessionDefinitionPreview.css';

interface SessionDefinitionPreviewProps {
    definition: SessionDefinition;
    onStart?: () => void;
    onChooseDestination?: () => void;
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
                            <span className="block-role-tag">{block.role}</span>
                        </div>
                        <ul className="preview-steps-list">
                            {block.steps.map((step, sIdx) => (
                                <li key={step.id ?? sIdx} className="preview-step-item">
                                    <div className="step-main">
                                        <span className="step-number">{sIdx + 1}.</span>
                                        <div className="step-details">
                                            <span className="step-title">{step.title}</span>
                                            {step.dose && (
                                                <span className="step-dose">
                                                    {step.dose.kind === 'repetition' && `${step.dose.sets} sets × ${typeof step.dose.reps === 'object' ? `${step.dose.reps.min}-${step.dose.reps.max}` : step.dose.reps} reps`}
                                                    {step.dose.kind === 'duration' && `${step.dose.seconds}s hold`}
                                                    {step.dose.kind === 'distance' && `${step.dose.meters}m`}
                                                    {step.dose.kind === 'checkoff' && `${step.dose.rounds ?? 1} rounds`}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {step.notes && <p className="step-notes">{step.notes}</p>}
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>

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
