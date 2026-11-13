import { useCallback, useEffect, useMemo, useState } from 'react';
import { impliedDate } from '../engine/externalPlacement';
import { type ExternalPlanHeader, type ObjectiveKey } from '../engine/models';
import { externalPlanService } from '../services/externalPlanService';
import { resolvePlanningAuthorityMode, type PlanningAuthorityMode } from '../ledger/planningAuthorityMode';
import type { UserPreferences } from '../ledger/models';
import { buildAiPromptTemplate } from './externalPlanImportPrompt';
import { loadPromptPlanningAuthorityMode } from './externalPlanImportPromptMode';
import { preflightExternalPlanImport, type ExternalPlanImportPreflight } from '../services/externalPlanImportPreflight';
import { activateIntentBlocksFromPlan, type IntentBlockActivationResult } from '../services/externalPlanV5ActivationService';
import { addDaysToLocalDateString, getLocalDateString } from '../utils/localDate';
import { diffPlans, type PlanDiffRow } from './externalPlanDiff';
import { describeImportRejection, describeReplacementIssue } from './externalPlanReplacementCopy';
import {
    isV2Session,
    type AnyExternalTrainingPlan as ExternalTrainingPlan,
    type AnyExternalPlanSession,
} from '../sessions/externalPlanV2';
import { EXTERNAL_PLAN_SCHEMA_V6 } from '../sessions/externalPlanV6';
import { validateExternalPlanImport } from '../sessions/externalPlanValidation';
import { SessionDefinitionPreview } from './session/SessionDefinitionPreview';
import './ExternalPlanImport.css';

interface ExternalPlanImportProps {
    userId: string;
    onImported?: () => void;
    preferences?: Pick<UserPreferences, 'engineRecommendationsEnabled'> | null;
}

type Phase =
    | { kind: 'editing' }
    | { kind: 'invalid'; issues: { field: string; message: string }[] }
    | { kind: 'previewing'; plan: ExternalTrainingPlan; previous: ExternalPlanHeader | null }
    | { kind: 'saving' }
    | { kind: 'saved'; plan: ExternalTrainingPlan; untagged: AnyExternalPlanSession[]; intentBlockResults: IntentBlockActivationResult[] }
    | { kind: 'failed'; message: string };

/** Objective keys the engine can credit, offered when a session declared none. */
const OBJECTIVE_CHOICES: ObjectiveKey[] = [
    'zone2_aerobic', 'threshold_quality', 'surge_repeatability', 'vo2_max',
    'strength_maintenance', 'strength_development', 'race_specific_endurance',
];

