import React from 'react';
import {
    reduceAssessmentTrials,
    type AssessmentReductionOutcome,
} from '../../observations/assessmentReducers';
import type { AssessmentTrial, MeasurementProtocol } from '../../observations/models';
import { getMetricDefinition } from '../../observations/registry';

interface CanonicalResultPreviewProps {
    protocol: MeasurementProtocol;
    assessmentAttemptId: string;
    trials: readonly AssessmentTrial[];
}

export const CanonicalResultPreview: React.FC<CanonicalResultPreviewProps> = ({
    protocol,
    assessmentAttemptId,
    trials,
}) => {
    if (!protocol.capture) return null;

    let outcomes: AssessmentReductionOutcome[] = [];
    let reductionError: string | null = null;

    try {
        outcomes = reduceAssessmentTrials(protocol, assessmentAttemptId, trials);
    } catch (err) {
        reductionError = err instanceof Error ? err.message : 'Error evaluating trials';
    }

    // For strength protocols: check if a heavier missed lift exists than the best successful lift
    const missedHeavierLifts = protocol.capture.reducers
        .filter(r => r.kind === 'highest_successful_load')
        .map(reducer => {
            if (reducer.kind !== 'highest_successful_load') return null;
            const validTrials = trials.filter(t => t.validity === 'valid');
            const successfulLoads = validTrials
                .filter(t => t.values[reducer.successFieldId] === true)
                .map(t => Number(t.values[reducer.loadFieldId]))
                .filter(Number.isFinite);
            const bestSuccess = successfulLoads.length > 0 ? Math.max(...successfulLoads) : 0;
            const missedLoads = validTrials
                .filter(t => t.values[reducer.successFieldId] === false)
                .map(t => Number(t.values[reducer.loadFieldId]))
                .filter(n => Number.isFinite(n) && n > bestSuccess);
            if (missedLoads.length > 0) {
                return {
                    metricId: reducer.metricId,
                    missedLoad: Math.max(...missedLoads),
                };
            }
            return null;
        })
        .filter((item): item is { metricId: string; missedLoad: number } => item !== null);

    return (
        <div className="canonical-preview-container" aria-live="polite">
            <h4 className="canonical-preview-title">Live result preview</h4>
            {reductionError && (
                <p className="testing-error" role="alert">
                    {reductionError}
                </p>
            )}
            {!reductionError && (
                <div className="canonical-preview-list">
                    {outcomes.map(outcome => {
                        const metricId = outcome.status === 'derived' ? outcome.result.metricId : outcome.metricId;
                        const metric = getMetricDefinition(metricId);
                        if (outcome.status === 'no_valid_trial') {
                            return (
                                <div key={metricId} className="canonical-preview-item unconfirmed">
                                    <span className="canonical-preview-metric">{metric.displayName}:</span>
                                    <span className="canonical-preview-note">No valid attempt recorded yet</span>
                                </div>
                            );
                        }

                        const { value, unit, sourceTrialIds } = outcome.result;
                        const trialLabels = sourceTrialIds
                            .map(id => id.replace(/^trial-/, 'attempt '))
                            .join(', ');
                        const heavierMiss = missedHeavierLifts.find(m => m.metricId === metricId);

                        return (
                            <div key={metricId} className="canonical-preview-item valid">
                                <span className="canonical-preview-metric">{metric.displayName}:</span>
                                <strong className="canonical-preview-value">
                                    {value} {unit}
                                </strong>
                                <span className="canonical-preview-source">
                                    ({trialLabels}
                                    {heavierMiss ? `; a missed ${heavierMiss.missedLoad} kg is kept as evidence` : ''})
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
