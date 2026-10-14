/**
 * #895 WP5 -- names which failure state holds for a canonical workout instead of "no data".
 * Visible notices are reserved for real gaps and unreadable dependencies; the full eight-check
 * list is always one disclosure away. Status is carried as text, never by colour alone.
 */
import { useState } from 'react';
import type { CompletedWorkoutView, ReconciliationSweepStatus } from '../training-occurrence/completedWorkoutView';
import {
    FAILURE_STATE_CODES,
    projectWorkoutSourceDiagnostics,
    type WorkoutSourceDiagnostics as Diagnostics,
} from '../training-occurrence/workoutSourceDiagnostics';
import {
    buildWorkoutDiagnosticsExport,
    serializeWorkoutDiagnosticsExport,
    type WorkoutDiagnosticsResult,
} from '../training-occurrence/workoutSourceDiagnosticsExport';
import {
    STATE_COPY,
    STATUS_LABEL,
    WINDOW_PROJECTION_FAILED_COPY,
    describeAssessment,
    stateNumber,
} from './workoutSourceDiagnosticsCopy';

export interface DiagnosticsWindow {
    from: string;
    toExclusive: string;
}

function OutboxLine({ outbox }: { outbox: Diagnostics['outbox'] }) {
    switch (outbox.status) {
        case 'not_linked': return null;
        case 'unreadable':
            return <p className="workout-source-line">Unsent writes on this device: unknown, the records could not be read.</p>;
        case 'read':
            return (
                <p className="workout-source-line">
                    Unsent writes on this device: {outbox.queued} waiting, {outbox.failed} rejected. These records are kept per device.
                </p>
            );
    }
}

function ReconciliationLine({ diagnostics }: { diagnostics: Diagnostics }) {
    const { reconciliationOutcome: outcome, reconciliationSweep: sweep } = diagnostics;
    const sweepText = sweep === 'completed' ? 'completed' : sweep === 'failed' ? 'failed' : 'not run on this load';
    const outcomeText = outcome.status === 'observed'
        ? outcome.outcome
        : 'unknown, a manual decision replaced the automatic result';
    return (
        <p className="workout-source-line">
            Matching outcome from the stored record: {outcomeText}. Latest matching check: {sweepText}.
        </p>
    );
}

export function WorkoutSourceDiagnostics({ workout }: { workout: CompletedWorkoutView }) {
    const diagnostics = projectWorkoutSourceDiagnostics(workout);
    const { states, attention } = diagnostics;
    return (
        <section className="workout-source-diagnostics" aria-label="Source completeness">
            {attention.length > 0 && (
                <div className="workout-source-notice" role="group" aria-label="Missing or unknown data">
                    <h5>Some data is missing or unknown</h5>
                    <ul>
                        {attention.map(code => (
                            <li key={code}>
                                <strong>{STATE_COPY[code].name}</strong> ({STATUS_LABEL[states[code].status]}). {describeAssessment(code, states[code]).join(' ')}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <details className="completed-workout-diagnostics workout-source-checks">
                <summary>Source diagnostics ({FAILURE_STATE_CODES.length} checks)</summary>
                <OutboxLine outbox={diagnostics.outbox} />
                <ReconciliationLine diagnostics={diagnostics} />
                <dl className="workout-source-checklist">
                    {FAILURE_STATE_CODES.map(code => (
                        <div key={code} className="workout-source-check">
                            <dt>
                                State {stateNumber(code)} · {STATE_COPY[code].name}: <strong>{STATUS_LABEL[states[code].status]}</strong>
                            </dt>
                            <dd>{describeAssessment(code, states[code]).join(' ')}</dd>
                        </div>
                    ))}
                </dl>
            </details>
        </section>
    );
}

type CopyFeedback = 'idle' | 'copied' | 'failed';

/** User-initiated only: nothing is copied or sent until the athlete presses the button. */
export function DiagnosticsExportButton({ range, result, sweep }: {
    range: DiagnosticsWindow;
    result: WorkoutDiagnosticsResult;
    /** The window sweep outcome; omitted means the caller has none, i.e. `not_run`. */
    sweep?: ReconciliationSweepStatus;
}) {
    const [feedback, setFeedback] = useState<CopyFeedback>('idle');
    const copy = async () => {
        try {
            const exported = buildWorkoutDiagnosticsExport({ window: range, generatedAt: new Date().toISOString(), reconciliationSweep: sweep ?? 'not_run', result });
            await navigator.clipboard.writeText(serializeWorkoutDiagnosticsExport(exported));
            setFeedback('copied');
        } catch (error) {
            console.warn('[training-occurrence] diagnostics copy failed', error);
            setFeedback('failed');
        }
    };
    return (
        <div className="workout-source-export">
            <button type="button" className="quick-action-btn secondary" onClick={copy}>
                Copy source diagnostics
            </button>
            <span role="status" className="workout-source-export-status">
                {feedback === 'copied' ? 'Copied. Contains ids, states and timestamps only.' : ''}
                {feedback === 'failed' ? 'Could not copy to the clipboard.' : ''}
            </span>
        </div>
    );
}

export function WorkoutWindowProjectionFailed({ range, sweep }: { range: DiagnosticsWindow | null; sweep?: ReconciliationSweepStatus }) {
    return (
        <div className="activity-telemetry-state error workout-source-window-failure" role="alert">
            <p>
                <strong>{WINDOW_PROJECTION_FAILED_COPY.name}</strong> (State 8). {WINDOW_PROJECTION_FAILED_COPY.explanation}
            </p>
            {range && <DiagnosticsExportButton range={range} result={{ status: 'projection_failed' }} sweep={sweep} />}
        </div>
    );
}
