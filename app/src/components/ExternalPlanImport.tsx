import { useCallback, useEffect, useMemo, useState } from 'react';
import { impliedDate } from '../engine/externalPlacement';
import { type ExternalPlanHeader, type ObjectiveKey } from '../engine/models';
import { externalPlanService } from '../services/externalPlanService';
import { preflightExternalPlanImport, type ExternalPlanImportPreflight } from '../services/externalPlanImportPreflight';
import { activateIntentBlocksFromPlan, type IntentBlockActivationResult } from '../services/externalPlanV5ActivationService';
import { addDaysToLocalDateString, getLocalDateString } from '../utils/localDate';
import { diffPlans, type PlanDiffRow } from './externalPlanDiff';
import {
    isV2Session,
    type AnyExternalTrainingPlan as ExternalTrainingPlan,
    type AnyExternalPlanSession,
} from '../sessions/externalPlanV2';
import { EXTERNAL_PLAN_SCHEMA_V6 } from '../sessions/externalPlanV6';
import { validateAnyExternalTrainingPlan } from '../sessions/externalPlanValidation';
import { SessionDefinitionPreview } from './session/SessionDefinitionPreview';
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

const AI_PROMPT_TEMPLATE = `Output the plan as a single JSON document and nothing else. Follow this contract exactly.

Top level: schema (literal "${EXTERNAL_PLAN_SCHEMA_V6}"), planId (lowercase slug, unchanged between revisions of the same plan), revision (integer, increment when revising), title, startDate (the Monday week 1 begins, YYYY-MM-DD), weekCount, optional notes, required restDays, optional intentBlocks, and sessions.

restDays is a list of deliberate protected-rest directives. It may be empty. Each directive is exactly {"id": "<stable-unique-id>", "week": <1-based-week>, "day": "<lowercase-weekday>"}. Use the same monday/tuesday/wednesday/thursday/friday/saturday/sunday vocabulary as session placement. Do not put absolute dates in restDays: startDate is the plan's only authored absolute date, and the app resolves week/day to a calendar date. Do not use omission to mean protected rest — a date with neither a session nor a restDays directive is intentionally unplanned and may use the app's normal fallback. Never place a fixed session and a restDays directive on the same week/day.

Do not compute calendar dates for sessions. Each session has id, title, priority (key/supporting/optional), and:

- placement: week (1-based), optional preferredDay (lowercase weekday), flexibility (fixed/preferred/any_day), ifMissed (drop/reschedule_within_week/carry_forward).
- gating: modality (cycling/running/strength/field/mobility/cross_training), intensity (recovery/easy/moderate/hard/max), durationMin, durationMax (minutes), environment (indoor/outdoor/either), equipment (subset of free_weights, cable_machine, treadmill, indoor_bike, pullup_bar).
- objectives: zero or more of threshold_quality, surge_repeatability, zone2_aerobic, strength_maintenance, strength_development, race_specific_endurance, vo2_max.
- definition: the executable content — schemaVersion (1), id (same as the session's own id), revision (1), title, optional summary, intent (training/testing/competition/rehab_return/recovery/skill_technical), optional dominantModality (matching gating.modality), optional duration ({min, max} minutes), and blocks. Each block has id, optional title, role (warmup/main/cooldown/accessory/test/recovery), executionMode (sequential/circuit/superset/density/amrap/alternating), and steps. Each step has id, kind ("exercise"), optional title, exerciseRef (prefer {"kind": "catalog", "exerciseId": "<id>"} when matching known movements — e.g. bike_progressive_warmup, bike_easy_spin, bike_threshold_interval, bike_vo2_interval, bike_float_interval, bike_over_under_interval, bike_short_surge, bike_hard_finish, bike_race_simulation, bike_race_opener, bike_cooldown, goblet_squat, front_squat, back_squat, rear_foot_elevated_split_squat, romanian_deadlift, kettlebell_deadlift, hip_thrust, bench_press, push_up, pull_up, dumbbell_row, chest_supported_dumbbell_row, dead_bug, side_plank, plank, copenhagen_plank, seated_soleus_iso, calf_isometric, easy_continuous_run, run_tempo_interval, run_vo2_interval, mobility_flow — or use {"kind": "unresolved_free_text", "name": "..."} for custom movements), dose, optional rest (seconds, or {min, max} for a range), optional notes. dose is one of: {"kind": "repetition", "sets": N, "reps": N or {min,max}}; {"kind": "duration", "sets": N (optional), "seconds": N or {min,max}} — use seconds for anything under two minutes (e.g. 10, 20, 30), never fractional minutes; {"kind": "distance", "sets": N (optional), "meters": N or {min,max}}. Example a 30-second-on/15-second-off interval step, 10 reps per set, 3 sets: {"id": "step-1", "kind": "exercise", "title": "30-second work", "exerciseRef": {"kind": "catalog", "exerciseId": "bike_vo2_interval"}, "dose": {"kind": "duration", "sets": 3, "seconds": 30}, "rest": 15}.
- isEvent: true only on the target event itself (a race, a test event). An event session must also use flexibility: "fixed" with a preferredDay. Do not mark ordinary hard sessions as events.
- scaling: reducible (boolean; set to false when no useful reduced form exists), reducedSummary and reducedDurationMin (advisory display only), minimumUsefulDurationMin, fallback (advisory only), and optional reducedDefinition. reducedDefinition is a complete SessionDefinition with the exact same id, intent and dominantModality as definition; it is the only executable scaled form. Omit it when reducible is false.
- intraday (optional): only for a session that is one member of a same-day training bundle (e.g. an AM ride plus a PM strength session on the same date). {"window": {"startLocal": "HH:mm", "endLocal": "HH:mm"}, "bundleId": "<stable-id-unique-within-the-week>", "order": <0-based integer, unique within the bundle>, optional "afterSessionId": "<earlier session's own id in this bundle>", optional "minimumSeparationMinutes": <number, requires afterSessionId>}. Every session sharing a bundleId in the same week must also share the same placement.week, placement.preferredDay and placement.flexibility. window is the requested interval only — the app resolves it against the athlete's real same-day availability at placement time, so only request a window the athlete has actually told the app about (Training Windows in the app). Do not invent a second session on a day with no evidence the athlete wants to train twice; do not use intraday for two unrelated sessions on different days.

Do not encode travel weeks, illness, or externally imposed time off as restDays — those are handled separately by the app's own calendar. restDays is only for deliberate plan-authored protected rest such as sequencing, taper or deload intent. Plan as if every otherwise scheduled day is available.

Do not encode readiness or autoregulation rules anywhere, including notes. The app adjudicates each session against that morning's data and owns all green/yellow/red decisions. Use notes only for context the app cannot know: which power meter is the reference, whether wattage targets or RPE take precedence, what block preceded this one.

Never include a "systemicCost" or similar calibrated load figure anywhere in definition — the app derives that itself from modality, intensity and duration.

Output as a downloadable JSON file.`;

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
    const [effectiveFrom, setEffectiveFrom] = useState(getLocalDateString);
    const [preflight, setPreflight] = useState<ExternalPlanImportPreflight | null>(null);
    const [preflightAcknowledged, setPreflightAcknowledged] = useState(false);
    const [promptCopied, setPromptCopied] = useState(false);
    const today = getLocalDateString();

    const handleCopyPrompt = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(AI_PROMPT_TEMPLATE);
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
        } catch {
            // Clipboard permission fallback
        }
    }, []);

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
        const result = validateAnyExternalTrainingPlan(parsed.value);
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
        setPhase({
            kind: 'failed',
            message: result.status === 'INVALID'
                ? `Rejected: ${result.issues.map(issue => `${issue.field ?? 'plan'} (${issue.code})`).join(', ')}`
                : `Could not reach storage${errorDetail ? `: ${errorDetail}` : ''}. Nothing was written; try again.`,
        });
    }, [userId, onImported]);

    const previousRevision = usePreviousRevision(userId, phase);
    const previousPlan = previousRevision.plan;

    useEffect(() => {
        if (phase.kind !== 'previewing') {
            setPreflight(null);
            return;
        }
        let current = true;
        setPreflight(null);
        setPreflightAcknowledged(false);
        void preflightExternalPlanImport(userId, phase.plan, effectiveFrom, today, previousPlan)
            .then(result => { if (current) setPreflight(result); })
            .catch(() => { if (current) setPreflight({ status: 'unknown', unavailableSources: ['activation preflight'], findings: [] }); });
        return () => { current = false; };
    }, [effectiveFrom, phase, previousPlan, today, userId]);

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
                            >
                                {promptCopied ? 'Copied prompt to clipboard!' : 'Copy AI prompt template'}
                            </button>
                            <span className="external-import-prompt-hint">
                                Tip: For short intervals (e.g. 10s, 20s, 30s), use <code>{'"dose": {"kind": "duration", "seconds": 20}'}</code> instead of fractional minutes.
                            </span>
                        </div>
                        <pre className="external-import-prompt-text">{AI_PROMPT_TEMPLATE}</pre>
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
    plan, previous, diff, previousRevisionReady = true, onConfirm, onCancel,
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
