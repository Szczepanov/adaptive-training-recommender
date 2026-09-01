import React, { useState, useMemo } from 'react';
import type { SessionStep } from '../../sessions/models';
import { EXERCISES, EXERCISES_BY_ID } from '../../workouts/exercises';
import { stepName } from '../../sessions/stepDisplay';
import './ExerciseSwapModal.css';

interface ExerciseSwapModalProps {
    step: SessionStep;
    onSwap: (replacement: {
        exerciseRef: SessionStep['exerciseRef'];
        title?: string;
        dose?: SessionStep['dose'];
        /** `undefined` leaves the step's current tempo/notes untouched; `null` explicitly clears it. */
        tempo?: string | null;
        rest?: SessionStep['rest'];
        notes?: string | null;
    }) => void;
    onClose: () => void;
}

export const ExerciseSwapModal: React.FC<ExerciseSwapModalProps> = ({
    step,
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
                // This modal always shows tempo/notes as editable text -- an empty field is an
                // explicit instruction to clear the step's existing value, not "leave it as is".
                tempo: customTempo.trim() || null,
                notes: customNotes.trim() || null,
            });
            onClose();
            return;
        }

        if (!selectedExerciseId) return;
        // Optimization: Use O(1) Map lookup instead of O(N) array .find()
        const exercise = EXERCISES_BY_ID.get(selectedExerciseId);
        if (!exercise) return;

        onSwap({
            exerciseRef: { kind: 'catalog', exerciseId: exercise.id },
            title: exercise.name,
            tempo: customTempo.trim() || null,
            notes: customNotes.trim() || exercise.instruction || null,
        });
        onClose();
    };

    return (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="swap-modal-title">
            <div className="exercise-swap-modal">
                <div className="swap-modal-header">
                    <h3 id="swap-modal-title">Swap Exercise</h3>
                    <button type="button" className="close-btn" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <p className="swap-subtitle">
                    Current: <strong>{currentName}</strong>
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
                        <input
                            type="search"
                            className="exercise-search-input"
                            placeholder="Search exercises by name, equipment, muscle..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            autoFocus
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
                        <label className="swap-input-group">
                            <span className="swap-label">Exercise Name</span>
                            <input
                                type="text"
                                className="swap-input-box"
                                placeholder="e.g. Single-arm Dumbbell Floor Press"
                                value={customName}
                                onChange={e => setCustomName(e.target.value)}
                                autoFocus
                            />
                        </label>
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
                            onChange={e => setCustomTempo(e.target.value)}
                        />
                    </label>
                    <label className="swap-input-group">
                        <span className="swap-label">Notes / Instructions (optional)</span>
                        <input
                            type="text"
                            className="swap-input-box"
                            placeholder="e.g. Single dumbbell, brace core"
                            value={customNotes}
                            onChange={e => setCustomNotes(e.target.value)}
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
                        Replace Exercise
                    </button>
                </div>
            </div>
        </div>
    );
};
