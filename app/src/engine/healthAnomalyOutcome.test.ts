import { describe, expect, it } from 'vitest';
import {
    buildHealthAnomalyEpisodeOutcome,
    parseHealthAnomalyEpisodeOutcome,
    type HealthAnomalyEpisodeOutcome,
} from './healthAnomalyOutcome';

const sourceAssessment = { date: '2026-08-20', revisionId: 'ha-1234567890abcdef' };

function existing(): HealthAnomalyEpisodeOutcome {
    return buildHealthAnomalyEpisodeOutcome({
        userId: 'u1',
        episodeId: 'health-anomaly:2026-08-20',
        sourceAssessment,
        explanation: 'nothing_obvious',
        now: '2026-08-21T06:00:00.000Z',
    });
}

describe('HealthAnomalyEpisodeOutcome (HA6)', () => {
    it('treats an absent respiratory test as unknown rather than negative', () => {
        const result = existing();
        expect(result.respiratoryTest).toBeNull();
    });

    it('allows the explanation to evolve without rewriting immutable episode/source identity', () => {
        const prior = existing();
        const updated = buildHealthAnomalyEpisodeOutcome({
            userId: prior.userId,
            episodeId: prior.episodeId,
            sourceAssessment: prior.sourceAssessment,
            explanation: 'illness_symptoms',
            symptomOnset: { date: '2026-08-21', precision: 'day' },
            respiratoryTest: { result: 'positive', testedOn: '2026-08-21', source: 'user_reported' },
            note: 'Symptoms appeared after waking.',
            now: '2026-08-21T18:00:00.000Z',
            existing: prior,
        });

        expect(updated.createdAt).toBe(prior.createdAt);
        expect(updated.updatedAt).not.toBe(prior.updatedAt);
        expect(updated.sourceAssessment).toEqual(prior.sourceAssessment);
        expect(updated.explanation).toBe('illness_symptoms');
        expect(updated.symptomOnset?.date).toBe('2026-08-21');
        expect(updated.respiratoryTest?.result).toBe('positive');
    });

    it('rejects an attempted source reassignment during an update', () => {
        const prior = existing();
        expect(() => buildHealthAnomalyEpisodeOutcome({
            userId: prior.userId,
            episodeId: prior.episodeId,
            sourceAssessment: { ...prior.sourceAssessment, date: '2026-08-19' },
            explanation: 'poor_sleep',
            now: '2026-08-21T18:00:00.000Z',
            existing: prior,
        })).toThrow(/immutable identity/i);
    });

    it('rejects malformed dates, enums and path-unsafe episode ids', () => {
        const base = existing();
        expect(() => parseHealthAnomalyEpisodeOutcome({ ...base, episodeId: 'bad/id' })).toThrow(/episodeId/);
        expect(() => parseHealthAnomalyEpisodeOutcome({ ...base, explanation: 'diagnosed_flu' })).toThrow(/explanation/);
        expect(() => parseHealthAnomalyEpisodeOutcome({
            ...base,
            symptomOnset: { date: '2026-02-31', precision: 'day' },
        })).toThrow(/onset/);
        expect(() => parseHealthAnomalyEpisodeOutcome({
            ...base,
            respiratoryTest: { result: 'unknown', testedOn: '2026-08-21', source: 'user_reported' },
        })).toThrow(/respiratory test/);
    });

    it('bounds free text and trims an empty note to null', () => {
        const empty = buildHealthAnomalyEpisodeOutcome({
            userId: 'u1', episodeId: 'episode-1', sourceAssessment,
            explanation: 'other_not_sure', note: '   ', now: '2026-08-21T06:00:00.000Z',
        });
        expect(empty.note).toBeNull();
        expect(() => parseHealthAnomalyEpisodeOutcome({ ...empty, note: 'x'.repeat(2001) })).toThrow(/note/);
    });
});
