import React, { useMemo, useState } from 'react';
import type {
    BlockExecutionMode,
    BlockRole,
    SessionBlock,
    SessionChoice,
    SessionChoiceAction,
    SessionDefinition,
    SessionDose,
    SessionLoad,
    SessionOption,
    SessionStep,
} from '../../sessions/models';
import { validateSessionDefinition } from '../../sessions/validation';
import { EXERCISES, EXERCISES_BY_ID } from '../../workouts/exercises';
import {
    createDraftAction,
    createDraftAlternative,
    createDraftChoice,
    createDraftOption,
    duplicateDraftBlock,
    duplicateDraftStep,
    moveDraftItem,
} from '../../sessions/sessionDraft';
import { SessionDefinitionPreview } from './SessionDefinitionPreview';
import { type PreparedSessionLaunch, SessionDestinationSheet } from './SessionDestinationSheet';
import './ManualSessionBuilder.css';

type ManualModality = 'strength' | 'cycling' | 'running' | 'field' | 'mobility' | 'cross_training';
const BLOCK_ROLES: BlockRole[] = ['warmup', 'main', 'accessory', 'cooldown', 'recovery'];
const EXECUTION_MODES: BlockExecutionMode[] = ['sequential', 'circuit', 'superset', 'alternating'];
type LoadKind = SessionLoad['kind'] | 'none';
const LOAD_KINDS: LoadKind[] = ['none', 'bodyweight', 'mass', 'percent_max', 'percent_one_rm', 'band', 'descriptive', 'unloaded'];
const LOAD_KIND_LABELS: Record<LoadKind, string> = {
    none: 'Not prescribed', bodyweight: 'Bodyweight', mass: 'Mass (kg)', percent_max: '% of max',
    percent_one_rm: '% of 1RM', band: 'Resistance band', descriptive: 'Descriptive (last reviewed load)',
    unloaded: 'Unloaded', relative_step: '% of another step',
};
const ACTION_KINDS: SessionChoiceAction['kind'][] = ['reduce_load_percent', 'reduce_sets', 'reduce_reps', 'omit_step', 'select_alternative', 'end_block', 'end_session'];
const ACTION_KIND_LABELS: Record<SessionChoiceAction['kind'], string> = {
    reduce_load_percent: 'Reduce load %', reduce_sets: 'Reduce to N sets', reduce_reps: 'Reduce to N reps',
    omit_step: 'Omit this movement', select_alternative: 'Switch to an alternative movement',
    end_block: 'End this block', end_session: 'End the session',
};

