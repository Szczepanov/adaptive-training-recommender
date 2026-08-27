import { useEffect, useRef, useState } from 'react';
import type { AutomaticIdentityAssessment, IdentityReviewEvent } from '../observations/identityModels';
import type { EffectiveBundleIdentityProjection } from '../engine/identityEligibility';
import {
    identityReviewCopyVariant,
    identityReviewEventFields,
    selectMostRecentSuspiciousNightForReview,
    type IdentityReviewButtonChoice,
} from '../engine/identityReviewUi';
import { identityPersistenceService } from '../services/identityPersistence';
import { addDaysToLocalDateString } from '../utils/localDate';
import './IdentityReviewCard.css';

const COPY: Record<
    ReturnType<typeof identityReviewCopyVariant>,
    (sourceNightKey: string) => { title: string; body: string }
> = {
    // The lookback window can surface a candidate from up to a week ago (IdentityReviewCard's
    // `lookbackDays`), so the copy must never say "tonight" -- naming the actual night avoids
    // an athlete answering about the wrong sleep period.
    ANCHOR_MISSING: (sourceNightKey) => ({
        title: 'Eight Sleep data not verified',
        body:
            `We couldn't find a Garmin record to confirm your Eight Sleep measurements from ${sourceNightKey} ` +
            'were yours, so they were not used for recovery or baseline learning.',
    }),
    ANCHOR_QUALITY_INSUFFICIENT: (sourceNightKey) => ({
        title: 'Eight Sleep data not verified',
        body:
            `The Garmin record for ${sourceNightKey} wasn't complete enough to confirm the Eight Sleep ` +
            'measurements were yours, so they were not used for recovery or baseline learning.',
    }),
    DEFAULT: (sourceNightKey) => ({
        title: 'Eight Sleep data not verified',
        body:
            `Your Eight Sleep measurements from ${sourceNightKey} did not agree strongly enough with your ` +
            'independently worn Garmin record. They were not used for recovery or baseline learning.',
    }),
};

const REASON_CODE_EXPLANATIONS: Partial<Record<string, string>> = {
    SESSION_TIMING_DISCORDANT: 'sleep interval differed from Garmin',
    RHR_RELATION_DISCORDANT: 'resting-heart-rate relationship differed from your usual paired pattern',
    RESPIRATION_RELATION_DISCORDANT: 'respiration-rate relationship differed from your usual paired pattern',
    HRV_RELATION_DISCORDANT: 'HRV relationship differed from your usual paired pattern',
    MIXED_OCCUPANCY_SUSPECTED: 'the tracked interval looked longer than a single occupant’s night',
    ANCHOR_MISSING: 'no Garmin record was available to compare against',
    ANCHOR_QUALITY_INSUFFICIENT: 'the Garmin record was not complete enough to compare against',
};

interface IdentityReviewFormProps {
    assessment: AutomaticIdentityAssessment;
    existingReviewLabel: IdentityReviewEvent['label'] | null;
    onSubmit: (choice: IdentityReviewButtonChoice) => Promise<void>;
}

/**
 * Presentational PI7 review form: reason-code-driven copy, four review buttons, progressive
 * disclosure of the underlying reason codes in user language. Pure props-in/callback-out so it
 * renders without Firestore for the component test; {@link IdentityReviewCard} wires it up.
 */
