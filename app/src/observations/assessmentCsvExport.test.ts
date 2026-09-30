import { describe, expect, it } from 'vitest';
import {
    ASSESSMENT_CSV_HEADERS,
    buildAssessmentHistoryCsv,
} from './assessmentCsvExport';
import { buildAssessmentHistory } from './assessmentHistory';
import type {
    AssessmentAttempt,
    MetricObservationHead,
    MetricObservationRevision,
} from './models';
import {
    STANDING_BROAD_JUMP_PROTOCOL,
} from './physicalCapitalProtocols';

function makeAttempt(
    id: string,
    protocolId: string,
    revision: number,
    purpose: AssessmentAttempt['purpose'],
    completedAt: string,
): AssessmentAttempt {
    return {
        id,
        protocolRef: { id: protocolId, revision },
        scheduledDate: completedAt.slice(0, 10),
        state: 'completed',
        purpose,
        completedAt,
    };
}

function makeObs(
    attempt: AssessmentAttempt,
    metricId: string,
    value: number,
    seriesKey: string,
    observedAt: string,
    validity: MetricObservationRevision['validity'] = 'valid',
    device?: { provider: string; model?: string },
): { head: MetricObservationHead; revision: MetricObservationRevision } {
    const observationKey = `${attempt.id}:${metricId}`;
    return {
        head: {
            observationKey,
            assessmentAttemptId: attempt.id,
            metricId,
            headRevision: 1,
            createdAt: observedAt,
            updatedAt: observedAt,
        },
        revision: {
            observationKey,
            revision: 1,
            metricId,
            value,
            unit: 'cm',
            observedAt,
            source: 'derived',
            protocolRef: attempt.protocolRef,
            comparisonSeriesKey: seriesKey,
            comparisonCanonicalizationVersion: 'ov-series-v1',
            assessmentAttemptId: attempt.id,
            validity,
            context: {},
            createdAt: observedAt,
            device,
        },
    };
}

describe('assessmentCsvExport', () => {
    it('generates exact header matching WP7.1 specification', () => {
        const expected = [
            'observed_at',
            'local_date',
            'attempt_id',
            'purpose',
            'protocol_id',
            'protocol_revision',
            'metric_id',
            'display_name',
            'value',
            'unit',
            'validity',
            'comparison_series_key',
            'baseline_value',
            'absolute_change',
            'percent_change',
            'progress_status',
            'device_provider',
            'device_model',
            'body_mass_kg',
            'body_mass_source',
            'body_mass_reference',
            'body_mass_date',
            'relative_value',
            'relative_unit',
        ];
        expect(ASSESSMENT_CSV_HEADERS).toEqual(expected);
    });

    it('emits deterministic ordering and correctly populates baseline vs post-baseline rows', () => {
        const att1 = makeAttempt('att-1', STANDING_BROAD_JUMP_PROTOCOL.id, 2, 'baseline', '2026-10-20T10:00:00Z');
        const att2 = makeAttempt('att-2', STANDING_BROAD_JUMP_PROTOCOL.id, 2, 'checkpoint', '2026-10-25T10:00:00Z');

        const obs1 = makeObs(att1, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-20T10:00:00Z', 'valid', { provider: 'Custom, Ruler' });
        const obs2 = makeObs(att2, 'standing_broad_jump_distance_cm', 241.5, 'series-1', '2026-10-25T10:00:00Z', 'valid', { provider: 'Tape "Pro"' });

        const history = buildAssessmentHistory({
            attempts: [att2, att1], // passed reversed
            observations: [obs2, obs1],
        });

        const csv = buildAssessmentHistoryCsv(history);
        const lines = csv.split('\n');

        expect(lines[0]).toBe(ASSESSMENT_CSV_HEADERS.join(','));
        // 2 data lines for broad jump
        expect(lines).toHaveLength(3);

        // Row 1: baseline (att-1)
        expect(lines[1]).toContain('att-1');
        expect(lines[1]).toContain('baseline');
        expect(lines[1]).toContain('"Custom, Ruler"'); // Quoted comma
        expect(lines[1]).toContain('230'); // value and baseline_value

        // Row 2: checkpoint (att-2)
        expect(lines[2]).toContain('att-2');
        expect(lines[2]).toContain('checkpoint');
        expect(lines[2]).toContain('"Tape ""Pro"""'); // Quoted and escaped quotes
        expect(lines[2]).toContain('241.5');
        expect(lines[2]).toContain('11.5'); // absolute change
        expect(lines[2]).toContain('5'); // percent change
        expect(lines[2]).toContain('insufficient_evidence');
    });

    it('correctly uses Warsaw local_date across UTC-midnight boundary (I2)', () => {
        // 2026-10-20 23:30:00 UTC is 2026-10-21 01:30:00 in Europe/Warsaw (CEST, UTC+2)
        const att = makeAttempt('att-late', STANDING_BROAD_JUMP_PROTOCOL.id, 2, 'baseline', '2026-10-20T23:30:00.000Z');
        const obs = makeObs(att, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-20T23:30:00.000Z');

        const history = buildAssessmentHistory({
            attempts: [att],
            observations: [obs],
        });

        const csv = buildAssessmentHistoryCsv(history);
        const lines = csv.split('\n');

        // Check local_date column (index 1)
        const fields = lines[1].split(',');
        expect(fields[0]).toBe('2026-10-20T23:30:00.000Z');
        expect(fields[1]).toBe('2026-10-21'); // Warsaw date!
    });

    it('leaves change columns empty for non-comparable / familiarization / invalid rows', () => {
        const attFam = makeAttempt('att-fam', STANDING_BROAD_JUMP_PROTOCOL.id, 2, 'familiarization', '2026-10-18T10:00:00Z');
        const obsFam = makeObs(attFam, 'standing_broad_jump_distance_cm', 220, 'series-1', '2026-10-18T10:00:00Z');

        const history = buildAssessmentHistory({
            attempts: [attFam],
            observations: [obsFam],
        });

        const csv = buildAssessmentHistoryCsv(history);
        const lines = csv.split('\n');
        const fields = lines[1].split(',');

        // baseline_value (index 12), absolute_change (index 13), percent_change (index 14) are empty
        expect(fields[12]).toBe('');
        expect(fields[13]).toBe('');
        expect(fields[14]).toBe('');
        expect(fields[15]).toBe('familiarization');
    });
});
