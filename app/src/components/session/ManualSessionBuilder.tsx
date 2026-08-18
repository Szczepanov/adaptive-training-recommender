import React, { useMemo, useState } from 'react';
import type { BlockExecutionMode, BlockRole, SessionBlock, SessionDefinition, SessionDose, SessionStep } from '../../sessions/models';
import { validateSessionDefinition } from '../../sessions/validation';
import { EXERCISES } from '../../workouts/exercises';
import { duplicateDraftBlock, duplicateDraftStep, moveDraftItem } from '../../sessions/sessionDraft';
import { SessionDefinitionPreview } from './SessionDefinitionPreview';
import { type PreparedSessionLaunch, SessionDestinationSheet } from './SessionDestinationSheet';
import './ManualSessionBuilder.css';

type ManualModality = 'strength' | 'cycling' | 'running' | 'field' | 'mobility' | 'cross_training';
const BLOCK_ROLES: BlockRole[] = ['warmup', 'main', 'accessory', 'cooldown', 'recovery'];
const EXECUTION_MODES: BlockExecutionMode[] = ['sequential', 'circuit', 'superset', 'alternating'];

function newId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function customStep(id = newId('step'), title = 'New exercise'): SessionStep {
    return {
        id,
        kind: 'exercise',
        title,
        exerciseRef: { kind: 'unresolved_free_text', name: title },
        dose: { kind: 'repetition', sets: 3, reps: 8 },
        resolutionNote: 'Custom movement: executable and loggable, but it has no catalog-derived safety, cost, stimulus, PR or 1RM semantics.',
    };
}

function initialBlocks(): SessionBlock[] {
    return [{
        id: newId('block'), title: 'Main work', role: 'main', executionMode: 'sequential', steps: [customStep()],
    }];
}

interface ManualSessionBuilderProps {
    onClose: () => void;
    onStartExecution: (session: PreparedSessionLaunch) => void;
    userId: string;
}