export function IdentityReviewForm({ assessment, existingReviewLabel, onSubmit }: IdentityReviewFormProps) {
    const [submitting, setSubmitting] = useState<IdentityReviewButtonChoice | null>(null);
    const [error, setError] = useState(false);
    const copy = COPY[identityReviewCopyVariant(assessment.reasonCodes)](assessment.sourceNightKey);

    const submit = async (choice: IdentityReviewButtonChoice) => {
        setSubmitting(choice);
        setError(false);
        try {
            await onSubmit(choice);
        } catch {
            setError(true);
        } finally {
            setSubmitting(null);
        }
    };

    const explanations = assessment.reasonCodes
        .map((code) => REASON_CODE_EXPLANATIONS[code])
        .filter((text): text is string => !!text);

    return (
        <div className="data-section" data-testid="identity-review-card">
            <h3>{copy.title}</h3>
            <p className="data-state-notice">{copy.body}</p>
            <p>Were these measurements yours for the full tracked sleep period?</p>

            <div className="identity-review-actions">
                <button type="button" onClick={() => void submit('ONLY_ME')} disabled={submitting !== null}>
                    {submitting === 'ONLY_ME' ? 'Saving…' : 'Only me'}
                </button>
                <button type="button" onClick={() => void submit('SHARED_MIXED')} disabled={submitting !== null}>
                    {submitting === 'SHARED_MIXED' ? 'Saving…' : 'Shared / mixed'}
                </button>
                <button type="button" onClick={() => void submit('NOT_ME')} disabled={submitting !== null}>
                    {submitting === 'NOT_ME' ? 'Saving…' : 'Not me'}
                </button>
                <button type="button" onClick={() => void submit('UNSURE')} disabled={submitting !== null}>
                    {submitting === 'UNSURE' ? 'Saving…' : 'Unsure'}
                </button>
            </div>
            {error && <p role="alert">Could not save your answer. Please try again.</p>}

            {existingReviewLabel && (
                <p className="data-state-notice">
                    You previously told us: {existingReviewLabel === 'USER' ? 'Only me' : existingReviewLabel === 'NOT_USER' ? 'Not me' : 'Unsure / shared'}.
                    Choosing a different answer above replaces it.
                </p>
            )}

            {explanations.length > 0 && (
                <details className="identity-review-why">
                    <summary>Why?</summary>
                    <ul>
                        {explanations.map((text) => (
                            <li key={text}>{text}</li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}

interface IdentityReviewCardProps {
    userId: string;
    date: string;
    lookbackDays?: number;
}

/**
 * PI7 data-wired suspicious-night review surface. Looks back over a small window of recent
 * assessments for the most recent night whose automatic evaluator abstained for a reason the
 * user can actually confirm or deny, and lets them submit a review event. Query-scope changes
 * invalidate the active assessment immediately so an older in-flight write cannot update the
 * local state for a newly selected night.
 */
export function IdentityReviewCard({ userId, date, lookbackDays = 7 }: IdentityReviewCardProps) {
    const [candidate, setCandidate] = useState<EffectiveBundleIdentityProjection | null>(null);
    const [existingReviewLabel, setExistingReviewLabel] = useState<IdentityReviewEvent['label'] | null>(null);
    const [lastReviewEventId, setLastReviewEventId] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    // Tracks which assessment the currently-displayed form belongs to, so a review submission
    // that is still in flight when the user navigates to a different night (re-running the effect
    // below) cannot land its setExistingReviewLabel/setLastReviewEventId against the wrong night.
    const activeAssessmentIdRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Invalidate the previous query scope before starting the async read. Without this, an
        // older submit that resolves during the new fetch window can still see the previous
        // assessment id as active and briefly write its label/event id into the new scope.
        activeAssessmentIdRef.current = null;
        setLoaded(false);
        setCandidate(null);
        setExistingReviewLabel(null);
        setLastReviewEventId(null);
        const startNightKey = addDaysToLocalDateString(date, -lookbackDays);
        identityPersistenceService
            .getEffectiveProjectionsInRange(userId, startNightKey, date)
            .then((projections) => {
                if (cancelled) return;
                const selected = selectMostRecentSuspiciousNightForReview(projections);
                setCandidate(selected);
                activeAssessmentIdRef.current = selected?.assessment.id ?? null;
                const priorReview = selected?.decision.authority === 'MANUAL_REVIEW' ? selected.decision : null;
                setExistingReviewLabel(priorReview?.effectiveStatus ?? null);
                setLastReviewEventId(priorReview?.reviewEventId ?? null);
                setLoaded(true);
            })
            .catch(() => {
                if (!cancelled) {
                    activeAssessmentIdRef.current = null;
                    setCandidate(null);
                    setExistingReviewLabel(null);
                    setLastReviewEventId(null);
                    setLoaded(true);
                }
            });
        return () => {
            cancelled = true;
            activeAssessmentIdRef.current = null;
        };
    }, [userId, date, lookbackDays]);

    if (!loaded || !candidate) return null;

    return (
        <div className="data-view-container">
            <IdentityReviewForm
                assessment={candidate.assessment}
                existingReviewLabel={existingReviewLabel}
                onSubmit={async (choice) => {
                    const submittedAssessmentId = candidate.assessment.id;
                    const fields = identityReviewEventFields(choice);
                    const eventId = `${submittedAssessmentId}:${crypto.randomUUID()}`;
                    await identityPersistenceService.submitUserReview({
                        userId,
                        id: eventId,
                        assessmentId: submittedAssessmentId,
                        label: fields.label,
                        occupancyAttestation: fields.occupancyAttestation,
                        supersedesReviewEventId: lastReviewEventId,
                    });
                    // The user may have navigated to a different night while this write was in
                    // flight; only apply the result if this form's night is still the active one.
                    if (activeAssessmentIdRef.current !== submittedAssessmentId) return;
                    setExistingReviewLabel(fields.label);
                    setLastReviewEventId(eventId);
                }}
            />
        </div>
    );
}
