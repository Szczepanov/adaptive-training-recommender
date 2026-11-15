import { describe, expect, it } from 'vitest';
import {
    buildHealthAnomalyEpisodeOutcome,
    parseHealthAnomalyEpisodeOutcome,
    summarizePersonalOutcomeCalibration,
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

    it('accepts the allergy_or_hay_fever explanation', () => {
        const result = buildHealthAnomalyEpisodeOutcome({
            userId: 'u1',
            episodeId: 'health-anomaly:2026-08-20',
            sourceAssessment,
            explanation: 'allergy_or_hay_fever',
            now: '2026-08-21T06:00:00.000Z',
        });
        expect(result.explanation).toBe('allergy_or_hay_fever');
        expect(() => parseHealthAnomalyEpisodeOutcome(result)).not.toThrow();
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

describe('summarizePersonalOutcomeCalibration (causal guard)', () => {
    function makeOutcome(
        episodeId: string,
        sourceDate: string,
        updatedAt: string,
        explanation: HealthAnomalyEpisodeOutcome['explanation'],
        extra: {
            symptomOnsetDate?: string;
            respiratoryTest?: HealthAnomalyEpisodeOutcome['respiratoryTest'];
        } = {},
    ): HealthAnomalyEpisodeOutcome {
        return buildHealthAnomalyEpisodeOutcome({
            userId: 'u1',
            episodeId,
            sourceAssessment: { date: sourceDate, revisionId: 'ha-1234567890abcdef' },
            explanation,
            symptomOnset: extra.symptomOnsetDate
                ? { date: extra.symptomOnsetDate, precision: 'day' }
                : null,
            respiratoryTest: extra.respiratoryTest ?? null,
            now: updatedAt,
        });
    }

    it('returns zeroed ineligible summary for empty list or invalid asOfDate', () => {
        expect(summarizePersonalOutcomeCalibration([], '2026-08-25')).toEqual({
            asOfDate: '2026-08-25',
            priorEpisodesCount: 0,
            illnessConfirmedCount: 0,
            confounderExplainedCount: 0,
            noIllnessCount: 0,
            unknownCount: 0,
            positiveRespiratoryTestsCount: 0,
            negativeRespiratoryTestsCount: 0,
            medianLeadTimeDays: null,
            calibrationEligible: false,
        });
        expect(summarizePersonalOutcomeCalibration([existing()], '2026-02-31').calibrationEligible).toBe(false);
    });

    it('enforces strict < asOfDate causality across sourceAssessment, updatedAt, symptomOnset, and test date', () => {
        const outcomes = [
            // Excluded: sourceAssessment.date === asOfDate
            makeOutcome('ep-same-day', '2026-08-25', '2026-08-25T10:00:00.000Z', 'illness_symptoms'),
            // Excluded: retro-labeled on or after asOfDate
            makeOutcome('ep-future-update', '2026-08-18', '2026-08-25T00:01:00.000Z', 'illness_symptoms'),
            // Excluded: symptom onset on asOfDate
            makeOutcome('ep-future-onset', '2026-08-19', '2026-08-24T08:00:00.000Z', 'illness_symptoms', {
                symptomOnsetDate: '2026-08-25',
            }),
            // Excluded: test date on asOfDate
            makeOutcome('ep-future-test', '2026-08-20', '2026-08-24T08:00:00.000Z', 'nothing_obvious', {
                respiratoryTest: { result: 'positive', testedOn: '2026-08-25', source: 'user_reported' },
            }),
            // Included: strictly prior
            makeOutcome('ep-valid', '2026-08-10', '2026-08-12T08:00:00.000Z', 'illness_symptoms', {
                symptomOnsetDate: '2026-08-12',
            }),
        ];

        const summary = summarizePersonalOutcomeCalibration(outcomes, '2026-08-25');
        expect(summary.priorEpisodesCount).toBe(1);
        expect(summary.illnessConfirmedCount).toBe(1);
        expect(summary.medianLeadTimeDays).toBe(2);
        expect(summary.calibrationEligible).toBe(false);
    });

    it('deduplicates by episodeId, classifies outcomes accurately, and unlocks calibrationEligible at 3 resolved episodes', () => {
        const ep1Initial = makeOutcome('ep-1', '2026-08-01', '2026-08-02T07:00:00.000Z', 'nothing_obvious');
        const ep1Updated = buildHealthAnomalyEpisodeOutcome({
            userId: 'u1',
            episodeId: 'ep-1',
            sourceAssessment: ep1Initial.sourceAssessment,
            explanation: 'illness_symptoms',
            symptomOnset: { date: '2026-08-02', precision: 'day' },
            respiratoryTest: { result: 'positive', testedOn: '2026-08-03', source: 'user_reported' },
            now: '2026-08-03T12:00:00.000Z',
            existing: ep1Initial,
        });
        const ep2 = makeOutcome('ep-2', '2026-08-08', '2026-08-09T09:00:00.000Z', 'hard_training_recovery');
        const ep3Unknown = makeOutcome('ep-3', '2026-08-12', '2026-08-13T09:00:00.000Z', 'other_not_sure');
        const ep4NoIllness = makeOutcome('ep-4', '2026-08-16', '2026-08-18T09:00:00.000Z', 'nothing_obvious', {
            respiratoryTest: { result: 'negative', testedOn: '2026-08-17', source: 'user_reported' },
        });

        // With 2 resolved + 1 unknown -> calibrationEligible false
        const partial = summarizePersonalOutcomeCalibration([ep1Initial, ep1Updated, ep2, ep3Unknown], '2026-08-25');
        expect(partial.priorEpisodesCount).toBe(3);
        expect(partial.unknownCount).toBe(1);
        expect(partial.calibrationEligible).toBe(false);

        // With 3 resolved + 1 unknown -> calibrationEligible true
        const eligible = summarizePersonalOutcomeCalibration(
            [ep1Initial, ep1Updated, ep2, ep3Unknown, ep4NoIllness],
            '2026-08-25',
        );
        expect(eligible).toEqual({
            asOfDate: '2026-08-25',
            priorEpisodesCount: 4,
            illnessConfirmedCount: 1,
            confounderExplainedCount: 1,
            noIllnessCount: 1,
            unknownCount: 1,
            positiveRespiratoryTestsCount: 1,
            negativeRespiratoryTestsCount: 1,
            medianLeadTimeDays: 1,
            calibrationEligible: true,
        });
    });

    it('uses Europe/Warsaw calendar dates rather than UTC prefixes for updatedAt causal filtering', () => {
        // 2026-08-24T23:30:00.000Z is 2026-08-25T01:30:00+02:00 in Europe/Warsaw -> excluded for asOfDate 2026-08-25
        const warsawSameDayAfterUtcMidnight = makeOutcome(
            'ep-utc-midnight',
            '2026-08-20',
            '2026-08-24T23:30:00.000Z',
            'illness_symptoms',
        );
        // 2026-08-24T21:30:00.000Z is 2026-08-24T23:30:00+02:00 in Europe/Warsaw -> strictly prior to 2026-08-25
        const warsawPriorDay = makeOutcome(
            'ep-prior-warsaw',
            '2026-08-18',
            '2026-08-24T21:30:00.000Z',
            'hard_training_recovery',
        );

        const summary = summarizePersonalOutcomeCalibration(
            [warsawSameDayAfterUtcMidnight, warsawPriorDay],
            '2026-08-25',
        );
        expect(summary.priorEpisodesCount).toBe(1);
        expect(summary.confounderExplainedCount).toBe(1);
        expect(summary.illnessConfirmedCount).toBe(0);
    });
});
