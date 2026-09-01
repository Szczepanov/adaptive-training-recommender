import { useState, memo, useId } from 'react';
import type { Recommendation } from '../engine/models';
import type { SessionReferenceBinding } from '../sessions/models';
import type { WorkoutPrescription } from '../workouts';
import { DecisionEvidenceSummary } from './DecisionEvidenceSummary';
import { OneTapAlternatives } from './OneTapAlternatives';
import { WorkoutExportMenu } from './WorkoutExportMenu';
import type { MorningDecisionEvidence } from '../engine/decisionEvidence';
import { prepareCatalogSessionLaunch } from '../services/sessionAuthoringService';
import { usabilityMetrics } from '../utils/usabilityMetrics';
import './MorningDecisionCard.css';

interface MorningDecisionCardProps {
    userId: string;
    date: string;
    recommendation: Recommendation | null;
    evidence: MorningDecisionEvidence;
    isCheckinMissing?: boolean;
    prescription?: WorkoutPrescription;
    adjustmentDirection: 'easier' | 'harder' | null;
    activeAlternativeId: string | null;
    isGateLocked?: boolean;
    gateLockedReason?: string;
    onStartSession?: (binding: SessionReferenceBinding) => void | Promise<void>;
    onNavigateCheckin?: () => void;
    onAdjustLoad: (direction: 'easier' | 'harder' | null) => void;
    onSelectTimeCrunch: (minutes: number) => void;
    onSelectHomeAlternative: () => void;
    onSelectMobilityAlternative: () => void;
    onSelectActiveRecoveryWalk: () => void;
    onResetAlternative: () => void;
    onOpenReclassify?: () => void;
}

const MODE_LABELS: Record<Recommendation['mode'], string> = {
    train: 'Normal Load',
    modify: 'Reduced Load',
    recover: 'Recovery Day',
};

