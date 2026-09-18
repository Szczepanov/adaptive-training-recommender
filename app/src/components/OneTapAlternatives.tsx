import { memo } from 'react';
import type { Recommendation, SessionTemplate } from '../engine/models';
import './OneTapAlternatives.css';

export interface AlternativeOption {
    id: string;
    label: string;
    icon: string;
    tag: string;
    description: string;
    action: () => void;
    disabled?: boolean;
    active?: boolean;
}

const MODALITY_ICON: Partial<Record<SessionTemplate['modality'], string>> = {
    Running: '🏃',
    Cycling: '🚴',
    Walking: '🚶',
    Swimming: '🏊',
    Strength: '🏋️',
    Field: '⚽',
    Mobility: '🧘',
    'Cross Training': '🔀',
};

interface OneTapAlternativesProps {
    recommendation: Recommendation | null;
    /** Same-category, cross-modality candidates covering today's original stimulus
     *  (see engine/sessionAlternatives.ts). Empty when none survive eligibility, or when
     *  today's session doesn't transfer across modalities (e.g. Strength). */
    stimulusAlternatives?: SessionTemplate[];
    onSelectTimeCrunch: (minutes: number) => void;
    onSelectStimulusAlternative?: (templateId: string) => void;
    onSelectHomeAlternative: () => void;
    onSelectMobilityAlternative: () => void;
    onSelectActiveRecoveryWalk: () => void;
    onResetOriginal: () => void;
    activeAlternativeId?: string | null;
}

export const OneTapAlternatives = memo(function OneTapAlternatives({
    recommendation,
    stimulusAlternatives = [],
    onSelectTimeCrunch,
    onSelectStimulusAlternative,
    onSelectHomeAlternative,
    onSelectMobilityAlternative,
    onSelectActiveRecoveryWalk,
    onResetOriginal,
    activeAlternativeId,
}: OneTapAlternativesProps) {
    if (!recommendation) return null;

    const timeOptions = [
        { min: 20, label: '20 min', id: 'time-20' },
        { min: 30, label: '30 min', id: 'time-30' },
        { min: 45, label: '45 min', id: 'time-45' },
    ];

    const ALTERNATIVE_LABELS: Record<string, string> = {
        'time-20': '20 min Express Session',
        'time-30': '30 min Condensed Session',
        'time-45': '45 min Condensed Session',
        'home-bodyweight': 'Zero-Equipment Mobility (Lighter Session)',
        'mobility': 'Joint Mobility Flow',
        'recovery-walk': 'Active Recovery Walk',
    };

    const activeStimulusTemplate = activeAlternativeId?.startsWith('stimulus:')
        ? stimulusAlternatives.find(t => `stimulus:${t.id}` === activeAlternativeId)
        : undefined;
    const activeLabel = activeStimulusTemplate
        ? `${activeStimulusTemplate.title} (${activeStimulusTemplate.modality})`
        : (activeAlternativeId ? (ALTERNATIVE_LABELS[activeAlternativeId] ?? activeAlternativeId) : null);

    return (
        <section className="one-tap-alternatives-container" aria-label="1-Tap Training Alternatives">
            <div className="alternatives-header">
                <span className="alternatives-badge">⚡ Quick Situational Pivots</span>
                <h5>Need to adjust for time, location, or energy?</h5>
            </div>

            <div className="alternatives-group-grid">
                {/* Time Crunch Options */}
                <div className="alternative-group">
                    <span className="group-label">⏱️ Time Crunch</span>
                    <div className="pills-row">
                        {timeOptions.map(opt => (
                            <button
                                key={opt.id}
                                type="button"
                                className={`pill-btn ${activeAlternativeId === opt.id ? 'active' : ''}`}
                                onClick={() => onSelectTimeCrunch(opt.min)}
                                aria-pressed={activeAlternativeId === opt.id}
                                aria-label={`Switch to ${opt.min} minute condensed session`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Same stimulus, different modality -- e.g. today's aerobic-base ride can be
                    covered by an equivalent run or walk. Dynamically generated from the
                    catalog (engine/sessionAlternatives.ts), already filtered for equipment,
                    environment, time budget, and injury/guardrail restrictions, so nothing
                    unsafe (e.g. a run on a medically restricted day) ever appears here. */}
                {stimulusAlternatives.length > 0 && onSelectStimulusAlternative && (
                    <div className="alternative-group">
                        <span className="group-label">🔁 Same Stimulus, Different Modality</span>
                        <div className="pills-row">
                            {stimulusAlternatives.map(alt => {
                                const id = `stimulus:${alt.id}`;
                                const icon = MODALITY_ICON[alt.modality] ?? '➡️';
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        className={`pill-btn ${activeAlternativeId === id ? 'active' : ''}`}
                                        onClick={() => onSelectStimulusAlternative(alt.id)}
                                        aria-pressed={activeAlternativeId === id}
                                        aria-label={`Switch to ${alt.title}, a ${alt.modality} alternative covering the same training stimulus`}
                                    >
                                        {icon} {alt.modality}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Location / Gear Shifts -- an intentional downgrade to a lighter mobility
                    session, not a same-stimulus substitute (the catalog has no genuine
                    equipment-free aerobic-base session yet), so it is labeled as such. */}
                <div className="alternative-group">
                    <span className="group-label">🏠 No Equipment Available</span>
                    <div className="pills-row">
                        <button
                            type="button"
                            className={`pill-btn ${activeAlternativeId === 'home-bodyweight' ? 'active' : ''}`}
                            onClick={onSelectHomeAlternative}
                            aria-pressed={activeAlternativeId === 'home-bodyweight'}
                            aria-label="Switch to a zero-equipment mobility session -- a lighter session, not an equivalent-effort swap"
                        >
                            🏠 Zero-Equipment (Lighter)
                        </button>
                    </div>
                </div>

                {/* Energy Downgrades */}
                <div className="alternative-group">
                    <span className="group-label">🧘 Recovery Pivot</span>
                    <div className="pills-row">
                        <button
                            type="button"
                            className={`pill-btn ${activeAlternativeId === 'mobility' ? 'active' : ''}`}
                            onClick={onSelectMobilityAlternative}
                            aria-pressed={activeAlternativeId === 'mobility'}
                            aria-label="Switch to joint mobility and stretching flow"
                        >
                            🧘 Joint Mobility
                        </button>
                        <button
                            type="button"
                            className={`pill-btn ${activeAlternativeId === 'recovery-walk' ? 'active' : ''}`}
                            onClick={onSelectActiveRecoveryWalk}
                            aria-pressed={activeAlternativeId === 'recovery-walk'}
                            aria-label="Switch to easy Zone 1 active recovery walk"
                        >
                            🚶 Recovery Walk
                        </button>
                    </div>
                </div>
            </div>

            {activeLabel && (
                <div className="alternative-active-banner">
                    <span>✨ Alternative applied: <strong>{activeLabel}</strong></span>
                    <button type="button" className="btn-reset-alternative" onClick={onResetOriginal}>
                        ↺ Reset to Engine Recommendation
                    </button>
                </div>
            )}
        </section>
    );
});
