import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    AssessmentAttempt,
    AssessmentAttemptPurpose,
    ComparisonContext,
    MeasurementProtocol,
    MetricObservationRevision,
    ObservationValidity,
} from '../../observations/models';
import { getMetricDefinition } from '../../observations/registry';
import { getComparisonDimensionDefinition } from '../../observations/protocols';
import {
    buildComparisonContextFromStrings,
    buildTestingSessionDefinition,
    createAssessmentAttemptId,
} from '../../observations/testingWorkflow';
import { adaptManualObservation } from '../../observations/manualAdapter';
import { observationKeyFor } from '../../observations/validation';
import { measurementProtocolService } from '../../services/measurementProtocolService';
import { assessmentAttemptService } from '../../services/assessmentAttemptService';
import { metricObservationService } from '../../services/metricObservationService';
import { prepareUnplannedSessionLaunch } from '../../services/sessionAuthoringService';
import { sessionExecutionService } from '../../services/sessionExecutionService';
import type { PreparedSessionLaunch } from '../../sessions/sessionLaunch';
import type { SessionExecution } from '../../sessions/models';
import { getLocalDateString } from '../../utils/localDate';
import { SessionRunner } from '../session/SessionRunner';
import './TestingWorkflow.css';

type TestingStage = 'lookup' | 'ready' | 'running' | 'capture' | 'complete' | 'abandoned';

interface TestingWorkflowProps {
    userId: string;
    onClose: () => void;
    onSessionStateChange?: (execution: SessionExecution | null) => void;
}

const PURPOSES: readonly AssessmentAttemptPurpose[] = ['familiarization', 'baseline', 'checkpoint', 'post_block'];
const VALIDITIES: readonly ObservationValidity[] = ['valid', 'invalid', 'practice', 'questionable'];

function occurrenceIdFromAttempt(attempt: AssessmentAttempt): string | null {
    const prefix = 'occurrence:';
    return attempt.sourceSessionRef?.startsWith(prefix) ? attempt.sourceSessionRef.slice(prefix.length) : null;
}

function attemptNote(validity: ObservationValidity, note: string, invalidReason: string): string | undefined {
    const cleanedNote = note.trim();
    const cleanedInvalid = invalidReason.trim();
    if (validity === 'invalid') return cleanedInvalid ? `Invalid: ${cleanedInvalid}` : undefined;
    if (validity === 'questionable') return cleanedNote ? `Questionable: ${cleanedNote}` : undefined;
    if (validity === 'practice') return cleanedNote ? `Practice: ${cleanedNote}` : undefined;
    return cleanedNote || undefined;
}

