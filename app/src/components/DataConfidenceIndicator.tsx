import React, { useId, useState } from 'react';
import type { ConfidenceRating, DataConfidenceScore, SensorTier } from '../engine/dataConfidence';
import './DataConfidenceIndicator.css';

export interface DataConfidenceIndicatorProps {
    confidence?: DataConfidenceScore | null;
    onRefresh?: () => void;
}

export const DataConfidenceIndicator: React.FC<DataConfidenceIndicatorProps> = ({
    confidence,
    onRefresh,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const panelId = useId();

    if (!confidence) return null;

    const { rating, score, sensorTier, breakdown, signals, activeSafeguards, summaryMessage } = confidence;

    const ratingClasses: Record<ConfidenceRating, string> = {
        HIGH: 'confidence-high',
        MODERATE: 'confidence-moderate',
        LOW: 'confidence-low',
        INSUFFICIENT: 'confidence-insufficient',
    };

    const ratingIcons: Record<ConfidenceRating, string> = {
        HIGH: '🛡️',
        MODERATE: '⚠️',
        LOW: '⚡',
        INSUFFICIENT: '🛑',
    };

    const tierLabels: Record<SensorTier, string> = {
        FULL_WEARABLE: 'Full Wearable',
        BASIC_WEARABLE: 'Basic Wearable',
        SUBJECTIVE_ONLY: 'Subjective Only',
    };

    return (
        <div className='data-confidence-wrapper'>
            <button
                type='button'
                className={'data-confidence-badge ' + (ratingClasses[rating] || 'confidence-low')}
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                aria-label={'Data confidence: ' + rating + ' (' + score + '%). Click to toggle diagnostic breakdown.'}
            >
                <span className='confidence-icon' aria-hidden='true'>{ratingIcons[rating] || 'ℹ️'}</span>
                <span className='confidence-label'>
                    Confidence: <strong>{rating} ({score}%)</strong>
                </span>
                <span className='confidence-expand-arrow' aria-hidden='true'>{isExpanded ? '▲' : '▼'}</span>
            </button>

            {isExpanded && (
                <div id={panelId} className='data-confidence-panel' role='region' aria-label='Data confidence diagnostic breakdown'>
                    <div className='confidence-panel-header'>
                        <h4>Data Quality & Telemetry Confidence</h4>
                        <div className='confidence-panel-header-actions'>
                            <span className={'sensor-tier-tag tier-' + sensorTier.toLowerCase()}>
                                {tierLabels[sensorTier]}
                            </span>
                            <button
                                type='button'
                                className='confidence-close-btn'
                                aria-label='Close data confidence details'
                                onClick={() => setIsExpanded(false)}
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    <p className='confidence-summary'>{summaryMessage}</p>

                    <div className='confidence-breakdown-grid'>
                        <div className='breakdown-meter'>
                            <div className='meter-label'>Completeness</div>
                            <div className='meter-bar-track'>
                                <div className='meter-bar-fill' style={{ width: breakdown.completenessScore + '%' }} />
                            </div>
                            <div className='meter-value'>{breakdown.completenessScore}%</div>
                        </div>

                        <div className='breakdown-meter'>
                            <div className='meter-label'>Freshness</div>
                            <div className='meter-bar-track'>
                                <div className='meter-bar-fill' style={{ width: breakdown.freshnessScore + '%' }} />
                            </div>
                            <div className='meter-value'>{breakdown.freshnessScore}%</div>
                        </div>

                        <div className='breakdown-meter'>
                            <div className='meter-label'>Baseline Maturity</div>
                            <div className='meter-bar-track'>
                                <div className='meter-bar-fill' style={{ width: breakdown.baselineMaturityScore + '%' }} />
                            </div>
                            <div className='meter-value'>{breakdown.baselineMaturityScore}%</div>
                        </div>

                        <div className='breakdown-meter'>
                            <div className='meter-label'>Plausibility</div>
                            <div className='meter-bar-track'>
                                <div className='meter-bar-fill' style={{ width: breakdown.plausibilityScore + '%' }} />
                            </div>
                            <div className='meter-value'>{breakdown.plausibilityScore}%</div>
                        </div>
                    </div>

                    {activeSafeguards && activeSafeguards.length > 0 && (
                        <div className='confidence-safeguards-box'>
                            <div className='safeguards-title'>Data quality cautions</div>
                            <ul>
                                {activeSafeguards.map((safeguard, idx) => (
                                    <li key={idx}>{safeguard}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className='confidence-signals-table'>
                        <div className='signals-header'>Signal Diagnostics:</div>
                        <div className='signals-list'>
                            {Object.values(signals).map(sig => (
                                <div key={sig.signal} className={'signal-item status-' + sig.status.toLowerCase()}>
                                    <div className='signal-heading'>
                                        <span className='signal-name'>{sig.displayName}</span>
                                        <span className={'signal-status-tag status-' + sig.status.toLowerCase()}>
                                            {sig.status}
                                        </span>
                                    </div>
                                    {sig.value !== null && (
                                        <span className='signal-value'>{String(sig.value)}{typeof sig.value === 'number' && sig.unit ? ` ${sig.unit}` : ''}</span>
                                    )}
                                    {sig.freshnessHours !== undefined && sig.freshnessHours !== null && (
                                        <span className='signal-meta'>Updated {sig.freshnessHours < 1 ? '<1' : Math.round(sig.freshnessHours)}h ago</span>
                                    )}
                                    {sig.historyDays !== undefined && sig.historyDays !== null && (
                                        <span className='signal-meta'>{sig.historyDays}-day baseline window</span>
                                    )}
                                    {sig.issues?.map(issue => <span key={issue} className='signal-issue-note'>{issue}</span>)}
                                </div>
                            ))}
                        </div>
                    </div>

                    {onRefresh && (
                        <div className='confidence-actions'>
                            <button type='button' className='confidence-refresh-btn' onClick={onRefresh}>
                                Refresh displayed data
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
