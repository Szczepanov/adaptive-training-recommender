import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import {
    buildHealthAnomalyEpisodeOutcome,
    parseHealthAnomalyEpisodeOutcome,
    type HealthAnomalyEpisodeOutcome,
    type HealthAnomalyOutcomeExplanation,
    type HealthAnomalyRespiratoryTestLabel,
    type HealthAnomalySymptomOnsetLabel,
} from '../engine/healthAnomalyOutcome';
import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';
import { addDaysToLocalDateString } from '../utils/localDate';
import { healthAnomalyAssessmentRepository } from './healthAnomalyPersistence';

export interface HealthAnomalyFollowupCandidate {
    episodeId: string;
    sourceAssessment: {
        date: string;
        revisionId: string;
    };
    episodeDay: number;
}

/**
 * Turn an assessment revision into a follow-up candidate, if the revision is actually eligible.
 *
 * Only a revision with a live episode qualifies. By default the first day of a new episode is
 * excluded (`allowFirstEpisodeDay = false`) so today's own screen never prompts immediately;
 * {@link findRecentHealthAnomalyFollowupCandidate} passes `true` for prior-day lookback, where a
 * one-day episode is only ever seen in retrospect.
 */
export function followupCandidateFromRevision(
    revision: HealthAnomalyAssessmentRevision | null | undefined,
    allowFirstEpisodeDay = false,
): HealthAnomalyFollowupCandidate | null {
    const episodeId = revision?.assessment.episodeId;
    const episodeDay = revision?.assessment.episodeDay;
    if (!revision || !episodeId || !episodeDay) return null;
    if (!allowFirstEpisodeDay && episodeDay < 2) return null;
    return {
        episodeId,
        sourceAssessment: { date: revision.date, revisionId: revision.revisionId },
        episodeDay,
    };
}

/**
 * Find a recent episode only when the user opens the shadow evidence surface.
 *
 * Today's first anomaly day is deliberately not a prompt: HA6 says ask later. A continuing
 * episode becomes eligible from day 2. A one-day episode becomes eligible on a later day via
 * the bounded prior-day lookback, without future data entering the original assessment.
 */
export async function findRecentHealthAnomalyFollowupCandidate(
    userId: string,
    throughDate: string,
    currentRevision?: HealthAnomalyAssessmentRevision | null,
    lookbackDays = 3,
): Promise<HealthAnomalyFollowupCandidate | null> {
    const current = currentRevision?.date === throughDate
        ? followupCandidateFromRevision(currentRevision, false)
        : null;
    if (current) return current;

    for (let offset = 1; offset <= lookbackDays; offset += 1) {
        const date = addDaysToLocalDateString(throughDate, -offset);
        const revision = await healthAnomalyAssessmentRepository.getLatestForDate(userId, date);
        const candidate = followupCandidateFromRevision(revision, true);
        if (candidate) return candidate;
    }
    return null;
}

/** Firestore-backed reader/writer for `users/{userId}/health_anomaly_outcomes/{episodeId}`. */
export class HealthAnomalyOutcomeRepository {
    /** Load and validate the existing outcome for an episode, or `null` if none was saved yet. */
    async get(userId: string, episodeId: string): Promise<HealthAnomalyEpisodeOutcome | null> {
        const snapshot = await getDoc(doc(getDb(), 'users', userId, 'health_anomaly_outcomes', episodeId));
        if (!snapshot.exists()) return null;
        return parseHealthAnomalyEpisodeOutcome(snapshot.data(), userId, episodeId);
    }

    /**
     * Transactionally create or update the outcome for `input.candidate.episodeId`, preserving
     * the original `sourceAssessment` and `createdAt` on an update regardless of which later
     * revision opened the edit form.
     */
    async save(input: {
        userId: string;
        candidate: HealthAnomalyFollowupCandidate;
        explanation: HealthAnomalyOutcomeExplanation;
        symptomOnset?: HealthAnomalySymptomOnsetLabel | null;
        respiratoryTest?: HealthAnomalyRespiratoryTestLabel | null;
        note?: string | null;
        now?: string;
    }): Promise<HealthAnomalyEpisodeOutcome> {
        const ref = doc(getDb(), 'users', input.userId, 'health_anomaly_outcomes', input.candidate.episodeId);
        return runTransaction(getDb(), async transaction => {
            const snapshot = await transaction.get(ref);
            const existing = snapshot.exists()
                ? parseHealthAnomalyEpisodeOutcome(snapshot.data(), input.userId, input.candidate.episodeId)
                : null;
            const outcome = buildHealthAnomalyEpisodeOutcome({
                userId: input.userId,
                episodeId: input.candidate.episodeId,
                // Once the episode has a label, keep its original assessment reference even
                // if a later episode day is the revision that opened the edit form.
                sourceAssessment: existing?.sourceAssessment ?? input.candidate.sourceAssessment,
                explanation: input.explanation,
                symptomOnset: input.symptomOnset ?? null,
                respiratoryTest: input.respiratoryTest ?? null,
                note: input.note ?? null,
                now: input.now ?? new Date().toISOString(),
                existing,
            });
            transaction.set(ref, outcome);
            return outcome;
        });
    }
}

export const healthAnomalyOutcomeRepository = new HealthAnomalyOutcomeRepository();
