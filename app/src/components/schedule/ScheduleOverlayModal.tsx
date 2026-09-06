import { useState, useEffect, memo } from 'react';
import type {
    ScheduleOverlayCategory,
    ScheduleOverlaySport,
    TrainingEnvironment,
    WorkoutCostProfile,
} from '../../engine/models';
import {
    SCHEDULE_OVERLAY_PRESETS,
    type ScheduleOverlayPreset,
} from '../../services/scheduleOverlayPresets';
import {
    scheduleOverlayService,
    type ScheduleOverlayWithId,
} from '../../services/scheduleOverlayService';
import { getLocalDateString } from '../../utils/localDate';
import './ScheduleOverlayModal.css';

interface ScheduleOverlayModalProps {
    userId: string;
    existingOverlay: ScheduleOverlayWithId | null;
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const CATEGORY_OPTIONS: Array<{ value: ScheduleOverlayCategory; label: string; icon: string }> = [
    { value: 'active_sport', label: 'Active Sport', icon: '⛷️' },
    { value: 'sedentary_rest', label: 'Sedentary Rest', icon: '🎄' },
    { value: 'high_step_walking', label: 'High-Step Walking', icon: '🚶' },
    { value: 'limited_availability', label: 'Limited Time', icon: '⏱️' },
];

const SPORT_OPTIONS: Array<{ value: ScheduleOverlaySport; label: string }> = [
    { value: 'skiing', label: 'Skiing / Snowboarding' },
    { value: 'volleyball', label: 'Volleyball' },
    { value: 'hiking', label: 'Hiking / Trekking' },
    { value: 'court_sport', label: 'Court Sport (Tennis / Squash)' },
    { value: 'field_sport', label: 'Field Sport (Football / Soccer)' },
    { value: 'general', label: 'General / Other Sport' },
];

const DEFAULT_COST: WorkoutCostProfile = {
    systemic: 0,
    cardiovascular: 0,
    lowerBody: 0,
    upperBody: 0,
    impactTissue: 0,
    neuromuscular: 0,
};

export const ScheduleOverlayModal = memo(function ScheduleOverlayModal({
    userId,
    existingOverlay,
    isOpen,
    onClose,
    onSaved,
}: ScheduleOverlayModalProps) {
    const today = getLocalDateString();
    const [title, setTitle] = useState('');
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);
    const [category, setCategory] = useState<ScheduleOverlayCategory>('active_sport');
    const [sport, setSport] = useState<ScheduleOverlaySport | ''>('skiing');
    const [dailyAvailabilityMinutes, setDailyAvailabilityMinutes] = useState(0);
    const [volumeScale, setVolumeScale] = useState(0.0);
    const [intensityScale, setIntensityScale] = useState(0.0);
    const [environmentOverride, setEnvironmentOverride] = useState<TrainingEnvironment | ''>('');
    const [expectedCost, setExpectedCost] = useState<WorkoutCostProfile>(DEFAULT_COST);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        if (existingOverlay) {
            setTitle(existingOverlay.title);
            setStartDate(existingOverlay.startDate);
            setEndDate(existingOverlay.endDate);
            setCategory(existingOverlay.category);
            setSport(existingOverlay.sport ?? '');
            setDailyAvailabilityMinutes(existingOverlay.dailyAvailabilityMinutes);
            setVolumeScale(existingOverlay.volumeScale);
            setIntensityScale(existingOverlay.intensityScale);
            setEnvironmentOverride(existingOverlay.environment ?? '');
            setExpectedCost({ ...existingOverlay.expectedCost });
            setShowAdvanced(false);
        } else {
            // Apply skiing preset as default starting point
            applyPreset(SCHEDULE_OVERLAY_PRESETS[0]);
            setStartDate(today);
            setEndDate(today);
            setShowAdvanced(false);
        }
        setError(null);
    }, [isOpen, existingOverlay, today]);

    if (!isOpen) return null;

    /** Copy one reviewed preset into editable form state without adding hidden constraints. */
    function applyPreset(preset: ScheduleOverlayPreset) {
        setTitle(preset.title);
        setCategory(preset.category);
        setSport(preset.sport ?? '');
        setDailyAvailabilityMinutes(preset.dailyAvailabilityMinutes);
        setVolumeScale(preset.volumeScale);
        setIntensityScale(preset.intensityScale);
        setExpectedCost({ ...preset.expectedCost });
        setEnvironmentOverride(preset.environment ?? '');
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!title.trim()) {
            setError('Please provide a title for this schedule block.');
            return;
        }

        if (startDate > endDate) {
            setError('Start date must be on or before end date.');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                title: title.trim(),
                startDate,
                endDate,
                category,
                // `sport` only has meaning for an active-sport overlay. Omitting it for
                // every other category also guarantees a category change clears stale data
                // when the service performs its authoritative full-document replacement.
                ...(category === 'active_sport' && sport ? { sport } : {}),
                dailyAvailabilityMinutes,
                volumeScale,
                intensityScale,
                expectedCost,
                ...(environmentOverride ? { environment: environmentOverride } : {}),
            };

            if (existingOverlay) {
                await scheduleOverlayService.update(userId, existingOverlay.id, {
                    ...payload,
                    createdAt: existingOverlay.createdAt,
                });
            } else {
                await scheduleOverlayService.create(userId, payload);
            }

            onSaved();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save schedule overlay');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!existingOverlay) return;
        setSaving(true);
        setError(null);
        try {
            await scheduleOverlayService.delete(userId, existingOverlay.id);
            onSaved();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete schedule overlay');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
            <div className="schedule-overlay-modal-card" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h3>{existingOverlay ? 'Edit Schedule Block' : 'Plan Time Off / Sport Block'}</h3>
                        <p className="modal-subtitle">
                            Informs periodization, weekly anchors, availability, and recovery demand about planned schedule constraints or extra activity.
                        </p>
                    </div>
                    <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close">
                        &times;
                    </button>
                </div>

                {!existingOverlay && (
                    <div className="presets-section">
                        <label className="section-label">Quick Presets</label>
                        <div className="presets-grid">
                            {SCHEDULE_OVERLAY_PRESETS.map(preset => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className="preset-btn"
                                    onClick={() => applyPreset(preset)}
                                >
                                    <span className="preset-icon">{preset.icon}</span>
                                    <span className="preset-label">{preset.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <form onSubmit={handleSave} className="overlay-form">
                    <div className="form-group">
                        <label htmlFor="overlay-title">Title / Name</label>
                        <input
                            id="overlay-title"
                            type="text"
                            className="text-input"
                            placeholder="e.g., Ski Trip in Alps, Christmas, Rome Walking"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label htmlFor="overlay-start-date">Start Date</label>
                            <input
                                id="overlay-start-date"
                                type="date"
                                className="text-input"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="overlay-end-date">End Date</label>
                            <input
                                id="overlay-end-date"
                                type="date"
                                className="text-input"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="section-label">Schedule Category</label>
                        <div className="category-toggle-group">
                            {CATEGORY_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    className={`category-toggle-btn ${category === opt.value ? 'active' : ''}`}
                                    onClick={() => {
                                        setCategory(opt.value);
                                        if (opt.value === 'sedentary_rest') {
                                            setDailyAvailabilityMinutes(0);
                                            setVolumeScale(0.0);
                                            setIntensityScale(0.0);
                                        } else if (opt.value === 'high_step_walking') {
                                            setDailyAvailabilityMinutes(0);
                                            setExpectedCost(prev => ({ ...prev, impactTissue: 0.55 }));
                                        }
                                    }}
                                >
                                    <span>{opt.icon}</span>
                                    <span>{opt.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {category === 'active_sport' && (
                        <div className="form-group">
                            <label htmlFor="overlay-sport">Sport Activity</label>
                            <select
                                id="overlay-sport"
                                className="select-input"
                                value={sport}
                                onChange={e => setSport(e.target.value as ScheduleOverlaySport)}
                            >
                                {SPORT_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="advanced-toggle-wrapper">
                        <button
                            type="button"
                            className="advanced-toggle-btn"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                        >
                            {showAdvanced ? '▼ Hide Advanced Physiological Tuning' : '▶ Show Advanced Physiological Tuning'}
                        </button>
                    </div>

                    {showAdvanced && (
                        <div className="advanced-section">
                            <div className="form-row">
                                <div className="form-group">
                                    <label htmlFor="overlay-avail">Training Available (min/day)</label>
                                    <input
                                        id="overlay-avail"
                                        type="number"
                                        min="0"
                                        max="1440"
                                        step="1"
                                        className="text-input"
                                        value={dailyAvailabilityMinutes}
                                        onChange={e => setDailyAvailabilityMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                                    />
                                    <span className="field-hint">0 min prevents quality/endurance anchors.</span>
                                </div>
                                <div className="form-group">
                                    <label htmlFor="overlay-env">Environment</label>
                                    <select
                                        id="overlay-env"
                                        className="select-input"
                                        value={environmentOverride}
                                        onChange={e => setEnvironmentOverride(e.target.value as TrainingEnvironment)}
                                    >
                                        <option value="">No restriction</option>
                                        <option value="outdoor">Outdoor only</option>
                                        <option value="indoor">Indoor only</option>
                                        <option value="either">Either</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Volume Scale: {Math.round(volumeScale * 100)}%</label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={volumeScale}
                                        onChange={e => setVolumeScale(parseFloat(e.target.value))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Intensity Scale: {Math.round(intensityScale * 100)}%</label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={intensityScale}
                                        onChange={e => setIntensityScale(parseFloat(e.target.value))}
                                    />
                                </div>
                            </div>

                            <div className="cost-sliders-group">
                                <label className="section-label">Injected Unprogrammed Fatigue</label>
                                <div className="cost-slider-row">
                                    <span>Lower Body (Quads/Legs):</span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={expectedCost.lowerBody}
                                        onChange={e => setExpectedCost(c => ({ ...c, lowerBody: parseFloat(e.target.value) }))}
                                    />
                                    <span className="cost-val">{Math.round(expectedCost.lowerBody * 100)}%</span>
                                </div>
                                <div className="cost-slider-row">
                                    <span>Impact / Joint Shock:</span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={expectedCost.impactTissue}
                                        onChange={e => setExpectedCost(c => ({ ...c, impactTissue: parseFloat(e.target.value) }))}
                                    />
                                    <span className="cost-val">{Math.round(expectedCost.impactTissue * 100)}%</span>
                                </div>
                                <div className="cost-slider-row">
                                    <span>Neuromuscular / Explosive:</span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={expectedCost.neuromuscular}
                                        onChange={e => setExpectedCost(c => ({ ...c, neuromuscular: parseFloat(e.target.value) }))}
                                    />
                                    <span className="cost-val">{Math.round(expectedCost.neuromuscular * 100)}%</span>
                                </div>
                                <div className="cost-slider-row">
                                    <span>Systemic Fatigue:</span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={expectedCost.systemic}
                                        onChange={e => setExpectedCost(c => ({ ...c, systemic: parseFloat(e.target.value) }))}
                                    />
                                    <span className="cost-val">{Math.round(expectedCost.systemic * 100)}%</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {error && <div className="modal-error-banner">{error}</div>}

                    <div className="modal-actions">
                        {existingOverlay && (
                            <button
                                type="button"
                                className="btn-delete"
                                onClick={handleDelete}
                                disabled={saving}
                            >
                                Delete
                            </button>
                        )}
                        <div className="actions-right">
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={onClose}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn-primary"
                                disabled={saving}
                            >
                                {saving ? 'Saving...' : existingOverlay ? 'Save Changes' : 'Add Schedule Block'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
});
