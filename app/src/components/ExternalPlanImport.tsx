import { useCallback, useEffect, useMemo, useState } from 'react';
import { validateExternalTrainingPlan } from '../engine/validation';
import { impliedDate } from '../engine/externalPlacement';
import { EXTERNAL_PLAN_SCHEMA, type ExternalPlanHeader, type ExternalTrainingPlan, type ObjectiveKey } from '../engine/models';
import { externalPlanService } from '../services/externalPlanService';
import { getLocalDateString } from '../utils/localDate';
import { diffPlans, type PlanDiffRow } from './externalPlanDiff';
import './ExternalPlanImport.css';

interface ExternalPlanImportProps {
    userId: string;
    onImported?: () => void;
}

type Phase =
    | { kind: 'editing' }
    | { kind: 'invalid'; issues: { field: string; message: string }[] }
    | { kind: 'previewing'; plan: ExternalTrainingPlan; previous: ExternalPlanHeader | null }
    | { kind: 'saving' }
    | { kind: 'saved'; plan: ExternalTrainingPlan; untagged: ExternalTrainingPlan['sessions'] }
    | { kind: 'failed'; message: string };

/** Objective keys the engine can credit, offered when a session declared none. */
const OBJECTIVE_CHOICES: ObjectiveKey[] = [
    'zone2_aerobic', 'threshold_quality', 'surge_repeatability', 'vo2_max',
    'strength_maintenance', 'strength_development', 'race_specific_endurance',
];

