import { useEffect, useState, memo } from 'react';
import type { ActivityOverride, NormalizedGarminActivity, SessionTemplate, WorkoutStimulusProfile } from '../engine/models';
import { activityOverrideService } from '../services/activityOverrideService';
import './ActivityReclassificationModal.css';

interface ActivityReclassificationModalProps {
    userId: string;
    activities: NormalizedGarminActivity[];
    existingOverrides: Record<string, ActivityOverride>;
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const MODALITY_OPTIONS: Array<SessionTemplate['modality']> = [
    'Running',
    'Cycling',
    'Strength',
    'Mobility',
    'Field',
    'Cross Training',
];

const STIMULUS_OPTIONS: Array<{ key: keyof WorkoutStimulusProfile; label: string }> = [
    { key: 'aerobicEndurance', label: 'Aerobic Base (Zone 2)' },
    { key: 'thresholdPower', label: 'Threshold / Tempo' },
    { key: 'vo2MaxPower', label: 'VO2 Max Intervals' },
    { key: 'repeatedSurges', label: 'Repeated Surges / Game Play' },
    { key: 'sprintPower', label: 'Neuromuscular / Sprint' },
    { key: 'hypertrophy', label: 'Hypertrophy / Muscle Mass' },
    { key: 'maxStrength', label: 'Maximum Strength' },
    { key: 'fatigueResistance', label: 'Fatigue Resistance / Long Duration' },
];

function inferredModality(activity: NormalizedGarminActivity): SessionTemplate['modality'] {
    const type = activity.type.toLowerCase();
    if (type.includes('cycl') || type.includes('bike')) return 'Cycling';
    if (type.includes('run') || type.includes('walk')) return 'Running';
    if (type.includes('mobility') || type.includes('yoga')) return 'Mobility';
    if (type.includes('field') || type.includes('soccer') || type.includes('football')) return 'Field';
    if (type.includes('strength') || type.includes('weight')) return 'Strength';
    return 'Cross Training';
}

function inferredIntensity(activity: NormalizedGarminActivity): 'easy' | 'moderate' | 'hard' {
    if (activity.intensityTag === 'hard') return 'hard';
    if (activity.intensityTag === 'easy') return 'easy';
    return 'moderate';
}

export const ActivityReclassificationModal = memo(function ActivityReclassificationModal({
    userId,
    activities,
    existingOverrides,
    isOpen,
    onClose,
    onSaved,
}: ActivityReclassificationModalProps) {
    const [selectedActivityId, setSelectedActivityId] = useState<string>('');
    const [modality, setModality] = useState<SessionTemplate['modality']>('Running');
    const [intensity, setIntensity] = useState<'easy' | 'moderate' | 'hard'>('moderate');
    const [rpe, setRpe] = useState<number>(6);
    const [stimulusFocus, setStimulusFocus] = useState<keyof WorkoutStimulusProfile | ''>('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const hydrateEditor = (activityId: string) => {
        const activity = activities.find(a => a.activityId === activityId);
        if (!activity) return;

        const override = existingOverrides[activityId];
        setSelectedActivityId(activityId);
        setError(null);
        if (override) {
            setModality(override.overriddenModality === 'Unknown' ? inferredModality(activity) : override.overriddenModality);
            setIntensity(override.overriddenIntensity === 'unknown' ? inferredIntensity(activity) : override.overriddenIntensity);
            setRpe(override.rpe ?? 6);
            setStimulusFocus(override.stimulusFocus ?? '');
            setNotes(override.notes ?? '');
            return;
        }

        setModality(inferredModality(activity));
        setIntensity(inferredIntensity(activity));
        setRpe(6);
        setStimulusFocus('');
        setNotes('');
    };

    useEffect(() => {
        if (!isOpen) return;
        const selectedStillExists = activities.some(activity => activity.activityId === selectedActivityId);
        const activityId = selectedStillExists ? selectedActivityId : activities[0]?.activityId;
        if (activityId) hydrateEditor(activityId);
    // Rehydrate when the modal opens or refreshed override/activity data arrives. The
    // selected id is intentionally not a dependency: hydrateEditor sets it and adding it
    // would make normal form edits vulnerable to a rehydration loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, activities, existingOverrides]);

    if (!isOpen) return null;

    const selectedActivity = activities.find(a => a.activityId === selectedActivityId) ?? activities[0];
    const currentOverride = selectedActivity ? existingOverrides[selectedActivity.activityId] : undefined;

    const handleSelectActivity = (id: string) => {
        hydrateEditor(id);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedActivity) return;

        setSaving(true);
        setError(null);
        try {
            const override: ActivityOverride = {
                activityId: selectedActivity.activityId,
                userId,
                date: selectedActivity.date,
                originalType: selectedActivity.type,
                originalIntensityTag: selectedActivity.intensityTag,
                overriddenModality: modality,
                overriddenIntensity: intensity,
                rpe,
                stimulusFocus: stimulusFocus || null,
                notes: notes.trim() || null,
                createdAt: currentOverride?.createdAt ?? new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            const success = await activityOverrideService.saveOverride(userId, override);
            if (!success) {
                setError('Failed to save reclassification. Please try again.');
                return;
            }
            onSaved();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error saving reclassification');
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveOverride = async () => {
        if (!selectedActivity || !currentOverride) return;
        setSaving(true);
        setError(null);
        try {
            const success = await activityOverrideService.deleteOverride(userId, selectedActivity.activityId);
            if (!success) {
                setError('Failed to remove reclassification. Please try again.');
                return;
            }
            onSaved();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error removing reclassification');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reclassify-title">
            <div className="reclassify-modal-card">
                <header className="modal-header">
                    <div>
                        <h3 id="reclassify-title">Correct Garmin Activity</h3>
                        <p className="modal-subtitle">
                            Did Garmin classify your sport or intensity incorrectly? Update it here to keep your training stimulus and recovery baselines accurate.
                        </p>
                    </div>
                    <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close modal">
                        ✕
                    </button>
                </header>

                <form onSubmit={handleSave} className="reclassify-form">
                    <div className="form-group">
                        <label htmlFor="activity-select">Select Synced Activity:</label>
                        <select
                            id="activity-select"
                            className="input-select"
                            value={selectedActivity?.activityId ?? ''}
                            onChange={(e) => handleSelectActivity(e.target.value)}
                            disabled={activities.length === 0}
                        >
                            {activities.map(act => (
                                <option key={act.activityId} value={act.activityId}>
                                    {act.date} — {act.type.replaceAll('_', ' ')} ({act.durationMin ?? '--'}m, {act.intensityTag})
                                    {existingOverrides[act.activityId] ? ' [Corrected]' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {selectedActivity ? (
                        <div className="original-activity-summary">
                            <span className="summary-label">Garmin Detected:</span>
                            <span className="summary-details">
                                <strong>{selectedActivity.type}</strong> · {selectedActivity.durationMin ?? '--'} min · TE Aerobic: {selectedActivity.trainingEffectAerobic ?? '--'} · TE Anaerobic: {selectedActivity.trainingEffectAnaerobic ?? '--'}
                            </span>
                        </div>
                    ) : (
                        <p className="form-error-msg">No synced activity is available to correct.</p>
                    )}

                    <div className="form-group">
                        <label htmlFor="modality-select">Actual Sport / Modality:</label>
                        <select
                            id="modality-select"
                            className="input-select"
                            value={modality}
                            onChange={(e) => setModality(e.target.value as SessionTemplate['modality'])}
                        >
                            {MODALITY_OPTIONS.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Actual Effort / Intensity:</label>
                        <div className="radio-button-group">
                            <button type="button" className={`group-choice-btn ${intensity === 'easy' ? 'active' : ''}`} onClick={() => setIntensity('easy')}>
                                🟢 Easy / Recovery
                            </button>
                            <button type="button" className={`group-choice-btn ${intensity === 'moderate' ? 'active' : ''}`} onClick={() => setIntensity('moderate')}>
                                🔵 Moderate / Steady
                            </button>
                            <button type="button" className={`group-choice-btn ${intensity === 'hard' ? 'active' : ''}`} onClick={() => setIntensity('hard')}>
                                🔴 Hard / Interval
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="slider-label-row">
                            <label htmlFor="rpe-slider">Perceived Exertion (RPE):</label>
                            <span className="rpe-value-badge">{rpe}/10</span>
                        </div>
                        <input id="rpe-slider" type="range" min="1" max="10" value={rpe} onChange={(e) => setRpe(Number(e.target.value))} className="range-input" />
                    </div>

                    <div className="form-group">
                        <label htmlFor="stimulus-select">Primary Adaptation Focus (Optional):</label>
                        <select
                            id="stimulus-select"
                            className="input-select"
                            value={stimulusFocus}
                            onChange={(e) => setStimulusFocus(e.target.value as keyof WorkoutStimulusProfile | '')}
                        >
                            <option value="">Default from modality and effort</option>
                            {STIMULUS_OPTIONS.map(opt => (
                                <option key={opt.key} value={opt.key}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label htmlFor="notes-input">Correction Notes (Optional):</label>
                        <input
                            id="notes-input"
                            type="text"
                            className="input-text"
                            placeholder="e.g. 5x1k track intervals, watch recorded as generic cardio"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />
                    </div>

                    {error && <p className="form-error-msg" role="alert">{error}</p>}

                    <div className="modal-actions-row">
                        {currentOverride && (
                            <button type="button" className="btn-secondary btn-danger-outline" onClick={handleRemoveOverride} disabled={saving}>
                                Reset to Garmin Default
                            </button>
                        )}
                        <div className="modal-right-actions">
                            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
                                Cancel
                            </button>
                            <button type="submit" className="btn-primary" disabled={saving || !selectedActivity}>
                                {saving ? 'Saving...' : 'Save Correction ✓'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
});
