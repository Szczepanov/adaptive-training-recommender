import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useOverlayDialog } from '../useOverlayDialog';
import '../overlayContract.css';
import type { SessionStep } from '../../sessions/models';
import { EXERCISES, EXERCISES_BY_ID } from '../../workouts/exercises';
import { stepName } from '../../sessions/stepDisplay';
import { buildCatalogReplacement, type StepExerciseReplacement } from '../../sessions/swapAdaptation';
import './ExerciseSwapModal.css';

interface ExerciseSwapModalProps {
    /** The step being replaced; in `add` mode, an empty exercise step to build the new one from. */
    step: SessionStep;
    /** `add` picks an extra exercise to append instead of replacing the current one. */
    mode?: 'swap' | 'add';
    onSwap: (replacement: StepExerciseReplacement) => void;
    onClose: () => void;
}

/** Modal dialog for substituting an active session step with a catalog or custom free-text exercise. */
export const ExerciseSwapModal: React.FC<ExerciseSwapModalProps> = ({
    step,
    mode = 'swap',
    onSwap,
    onClose,
}) => {
    const currentName = stepName(step);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
    const [isCustom, setIsCustom] = useState<boolean>(false);
    const [customName, setCustomName] = useState<string>('');
    const [customTempo, setCustomTempo] = useState<string>(step.tempo ?? '');
    const [customNotes, setCustomNotes] = useState<string>(step.notes ?? '');
    // The fields start with the replaced exercise's tempo/notes. Unless the athlete edits them,
    // they describe the old movement and must not be copied onto a catalog replacement.
    const [tempoEdited, setTempoEdited] = useState<boolean>(false);
    const [notesEdited, setNotesEdited] = useState<boolean>(false);
    const panelRef = useRef<HTMLDivElement>(null);
    useOverlayDialog(true, panelRef, onClose, '#swap-exercise-search, #swap-custom-exercise-name');
    useEffect(() => {
        const selector = isCustom ? '#swap-custom-exercise-name' : '#swap-exercise-search';
        panelRef.current?.querySelector<HTMLInputElement>(selector)?.focus();
    }, [isCustom]);

    const filteredExercises = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return EXERCISES.slice(0, 30);
        return EXERCISES.filter(ex =>
            ex.name.toLowerCase().includes(query) ||
            ex.id.toLowerCase().includes(query) ||
            ex.modality.toLowerCase().includes(query) ||
            ex.primaryMuscles.some(m => m.toLowerCase().includes(query)) ||
            (ex.equipment && ex.equipment.some(eq => eq.toLowerCase().includes(query))),
        );
    }, [searchQuery]);

    const handleConfirm = () => {
        if (isCustom) {
            if (!customName.trim()) return;
            onSwap({
                exerciseRef: { kind: 'unresolved_free_text', name: customName.trim() },
                title: customName.trim(),
                // Pre-filled tempo/notes describe the replaced movement; only typed text carries over.
                tempo: (tempoEdited ? customTempo.trim() : '') || null,
                notes: (notesEdited ? customNotes.trim() : '') || null,
                stopConditions: null,
            });
            onClose();
            return;
        }

        if (!selectedExerciseId) return;
        // Optimization: Use O(1) Map lookup instead of O(N) array .find()
        const exercise = EXERCISES_BY_ID.get(selectedExerciseId);
        if (!exercise) return;

        onSwap(buildCatalogReplacement(step, exercise, {
            ...(tempoEdited ? { tempo: customTempo } : {}),
            ...(notesEdited ? { notes: customNotes } : {}),
        }));
        onClose();
    };

    return (
        <div className="modal-overlay overlay-viewport" role="dialog" aria-modal="true" aria-labelledby="swap-modal-title">
            <div ref={panelRef} className="exercise-swap-modal overlay-panel" tabIndex={-1}>
                <div className="swap-modal-header">
                    <h3 id="swap-modal-title">{mode === 'add' ? 'Add Exercise' : 'Swap Exercise'}</h3>
                    <button type="button" className="close-btn" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <p className="swap-subtitle">
                    {mode === 'add'
                        ? 'Log an exercise you are doing beyond the plan. It is saved with this session.'
                        : <>Current: <strong>{currentName}</strong></>}
                </p>

                <div className="swap-mode-toggle">
                    <button
                        type="button"
                        className={`mode-btn ${!isCustom ? 'active' : ''}`}
                        onClick={() => setIsCustom(false)}
                    >
                        Choose from Catalog
                    </button>
                    <button
                        type="button"
                        className={`mode-btn ${isCustom ? 'active' : ''}`}
                        onClick={() => setIsCustom(true)}
                    >
                        Custom Exercise Name
                    </button>
                </div>

                {!isCustom ? (
                    <div className="catalog-picker-section">
                        <label className="swap-label" htmlFor="swap-exercise-search">Search exercises</label>
                        <input
                            id="swap-exercise-search"
                            type="search"
                            className="exercise-search-input"
                            placeholder="Search exercises by name, equipment, muscle..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                        <div className="exercise-picker-list">
                            {filteredExercises.map(ex => {
                                const isSelected = selectedExerciseId === ex.id;
                                return (
                                    <button
                                        key={ex.id}
                                        type="button"
                                        className={`exercise-option-item ${isSelected ? 'selected' : ''}`}
                                        onClick={() => setSelectedExerciseId(ex.id)}
                                        aria-pressed={isSelected}
                                    >
                                        <div className="exercise-option-main">
                                            <span className="exercise-option-name">{ex.name}</span>
                                            <span className="exercise-option-meta">
                                                {ex.modality} {ex.equipment?.length ? `· ${ex.equipment.join(', ')}` : ''}
                                            </span>
                                        </div>
                                        {isSelected && <span className="selected-check">✓</span>}
                                    </button>
                                );
                            })}
                            {filteredExercises.length === 0 && (
                                <p className="no-match-text">No matching exercises. You can switch to "Custom Exercise Name".</p>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="custom-exercise-section">
                        <div className="swap-input-group">
                            <label className="swap-label" htmlFor="swap-custom-exercise-name">Exercise Name</label>
                            <input
                                id="swap-custom-exercise-name"
                                type="text"
                                className="swap-input-box"
                                placeholder="e.g. Single-arm Dumbbell Floor Press"
                                value={customName}
                                onChange={e => setCustomName(e.target.value)}
                            />
                        </div>
                    </div>
                )}

                <div className="optional-fields-row">
                    <label className="swap-input-group">
                        <span className="swap-label">Tempo (optional, e.g. 3-0-1-1)</span>
                        <input
                            type="text"
                            className="swap-input-box"
                            placeholder="e.g. 3-0-1-1"
                            value={customTempo}
                            onChange={e => { setCustomTempo(e.target.value); setTempoEdited(true); }}
                        />
                    </label>
                    <label className="swap-input-group">
                        <span className="swap-label">Notes / Instructions (optional)</span>
                        <input
                            type="text"
                            className="swap-input-box"
                            placeholder="e.g. Single dumbbell, brace core"
                            value={customNotes}
                            onChange={e => { setCustomNotes(e.target.value); setNotesEdited(true); }}
                        />
                    </label>
                </div>

                <div className="swap-modal-actions">
                    <button type="button" className="cancel-swap-btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="confirm-swap-btn"
                        disabled={!isCustom && !selectedExerciseId || isCustom && !customName.trim()}
                        onClick={handleConfirm}
                    >
                        {mode === 'add' ? 'Add Exercise' : 'Replace Exercise'}
                    </button>
                </div>
            </div>
        </div>
    );
};