function parseJson(text: string): { value: unknown } | { error: string } {
    try {
        return { value: JSON.parse(text) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Paste → validate → preview → confirm.
 *
 * Nothing is written until the athlete has seen what will be stored. Validation happens
 * against the same contract the engine reads back (`validateExternalTrainingPlan`), so a
 * plan that previews cleanly is a plan that will adjudicate — there is no second, laxer
 * import path.
 */
export function ExternalPlanImport({ userId, onImported }: ExternalPlanImportProps) {
    const [text, setText] = useState('');
    const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
    const [objectiveEdits, setObjectiveEdits] = useState<Record<string, ObjectiveKey[]>>({});
    const today = getLocalDateString();

    const handleTextChange = useCallback((next: string) => {
        setText(next);
        setPhase({ kind: 'editing' });
    }, []);

    const validateAndPreview = useCallback(async () => {
        const parsed = parseJson(text);
        if ('error' in parsed) {
            setPhase({ kind: 'invalid', issues: [{ field: 'document', message: `Not valid JSON: ${parsed.error}` }] });
            return;
        }
        const result = validateExternalTrainingPlan(parsed.value);
        if (!result.isValid || !result.data) {
            setPhase({ kind: 'invalid', issues: result.errors.map(error => ({ field: error.field, message: error.message })) });
            return;
        }
        const existing = await externalPlanService.getHeaderState(userId, result.data.planId);
        setPhase({
            kind: 'previewing',
            plan: result.data,
            previous: existing.status === 'AVAILABLE' ? existing.data : null,
        });
    }, [text, userId]);

    const confirmImport = useCallback(async (plan: ExternalTrainingPlan) => {
        setPhase({ kind: 'saving' });
        // Forward-only: a revision takes effect from today, so days already adjudicated keep
        // the recommendation and audit they were given (ADR-0019 D-IMMUT).
        const result = await externalPlanService.import(userId, plan, today);
        if (result.status === 'AVAILABLE') {
            setPhase({
                kind: 'saved',
                plan,
                untagged: plan.sessions.filter(session => !session.objectives || session.objectives.length === 0),
            });
            onImported?.();
            return;
        }
        setPhase({
            kind: 'failed',
            message: result.status === 'INVALID'
                ? `Rejected: ${result.issues.map(issue => `${issue.field ?? 'plan'} (${issue.code})`).join(', ')}`
                : 'Could not reach storage. Nothing was written; try again.',
        });
    }, [userId, today, onImported]);

    const previousPlan = usePreviousRevision(userId, phase);

    const diff = useMemo(() => {
        if (phase.kind !== 'previewing' || !previousPlan) return null;
        return diffPlans(previousPlan, phase.plan);
    }, [phase, previousPlan]);

    return (
        <div className="external-import">
            <div className="dashboard-card">
                <div className="card-header">
                    <div className="header-title-group">
                        <h3>Import a training plan</h3>
                        <span className="provisional-tag">Paste the JSON your AI produced from the published prompt block</span>
                    </div>
                </div>

                <textarea
                    className="external-import-input"
                    value={text}
                    onChange={event => handleTextChange(event.target.value)}
                    rows={14}
                    spellCheck={false}
                    placeholder={`{ "schema": "${EXTERNAL_PLAN_SCHEMA}", "planId": "...", ... }`}
                    aria-label="Plan JSON"
                />

                <div className="external-import-actions">
                    <button
                        type="button"
                        className="external-import-primary"
                        disabled={text.trim().length === 0 || phase.kind === 'saving'}
                        onClick={validateAndPreview}
                    >
                        Validate and preview
                    </button>
                    {text.length > 0 && (
                        <button type="button" className="external-import-secondary" onClick={() => handleTextChange('')}>
                            Clear
                        </button>
                    )}
                </div>

                {phase.kind === 'invalid' && (
                    <section className="external-import-errors" aria-label="Validation errors">
                        <h4>This plan was not stored</h4>
                        <p>Every problem is listed, not just the first, so one round of fixes is enough.</p>
                        <ul>
                            {phase.issues.map((issue, index) => (
                                <li key={`${issue.field}-${index}`}><code>{issue.field}</code> — {issue.message}</li>
                            ))}
                        </ul>
                    </section>
                )}

                {phase.kind === 'failed' && (
                    <p className="external-import-failed">{phase.message}</p>
                )}

                {phase.kind === 'previewing' && (
                    <PlanPreview
                        plan={phase.plan}
                        previous={phase.previous}
                        diff={diff}
                        onConfirm={() => confirmImport(phase.plan)}
                        onCancel={() => setPhase({ kind: 'editing' })}
                    />
                )}

                {phase.kind === 'saving' && <p className="external-import-status">Storing revision…</p>}

                {phase.kind === 'saved' && (
                    <section className="external-import-saved" aria-label="Import result">
                        <h4>Stored: {phase.plan.title}</h4>
                        <p>
                            Revision {phase.plan.revision}, {phase.plan.sessions.length} sessions,
                            {' '}effective from {today}. Days already decided keep the recommendation they were given.
                        </p>
                        {phase.untagged.length > 0 && (
                            <div className="external-import-objectives">
                                <h5>Confirm what these sessions are for</h5>
                                <p>
                                    {phase.untagged.length} session{phase.untagged.length === 1 ? '' : 's'} declared no
                                    objectives. Without them the weekly review has to infer intent from modality and
                                    intensity alone, which is coarser than your author&apos;s own labelling.
                                </p>
                                {phase.untagged.map(session => (
                                    <div key={session.id} className="external-import-objective-row">
                                        <span className="external-import-objective-title">{session.title}</span>
                                        <div className="external-import-objective-choices">
                                            {OBJECTIVE_CHOICES.map(key => {
                                                const selected = (objectiveEdits[session.id] ?? []).includes(key);
                                                return (
                                                    <button
                                                        key={key}
                                                        type="button"
                                                        className={selected ? 'selected' : ''}
                                                        aria-pressed={selected}
                                                        onClick={() => setObjectiveEdits(current => {
                                                            const chosen = current[session.id] ?? [];
                                                            return {
                                                                ...current,
                                                                [session.id]: selected ? chosen.filter(item => item !== key) : [...chosen, key],
                                                            };
                                                        })}
                                                    >
                                                        {key.replaceAll('_', ' ')}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="external-import-primary"
                                    onClick={() => {
                                        const tagged: ExternalTrainingPlan = {
                                            ...phase.plan,
                                            revision: phase.plan.revision + 1,
                                            sessions: phase.plan.sessions.map(session => {
                                                const chosen = objectiveEdits[session.id];
                                                return chosen && chosen.length > 0 ? { ...session, objectives: chosen } : session;
                                            }),
                                        };
                                        handleTextChange(JSON.stringify(tagged, null, 2));
                                    }}
                                    disabled={Object.values(objectiveEdits).every(list => list.length === 0)}
                                >
                                    Apply tags as revision {phase.plan.revision + 1}
                                </button>
                                <p className="external-import-objective-note">
                                    A stored revision is never edited in place. Applying tags loads revision
                                    {' '}{phase.plan.revision + 1} into the box above for you to review and import.
                                </p>
                            </div>
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}

/** Loads the stored revision a preview is replacing, so the diff has something to compare. */
function usePreviousRevision(userId: string, phase: Phase): ExternalTrainingPlan | null {
    const [loaded, setLoaded] = useState<{ key: string; plan: ExternalTrainingPlan | null } | null>(null);
    const planId = phase.kind === 'previewing' ? phase.previous?.planId ?? null : null;
    const revision = phase.kind === 'previewing' ? phase.previous?.revision ?? null : null;
    const key = planId !== null && revision !== null ? `${planId}:${revision}` : null;

    useEffect(() => {
        if (key === null || planId === null || revision === null) return;
        let cancelled = false;
        externalPlanService.getRevisionState(userId, planId, revision).then(state => {
            if (!cancelled) setLoaded({ key, plan: state.status === 'AVAILABLE' ? state.data : null });
        });
        return () => { cancelled = true; };
    }, [userId, key, planId, revision]);

    return loaded !== null && loaded.key === key ? loaded.plan : null;
}

interface PlanPreviewProps {
    plan: ExternalTrainingPlan;
    previous: ExternalPlanHeader | null;
    diff: PlanDiffRow[] | null;
    onConfirm: () => void;
    onCancel: () => void;
}

function PlanPreview({ plan, previous, diff, onConfirm, onCancel }: PlanPreviewProps) {
    const notNewer = previous !== null && plan.revision <= previous.revision;

    return (
        <section className="external-import-preview" aria-label="Plan preview">
            <h4>{plan.title}</h4>
            <p className="external-import-preview-meta">
                {plan.planId} · revision {plan.revision} · {plan.weekCount} weeks from {plan.startDate} ·
                {' '}{plan.sessions.length} sessions
            </p>

            {notNewer && (
                <p className="external-import-blocked">
                    Revision {plan.revision} does not advance the stored revision {previous.revision}. Bump the
                    revision number in the JSON — a plan is never overwritten in place.
                </p>
            )}

            {diff && diff.length > 0 && (
                <div className="external-import-diff">
                    <h5>What changes against revision {previous?.revision}</h5>
                    <ul>
                        {diff.map(row => (
                            <li key={`${row.change}-${row.sessionId}`} className={`diff-${row.change}`}>{row.detail}</li>
                        ))}
                    </ul>
                </div>
            )}
            {diff && diff.length === 0 && (
                <p className="external-import-preview-meta">No session differs from the stored revision.</p>
            )}

            <ol className="external-import-sessions">
                {plan.sessions.map(session => (
                    <li key={session.id}>
                        <span className="external-import-session-date">{impliedDate(plan, session)}</span>
                        <span className="external-import-session-title">{session.title}</span>
                        <span className="external-import-session-meta">
                            {session.gating.modality} · {session.gating.intensity} ·
                            {' '}{session.gating.durationMin}–{session.gating.durationMax} min · {session.priority}
                            {session.isEvent && ' · event'}
                        </span>
                    </li>
                ))}
            </ol>

            <div className="external-import-actions">
                <button type="button" className="external-import-primary" onClick={onConfirm} disabled={notNewer}>
                    Import this plan
                </button>
                <button type="button" className="external-import-secondary" onClick={onCancel}>
                    Back to editing
                </button>
            </div>
        </section>
    );
}