export const MorningDecisionCard = memo(function MorningDecisionCard({
    userId,
    date,
    recommendation,
    evidence,
    isCheckinMissing = false,
    prescription,
    adjustmentDirection,
    activeAlternativeId,
    isGateLocked = false,
    gateLockedReason,
    onStartSession,
    onNavigateCheckin,
    onAdjustLoad,
    onSelectTimeCrunch,
    onSelectHomeAlternative,
    onSelectMobilityAlternative,
    onSelectActiveRecoveryWalk,
    onResetAlternative,
    onOpenReclassify,
}: MorningDecisionCardProps) {
    const [activeTab, setActiveTab] = useState<'none' | 'why' | 'alternatives' | 'workout'>('none');
    const [launching, setLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const panelId = useId();

    const handleTabToggle = (tab: 'why' | 'alternatives' | 'workout') => {
        const next = activeTab === tab ? 'none' : tab;
        setActiveTab(next);
        if (next !== 'none') {
            usabilityMetrics.recordActionSelected(userId, date, `expand_tab_${next}`);
        }
    };

    const handleStartPrimary = async () => {
        usabilityMetrics.recordActionSelected(userId, date, 'start_primary_session', {
            adjusted: adjustmentDirection !== null,
            alternativeId: activeAlternativeId,
        });
        setLaunchError(null);

        if (isCheckinMissing && onNavigateCheckin) {
            onNavigateCheckin();
            return;
        }

        if (!recommendation) return;

        // Clinical escalation pauses all training launch paths, including adjusted
        // bindings and the original prescription, until medical evaluation clears it.
        if (recommendation.envelopes?.safety.clinicalEscalationRequired) return;

        // A recommendation's primarySession is an immutable binding for the original
        // authored prescription. Once the athlete selects a one-tap alternative or load
        // adjustment, launch the currently displayed prescription instead of silently
        // executing that stale binding.
        const needsAdjustedBinding = Boolean(activeAlternativeId || adjustmentDirection !== null);
        if (onStartSession && needsAdjustedBinding && prescription) {
            setLaunching(true);
            try {
                const launch = await prepareCatalogSessionLaunch(userId, prescription);
                await onStartSession(launch.binding);
            } catch (error) {
                setLaunchError(error instanceof Error ? error.message : 'Unable to prepare the adjusted session.');
            } finally {
                setLaunching(false);
            }
            return;
        }

        if (recommendation.primarySession && onStartSession) {
            setLaunching(true);
            try {
                await onStartSession(recommendation.primarySession);
            } catch (error) {
                setLaunchError(error instanceof Error ? error.message : 'Unable to start this session.');
            } finally {
                setLaunching(false);
            }
        } else if (prescription) {
            setActiveTab('workout');
        }
    };

    const handleLoadAdjustClick = (dir: 'easier' | 'harder' | null) => {
        if (dir === 'harder' && (isGateLocked || !evidence.boundaries.harderAdjustmentAllowed)) {
            usabilityMetrics.recordOverrideAttempt(userId, date, 'Harder load blocked by safety gate', true);
            return;
        }
        usabilityMetrics.recordActionSelected(userId, date, `adjust_load_${dir ?? 'reset'}`);
        setLaunchError(null);
        onAdjustLoad(dir);
    };

    const isHardGateActive = isGateLocked || !evidence.boundaries.harderAdjustmentAllowed;
    const canLaunchCurrentPrescription = Boolean(
        onStartSession
        && prescription
        && (activeAlternativeId || adjustmentDirection !== null),
    );

    return (
        <section
            className={`morning-decision-card ${recommendation ? `mode-${recommendation.mode}` : 'mode-pending'}`}
            aria-label="Today's Morning Training Decision"
        >
            <div className="decision-hero-layer">
                <div className="hero-top-row">
                    <span className="hero-kicker">Today&apos;s Training Plan</span>
                    <div className="hero-badges">
                        {recommendation && (
                            <span className={`status-badge mode-${recommendation.mode}`}>
                                {MODE_LABELS[recommendation.mode]}
                            </span>
                        )}
                        <span className={`confidence-badge ${evidence.confidence.badgeClass}`}>
                            {evidence.confidence.label}
                        </span>
                        {onOpenReclassify && (
                            <button
                                type="button"
                                className="btn-reclassify-trigger"
                                onClick={onOpenReclassify}
                                title="Correct or reclassify Garmin activity"
                                aria-label="Correct Garmin activity"
                            >
                                ✏️ Correct
                            </button>
                        )}
                    </div>
                </div>

                {isCheckinMissing ? (
                    <div className="hero-checkin-prompt">
                        <h2 className="hero-headline">Good Morning! Complete Check-in</h2>
                        <p className="hero-subtext">
                            Answer 4 quick questions (~10s) so the engine can check your recovery safety gates and finalize today&apos;s workout dose.
                        </p>
                        <div className="hero-cta-wrap">
                            <button type="button" className="btn-hero-primary" onClick={() => void handleStartPrimary()} aria-label="Start morning check-in">
                                ✓ Start Morning Check-in →
                            </button>
                        </div>
                    </div>
                ) : recommendation ? (
                    <div className="hero-recommendation-content">
                        {recommendation.envelopes?.safety.clinicalEscalationRequired && (
                            <div className="clinical-escalation-hero-banner" role="alert">
                                <span className="escalation-icon" aria-hidden="true">⚠️</span>
                                <div className="escalation-content">
                                    <strong className="escalation-title">Clinical Evaluation Recommended</strong>
                                    <p className="escalation-text">
                                        {recommendation.envelopes.safety.clinicalReason ?? 'Red-flag symptoms reported. Training recommendations are paused until medical evaluation.'}
                                    </p>
                                    <p className="escalation-text">
                                        If you have acute chest pain/pressure, unexplained shortness of breath, fainting/near-fainting, new neurological symptoms, or believe this may be an emergency, seek urgent or emergency medical care now.
                                    </p>
                                </div>
                            </div>
                        )}
                        <div className="headline-meta-row">
                            <h2 className="hero-headline">
                                {recommendation.template.title}
                                {recommendation.activeDose && (
                                    <span className="hero-dose-pill">{recommendation.activeDose.label}</span>
                                )}
                            </h2>
                        </div>

                        <p className="hero-session-metrics">
                            <span className="metric-tag">{recommendation.template.modality}</span>
                            <span className="metric-dot">·</span>
                            <span className="metric-tag">
                                {recommendation.activeDose
                                    ? `${recommendation.activeDose.durationMin}–${recommendation.activeDose.durationMax} min`
                                    : `${recommendation.template.durationMin}–${recommendation.template.durationMax} min`}
                            </span>
                            <span className="metric-dot">·</span>
                            <span className="metric-tag">{recommendation.template.category}</span>
                        </p>

                        <div className="hero-why-callout" role="note">
                            <p className="why-text">
                                <strong>Why today:</strong> {recommendation.rationale}
                            </p>
                        </div>

                        <div className="hero-cta-wrap">
                            {!recommendation.envelopes?.safety.clinicalEscalationRequired
                            && (canLaunchCurrentPrescription || (recommendation.primarySession && onStartSession)) ? (
                                <button
                                    type="button"
                                    className="btn-hero-primary"
                                    onClick={() => void handleStartPrimary()}
                                    disabled={launching}
                                    aria-label={`Start ${recommendation.template.title}`}
                                >
                                    {recommendation.template.modality === 'Strength' ? '🏋️' : '▶️'} {launching ? 'Preparing Session…' : 'Start Session →'}
                                </button>
                            ) : prescription ? (
                                <button
                                    type="button"
                                    className="btn-hero-primary"
                                    onClick={() => setActiveTab(activeTab === 'workout' ? 'none' : 'workout')}
                                    aria-label={`View workout details for ${recommendation.template.title}`}
                                >
                                    📋 View Workout Targets →
                                </button>
                            ) : null}

                            {prescription && (
                                <WorkoutExportMenu
                                    userId={userId}
                                    date={date}
                                    title={recommendation.template.title}
                                    modality={recommendation.template.modality}
                                    prescription={prescription}
                                />
                            )}
                        </div>
                        {launchError && <p className="form-error-msg" role="alert">{launchError}</p>}
                    </div>
                ) : (
                    <div className="hero-empty-state">
                        <p>Syncing recovery signals to generate today&apos;s recommendation...</p>
                    </div>
                )}
            </div>

            {recommendation && (
                <div className="decision-tabs-bar">
                    <button
                        type="button"
                        aria-expanded={activeTab === 'why'}
                        className={`decision-tab-btn ${activeTab === 'why' ? 'active' : ''}`}
                        onClick={() => handleTabToggle('why')}
                    >
                        💡 Why & Invalidation Rules {activeTab === 'why' ? '▲' : '▼'}
                    </button>
                    <button
                        type="button"
                        aria-expanded={activeTab === 'alternatives'}
                        className={`decision-tab-btn ${activeTab === 'alternatives' ? 'active' : ''}`}
                        onClick={() => handleTabToggle('alternatives')}
                    >
                        ⚡ 1-Tap Alternatives {activeTab === 'alternatives' ? '▲' : '▼'}
                    </button>
                    {prescription && (
                        <button
                            type="button"
                            aria-expanded={activeTab === 'workout'}
                            className={`decision-tab-btn ${activeTab === 'workout' ? 'active' : ''}`}
                            onClick={() => handleTabToggle('workout')}
                        >
                            📋 Workout Steps {activeTab === 'workout' ? '▲' : '▼'}
                        </button>
                    )}
                </div>
            )}

            {activeTab === 'why' && (
                <div
                    id={`${panelId}-why`}
                    role="region"
                    aria-label="Why and Invalidation Rules"
                    className="tab-panel-content animate-fade-in"
                >
                    <DecisionEvidenceSummary evidence={evidence} />
                </div>
            )}

            {activeTab === 'alternatives' && (
                <div
                    id={`${panelId}-alternatives`}
                    role="region"
                    aria-label="1-Tap Alternatives and Load Adjustment"
                    className="tab-panel-content animate-fade-in"
                >
                    <div className="load-adjustment-box">
                        <span className="box-title">Adjust Intensity & Volume:</span>
                        <div className="load-stepper-row">
                            <button type="button" className={`stepper-btn ${adjustmentDirection === 'easier' ? 'active' : ''}`} onClick={() => handleLoadAdjustClick(adjustmentDirection === 'easier' ? null : 'easier')} aria-label="Set easier load">
                                🟢 Easier
                            </button>
                            <button type="button" className={`stepper-btn ${adjustmentDirection === null ? 'active' : ''}`} onClick={() => handleLoadAdjustClick(null)} aria-label="Set recommended load">
                                🔵 As Recommended
                            </button>
                            <button type="button" className={`stepper-btn ${adjustmentDirection === 'harder' ? 'active' : ''}`} disabled={isHardGateActive} onClick={() => handleLoadAdjustClick(adjustmentDirection === 'harder' ? null : 'harder')} title={isHardGateActive ? 'Harder load locked by active safety gate' : 'Increase load'} aria-label="Set harder load">
                                🔴 Harder {isHardGateActive && '🔒'}
                            </button>
                        </div>
                        {isHardGateActive && (
                            <p className="gate-locked-notice">
                                🔒 Harder option is locked today: {gateLockedReason || evidence.boundaries.hardGates.find(g => g.active)?.reason || 'Safety gate active.'}
                            </p>
                        )}
                    </div>

                    <OneTapAlternatives
                        recommendation={recommendation}
                        activeAlternativeId={activeAlternativeId}
                        onSelectTimeCrunch={onSelectTimeCrunch}
                        onSelectHomeAlternative={onSelectHomeAlternative}
                        onSelectMobilityAlternative={onSelectMobilityAlternative}
                        onSelectActiveRecoveryWalk={onSelectActiveRecoveryWalk}
                        onResetOriginal={onResetAlternative}
                    />
                </div>
            )}

            {activeTab === 'workout' && prescription && (
                <div
                    id={`${panelId}-workout`}
                    role="region"
                    aria-label="Workout Step Breakdown"
                    className="tab-panel-content animate-fade-in"
                >
                    <section className="detailed-plan-panel" aria-label="Workout Step Breakdown">
                        <div className="plan-summary-bar">
                            <span>Target: <strong>{prescription.targetDurationMin} minutes</strong></span>
                            <span>Category: <strong>{recommendation?.template.category}</strong></span>
                        </div>
                        {prescription.displayBlocks.map((block) => (
                            <div className={`plan-block-view role-${block.role}`} key={block.id}>
                                <h5 className="block-name">{block.name}</h5>
                                {block.steps.map((step) => (
                                    <div className="step-row" key={step.id}>
                                        <div className="step-main">
                                            <strong>{step.name}</strong>
                                            {step.optional && <span className="step-optional">Optional</span>}
                                            <p className="step-dose">{step.dose}{step.rest ? ` · ${step.rest}` : ''}</p>
                                        </div>
                                        {step.structuredTargets && step.structuredTargets.length > 0 && (
                                            <div className="step-targets-box">
                                                {step.structuredTargets.map((t, idx) => (
                                                    <span key={idx} className={`target-badge role-${t.role}`}>
                                                        {t.label}: <strong>{t.valueText}</strong>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {step.cues && step.cues.length > 0 && (
                                            <p className="step-cue-text">💡 {step.cues.join(' · ')}</p>
                                        )}
                                        {step.stopConditions && step.stopConditions.length > 0 && (
                                            <p className="step-stop-text">⚠️ <strong>Stop if:</strong> {step.stopConditions.join(', ')}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </section>
                </div>
            )}
        </section>
    );
});
