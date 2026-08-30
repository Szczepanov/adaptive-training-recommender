import { memo } from 'react';
import type { MorningDecisionEvidence } from '../engine/decisionEvidence';
import { signed } from '../engine/decisionEvidence';
import './DecisionEvidenceSummary.css';

interface DecisionEvidenceSummaryProps {
    evidence: MorningDecisionEvidence;
}

export const DecisionEvidenceSummary = memo(function DecisionEvidenceSummary({ evidence }: DecisionEvidenceSummaryProps) {
    const { deltas, rankedEvidence, boundaries, invalidationTriggers, confidence } = evidence;

    return (
        <section className="decision-evidence-summary" aria-label="Recommendation Evidence and Invalidation Rules">
            {/* Day over Day Deltas */}
            <article className="evidence-section dod-deltas-section">
                <div className="section-title-row">
                    <span className="section-icon">📈</span>
                    <h5>What changed since yesterday?</h5>
                </div>
                <p className="dod-summary-text">{deltas.summaryText}</p>

                {deltas.hasYesterdayData && (
                    <div className="dod-metrics-grid">
                        {deltas.hrvDeltaYesterday !== null && (
                            <div className="dod-chip">
                                <span className="chip-label">Overnight HRV</span>
                                <span className={`chip-value ${deltas.hrvDeltaYesterday >= 0 ? 'positive' : 'negative'}`}>
                                    {deltas.hrvToday} ms ({signed(deltas.hrvDeltaYesterday, 'ms')})
                                </span>
                            </div>
                        )}
                        {deltas.sleepScoreDelta !== null && (
                            <div className="dod-chip">
                                <span className="chip-label">Sleep Score</span>
                                <span className={`chip-value ${deltas.sleepScoreDelta >= 0 ? 'positive' : 'negative'}`}>
                                    {deltas.sleepScoreToday}/100 ({signed(deltas.sleepScoreDelta, 'pts')})
                                </span>
                            </div>
                        )}
                        {deltas.restingHrDelta !== null && (
                            <div className="dod-chip">
                                <span className="chip-label">Resting HR</span>
                                <span className={`chip-value ${deltas.restingHrDelta <= 0 ? 'positive' : 'caution'}`}>
                                    {deltas.restingHrToday} bpm ({signed(deltas.restingHrDelta, 'bpm')})
                                </span>
                            </div>
                        )}
                        {deltas.bodyBatteryDelta !== null && (
                            <div className="dod-chip">
                                <span className="chip-label">Wake Battery</span>
                                <span className={`chip-value ${deltas.bodyBatteryDelta >= 0 ? 'positive' : 'negative'}`}>
                                    {deltas.bodyBatteryToday} ({signed(deltas.bodyBatteryDelta)})
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </article>

            {/* Which Evidence Mattered Most */}
            <article className="evidence-section ranked-evidence-section">
                <div className="section-title-row">
                    <span className="section-icon">⚖️</span>
                    <h5>Which evidence mattered most?</h5>
                </div>
                <div className="ranked-evidence-list">
                    {rankedEvidence.map((item, idx) => (
                        <div className={`ranked-item impact-${item.impact}`} key={item.id}>
                            <div className="ranked-item-header">
                                <span className="ranked-index">#{idx + 1}</span>
                                <strong className="ranked-title">{item.title}</strong>
                                <span className={`weight-badge category-${item.category}`}>{item.weightBadge}</span>
                            </div>
                            <p className="ranked-desc">{item.description}</p>
                        </div>
                    ))}
                </div>
            </article>

            {/* Hard Safety Gates vs Soft Optimization */}
            <article className="evidence-section boundaries-section">
                <div className="section-title-row">
                    <span className="section-icon">🛡️</span>
                    <h5>Safety Gates vs. Optimization Strategy</h5>
                </div>
                <p className="boundaries-summary">{boundaries.summary}</p>
                <div className="boundaries-grid">
                    <div className="boundary-column hard-gates-col">
                        <h6>🛡️ Hard Safety Gates (Non-negotiable)</h6>
                        <ul className="gate-list">
                            {boundaries.hardGates.map(gate => (
                                <li key={gate.id} className={`gate-item ${gate.active ? 'gate-active' : 'gate-clear'}`}>
                                    <span className="gate-status-indicator">{gate.active ? '🔒 Restricted' : '✓ Clear'}</span>
                                    <div className="gate-text">
                                        <strong>{gate.name}</strong>
                                        <p>{gate.reason}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="boundary-column soft-opt-col">
                        <h6>🧭 Soft Optimization (Adaptation Focus)</h6>
                        <ul className="opt-list">
                            {boundaries.softOptimizations.map(opt => (
                                <li key={opt.id} className="opt-item">
                                    <span className="opt-bullet">◈</span>
                                    <div className="opt-text">
                                        <strong>{opt.name}</strong>
                                        <p>{opt.description}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </article>

            {/* What should make me change this decision? */}
            <article className="evidence-section invalidation-section">
                <div className="section-title-row">
                    <span className="section-icon">⚠️</span>
                    <h5>What should make me change this decision?</h5>
                </div>
                <div className="invalidation-triggers-list">
                    {invalidationTriggers.map(trigger => (
                        <div key={trigger.id} className="invalidation-item">
                            <span className="trigger-icon">{trigger.icon}</span>
                            <div className="trigger-content">
                                <strong className="trigger-condition">{trigger.trigger}</strong>
                                <p className="trigger-action">👉 {trigger.action}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </article>

            {/* Data Confidence & Uncertainty */}
            <article className="evidence-section confidence-section">
                <div className="section-title-row">
                    <span className="section-icon">🎯</span>
                    <h5>Data Confidence & Uncertainty</h5>
                    <span className={`confidence-pill ${confidence.badgeClass}`}>{confidence.label}</span>
                </div>
                <p className="confidence-statement">{confidence.uncertaintyStatement}</p>
                <ul className="confidence-reasons-list">
                    {confidence.reasons.map((reason, idx) => (
                        <li key={idx}>• {reason}</li>
                    ))}
                </ul>
            </article>
        </section>
    );
});
