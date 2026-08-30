import { memo } from 'react';
import type { Recommendation } from '../engine/models';
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

interface OneTapAlternativesProps {
    recommendation: Recommendation | null;
    onSelectTimeCrunch: (minutes: number) => void;
    onSelectHomeAlternative: () => void;
    onSelectMobilityAlternative: () => void;
    onSelectActiveRecoveryWalk: () => void;
    onResetOriginal: () => void;
    activeAlternativeId?: string | null;
}

export const OneTapAlternatives = memo(function OneTapAlternatives({
    recommendation,
    onSelectTimeCrunch,
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
        'home-bodyweight': 'Home Bodyweight (Zero Equipment)',
        'mobility': 'Joint Mobility Flow',
        'recovery-walk': 'Active Recovery Walk',
    };

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

                {/* Location / Gear Shifts */}
                <div className="alternative-group">
                    <span className="group-label">🏠 Gear & Venue</span>
                    <div className="pills-row">
                        <button
                            type="button"
                            className={`pill-btn ${activeAlternativeId === 'home-bodyweight' ? 'active' : ''}`}
                            onClick={onSelectHomeAlternative}
                            aria-pressed={activeAlternativeId === 'home-bodyweight'}
                            aria-label="Switch to Home Bodyweight workout with no equipment needed"
                        >
                            🏠 Home / Bodyweight
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

            {activeAlternativeId && (
                <div className="alternative-active-banner">
                    <span>✨ Alternative applied: <strong>{ALTERNATIVE_LABELS[activeAlternativeId] || activeAlternativeId}</strong></span>
                    <button type="button" className="btn-reset-alternative" onClick={onResetOriginal}>
                        ↺ Reset to Engine Recommendation
                    </button>
                </div>
            )}
        </section>
    );
});
