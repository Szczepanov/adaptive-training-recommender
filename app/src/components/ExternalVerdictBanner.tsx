import type { ExternalPrescriptionStep, ExternalSessionVerdictSummary, Recommendation } from '../engine/models';
import './ExternalVerdictBanner.css';

interface ExternalVerdictBannerProps {
    prescription: NonNullable<Recommendation['externalPrescription']>;
    verdict: ExternalSessionVerdictSummary;
}

const DECISION_LABEL: Record<ExternalSessionVerdictSummary['decision'], string> = {
    proceed: 'Do it as written',
    scale: 'Do the reduced version',
    defer: 'Move it to another day',
    skip: 'Not today',
    advisory: 'Your call',
};

/** Plain language for each hard gate, so an excluded session always says which one and why. */
const GATE_EXPLANATION: Record<string, string> = {
    time_limit: 'you have less time available today than this session needs',
    equipment: 'the equipment this session needs is not available to you',
    environment: 'today\'s environment does not match where this session has to happen',
    safety_guardrail: 'one of your safety guardrails excludes this kind of work',
    restricted_modality: 'this type of training is restricted for you today',
    restricted_category: 'this category of session is restricted for you today',
};

function gateSentence(gateFailures: readonly string[]): string | null {
    if (gateFailures.length === 0) return null;
    const explained = gateFailures.map(gate => GATE_EXPLANATION[gate] ?? gate.replaceAll('_', ' '));
    return explained.length === 1
        ? `Excluded because ${explained[0]}.`
        : `Excluded because ${explained.slice(0, -1).join(', ')} and ${explained[explained.length - 1]}.`;
}

function stepTiming(step: ExternalPrescriptionStep): string | null {
    const parts: string[] = [];
    if (step.durationMin !== undefined) parts.push(`${step.durationMin} min`);
    if (step.durationSec !== undefined) parts.push(`${step.durationSec} s`);
    if (step.sets !== undefined && step.sets > 1) parts.push(`${step.sets} sets`);
    if (step.repeat !== undefined && step.repeat > 1) parts.push(`× ${step.repeat}`);
    if (step.recoveryMin !== undefined) parts.push(`${step.recoveryMin} min recovery`);
    if (step.recoverySec !== undefined) parts.push(`${step.recoverySec} s recovery`);
    if (step.setRecoveryMin !== undefined) parts.push(`${step.setRecoveryMin} min between sets`);
    if (step.setRecoverySec !== undefined) parts.push(`${step.setRecoverySec} s between sets`);
    return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Renders the adjudication of an imported session.
 *
 * The decision leads, not the session: a `skip`/`defer` day must never read as "do this".
 * The author's own text is shown verbatim and labelled as theirs, and the free-text
 * fallback is rendered as prose with no action attached to it — ADR-0019 D-CANDIDATE makes
 * it advisory, because it has passed none of today's gates.
 */
export function ExternalVerdictBanner({ prescription, verdict }: ExternalVerdictBannerProps) {
    const actionable = verdict.decision === 'proceed' || verdict.decision === 'scale' || verdict.decision === 'advisory';
    const gate = gateSentence(verdict.gateFailures);
    const steps = prescription.prescription.steps ?? [];

    return (
        <section className={`external-verdict verdict-${verdict.decision}`} aria-label="Imported plan session">
            <header className="external-verdict-header">
                <div>
                    <span className="external-verdict-source">
                        From your plan: {prescription.planId} (revision {prescription.revision})
                        {prescription.isEvent && <span className="external-event-tag">Event</span>}
                    </span>
                    <h4 className="external-verdict-title">{prescription.title}</h4>
                </div>
                <span className={`external-verdict-badge decision-${verdict.decision}`}>
                    {DECISION_LABEL[verdict.decision]}
                </span>
            </header>

            <p className="external-verdict-rationale">{verdict.rationale}</p>
            {gate && <p className="external-verdict-gate">{gate}</p>}

            {actionable ? (
                <div className="external-prescription">
                    <h5>{verdict.decision === 'scale' && verdict.scaledSummary ? 'Reduced version, as your plan wrote it' : 'As your plan wrote it'}</h5>
                    <p className="external-prescription-summary">
                        {verdict.decision === 'scale' && verdict.scaledSummary
                            ? verdict.scaledSummary
                            : prescription.prescription.summary}
                    </p>
                    {steps.length > 0 && (
                        <ol className="external-prescription-steps">
                            {steps.map((step, index) => (
                                <li key={`${step.name}-${index}`}>
                                    <span className="step-name">{step.name}</span>
                                    {step.target && <span className="step-target">{step.target}</span>}
                                    {stepTiming(step) && <span className="step-timing">{stepTiming(step)}</span>}
                                    {step.notes && <span className="step-notes">{step.notes}</span>}
                                </li>
                            ))}
                        </ol>
                    )}
                    {verdict.executionDose && verdict.executionDose.volume < 1 && (
                        <p className="external-prescription-dose">
                            Today&apos;s ceiling puts this at {Math.round(verdict.executionDose.volume * 100)}% of the written volume.
                        </p>
                    )}
                </div>
            ) : (
                <p className="external-not-actionable">
                    Nothing from this session is prescribed today. It stays in your plan — use the week view to move or drop it.
                </p>
            )}

            {verdict.fallbackSuggestion && (
                <aside className="external-fallback" aria-label="Your plan author's note">
                    <h5>Your plan&apos;s note on what to do instead</h5>
                    <p>{verdict.fallbackSuggestion}</p>
                    <p className="external-fallback-caveat">
                        This is your author&apos;s text, shown for context. It has <strong>not</strong> been checked
                        against today&apos;s readiness, equipment or safety constraints, so it is not a session this
                        app is recommending.
                    </p>
                </aside>
            )}
        </section>
    );
}