/** Parses pasted JSON without throwing into the component event path. */
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
 * against the same contract the engine reads back, plus the import-only session-id bound
 * (`validateExternalPlanImport`, #945), and `externalPlanService.import` re-checks it, so
 * a plan that previews cleanly is a plan that will adjudicate — there is no second, laxer
 * import path.
 */
export function ExternalPlanImport({ userId, onImported, preferences }: ExternalPlanImportProps) {
    const [text, setText] = useState('');
    const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
    const [objectiveEdits, setObjectiveEdits] = useState<Record<string, ObjectiveKey[]>>({});
    const [effectiveFrom, setEffectiveFrom] = useState(getLocalDateString);
    const [preflight, setPreflight] = useState<ExternalPlanImportPreflight | null>(null);
    const [preflightAcknowledged, setPreflightAcknowledged] = useState(false);
    const [promptCopied, setPromptCopied] = useState(false);
    const [loadedMode, setLoadedMode] = useState<PlanningAuthorityMode | null>(null);
    // The prompt's travel instruction depends on the mode, so Copy waits until the stored
    // preferences have settled; otherwise a quick click copies the engine-mode default.
    const [preferencesSettled, setPreferencesSettled] = useState(false);
    const today = getLocalDateString();

    useEffect(() => {
        if (preferences !== undefined) return;
        let current = true;
        setPreferencesSettled(false);
        void loadPromptPlanningAuthorityMode(userId).then(mode => {
            if (!current) return;
            setLoadedMode(mode);
            setPreferencesSettled(true);
        });
        return () => { current = false; };
    }, [preferences, userId]);

    const planningAuthorityMode = preferences !== undefined
        ? resolvePlanningAuthorityMode(preferences)
        : loadedMode ?? resolvePlanningAuthorityMode(null);
    const promptReady = preferences !== undefined || preferencesSettled;
    const promptTemplate = useMemo(
        () => buildAiPromptTemplate(planningAuthorityMode),
        [planningAuthorityMode],
    );

    const handleCopyPrompt = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(promptTemplate);
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
        } catch {
            // Clipboard permission fallback
        }
    }, [promptTemplate]);

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
        const result = validateExternalPlanImport(parsed.value);
        if (!result.isValid || !result.data) {
            setPhase({ kind: 'invalid', issues: result.errors.map(error => ({ field: error.field, message: error.message })) });
            return;
        }
        const existing = await externalPlanService.getHeaderState(userId, result.data.planId);
        if (existing.status !== 'AVAILABLE' && existing.status !== 'MISSING') {
            setPhase({ kind: 'failed', message: 'Could not verify the stored plan history. Nothing was stored; retry after storage is available.' });
            return;
        }
        setPhase({
            kind: 'previewing',
            plan: result.data,
            previous: existing.status === 'AVAILABLE' ? existing.data : null,
        });
    }, [text, userId]);

    const previousRevision = usePreviousRevision(userId, phase);
    const previousPlan = previousRevision.plan;

    const confirmImport = useCallback(async (plan: ExternalTrainingPlan, effectiveDate: string) => {
        setPhase({ kind: 'saving' });
        const result = await externalPlanService.import(userId, plan, effectiveDate);
        if (result.status === 'AVAILABLE') {
            // v5's intentBlocks are materialized as real IntentBlocks only after the plan
            // revision itself is safely stored -- never before, since a failed plan import
            // must not leave orphaned intent blocks sourced from a plan that was never saved.
            const intentBlockResults = 'intentBlocks' in plan ? await activateIntentBlocksFromPlan(userId, plan) : [];
            setPhase({
                kind: 'saved',
                plan,
                untagged: plan.sessions.filter(session => !session.objectives || session.objectives.length === 0),
                intentBlockResults,
            });
            onImported?.();
            return;
        }
        const errorDetail = result.status === 'UNAVAILABLE' && result.message ? result.message : null;
        const replacementCopy = result.status === 'INVALID' ? describeImportRejection(result.issues, plan, previousPlan) : [];
        setPhase({
            kind: 'failed',
            message: replacementCopy.length > 0 ? replacementCopy.join(' ')
                : result.status === 'INVALID'
                ? `Rejected: ${result.issues.map(issue => `${issue.field ?? 'plan'} (${issue.code})`).join(', ')}`
                : `Could not reach storage${errorDetail ? `: ${errorDetail}` : ''}. Nothing was written; try again.`,
        });
    }, [userId, onImported, previousPlan]);

    useEffect(() => {
        if (phase.kind !== 'previewing') {
            setPreflight(null);
            return;
        }
        if (!previousRevision.ready) {
            setPreflight(null);
            setPreflightAcknowledged(false);
            return;
        }
        let current = true;
        setPreflight(null);
        setPreflightAcknowledged(false);
        void preflightExternalPlanImport(userId, phase.plan, effectiveFrom, today, previousPlan)
            .then(result => { if (current) setPreflight(result); })
            .catch(() => { if (current) setPreflight({ status: 'unknown', unavailableSources: ['activation preflight'], findings: [] }); });
        return () => { current = false; };
    }, [effectiveFrom, phase, previousPlan, previousRevision.ready, today, userId]);

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

                <details className="external-import-prompt-guide">
                    <summary>
                        <span>Need the prompt template for your AI?</span>
                    </summary>
                    <div className="external-import-prompt-content">
                        <div className="external-import-prompt-actions">
                            <button
                                type="button"
                                className="external-import-secondary"
                                onClick={handleCopyPrompt}
                                disabled={!promptReady}
                            >
                                {promptCopied ? 'Copied prompt to clipboard!' : 'Copy AI prompt template'}
                            </button>
                            <span className="external-import-prompt-hint">
                                Tip: For short intervals (e.g. 10s, 20s, 30s), use <code>{'"dose": {"kind": "duration", "seconds": 20}'}</code> instead of fractional minutes.
                            </span>
                        </div>
                        <pre className="external-import-prompt-text">{promptTemplate}</pre>
                    </div>
                </details>

                <textarea
                    className="external-import-input"
                    value={text}
                    onChange={event => handleTextChange(event.target.value)}
                    rows={14}
                    spellCheck={false}
                    placeholder={`{ "schema": "${EXTERNAL_PLAN_SCHEMA_V6}", "planId": "...", "restDays": [], ... }`}
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
                        previousPlan={previousPlan}
                        diff={diff}
                        previousRevisionReady={previousRevision.ready}
                        effectiveFrom={effectiveFrom}
                        today={today}
                        onEffectiveFromChange={setEffectiveFrom}
                        preflight={preflight}
                        preflightAcknowledged={preflightAcknowledged}
                        onPreflightAcknowledgementChange={setPreflightAcknowledged}
                        onConfirm={() => confirmImport(phase.plan, effectiveFrom)}
                        onCancel={() => setPhase({ kind: 'editing' })}
                    />
                )}

                {phase.kind === 'saving' && <p className="external-import-status">Storing revision…</p>}

                {phase.kind === 'saved' && (
                    <section className="external-import-saved" aria-label="Import result">
                        <h4>Stored: {phase.plan.title}</h4>
                        <p>
                            Revision {phase.plan.revision}, {phase.plan.sessions.length} sessions,
                            {' '}effective from {effectiveFrom}. Days already decided keep the recommendation they were given.
                        </p>
                        {phase.intentBlockResults.length > 0 && (
                            <div className="external-import-objectives">
                                <h5>Intent blocks</h5>
                                <ul>
                                    {phase.intentBlockResults.map(result => (
                                        <li key={result.entryId}>
                                            {result.outcome.status === 'saved'
                                                ? `${result.entryId}: saved (revision ${result.outcome.header.revision})`
                                                : `${result.entryId}: not saved — ${result.outcome.message}`}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
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
                                        // TS distributes a plan-union spread/rebuild as ExternalPlanSession[] |
                                        // ExternalPlanSessionV2[] (never a mixed array) and can't itself prove
                                        // this same-shape-in/same-shape-out map preserves that per element --
                                        // it does, at runtime, since `session` is only ever spread into itself.
                                        const tagged = {
                                            ...phase.plan,
                                            revision: phase.plan.revision + 1,
                                            sessions: phase.plan.sessions.map(session => {
                                                const chosen = objectiveEdits[session.id];
                                                return chosen && chosen.length > 0 ? { ...session, objectives: chosen } : session;
                                            }),
                                        } as ExternalTrainingPlan;
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
function usePreviousRevision(userId: string, phase: Phase): { plan: ExternalTrainingPlan | null; ready: boolean } {
    const [loaded, setLoaded] = useState<{ key: string; plan: ExternalTrainingPlan | null; ready: boolean } | null>(null);
    const planId = phase.kind === 'previewing' ? phase.previous?.planId ?? null : null;
    const revision = phase.kind === 'previewing' ? phase.previous?.revision ?? null : null;
    const key = planId !== null && revision !== null ? `${planId}:${revision}` : null;

    useEffect(() => {
        if (key === null || planId === null || revision === null) return;
        let cancelled = false;
        externalPlanService.getRevisionState(userId, planId, revision).then(state => {
            if (!cancelled) setLoaded({ key, plan: state.status === 'AVAILABLE' ? state.data : null, ready: state.status === 'AVAILABLE' });
        });
        return () => { cancelled = true; };
    }, [userId, key, planId, revision]);

    return key === null ? { plan: null, ready: true }
        : loaded !== null && loaded.key === key ? { plan: loaded.plan, ready: loaded.ready }
            : { plan: null, ready: false };
}

export interface PlanPreviewProps {
    plan: ExternalTrainingPlan;
    previous: ExternalPlanHeader | null;
    /** The stored revision being replaced, for naming the sessions a replacement declares. */
    previousPlan?: ExternalTrainingPlan | null;
    diff: PlanDiffRow[] | null;
    previousRevisionReady?: boolean;
    effectiveFrom?: string;
    today?: string;
    preflight?: ExternalPlanImportPreflight | null;
    preflightAcknowledged?: boolean;
    onEffectiveFromChange?: (date: string) => void;
    onPreflightAcknowledgementChange?: (acknowledged: boolean) => void;
    onConfirm: () => void;
    onCancel: () => void;
}

/** Exported (not just used internally) so the acknowledgement-gating behavior is directly
 * testable without driving the full paste-JSON → validate → preview state machine. */
export function PlanPreview({
    plan, previous, previousPlan = null, diff, previousRevisionReady = true, onConfirm, onCancel,
    today = getLocalDateString(), effectiveFrom = today, onEffectiveFromChange = () => {},
    preflight = { status: 'ready', findings: [] }, preflightAcknowledged = false,
    onPreflightAcknowledgementChange = () => {},
}: PlanPreviewProps) {
    const notNewer = previous !== null && plan.revision <= previous.revision;

    // M3.7: a diff row's `contentChanges` are only present for a matched v2/v2 session pair
    // (`externalPlanDiff.ts`). Behavior-changing rows -- dose, load, laterality, optional vs
    // required, an authored choice's actions -- must be explicitly acknowledged before the
    // athlete can confirm; cosmetic-only rows (wording) never block.
    const behaviorChangeCount = (diff ?? []).filter(row => row.behaviorChanging).length;
    const [acknowledged, setAcknowledged] = useState(false);
    const blockedByPreflight = !preflight || preflight.status !== 'ready'
        || (preflight.findings.length > 0 && !preflightAcknowledged);
    const blockedByUnreviewedChanges = (behaviorChangeCount > 0 && !acknowledged) || !previousRevisionReady || blockedByPreflight;

    return (
        <section className="external-import-preview" aria-label="Plan preview">
            <h4>{plan.title}</h4>
            <p className="external-import-preview-meta">
                {plan.planId} · revision {plan.revision} · {plan.weekCount} weeks from {plan.startDate} ·
                {' '}{plan.sessions.length} sessions
            </p>

            <label className="external-import-preview-effective-date">
                Effective from (Europe/Warsaw)
                <input
                    type="date"
                    value={effectiveFrom}
                    min={today}
                    onChange={event => onEffectiveFromChange(event.target.value)}
                    aria-label="Revision effective from date"
                />
            </label>
            <p className="external-import-preview-meta">
                This full revision replaces this plan from {effectiveFrom}; earlier dates stay with the prior revision. Omitted sessions are removed from this revision&apos;s horizon.
            </p>
            {diff && (
                <p className="external-import-preview-meta">
                    Added {(diff ?? []).filter(row => row.change === 'added').length} · changed {(diff ?? []).filter(row => row.change === 'changed').length} · removed {(diff ?? []).filter(row => row.change === 'removed').length} · retained {plan.sessions.length - (diff ?? []).filter(row => row.change === 'added' || row.change === 'changed').length}
                </p>
            )}

            <section className="external-import-diff" aria-label="Activation conflict review">
                <h5>Calendar and authority preflight</h5>
                {!preflight && <p>Checking current plans, fixed activities, travel blocks, and authored sessions…</p>}
                {preflight?.status === 'invalid_date' && <p className="external-import-blocked">Choose a valid effective date from today through the plan’s final date, {addDaysToLocalDateString(plan.startDate, plan.weekCount * 7 - 1)}.</p>}
                {preflight?.status === 'unknown' && (
                    <p className="external-import-blocked">Activation is blocked because these authority inputs could not be verified: {preflight.unavailableSources.join(', ')}. Retry the preview when they are readable.</p>
                )}
                {preflight?.status === 'invalid_replacements' && (
                    <>
                        <p className="external-import-blocked">
                            {preflight.issues.every(issue => issue.code === 'replaced-placement-unreadable')
                                ? 'This revision cannot be imported yet.'
                                : 'This revision cannot be imported until its session replacements are fixed.'}
                        </p>
                        <ul>
                            {preflight.issues.map(issue => (
                                <li key={`${issue.code}-${issue.field}`}>{describeReplacementIssue(issue, plan, previousPlan)}</li>
                            ))}
                        </ul>
                    </>
                )}
                {preflight?.status === 'ready' && preflight.findings.length === 0 && (
                    <p>No overlap or placement consequences were found in the current plan, calendar, or occurrence records.</p>
                )}
                {preflight?.status === 'ready' && preflight.findings.length > 0 && (
                    <>
                        <ul>
                            {preflight.findings.map((finding, index) => (
                                <li key={`${finding.kind}-${finding.date}-${index}`}>{finding.date} — {finding.detail}</li>
                            ))}
                        </ul>
                        <label className="external-import-ack">
                            <input type="checkbox" checked={preflightAcknowledged} onChange={event => onPreflightAcknowledgementChange(event.target.checked)} />
                            I reviewed these placement, calendar, and authority impacts.
                        </label>
                    </>
                )}
            </section>

            {notNewer && (
                <p className="external-import-blocked">
                    Revision {plan.revision} does not advance the stored revision {previous.revision}. Bump the
                    revision number in the JSON — a plan is never overwritten in place.
                </p>
            )}
            {!previousRevisionReady && previous !== null && (
                <p className="external-import-blocked">Could not verify the prior immutable revision. Retry the preview before activating this revision.</p>
            )}

            {diff && diff.length > 0 && (
                <div className="external-import-diff">
                    <h5>What changes against revision {previous?.revision}</h5>
                    <ul>
                        {diff.map(row => (
                            <li key={`${row.change}-${row.sessionId}`} className={`diff-${row.change}`}>
                                {row.detail}
                                {row.contentChanges && row.contentChanges.length > 0 && (
                                    <ul className="external-import-content-diff">
                                        {row.contentChanges.map((change, index) => (
                                            <li
                                                key={`${row.sessionId}-${change.scope}-${change.id}-${index}`}
                                                className={change.behaviorChanging ? 'content-diff-behavior' : 'content-diff-cosmetic'}
                                            >
                                                {change.behaviorChanging ? '⚠ ' : ''}{change.detail}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {diff && diff.length === 0 && (
                <p className="external-import-preview-meta">No session differs from the stored revision.</p>
            )}

            {'intentBlocks' in plan && plan.intentBlocks && plan.intentBlocks.length > 0 && (
                <div className="external-import-diff">
                    <h5>Intent blocks this import will author</h5>
                    <ul>
                        {plan.intentBlocks.map(block => (
                            <li key={block.id}>
                                <strong>{block.title ?? block.id}</strong> — week {block.startWeek} ({block.startDay}) through
                                {' '}week {block.endWeek} ({block.endDay}), {block.objectives.length} objective
                                {block.objectives.length === 1 ? '' : 's'}
                                {block.progressionContract ? ', with a progression contract' : ''}.
                            </li>
                        ))}
                    </ul>
                </div>
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
                        {isV2Session(session) && (
                            <details className="external-import-session-detail">
                                <summary>Full session content — every block and step, not just this summary line</summary>
                                <SessionDefinitionPreview definition={session.definition} />
                            </details>
                        )}
                        {'scaling' in session && session.scaling && 'reducedDefinition' in session.scaling && session.scaling.reducedDefinition && (
                            <details className="external-import-session-detail">
                                <summary>Exact reduced executable content</summary>
                                <SessionDefinitionPreview definition={session.scaling.reducedDefinition} />
                            </details>
                        )}
                    </li>
                ))}
            </ol>

            {behaviorChangeCount > 0 && (
                <label className="external-import-ack">
                    <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={event => setAcknowledged(event.target.checked)}
                    />
                    I reviewed the {behaviorChangeCount} behavior change{behaviorChangeCount === 1 ? '' : 's'} marked ⚠ above.
                </label>
            )}

            <div className="external-import-actions">
                <button
                    type="button"
                    className="external-import-primary"
                    onClick={onConfirm}
                        disabled={notNewer || blockedByUnreviewedChanges || !effectiveFrom || effectiveFrom < today}
                >
                    Import this plan
                </button>
                <button type="button" className="external-import-secondary" onClick={onCancel}>
                    Back to editing
                </button>
            </div>
        </section>
    );
}