export const TestingWorkflow: React.FC<TestingWorkflowProps> = ({ userId, onClose, onSessionStateChange }) => {
    const [stage, setStage] = useState<TestingStage>('lookup');
    const [protocolId, setProtocolId] = useState('');
    const [protocolRevision, setProtocolRevision] = useState('1');
    const [protocol, setProtocol] = useState<MeasurementProtocol | null>(null);
    const [contextValues, setContextValues] = useState<Record<string, string>>({});
    const [purpose, setPurpose] = useState<AssessmentAttemptPurpose>('baseline');
    const [launch, setLaunch] = useState<PreparedSessionLaunch | null>(null);
    const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
    const [execution, setExecution] = useState<SessionExecution | null>(null);
    const [metricValues, setMetricValues] = useState<Record<string, string>>({});
    const [validity, setValidity] = useState<ObservationValidity>('valid');
    const [invalidReason, setInvalidReason] = useState('');
    const [qualityNote, setQualityNote] = useState('');
    const [deviceProvider, setDeviceProvider] = useState('');
    const [deviceModel, setDeviceModel] = useState('');
    const [deviceId, setDeviceId] = useState('');
    const [saved, setSaved] = useState<MetricObservationRevision[]>([]);
    const [correctionMetricId, setCorrectionMetricId] = useState<string | null>(null);
    const [correctionValue, setCorrectionValue] = useState('');
    const [correctionReason, setCorrectionReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recovering, setRecovering] = useState(true);
    const startInFlight = useRef(false);
    const terminalHandled = useRef<string | null>(null);

    const populateProtocol = useCallback((loaded: MeasurementProtocol) => {
        setProtocol(loaded);
        setProtocolId(loaded.id);
        setProtocolRevision(String(loaded.revision));
        setContextValues(Object.fromEntries(loaded.comparisonContext.required.map(dimension => [dimension, ''])));
        setMetricValues(Object.fromEntries(loaded.metricIds.map(metricId => [metricId, ''])));
    }, []);

    const refreshSaved = useCallback(async (assessmentAttemptId: string, loadedProtocol: MeasurementProtocol) => {
        const revisions = await Promise.all(loadedProtocol.metricIds.map(metricId =>
            metricObservationService.getCurrentRevision(userId, observationKeyFor(assessmentAttemptId, metricId)),
        ));
        setSaved(revisions.filter((revision): revision is MetricObservationRevision => revision !== null));
    }, [userId]);

    useEffect(() => {
        let cancelled = false;
        assessmentAttemptService.findOpenAttempt(userId)
            .then(async openAttempt => {
                if (cancelled || !openAttempt) return;
                const loadedProtocol = await measurementProtocolService.getRevision(
                    userId,
                    openAttempt.protocolRef.id,
                    openAttempt.protocolRef.revision,
                );
                if (cancelled || !loadedProtocol) return;
                populateProtocol(loadedProtocol);
                setAttempt(openAttempt);
                setPurpose(openAttempt.purpose);

                const occurrenceId = occurrenceIdFromAttempt(openAttempt);
                const linkedExecution = occurrenceId
                    ? await sessionExecutionService.findExecutionByOccurrenceId(userId, occurrenceId)
                    : null;
                if (cancelled) return;
                setExecution(linkedExecution);
                onSessionStateChange?.(linkedExecution);

                if (!linkedExecution) {
                    setError('An open test attempt exists, but its session execution could not be found. You may abandon it and start a fresh attempt.');
                    setStage('ready');
                    return;
                }
                if (linkedExecution.state === 'in_progress') {
                    if (openAttempt.state === 'scheduled') {
                        await assessmentAttemptService.startAttempt(userId, openAttempt.id, linkedExecution.startedAt);
                        setAttempt({ ...openAttempt, state: 'in_progress', startedAt: linkedExecution.startedAt });
                    }
                    setStage('running');
                    return;
                }
                if (linkedExecution.state === 'completed') {
                    if (openAttempt.state === 'scheduled') {
                        await assessmentAttemptService.startAttempt(userId, openAttempt.id, linkedExecution.startedAt);
                        setAttempt({ ...openAttempt, state: 'in_progress', startedAt: linkedExecution.startedAt });
                    }
                    setStage('capture');
                    await refreshSaved(openAttempt.id, loadedProtocol);
                    return;
                }
                if (openAttempt.state !== 'abandoned') await assessmentAttemptService.abandonAttempt(userId, openAttempt.id, 'Linked execution was abandoned.');
                setStage('abandoned');
            })
            .catch(reason => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not recover an open test attempt.');
            })
            .finally(() => {
                if (!cancelled) setRecovering(false);
            });
        return () => { cancelled = true; };
    }, [onSessionStateChange, populateProtocol, refreshSaved, userId]);

    const loadProtocol = async () => {
        setBusy(true);
        setError(null);
        try {
            const revision = Number(protocolRevision);
            if (!Number.isInteger(revision) || revision < 1) throw new Error('Protocol revision must be a positive integer.');
            const loaded = await measurementProtocolService.getRevision(userId, protocolId.trim(), revision);
            if (!loaded) throw new Error(`Protocol ${protocolId.trim()}@${revision} was not found.`);
            populateProtocol(loaded);
            setStage('ready');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not load protocol.');
        } finally {
            setBusy(false);
        }
    };

    const startTest = async () => {
        if (!protocol) return;
        setBusy(true);
        setError(null);
        try {
            buildComparisonContextFromStrings(protocol, contextValues);
            const definition = buildTestingSessionDefinition(protocol);
            const prepared = await prepareUnplannedSessionLaunch(userId, definition);
            if (!prepared.binding.occurrenceId) throw new Error('Testing launch requires an occurrence identity.');
            const assessment: AssessmentAttempt = {
                id: createAssessmentAttemptId(protocol),
                protocolRef: { id: protocol.id, revision: protocol.revision },
                scheduledDate: getLocalDateString(),
                state: 'scheduled',
                purpose,
                sourceSessionRef: `occurrence:${prepared.binding.occurrenceId}`,
            };
            await assessmentAttemptService.createAttempt(userId, assessment);
            setAttempt(assessment);
            setLaunch(prepared);
            setStage('running');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not start test.');
        } finally {
            setBusy(false);
        }
    };

    const handleExecutionState = useCallback(async (next: SessionExecution | null) => {
        setExecution(next);
        onSessionStateChange?.(next);
        if (!next || !attempt) return;

        if (next.state === 'in_progress' && attempt.state === 'scheduled' && !startInFlight.current) {
            startInFlight.current = true;
            try {
                await assessmentAttemptService.startAttempt(userId, attempt.id, next.startedAt);
                setAttempt(current => current ? { ...current, state: 'in_progress', startedAt: next.startedAt } : current);
            } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Could not start assessment attempt.');
            } finally {
                startInFlight.current = false;
            }
            return;
        }

        if (next.state === 'completed' && terminalHandled.current !== next.executionId) {
            terminalHandled.current = next.executionId;
            if (attempt.state === 'scheduled') {
                try {
                    await assessmentAttemptService.startAttempt(userId, attempt.id, next.startedAt);
                    setAttempt(current => current ? { ...current, state: 'in_progress', startedAt: next.startedAt } : current);
                } catch (reason) {
                    setError(reason instanceof Error ? reason.message : 'Could not reconcile assessment start.');
                    return;
                }
            }
            setStage('capture');
            if (protocol) await refreshSaved(attempt.id, protocol);
            return;
        }

        if (next.state === 'abandoned' && terminalHandled.current !== next.executionId) {
            terminalHandled.current = next.executionId;
            try {
                await assessmentAttemptService.abandonAttempt(userId, attempt.id, 'Session execution abandoned.');
                setAttempt(current => current ? { ...current, state: 'abandoned' } : current);
            } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Could not abandon assessment attempt.');
            }
            setStage('abandoned');
        }
    }, [attempt, onSessionStateChange, protocol, refreshSaved, userId]);

    const saveObservations = async () => {
        if (!protocol || !attempt || !execution) return;
        setBusy(true);
        setError(null);
        try {
            const context = buildComparisonContextFromStrings(protocol, contextValues);
            if (validity === 'invalid' && invalidReason.trim().length === 0) throw new Error('Invalid attempts require a reason.');
            if (validity === 'questionable' && qualityNote.trim().length === 0) throw new Error('Questionable attempts require a note.');

            const observedAt = execution.completedAt ?? new Date().toISOString();
            for (const metricId of protocol.metricIds) {
                const metric = getMetricDefinition(metricId);
                const value = Number(metricValues[metricId]);
                if (!Number.isFinite(value)) throw new Error(`${metric.displayName} requires a numeric value.`);
                const revision = await adaptManualObservation({
                    assessmentAttemptId: attempt.id,
                    metricId,
                    value,
                    unit: metric.unit,
                    observedAt,
                    protocol,
                    context,
                    validity,
                    ...(validity === 'invalid' ? { invalidReason: invalidReason.trim() } : {}),
                    sourceRef: `execution:${execution.executionId}`,
                    ...(deviceProvider.trim() ? {
                        device: {
                            provider: deviceProvider.trim(),
                            ...(deviceModel.trim() ? { model: deviceModel.trim() } : {}),
                            ...(deviceId.trim() ? { deviceId: deviceId.trim() } : {}),
                        },
                    } : {}),
                });
                await metricObservationService.createInitialRevision(userId, revision);
            }

            const currentAttempt = await assessmentAttemptService.getAttempt(userId, attempt.id);
            if (currentAttempt?.state === 'in_progress') {
                await assessmentAttemptService.completeAttempt(
                    userId,
                    attempt.id,
                    observedAt,
                    attemptNote(validity, qualityNote, invalidReason),
                );
                setAttempt({ ...currentAttempt, state: 'completed', completedAt: observedAt, notes: attemptNote(validity, qualityNote, invalidReason) });
            }
            await refreshSaved(attempt.id, protocol);
            setStage('complete');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not save test observations.');
        } finally {
            setBusy(false);
        }
    };

    const saveCorrection = async () => {
        if (!protocol || !attempt || !correctionMetricId) return;
        setBusy(true);
        setError(null);
        try {
            const current = await metricObservationService.getCurrentRevision(
                userId,
                observationKeyFor(attempt.id, correctionMetricId),
            );
            if (!current) throw new Error('The observation to correct no longer exists.');
            const value = Number(correctionValue);
            if (!Number.isFinite(value)) throw new Error('Correction value must be numeric.');
            if (!correctionReason.trim()) throw new Error('Correction reason is required.');
            const corrected = await adaptManualObservation({
                assessmentAttemptId: attempt.id,
                metricId: current.metricId,
                value,
                unit: current.unit,
                observedAt: current.observedAt,
                protocol,
                context: current.context as ComparisonContext,
                validity: current.validity,
                ...(current.invalidReason ? { invalidReason: current.invalidReason } : {}),
                ...(current.sourceRef ? { sourceRef: current.sourceRef } : {}),
                ...(current.device ? { device: current.device } : {}),
            }, {
                revision: current.revision + 1,
                supersedesRevision: current.revision,
                correctionReason: correctionReason.trim(),
            });
            await metricObservationService.appendCorrection(userId, corrected);
            await refreshSaved(attempt.id, protocol);
            setCorrectionMetricId(null);
            setCorrectionValue('');
            setCorrectionReason('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not save correction.');
        } finally {
            setBusy(false);
        }
    };

    const metricRows = useMemo(() => protocol?.metricIds.map(getMetricDefinition) ?? [], [protocol]);

    if (recovering) return <div className="testing-workflow"><p>Recovering testing workflow…</p></div>;

    if (stage === 'running' && launch) {
        return (
            <SessionRunner
                userId={userId}
                initialSession={launch}
                onInitialSessionHandled={() => setLaunch(null)}
                onSessionStateChange={handleExecutionState}
                onClose={onClose}
            />
        );
    }

    if (stage === 'running' && execution?.state === 'in_progress') {
        return <SessionRunner userId={userId} onSessionStateChange={handleExecutionState} onClose={onClose} />;
    }

    return (
        <div className="testing-workflow">
            <header className="testing-header">
                <div>
                    <span className="testing-kicker">Protocol testing</span>
                    <h2>{protocol?.title ?? 'Run a standardized assessment'}</h2>
                </div>
                <button type="button" className="testing-secondary" onClick={onClose}>Close</button>
            </header>

            {error && <p className="testing-error" role="alert">{error}</p>}

            {stage === 'lookup' && (
                <section className="testing-card">
                    <h3>Load immutable protocol revision</h3>
                    <p>Enter the exact user-owned protocol ID and revision. Testing never silently upgrades to a newer revision.</p>
                    <div className="testing-grid two">
                        <label>Protocol ID<input value={protocolId} onChange={event => setProtocolId(event.target.value)} /></label>
                        <label>Revision<input inputMode="numeric" value={protocolRevision} onChange={event => setProtocolRevision(event.target.value)} /></label>
                    </div>
                    <button type="button" className="testing-primary" disabled={busy || !protocolId.trim()} onClick={loadProtocol}>{busy ? 'Loading…' : 'Load protocol'}</button>
                </section>
            )}

            {protocol && stage === 'ready' && (
                <>
                    <section className="testing-card protocol-lock">
                        <div className="testing-row"><strong>{protocol.title}</strong><span>rev {protocol.revision}</span></div>
                        <p>Metrics: {metricRows.map(metric => `${metric.displayName} (${metric.unit})`).join(', ')}</p>
                        <p>Burden: <strong>{protocol.burden}</strong>{protocol.expectedRecoveryHours !== undefined ? ` · expected recovery ${protocol.expectedRecoveryHours} h` : ''}</p>
                        {protocol.warmupRef && <p>Warm-up: <code>{protocol.warmupRef}</code></p>}
                        <p>Familiarization: {protocol.familiarization.required ? `required · minimum ${protocol.familiarization.minimumExposures}` : 'not required'}</p>
                        {protocol.invalidationRules.length > 0 && <div><strong>Invalidate if:</strong><ul>{protocol.invalidationRules.map(rule => <li key={rule}>{rule}</li>)}</ul></div>}
                    </section>

                    <section className="testing-card">
                        <h3>Lock comparison context</h3>
                        <p>Series-defining values create comparison identity. Context-only values are retained but do not split the series.</p>
                        <div className="testing-grid">
                            {protocol.comparisonContext.required.map(dimension => {
                                const definition = getComparisonDimensionDefinition(dimension);
                                const seriesDefining = protocol.comparisonContext.seriesDefining.includes(dimension);
                                return <label key={dimension}>{dimension} <small>{seriesDefining ? 'series-defining' : 'context-only'} · {definition.description}</small><input value={contextValues[dimension] ?? ''} onChange={event => setContextValues(current => ({ ...current, [dimension]: event.target.value }))} /></label>;
                            })}
                        </div>
                        <label>Attempt purpose<select value={purpose} onChange={event => setPurpose(event.target.value as AssessmentAttemptPurpose)}>{PURPOSES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
                        <div className="testing-actions">
                            <button type="button" className="testing-secondary" onClick={() => { setProtocol(null); setStage('lookup'); }}>Choose another protocol</button>
                            <button type="button" className="testing-primary" disabled={busy} onClick={startTest}>{busy ? 'Preparing…' : 'Confirm lock and start'}</button>
                        </div>
                    </section>
                </>
            )}

            {protocol && attempt && stage === 'capture' && (
                <section className="testing-card">
                    <h3>Record raw result</h3>
                    <p>Attempt <code>{attempt.id}</code>. Values remain raw; this screen does not infer FTP, threshold or progress.</p>
                    <div className="testing-grid">
                        {metricRows.map(metric => <label key={metric.id}>{metric.displayName} ({metric.unit})<input inputMode="decimal" value={metricValues[metric.id] ?? ''} onChange={event => setMetricValues(current => ({ ...current, [metric.id]: event.target.value }))} /></label>)}
                    </div>
                    <fieldset className="testing-validity"><legend>Attempt validity</legend>{VALIDITIES.map(item => <label key={item}><input type="radio" name="validity" checked={validity === item} onChange={() => setValidity(item)} /> {item}</label>)}</fieldset>
                    {validity === 'invalid' && <label>Invalid reason<input value={invalidReason} onChange={event => setInvalidReason(event.target.value)} /></label>}
                    {(validity === 'questionable' || validity === 'practice' || validity === 'valid') && <label>Validity note (optional{validity === 'questionable' ? ' except questionable requires one' : ''})<input value={qualityNote} onChange={event => setQualityNote(event.target.value)} /></label>}
                    <h4>Manual source/device provenance</h4>
                    <div className="testing-grid three">
                        <label>Provider<input placeholder="e.g. Garmin / Favero" value={deviceProvider} onChange={event => setDeviceProvider(event.target.value)} /></label>
                        <label>Model<input value={deviceModel} onChange={event => setDeviceModel(event.target.value)} /></label>
                        <label>Device ID<input value={deviceId} onChange={event => setDeviceId(event.target.value)} /></label>
                    </div>
                    <p className="testing-note">If the page was reloaded after execution, re-enter the exact locked comparison context before saving. No context is guessed.</p>
                    <div className="testing-grid">
                        {protocol.comparisonContext.required.map(dimension => <label key={dimension}>{dimension}<input value={contextValues[dimension] ?? ''} onChange={event => setContextValues(current => ({ ...current, [dimension]: event.target.value }))} /></label>)}
                    </div>
                    <button type="button" className="testing-primary" disabled={busy} onClick={saveObservations}>{busy ? 'Saving…' : 'Save raw observation(s)'}</button>
                </section>
            )}

            {protocol && attempt && stage === 'complete' && (
                <section className="testing-card">
                    <h3>Assessment recorded</h3>
                    <p>Attempt {attempt.id} is complete. Current observation revisions:</p>
                    <div className="testing-observations">{saved.map(revision => {
                        const metric = getMetricDefinition(revision.metricId);
                        return <div key={revision.observationKey} className="testing-observation-row"><div><strong>{metric.displayName}</strong><span>{revision.value} {revision.unit} · {revision.validity} · rev {revision.revision}</span></div><button type="button" className="testing-secondary" onClick={() => { setCorrectionMetricId(revision.metricId); setCorrectionValue(String(revision.value)); setCorrectionReason(''); }}>Correct</button></div>;
                    })}</div>
                    {correctionMetricId && <div className="testing-correction"><h4>Append correction</h4><label>Corrected value<input inputMode="decimal" value={correctionValue} onChange={event => setCorrectionValue(event.target.value)} /></label><label>Reason<input value={correctionReason} onChange={event => setCorrectionReason(event.target.value)} /></label><div className="testing-actions"><button type="button" className="testing-secondary" onClick={() => setCorrectionMetricId(null)}>Cancel</button><button type="button" className="testing-primary" disabled={busy} onClick={saveCorrection}>{busy ? 'Saving…' : 'Save correction revision'}</button></div></div>}
                    <div className="testing-actions"><button type="button" className="testing-primary" onClick={onClose}>Done</button></div>
                </section>
            )}

            {stage === 'abandoned' && <section className="testing-card"><h3>Assessment abandoned</h3><p>No valid benchmark observation was created.</p><button type="button" className="testing-primary" onClick={onClose}>Done</button></section>}
        </div>
    );
};