function defaultLoadForKind(kind: SessionLoad['kind']): SessionLoad {
    switch (kind) {
        case 'mass': return { kind, kg: 20 };
        case 'percent_max': return { kind, percent: 70 };
        case 'percent_one_rm': return { kind, percent: 70 };
        case 'band': return { kind, bandColor: 'medium' };
        case 'descriptive': return { kind, display: '' };
        case 'bodyweight': return { kind };
        case 'unloaded': return { kind };
        case 'relative_step': return { kind, stepId: '', percent: 100 };
    }
}

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

    // ⚡ Bolt: Precompute static exercise options to prevent full 176-item catalog array mapping on every keystroke
    const exerciseOptions = useMemo(
        () => EXERCISES.map(exercise => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>),
        [],
    );

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

    const changeLoad = (blockIndex: number, stepIndex: number, kind: LoadKind) =>
        updateStep(blockIndex, stepIndex, { load: kind === 'none' ? undefined : defaultLoadForKind(kind) });

    const changeEffort = (blockIndex: number, stepIndex: number, kind: 'none' | 'rpe' | 'rir') =>
        updateStep(blockIndex, stepIndex, { effort: kind === 'none' ? undefined : { kind, target: kind === 'rpe' ? 7 : 3 } });

    const addAlternative = (blockIndex: number, stepIndex: number) => setBlocks(current => current.map((block, index) => index !== blockIndex ? block : {
        ...block,
        steps: block.steps.map((step, stepAt) => stepAt !== stepIndex ? step : {
            ...step,
            alternatives: [...(step.alternatives ?? []), createDraftAlternative(undefined, 'Alternative movement', newId)],
        }),
    }));

    // Also clears alternativeId on any select_alternative action targeting this step that
    // referenced the removed alternative -- otherwise it dangles silently: validation only
    // checks targetStepId/targetBlockId, and the runner's applySelectAlternative no-ops on an
    // unresolvable id, so the athlete would pick "switch exercise" and nothing would happen.
    const removeAlternative = (blockIndex: number, stepIndex: number, altId: string) => setBlocks(current => current.map((block, index) => {
        if (index !== blockIndex) return block;
        const removedFromStepId = block.steps[stepIndex]?.id;
        return {
            ...block,
            steps: block.steps.map((step, stepAt) => stepAt !== stepIndex ? step : {
                ...step,
                alternatives: (step.alternatives ?? []).filter(alt => alt.id !== altId),
            }),
            optionSets: (block.optionSets ?? []).map(choice => choice.appliesAtStepId !== removedFromStepId ? choice : {
                ...choice,
                options: choice.options.map(option => ({
                    ...option,
                    actions: option.actions.map(action => action.kind === 'select_alternative' && action.alternativeId === altId ? { ...action, alternativeId: '' } : action),
                })),
            }),
        };
    }));

    const updateAlternative = (blockIndex: number, stepIndex: number, altId: string, exerciseId: string | undefined, title: string) => setBlocks(current => current.map((block, index) => index !== blockIndex ? block : {
        ...block,
        steps: block.steps.map((step, stepAt) => stepAt !== stepIndex ? step : {
            ...step,
            alternatives: (step.alternatives ?? []).map(alt => alt.id !== altId ? alt : {
                ...alt, title, exerciseRef: exerciseId ? { kind: 'catalog', exerciseId } : { kind: 'unresolved_free_text', name: title },
            }),
        }),
    }));

    // Authored choices (D-MCHOICE) live on the block, not the step, so a single choice can be
    // remapped for multiple steps' alternatives -- but every fixture and this builder only ever
    // scopes one to `appliesAtStepId`. Mutations are keyed by choice/option id, not index, since
    // an option's action list can change length independently of its siblings.
    const updateChoices = (blockIndex: number, updater: (choices: SessionChoice[]) => SessionChoice[]) => setBlocks(current => current.map((block, index) => index !== blockIndex ? block : {
        ...block, optionSets: updater(block.optionSets ?? []),
    }));

    const addChoice = (blockIndex: number, appliesAtStepId: string) => updateChoices(blockIndex, choices => [...choices, createDraftChoice(appliesAtStepId, newId)]);
    const removeChoice = (blockIndex: number, choiceId: string) => updateChoices(blockIndex, choices => choices.filter(choice => choice.id !== choiceId));
    const updateChoice = (blockIndex: number, choiceId: string, patch: Partial<SessionChoice>) => updateChoices(blockIndex, choices => choices.map(choice => choice.id !== choiceId ? choice : { ...choice, ...patch }));

    // Retargets every action across this choice's options that pointed at the previous
    // `appliesAtStepId`, so switching which step a choice applies to can't silently leave an
    // action mutating the *old* step. `select_alternative` additionally loses its alternativeId
    // -- alternatives are step-scoped, so an alternative id valid on the old step is meaningless
    // (and may not even exist) on the new one; the author must re-pick it.
    const updateChoiceAppliesAtStep = (blockIndex: number, choiceId: string, nextStepId: string) => updateChoices(blockIndex, choices => choices.map(choice => {
        if (choice.id !== choiceId) return choice;
        const previousStepId = choice.appliesAtStepId;
        return {
            ...choice,
            appliesAtStepId: nextStepId,
            options: choice.options.map(option => ({
                ...option,
                actions: option.actions.map(action => {
                    if (!('targetStepId' in action) || action.targetStepId !== previousStepId) return action;
                    return action.kind === 'select_alternative'
                        ? { ...action, targetStepId: nextStepId, alternativeId: '' }
                        : { ...action, targetStepId: nextStepId };
                }),
            })),
        };
    }));

    const updateOptions = (blockIndex: number, choiceId: string, updater: (options: SessionOption[]) => SessionOption[]) => updateChoices(blockIndex, choices => choices.map(choice => choice.id !== choiceId ? choice : { ...choice, options: updater(choice.options) }));
    const addOption = (blockIndex: number, choiceId: string) => updateOptions(blockIndex, choiceId, options => [...options, createDraftOption(newId)]);
    const removeOption = (blockIndex: number, choiceId: string, optionId: string) => updateOptions(blockIndex, choiceId, options => options.filter(option => option.id !== optionId));
    const updateOptionLabel = (blockIndex: number, choiceId: string, optionId: string, label: string) => updateOptions(blockIndex, choiceId, options => options.map(option => option.id !== optionId ? option : { ...option, label }));

    const updateActions = (blockIndex: number, choiceId: string, optionId: string, updater: (actions: SessionChoiceAction[]) => SessionChoiceAction[]) => updateOptions(blockIndex, choiceId, options => options.map(option => option.id !== optionId ? option : { ...option, actions: updater(option.actions) }));
    const addAction = (blockIndex: number, block: SessionBlock, choice: SessionChoice, optionId: string, kind: SessionChoiceAction['kind']) => {
        const targetStep = block.steps.find(step => step.id === choice.appliesAtStepId);
        const firstAlternativeId = targetStep?.alternatives?.[0]?.id;
        updateActions(blockIndex, choice.id, optionId, actions => [...actions, createDraftAction(kind, { stepId: choice.appliesAtStepId, blockId: block.id, firstAlternativeId })]);
    };
    const removeAction = (blockIndex: number, choiceId: string, optionId: string, actionIndex: number) => updateActions(blockIndex, choiceId, optionId, actions => actions.filter((_, index) => index !== actionIndex));
    // Patches fields on the action *without* changing its kind (%, sets, reps, alternativeId, ...).
    const updateAction = (blockIndex: number, choiceId: string, optionId: string, actionIndex: number, patch: Partial<SessionChoiceAction>) => updateActions(blockIndex, choiceId, optionId, actions => actions.map((action, index) => index !== actionIndex ? action : { ...action, ...patch } as SessionChoiceAction));
    // Swaps the action's kind entirely. Merging a patch (as updateAction does) would leave stale
    // fields from the previous kind on the object -- e.g. switching reduce_load_percent to
    // end_session must drop `percent`/`targetStepId`, not keep them alongside the new kind.
    const replaceAction = (blockIndex: number, choiceId: string, optionId: string, actionIndex: number, next: SessionChoiceAction) => updateActions(blockIndex, choiceId, optionId, actions => actions.map((action, index) => index !== actionIndex ? action : next));

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
                                    const effortKind: 'none' | 'rpe' | 'rir' = step.effort?.kind === 'rir' ? 'rir' : step.effort?.kind === 'rpe' ? 'rpe' : 'none';
                                    const effortTarget = typeof step.effort?.target === 'number' ? step.effort.target : '';
                                    const loadKind: LoadKind = step.load?.kind ?? 'none';
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
                                                const exercise = EXERCISES_BY_ID.get(event.target.value);
                                                updateStep(blockIndex, stepIndex, exercise
                                                    ? { title: exercise.name, exerciseRef: { kind: 'catalog', exerciseId: exercise.id }, resolutionNote: undefined }
                                                    : { exerciseRef: { kind: 'unresolved_free_text', name: step.title ?? 'Custom movement' }, resolutionNote: 'Custom movement: executable and loggable, but it has no catalog-derived safety, cost, stimulus, PR or 1RM semantics.' });
                                            }}><option value="__custom__">Custom / free text</option>{exerciseOptions}</select></label>
                                            <label>Dose<select value={dose?.kind ?? 'repetition'} onChange={event => changeDose(blockIndex, stepIndex, event.target.value as SessionDose['kind'])}><option value="repetition">Repetitions</option><option value="duration">Timed hold</option><option value="distance">Distance</option><option value="checkoff">Check-off</option></select></label>
                                            {dose?.kind === 'repetition' && <><label>Sets<input type="number" min={1} value={dose.sets} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, sets: Math.max(1, Number(event.target.value) || 1) } })} /></label><label>Reps<input type="number" min={1} value={typeof dose.reps === 'number' ? dose.reps : dose.reps.min} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, reps: Math.max(1, Number(event.target.value) || 1) } })} /></label></>}
                                            {dose?.kind === 'duration' && <><label>Sets<input type="number" min={1} value={dose.sets ?? 1} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, sets: Math.max(1, Number(event.target.value) || 1) } })} /></label><label>Seconds<input type="number" min={1} value={typeof dose.seconds === 'number' ? dose.seconds : dose.seconds.min} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, seconds: Math.max(1, Number(event.target.value) || 1) } })} /></label></>}
                                            {dose?.kind === 'distance' && <><label>Sets<input type="number" min={1} value={dose.sets ?? 1} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, sets: Math.max(1, Number(event.target.value) || 1) } })} /></label><label>Metres<input type="number" min={1} value={typeof dose.meters === 'number' ? dose.meters : (typeof dose.metres === 'number' ? dose.metres : '')} onChange={event => updateStep(blockIndex, stepIndex, { dose: { ...dose, meters: Math.max(1, Number(event.target.value) || 1), metres: undefined } })} /></label></>}
                                            <label>Effort<select value={effortKind} onChange={event => changeEffort(blockIndex, stepIndex, event.target.value as 'none' | 'rpe' | 'rir')}><option value="none">Not tracked</option><option value="rpe">RPE</option><option value="rir">RIR</option></select></label>
                                            {effortKind !== 'none' && <label>{effortKind === 'rpe' ? 'RPE target' : 'RIR target'}<input type="number" min={0} max={10} step={0.5} value={effortTarget} onChange={event => updateStep(blockIndex, stepIndex, { effort: { kind: effortKind, target: Number(event.target.value) || 0 } })} /></label>}
                                            <label>Rest (sec)<input type="number" min={1} placeholder="Optional" value={typeof step.rest === 'number' ? step.rest : ''} onChange={event => updateStep(blockIndex, stepIndex, { rest: event.target.value === '' ? undefined : Math.max(1, Number(event.target.value)) })} /></label>
                                        </div>
                                        <details className="builder-advanced-fields">
                                            <summary>Advanced prescription</summary>
                                            <label><input type="checkbox" checked={Boolean(step.optional)} onChange={event => updateStep(blockIndex, stepIndex, { optional: event.target.checked || undefined })} /> Optional movement</label>
                                            <label>Laterality<select value={step.laterality ?? 'bilateral'} onChange={event => updateStep(blockIndex, stepIndex, { laterality: event.target.value as SessionStep['laterality'] })}><option value="bilateral">Bilateral</option><option value="per_side">Per side</option><option value="alternating">Alternating sides</option></select></label>
                                            <label>Tempo<input value={step.tempo ?? ''} placeholder="e.g. 2-0-X-0" onChange={event => updateStep(blockIndex, stepIndex, { tempo: event.target.value || undefined })} /></label>
                                            <label>Load<select value={loadKind} onChange={event => changeLoad(blockIndex, stepIndex, event.target.value as LoadKind)}>
                                                {LOAD_KINDS.map(kind => <option key={kind} value={kind}>{LOAD_KIND_LABELS[kind]}</option>)}
                                            </select></label>
                                            {step.load?.kind === 'mass' && <label>Mass (kg)<input type="number" min={0} step={0.5} value={typeof step.load.kg === 'number' ? step.load.kg : ''} onChange={event => updateStep(blockIndex, stepIndex, { load: { kind: 'mass', kg: Math.max(0, Number(event.target.value) || 0) } })} /></label>}
                                            {(step.load?.kind === 'percent_max' || step.load?.kind === 'percent_one_rm') && <label>Percent<input type="number" min={1} max={100} value={step.load.percent} onChange={event => updateStep(blockIndex, stepIndex, { load: { ...step.load as { kind: 'percent_max' | 'percent_one_rm'; percent: number }, percent: Math.max(1, Number(event.target.value) || 1) } })} /></label>}
                                            {step.load?.kind === 'band' && <label>Band<input value={step.load.bandColor} onChange={event => updateStep(blockIndex, stepIndex, { load: { kind: 'band', bandColor: event.target.value } })} /></label>}
                                            {step.load?.kind === 'descriptive' && <label>Load note<input value={step.load.display ?? ''} placeholder="e.g. last reviewed working load" onChange={event => updateStep(blockIndex, stepIndex, { load: { kind: 'descriptive', display: event.target.value } })} /></label>}
                                            <label>Step notes<textarea rows={2} value={step.notes ?? ''} onChange={event => updateStep(blockIndex, stepIndex, { notes: event.target.value || undefined })} /></label>
                                            <label>Stop conditions (one per line)<textarea rows={2} value={(step.stopConditions ?? []).join('\n')} onChange={event => updateStep(blockIndex, stepIndex, { stopConditions: event.target.value.split('\n').map(value => value.trim()).filter(Boolean) })} /></label>
                                            <div className="builder-alternatives">
                                                <div className="builder-alternatives-header"><span>Alternatives (for authored choices to switch to)</span><button type="button" onClick={() => addAlternative(blockIndex, stepIndex)}>Add alternative</button></div>
                                                {(step.alternatives ?? []).map(alt => {
                                                    const altExercise = alt.exerciseRef.kind === 'catalog' ? alt.exerciseRef.exerciseId : '__custom__';
                                                    return <div key={alt.id} className="builder-alternative-row">
                                                        <input value={alt.title} onChange={event => updateAlternative(blockIndex, stepIndex, alt.id, altExercise === '__custom__' ? undefined : altExercise, event.target.value)} aria-label="Alternative title" />
                                                        <select value={altExercise} onChange={event => {
                                                            const exercise = EXERCISES_BY_ID.get(event.target.value);
                                                            updateAlternative(blockIndex, stepIndex, alt.id, exercise?.id, exercise?.name ?? alt.title);
                                                        }} aria-label="Alternative movement"><option value="__custom__">Custom / free text</option>{exerciseOptions}</select>
                                                        <button type="button" onClick={() => removeAlternative(blockIndex, stepIndex, alt.id)} aria-label="Remove alternative">Remove</button>
                                                    </div>;
                                                })}
                                            </div>
                                        </details>
                                    </div>;
                                })}
                                <button type="button" className="add-step-btn" onClick={() => addStep(blockIndex)}>Add movement</button>
                            </div>
                            <section className="builder-choices">
                                <div className="builder-choices-header">
                                    <span>Authored choices — a bounded option set the athlete answers at a step (D-MCHOICE)</span>
                                    <button type="button" disabled={block.steps.length === 0} onClick={() => addChoice(blockIndex, block.steps[0].id)}>Add choice</button>
                                </div>
                                {(block.optionSets ?? []).map(choice => <div key={choice.id} className="builder-choice-card">
                                    <div className="builder-choice-row">
                                        <label>Applies at<select value={choice.appliesAtStepId} onChange={event => updateChoiceAppliesAtStep(blockIndex, choice.id, event.target.value)}>
                                            {block.steps.map(step => <option key={step.id} value={step.id}>{step.title ?? step.id}</option>)}
                                        </select></label>
                                        <button type="button" onClick={() => removeChoice(blockIndex, choice.id)} aria-label="Remove choice">Remove choice</button>
                                    </div>
                                    <label>Trigger — what the athlete observes<input value={choice.trigger.description} placeholder="e.g. How did the warm-up sets feel?" onChange={event => updateChoice(blockIndex, choice.id, { trigger: { kind: 'athlete_observed', description: event.target.value } })} /></label>
                                    <div className="builder-options-list">
                                        {choice.options.map(option => <div key={option.id} className="builder-option-card">
                                            <div className="builder-option-row">
                                                <input value={option.label} onChange={event => updateOptionLabel(blockIndex, choice.id, option.id, event.target.value)} aria-label="Option label" />
                                                <button type="button" disabled={choice.options.length <= 1} onClick={() => removeOption(blockIndex, choice.id, option.id)} aria-label="Remove option">Remove</button>
                                            </div>
                                            {option.actions.map((action, actionIndex) => {
                                                const targetStep = block.steps.find(step => step.id === choice.appliesAtStepId);
                                                return <div key={actionIndex} className="builder-action-row">
                                                    <select value={action.kind} onChange={event => replaceAction(blockIndex, choice.id, option.id, actionIndex, createDraftAction(event.target.value as SessionChoiceAction['kind'], { stepId: choice.appliesAtStepId, blockId: block.id, firstAlternativeId: targetStep?.alternatives?.[0]?.id }))}>
                                                        {ACTION_KINDS.map(kind => <option key={kind} value={kind}>{ACTION_KIND_LABELS[kind]}</option>)}
                                                    </select>
                                                    {action.kind === 'reduce_load_percent' && <label>%<input type="number" min={1} max={99} value={action.percent} onChange={event => updateAction(blockIndex, choice.id, option.id, actionIndex, { percent: Math.max(1, Number(event.target.value) || 1) })} /></label>}
                                                    {action.kind === 'reduce_sets' && <label>Sets<input type="number" min={1} value={action.sets} onChange={event => updateAction(blockIndex, choice.id, option.id, actionIndex, { sets: Math.max(1, Number(event.target.value) || 1) })} /></label>}
                                                    {action.kind === 'reduce_reps' && <label>Reps<input type="number" min={1} value={action.reps} onChange={event => updateAction(blockIndex, choice.id, option.id, actionIndex, { reps: Math.max(1, Number(event.target.value) || 1) })} /></label>}
                                                    {action.kind === 'select_alternative' && <label>Alternative<select value={action.alternativeId} onChange={event => updateAction(blockIndex, choice.id, option.id, actionIndex, { alternativeId: event.target.value })}>
                                                        <option value="">Choose…</option>
                                                        {(targetStep?.alternatives ?? []).map(alt => <option key={alt.id} value={alt.id}>{alt.title}</option>)}
                                                    </select>{(targetStep?.alternatives ?? []).length === 0 && <em className="builder-choice-warning">Add an alternative to “{targetStep?.title ?? choice.appliesAtStepId}” first</em>}</label>}
                                                    <button type="button" onClick={() => removeAction(blockIndex, choice.id, option.id, actionIndex)} aria-label="Remove action">Remove action</button>
                                                </div>;
                                            })}
                                            <button type="button" className="add-action-btn" onClick={() => addAction(blockIndex, block, choice, option.id, 'reduce_load_percent')}>Add action</button>
                                        </div>)}
                                        <button type="button" className="add-option-btn" onClick={() => addOption(blockIndex, choice.id)}>Add option</button>
                                    </div>
                                </div>)}
                            </section>
                        </article>
                    ))}
                </section>
                {validationError && <pre className="destination-error-box" role="alert">{validationError}</pre>}
                <div className="builder-actions"><button type="button" className="save-and-proceed-btn" onClick={review}>Review session</button></div>
            </div>

            {showPreview && <SessionDefinitionPreview definition={definition} onChooseDestination={() => setShowDestination(true)} />}
            <SessionDestinationSheet userId={userId} definition={definition} isOpen={showDestination} onClose={() => setShowDestination(false)} onStartExecution={onStartExecution} onSaved={onClose} onOccurrenceCreated={onClose} />
        </div>
    );
};