export const ManualSessionBuilder: React.FC<ManualSessionBuilderProps> = ({ userId, onClose, onStartExecution }) => {
    const [definitionId] = useState(() => newId('manual'));
    const [title, setTitle] = useState('Custom workout');
    const [summary, setSummary] = useState('');
    const [modality, setModality] = useState<ManualModality>('strength');
    const [durationMin, setDurationMin] = useState(45);
    const [blocks, setBlocks] = useState<SessionBlock[]>(initialBlocks);
    const [showPreview, setShowPreview] = useState(false);
    const [showDestination, setShowDestination] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    const definition = useMemo<SessionDefinition>(() => ({
        schemaVersion: 1,
        id: definitionId,
        revision: 1,
        title: title.trim() || 'Custom workout',
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        intent: modality === 'mobility' ? 'recovery' : 'training',
        dominantModality: modality,
        duration: { min: durationMin, max: durationMin },
        blocks,
    }), [blocks, definitionId, durationMin, modality, summary, title]);

    const updateBlock = (blockIndex: number, patch: Partial<SessionBlock>) => setBlocks(current =>
        current.map((block, index) => index === blockIndex ? { ...block, ...patch } : block));

    const updateStep = (blockIndex: number, stepIndex: number, patch: Partial<SessionStep>) => setBlocks(current =>
        current.map((block, index) => index !== blockIndex ? block : {
            ...block,
            steps: block.steps.map((step, stepAt) => stepAt === stepIndex ? { ...step, ...patch } : step),
        }));

    const addBlock = () => setBlocks(current => [...current, {
        id: newId('block'), title: `Block ${current.length + 1}`, role: 'main', executionMode: 'sequential', steps: [customStep()],
    }]);

    const addStep = (blockIndex: number) => setBlocks(current => current.map((block, index) => index !== blockIndex ? block : {
        ...block, steps: [...block.steps, customStep()],
    }));

    const moveBlock = (fromIndex: number, toIndex: number) => setBlocks(current => moveDraftItem(current, fromIndex, toIndex));

    const duplicateBlock = (blockIndex: number) => setBlocks(current => {
        const copy = duplicateDraftBlock(current[blockIndex], newId);
        const next = [...current];
        next.splice(blockIndex + 1, 0, copy);
        return next;
    });

    const moveStep = (blockIndex: number, fromIndex: number, toIndex: number) => setBlocks(current => current.map((block, index) => index !== blockIndex ? block : {
        ...block, steps: moveDraftItem(block.steps, fromIndex, toIndex),
    }));

    const duplicateStep = (blockIndex: number, stepIndex: number) => setBlocks(current => current.map((block, index) => {
        if (index !== blockIndex) return block;
        const steps = [...block.steps];
        steps.splice(stepIndex + 1, 0, duplicateDraftStep(steps[stepIndex], newId));
        return { ...block, steps };
    }));

    const removeStep = (blockIndex: number, stepIndex: number) => setBlocks(current => current
        .map((block, index) => index !== blockIndex ? block : {
            ...block, steps: block.steps.filter((_, stepAt) => stepAt !== stepIndex),
        })
        .filter(block => block.steps.length > 0));

    const changeDose = (blockIndex: number, stepIndex: number, kind: SessionDose['kind']) => {
        const dose: SessionDose = kind === 'duration'
            ? { kind: 'duration', sets: 3, seconds: 30 }
            : kind === 'distance'
                ? { kind: 'distance', sets: 1, meters: 100 }
            : kind === 'checkoff'
                ? { kind: 'checkoff', rounds: 1 }
                : { kind: 'repetition', sets: 3, reps: 8 };
        updateStep(blockIndex, stepIndex, { dose });
    };

    const review = () => {
        const result = validateSessionDefinition(definition);
        if (!result.ok) {
            setValidationError(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
            setShowPreview(false);
            return;
        }
        setValidationError(null);
        setShowPreview(true);
    };

    return (
        <div className="manual-session-builder">
            <header className="builder-header">
                <div><h2>Build a session</h2><p>Choose a catalog movement when it exists; custom movements stay explicitly unresolved.</p></div>
                <button type="button" className="close-builder-btn" onClick={onClose} aria-label="Close builder">×</button>
            </header>

            <div className="builder-form">
                <div className="form-group">
                    <label htmlFor="session-title">Session title</label>
                    <input id="session-title" value={title} onChange={event => setTitle(event.target.value)} />
                </div>
                <div className="form-row">
                    <div className="form-group"><label htmlFor="session-modality">Main modality</label>
                        <select id="session-modality" value={modality} onChange={event => setModality(event.target.value as ManualModality)}>
                            <option value="strength">Strength</option><option value="cycling">Cycling</option><option value="running">Running</option>
                            <option value="field">Field</option><option value="mobility">Mobility / recovery</option><option value="cross_training">Cross training</option>
                        </select>
                    </div>
                    <div className="form-group"><label htmlFor="session-duration">Target duration (min)</label>
                        <input id="session-duration" type="number" min={1} max={300} value={durationMin} onChange={event => setDurationMin(Math.max(1, Number(event.target.value) || 1))} />
                    </div>
                </div>
                <div className="form-group"><label htmlFor="session-summary">Purpose or coaching notes</label>
                    <textarea id="session-summary" value={summary} onChange={event => setSummary(event.target.value)} rows={2} />
                </div>

                <section className="blocks-section">
                    <div className="blocks-header"><h3>Blocks</h3><button type="button" className="add-block-btn" onClick={addBlock}>Add block</button></div>
                    {blocks.map((block, blockIndex) => (
                        <article key={block.id} className="builder-block-card">
                            <div className="block-meta-row">
                                <input className="block-title-input" value={block.title ?? ''} onChange={event => updateBlock(blockIndex, { title: event.target.value })} aria-label="Block title" />
                                <select className="block-role-select" value={block.role} onChange={event => updateBlock(blockIndex, { role: event.target.value as BlockRole })} aria-label="Block role">
                                    {BLOCK_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                                </select>
                                <select className="block-role-select" value={block.executionMode} onChange={event => updateBlock(blockIndex, { executionMode: event.target.value as BlockExecutionMode })} aria-label="Block execution mode">
                                    {EXECUTION_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                                </select>
                            </div>
                            <div className="builder-order-controls">
                                <button type="button" disabled={blockIndex === 0} onClick={() => moveBlock(blockIndex, blockIndex - 1)}>Move block up</button>
                                <button type="button" disabled={blockIndex === blocks.length - 1} onClick={() => moveBlock(blockIndex, blockIndex + 1)}>Move block down</button>
                                <button type="button" onClick={() => duplicateBlock(blockIndex)}>Duplicate block</button>
                                {block.executionMode !== 'sequential' && <label>Rounds<input type="number" min={1} value={typeof block.rounds === 'number' ? block.rounds : ''} placeholder="From steps" onChange={event => updateBlock(blockIndex, { rounds: event.target.value === '' ? undefined : Math.max(1, Number(event.target.value) || 1) })} /></label>}
                            </div>
                            <div className="builder-steps-list">
                                {block.steps.map((step, stepIndex) => {
                                    const selectedExercise = step.exerciseRef?.kind === 'catalog' ? step.exerciseRef.exerciseId : '__custom__';
                                    const dose = step.dose;
                                    const rpe = step.effort?.kind === 'rpe' && typeof step.effort.target === 'number' ? step.effort.target : '';
                                    return <div key={step.id} className="builder-step-card">
                                        <div className="builder-step-row"><span className="step-idx">{stepIndex + 1}.</span>
                                            <input className="step-title-input" value={step.title ?? ''} onChange={event => updateStep(blockIndex, stepIndex, {
                                                title: event.target.value,
                                                ...(step.exerciseRef?.kind === 'unresolved_free_text' ? { exerciseRef: { kind: 'unresolved_free_text', name: event.target.value } } : {}),
                                            })} aria-label="Movement name" />
                                            <button type="button" className="draft-order-btn" disabled={stepIndex === 0} onClick={() => moveStep(blockIndex, stepIndex, stepIndex - 1)}>↑</button>
                                            <button type="button" className="draft-order-btn" disabled={stepIndex === block.steps.length - 1} onClick={() => moveStep(blockIndex, stepIndex, stepIndex + 1)}>↓</button>
                                            <button type="button" className="draft-order-btn" onClick={() => duplicateStep(blockIndex, stepIndex)}>Duplicate</button>
                                            <button type="button" className="remove-step-btn" onClick={() => removeStep(blockIndex, stepIndex)} aria-label="Remove movement">Remove</button>
                                        </div>
                                        <div className="builder-step-fields">
                                            <label>Movement<select value={selectedExercise} onChange={event => {
                                                const exercise = EXERCISES.find(item => item.id === event.target.value);
                                                updateStep(blockIndex, stepIndex, exercise
                                                    ? { title: exercise.name, exerciseRef: { kind: 'catalog', exerciseId: exercise.id }, resolutionNote: undefined }
                                                    : { exerciseRef: { kind: 'unresolved_free_text', name: step.title ?? 'Custom movement' }, resolutionNote: 'Custom movement: executable and loggable, but it has no catalog-derived safety, cost, stimulus, PR or 1RM semantics.' });
                                            }}><option value="__custom__">Custom / free text</option>{EXERCISES.map(exercise => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}</select></label>
                                            <label>Dose<select value={dose?.kind ?? 'repetition'} onChange={event => changeDose(blockIndex, stepIndex, event.target.value as SessionDose['kind'])}><option value="repetition">Repetitions</option><option value="duration">Timed hold</option><option value="distance">Distance</option><option value="checkoff">Check-off</option></select></label>
                                            {dose?.kind === 'repetition' && <><label>Sets<input type="number" min={1} value={dose.sets} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, sets: Math.max(1, Number(event.target.value) || 1) } })} /></label><label>Reps<input type="number" min={1} value={typeof dose.reps === 'number' ? dose.reps : dose.reps.min} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, reps: Math.max(1, Number(event.target.value) || 1) } })} /></label></>}
                                            {dose?.kind === 'duration' && <><label>Sets<input type="number" min={1} value={dose.sets ?? 1} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, sets: Math.max(1, Number(event.target.value) || 1) } })} /></label><label>Seconds<input type="number" min={1} value={typeof dose.seconds === 'number' ? dose.seconds : dose.seconds.min} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, seconds: Math.max(1, Number(event.target.value) || 1) } })} /></label></>}
                                            {dose?.kind === 'distance' && <><label>Sets<input type="number" min={1} value={dose.sets ?? 1} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, sets: Math.max(1, Number(event.target.value) || 1) } })} /></label><label>Metres<input type="number" min={1} value={typeof dose.meters === 'number' ? dose.meters : (typeof dose.metres === 'number' ? dose.metres : '')} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, meters: Math.max(1, Number(event.target.value) || 1), metres: undefined } })} /></label></>}
                                            <label>RPE<input type="number" min={1} max={10} step={0.5} placeholder="Optional" value={rpe} onChange={event => updateStep(blockIndex, stepIndex, { effort: event.target.value === '' ? undefined : { kind: 'rpe', target: Number(event.target.value) } })} /></label>
                                            <label>Rest (sec)<input type="number" min={1} placeholder="Optional" value={typeof step.rest === 'number' ? step.rest : ''} onChange={event => updateStep(blockIndex, stepIndex, { rest: event.target.value === '' ? undefined : Math.max(1, Number(event.target.value)) })} /></label>
                                        </div>
                                        <details className="builder-advanced-fields">
                                            <summary>Advanced prescription</summary>
                                            <label><input type="checkbox" checked={Boolean(step.optional)} onChange={event => updateStep(blockIndex, stepIndex, { optional: event.target.checked || undefined })} /> Optional movement</label>
                                            <label>Laterality<select value={step.laterality ?? 'bilateral'} onChange={event => updateStep(blockIndex, stepIndex, { laterality: event.target.value as SessionStep['laterality'] })}><option value="bilateral">Bilateral</option><option value="per_side">Per side</option><option value="alternating">Alternating sides</option></select></label>
                                            <label>Tempo<input value={step.tempo ?? ''} placeholder="e.g. 2-0-X-0" onChange={event => updateStep(blockIndex, stepIndex, { tempo: event.target.value || undefined })} /></label>
                                            <label>Step notes<textarea rows={2} value={step.notes ?? ''} onChange={event => updateStep(blockIndex, stepIndex, { notes: event.target.value || undefined })} /></label>
                                            <label>Stop conditions (one per line)<textarea rows={2} value={(step.stopConditions ?? []).join('\n')} onChange={event => updateStep(blockIndex, stepIndex, { stopConditions: event.target.value.split('\n').map(value => value.trim()).filter(Boolean) })} /></label>
                                        </details>
                                    </div>;
                                })}
                                <button type="button" className="add-step-btn" onClick={() => addStep(blockIndex)}>Add movement</button>
                            </div>
                        </article>
                    ))}
                </section>
                {validationError && <pre className="destination-error-box" role="alert">{validationError}</pre>}
                <div className="builder-actions"><button type="button" className="save-and-proceed-btn" onClick={review}>Review session</button></div>
            </div>

            {showPreview && <SessionDefinitionPreview definition={definition} onChooseDestination={() => setShowDestination(true)} />}
            <SessionDestinationSheet userId={userId} definition={definition} isOpen={showDestination} onClose={() => setShowDestination(false)} onStartExecution={onStartExecution} onSaved={onClose} />
        </div>
    );
};
