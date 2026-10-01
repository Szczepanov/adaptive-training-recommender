import { describeEligibilityReasons } from '../engine/eligibility';
import type { ExternalSessionVerdictSummary, Recommendation } from '../engine/models';
import { stepTiming } from './externalPrescriptionUtils';
import './ExternalVerdictBanner.css';

interface ExternalVerdictBannerProps {
    prescription: NonNullable<Recommendation['externalPrescription']>;
    verdict: ExternalSessionVerdictSummary;
    /** #949: whether the card offers Start for the plan's exact v6 `reducedDefinition`.
     * Only meaningful under a `scale` verdict. */
    reducedLaunch?: ReducedLaunchState;
}

/** `available`: Home froze a binding to the exact reduced form and the card offers Start.
 * `adjusted`: a time or load adjustment is applied, so the exact form is not what is shown.
 * `unavailable`: no reduced form exists, or it could not be prepared for today. */
export type ReducedLaunchState = 'available' | 'adjusted' | 'unavailable';

const DECISION_LABEL: Record<ExternalSessionVerdictSummary['decision'], string> = {
    proceed: 'Do it as written',
    scale: 'Do the reduced version',
    defer: 'Move it to another day',
    skip: 'Not today',
    advisory: 'Your call',
};

/** The engine's own wording for each gate, so the banner and the persisted rationale cannot
 * explain the same exclusion two different ways. */
function gateSentence(gateFailures: readonly string[]): string | null {
    if (gateFailures.length === 0) return null;
    return `Excluded because ${describeEligibilityReasons(gateFailures)}.`;
}

/**
 * Renders the adjudication of an imported session.
 *
 * The decision leads, not the session: a `skip`/`defer` day must never read as "do this".
 * The author's own text is shown verbatim and labelled as theirs, and the free-text
 * fallback is rendered as prose with no action attached to it — ADR-0019 D-CANDIDATE makes
 * it advisory, because it has passed none of today's gates.
 */
/** The scale-only note on what Start will run, so the banner never contradicts the card's
 * launch affordance: present only when the card offers Start for the reduced form. */
function scaleLaunchNote(prescription: ExternalVerdictBannerProps['prescription'], reducedLaunch: ReducedLaunchState): string {
    if (reducedLaunch === 'available') {
        return 'Start runs your plan’s own reduced version exactly as written, never the original full-dose steps.';
    }
    const scaling = prescription.scaling as { reducedDefinition?: unknown } | undefined;
    if (reducedLaunch === 'adjusted' && scaling?.reducedDefinition) {
        return 'Start is unavailable while a time or load adjustment is applied: the app runs only your plan’s own reduced version exactly as written. Reset the adjustment to start it.';
    }
    return scaling?.reducedDefinition
        ? 'Start is unavailable because your plan’s reduced version could not be prepared for today. The app will not launch the original full-dose steps under a reduced verdict.'
        : 'Start is unavailable for this reduced form because the imported plan does not include executable reduced steps. The app will not launch the original full-dose steps under a reduced verdict.';
}

export function ExternalVerdictBanner({ prescription, verdict, reducedLaunch = 'unavailable' }: ExternalVerdictBannerProps) {
    const actionable = verdict.decision === 'proceed' || verdict.decision === 'scale' || verdict.decision === 'advisory';
    // `skip` and `advisory` rationales already name the gates in the same words, and the
    // rationale is what the athlete reads twice (here and under "Why this today?"). Repeating
    // it a third time in the same card is noise, not emphasis.
    const gate = verdict.decision === 'skip' || verdict.decision === 'advisory'
        ? null
        : gateSentence(verdict.gateFailures);
    const steps = prescription.prescription.steps ?? [];
    const scalePercent = verdict.decision === 'scale' && verdict.executionDose
        ? Math.round(verdict.executionDose.volume * 100)
        : null;
    const displayedSummary = verdict.decision === 'scale'
        ? verdict.scaledSummary
            ?? (scalePercent !== null
                ? `Keep the session intent, but cap total volume at ${scalePercent}% of the written dose.`
                : 'Keep the session intent, but use only the reduced volume cleared for today.')
        : prescription.prescription.summary;
    const showAuthoredSteps = verdict.decision !== 'scale' && steps.length > 0;

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
                    <h5>{verdict.decision === 'scale' && verdict.scaledSummary ? 'Reduced version, as your plan wrote it' : verdict.decision === 'scale' ? 'Reduced volume for today' : 'As your plan wrote it'}</h5>
                    <p className="external-prescription-summary">{displayedSummary}</p>
                    {showAuthoredSteps && (
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
                    {verdict.decision === 'scale' && (
                        <p className="external-prescription-dose">{scaleLaunchNote(prescription, reducedLaunch)}</p>
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
