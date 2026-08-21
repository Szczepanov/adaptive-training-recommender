import { useEffect, useState } from 'react';
import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';
import {
    HEALTH_ANOMALY_OUTCOME_EXPLANATIONS,
    type HealthAnomalyEpisodeOutcome,
    type HealthAnomalyOutcomeExplanation,
    type HealthAnomalyRespiratoryTestResult,
} from '../engine/healthAnomalyOutcome';
import {
    findRecentHealthAnomalyFollowupCandidate,
    healthAnomalyOutcomeRepository,
    type HealthAnomalyFollowupCandidate,
} from '../services/healthAnomalyOutcomeService';
import { getLocalDateString } from '../utils/localDate';
import './HealthAnomalyFollowupCard.css';

const EXPLANATION_LABELS: Record<HealthAnomalyOutcomeExplanation, string> = {
    illness_symptoms: 'I developed illness symptoms',
    hard_training_recovery: 'Hard training / recovery',
    poor_sleep: 'Poor sleep',
    alcohol: 'Alcohol',
    travel_jetlag: 'Travel / jet lag',
    stress: 'Stress',
    heat_dehydration: 'Heat / dehydration',
    vaccination_medication: 'Vaccination / medication',
    nothing_obvious: 'Nothing obvious',
    other_not_sure: 'Other / not sure',
};

interface HealthAnomalyFollowupFormProps {
    candidate: HealthAnomalyFollowupCandidate;
    existing: HealthAnomalyEpisodeOutcome | null;
    onSave: (input: {
        explanation: HealthAnomalyOutcomeExplanation;
        symptomOnsetDate: string | null;
        testResult: HealthAnomalyRespiratoryTestResult | null;
        testedOn: string | null;
        note: string | null;
    }) => Promise<void>;
}

export function HealthAnomalyFollowupForm({ candidate, existing, onSave }: HealthAnomalyFollowupFormProps) {
    const [explanation, setExplanation] = useState<HealthAnomalyOutcomeExplanation>(existing?.explanation ?? 'nothing_obvious');
    const [symptomOnsetDate, setSymptomOnsetDate] = useState(existing?.symptomOnset?.date ?? '');
    const [testResult, setTestResult] = useState<HealthAnomalyRespiratoryTestResult | ''>(existing?.respiratoryTest?.result ?? '');
    const [testedOn, setTestedOn] = useState(existing?.respiratoryTest?.testedOn ?? getLocalDateString());
    const [note, setNote] = useState(existing?.note ?? '');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState(false);

    const submit = async () => {
        setSaving(true);
        setSaved(false);
        setError(false);
        try {
            await onSave({
                explanation,
                symptomOnsetDate: symptomOnsetDate || null,
                testResult: testResult || null,
                testedOn: testResult ? (testedOn || getLocalDateString()) : null,
                note: note.trim() || null,
            });
            setSaved(true);
        } catch {
            setError(true);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="data-section" data-testid="health-anomaly-followup">
            <h3>Recovery follow-up (shadow)</h3>
            <p className="data-state-notice">
                Evidence only. This answer can be updated later and does not change your recommendation.
            </p>
            <p>Episode day {candidate.episodeDay}. What best explains the unusual recovery signals in retrospect?</p>

            <div className="ha-followup-form">
                <div className="ha-followup-field">
                    <label htmlFor="ha-followup-explanation">Best explanation</label>
                    <select
                        id="ha-followup-explanation"
                        value={explanation}
                        onChange={event => setExplanation(event.target.value as HealthAnomalyOutcomeExplanation)}
                    >
                        {HEALTH_ANOMALY_OUTCOME_EXPLANATIONS.map(value => (
                            <option key={value} value={value}>{EXPLANATION_LABELS[value]}</option>
                        ))}
                    </select>
                </div>

                {(explanation === 'illness_symptoms' || !!existing?.symptomOnset) && (
                    <div className="ha-followup-field">
                        <label htmlFor="ha-followup-onset">Approximate symptom onset date</label>
                        <input
                            id="ha-followup-onset"
                            type="date"
                            value={symptomOnsetDate}
                            onChange={event => setSymptomOnsetDate(event.target.value)}
                        />
                    </div>
                )}

                <div className="ha-followup-field">
                    <label htmlFor="ha-followup-test">Optional respiratory test</label>
                    <select
                        id="ha-followup-test"
                        value={testResult}
                        onChange={event => setTestResult(event.target.value as HealthAnomalyRespiratoryTestResult | '')}
                    >
                        <option value="">No result recorded / unknown</option>
                        <option value="positive">Positive</option>
                        <option value="negative">Negative</option>
                    </select>
                </div>

                {testResult && (
                    <div className="ha-followup-field">
                        <label htmlFor="ha-followup-tested-on">Test date</label>
                        <input
                            id="ha-followup-tested-on"
                            type="date"
                            value={testedOn}
                            onChange={event => setTestedOn(event.target.value)}
                        />
                    </div>
                )}

                <div className="ha-followup-field">
                    <label htmlFor="ha-followup-note">Optional note</label>
                    <textarea
                        id="ha-followup-note"
                        maxLength={2000}
                        value={note}
                        onChange={event => setNote(event.target.value)}
                    />
                </div>

                <div className="ha-followup-actions">
                    <button type="button" onClick={() => void submit()} disabled={saving}>
                        {saving ? 'Saving…' : existing ? 'Update follow-up' : 'Save follow-up'}
                    </button>
                    {saved && <span role="status">Saved.</span>}
                    {error && <span role="alert">Could not save the follow-up.</span>}
                </div>
            </div>
        </div>
    );
}

interface HealthAnomalyFollowupCardProps {
    userId: string;
    date: string;
    currentRevision?: HealthAnomalyAssessmentRevision | null;
}

/**
 * Shadow-era HA6 surface. It intentionally lives on Detailed Data rather than Home: HA7 still
 * owns any visible anomaly/possible-illness alert semantics. This card only collects a later
 * retrospective label for an episode that the shadow evaluator already persisted.
 */
export function HealthAnomalyFollowupCard({ userId, date, currentRevision }: HealthAnomalyFollowupCardProps) {
    const [candidate, setCandidate] = useState<HealthAnomalyFollowupCandidate | null>(null);
    const [existing, setExisting] = useState<HealthAnomalyEpisodeOutcome | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoaded(false);
        findRecentHealthAnomalyFollowupCandidate(userId, date, currentRevision)
            .then(async value => {
                if (cancelled) return;
                setCandidate(value);
                if (!value) {
                    setExisting(null);
                    setLoaded(true);
                    return;
                }
                const outcome = await healthAnomalyOutcomeRepository.get(userId, value.episodeId);
                if (cancelled) return;
                setExisting(outcome);
                setLoaded(true);
            })
            .catch(() => {
                if (!cancelled) {
                    setCandidate(null);
                    setExisting(null);
                    setLoaded(true);
                }
            });
        return () => { cancelled = true; };
    }, [userId, date, currentRevision]);

    if (!loaded || !candidate) return null;

    return (
        <HealthAnomalyFollowupForm
            candidate={candidate}
            existing={existing}
            onSave={async input => {
                const saved = await healthAnomalyOutcomeRepository.save({
                    userId,
                    candidate,
                    explanation: input.explanation,
                    symptomOnset: input.symptomOnsetDate ? { date: input.symptomOnsetDate, precision: 'day' } : null,
                    respiratoryTest: input.testResult && input.testedOn
                        ? { result: input.testResult, testedOn: input.testedOn, source: 'user_reported' }
                        : null,
                    note: input.note,
                });
                setExisting(saved);
            }}
        />
    );
}
