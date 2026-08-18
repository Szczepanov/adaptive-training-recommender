import React, { useState } from 'react';
import type { SessionDefinition, SessionBlock, BlockRole } from '../../sessions/models';

type ManualModality = 'strength' | 'cycling' | 'running' | 'field' | 'mobility' | 'cross_training';
import { SessionDestinationSheet } from './SessionDestinationSheet';
import './ManualSessionBuilder.css';

interface ManualSessionBuilderProps {
    userId: string;
    onClose: () => void;
    onSessionCreated?: (definition: SessionDefinition) => void;
}

export const ManualSessionBuilder: React.FC<ManualSessionBuilderProps> = ({
    userId,
    onClose,
    onSessionCreated,
}) => {
    const [definitionId] = useState<string>(() => `def-${Date.now()}`);
    const [title, setTitle] = useState<string>('Custom Workout');
    const [summary, setSummary] = useState<string>('');
    const [modality, setModality] = useState<ManualModality>('strength');
    const [durationMin, setDurationMin] = useState<number>(45);
    const [blocks, setBlocks] = useState<SessionBlock[]>([
        {
            id: 'block-1',
            title: 'Warm-up',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [{ id: 'step-1', kind: 'exercise', title: 'Dynamic Warm-up', notes: 'Prepare tissues' }],
        },
        {
            id: 'block-2',
            title: 'Main Work',
            role: 'main',
            executionMode: 'sequential',
            steps: [{ id: 'step-2', kind: 'exercise', title: 'Primary Movement', dose: { kind: 'repetition', sets: 3, reps: 8 } }],
        },
    ]);
    const [destinationSheetOpen, setDestinationSheetOpen] = useState<boolean>(false);

    const handleAddBlock = () => {
        const newBlockId = `block-${blocks.length + 1}`;
        setBlocks(prev => [
            ...prev,
            {
                id: newBlockId,
                title: `Block ${prev.length + 1}`,
                role: 'main',
                executionMode: 'sequential',
                steps: [{ id: `step-${Date.now()}`, kind: 'exercise', title: 'New Exercise' }],
            },
        ]);
    };

    const handleAddStep = (blockIndex: number) => {
        const newStepId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        setBlocks(prev => {
            const next = [...prev];
            next[blockIndex] = {
                ...next[blockIndex],
                steps: [
                    ...next[blockIndex].steps,
                    { id: newStepId, kind: 'exercise', title: 'New Exercise', dose: { kind: 'repetition', sets: 3, reps: 10 } },
                ],
            };
            return next;
        });
    };

    const handleUpdateStepTitle = (blockIndex: number, stepIndex: number, newTitle: string) => {
        setBlocks(prev => {
            const next = [...prev];
            const steps = [...next[blockIndex].steps];
            steps[stepIndex] = { ...steps[stepIndex], title: newTitle };
            next[blockIndex] = { ...next[blockIndex], steps };
            return next;
        });
    };

    const handleUpdateBlockRole = (blockIndex: number, role: BlockRole) => {
        setBlocks(prev => {
            const next = [...prev];
            next[blockIndex] = { ...next[blockIndex], role };
            return next;
        });
    };

    const builtDefinition: SessionDefinition = {
        schemaVersion: 1,
        id: definitionId,
        revision: 1,
        title: title.trim() || 'Custom Workout',
        summary: summary.trim() || undefined,
        intent: modality === 'mobility' ? 'recovery' : 'training',
        dominantModality: modality,
        duration: { min: durationMin, max: durationMin },
        blocks,
    };

    return (
        <div className="manual-session-builder">
            <header className="builder-header">
                <h2>Build Session</h2>
                <button type="button" className="close-builder-btn" onClick={onClose} aria-label="Close builder">✕</button>
            </header>

            <div className="builder-form">
                <div className="form-group">
                    <label htmlFor="session-title">Session Title</label>
                    <input
                        id="session-title"
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="e.g. Lower Body Heavy & Core"
                    />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="session-modality">Modality</label>
                        <select
                            id="session-modality"
                            value={modality}
                            onChange={e => setModality(e.target.value as ManualModality)}
                        >
                            <option value="strength">Strength</option>
                            <option value="cycling">Cycling</option>
                            <option value="running">Running</option>
                            <option value="field">Field</option>
                            <option value="mobility">Mobility</option>
                            <option value="cross_training">Cross Training</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label htmlFor="session-duration">Target Duration (min)</label>
                        <input
                            id="session-duration"
                            type="number"
                            min={5}
                            max={240}
                            value={durationMin}
                            onChange={e => setDurationMin(parseInt(e.target.value, 10) || 30)}
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label htmlFor="session-summary">Summary & Intent</label>
                    <textarea
                        id="session-summary"
                        value={summary}
                        onChange={e => setSummary(e.target.value)}
                        placeholder="Key focus or coaching notes..."
                        rows={2}
                    />
                </div>

                <div className="blocks-section">
                    <div className="blocks-header">
                        <h3>Session Blocks</h3>
                        <button type="button" className="add-block-btn" onClick={handleAddBlock}>+ Add Block</button>
                    </div>

                    {blocks.map((block, bIdx) => (
                        <div key={block.id} className="builder-block-card">
                            <div className="block-meta-row">
                                <input
                                    type="text"
                                    value={block.title ?? ''}
                                    onChange={e => {
                                        const newTitle = e.target.value;
                                        setBlocks(prev => {
                                            const next = [...prev];
                                            next[bIdx] = { ...next[bIdx], title: newTitle };
                                            return next;
                                        });
                                    }}
                                    className="block-title-input"
                                    placeholder="Block name"
                                />
                                <select
                                    value={block.role}
                                    onChange={e => handleUpdateBlockRole(bIdx, e.target.value as BlockRole)}
                                    className="block-role-select"
                                >
                                    <option value="warmup">Warmup</option>
                                    <option value="main">Main</option>
                                    <option value="accessory">Accessory</option>
                                    <option value="cooldown">Cooldown</option>
                                </select>
                            </div>

                            <div className="builder-steps-list">
                                {block.steps.map((step, sIdx) => (
                                    <div key={step.id} className="builder-step-row">
                                        <span className="step-idx">{sIdx + 1}.</span>
                                        <input
                                            type="text"
                                            value={step.title}
                                            onChange={e => handleUpdateStepTitle(bIdx, sIdx, e.target.value)}
                                            className="step-title-input"
                                            placeholder="Exercise / movement title"
                                        />
                                    </div>
                                ))}
                                <button type="button" className="add-step-btn" onClick={() => handleAddStep(bIdx)}>+ Add Movement</button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="builder-actions">
                    <button
                        type="button"
                        className="save-and-proceed-btn"
                        onClick={() => setDestinationSheetOpen(true)}
                    >
                        Review & Set Destination →
                    </button>
                </div>
            </div>

            <SessionDestinationSheet
                userId={userId}
                definition={builtDefinition}
                isOpen={destinationSheetOpen}
                onClose={() => setDestinationSheetOpen(false)}
                onSaved={() => {
                    if (onSessionCreated) onSessionCreated(builtDefinition);
                    onClose();
                }}
            />
        </div>
    );
};
