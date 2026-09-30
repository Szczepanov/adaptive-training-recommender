import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentSeriesCard } from './AssessmentSeriesCard';
import type { AssessmentHistoryRow, AssessmentTestHistory } from '../../observations/assessmentHistory';
import type { PerformanceTestDefinition } from '../../observations/performanceTestingCatalog';
import type { MetricObservationHead, MetricObservationRevision } from '../../observations/models';
import { STANDING_BROAD_JUMP_PROTOCOL } from '../../observations/physicalCapitalProtocols';

describe('AssessmentSeriesCard', () => {
    const baseTest: AssessmentTestHistory = {
        definitionId: 'field-standing-broad-jump-r2',
        protocolId: STANDING_BROAD_JUMP_PROTOCOL.id,
        title: 'Standing broad jump',
        family: 'field',
        definition: {
            id: 'field-standing-broad-jump-r2',
            protocol: { ...STANDING_BROAD_JUMP_PROTOCOL, revision: 2 },
            sessionDefinition: {} as unknown as PerformanceTestDefinition['sessionDefinition'],
            defaultContext: {},
            expectedSource: 'manual',
        },
        activeSeries: null,
        otherSeries: [],
        completedWithoutBenchmarkCount: 0,
        abandonedCount: 0,
        unreadableCount: 0,
    };

    it('renders empty state when no active series exists', () => {
        const html = renderToStaticMarkup(<AssessmentSeriesCard test={baseTest} onSelectAttempt={vi.fn()} />);
        expect(html).toContain('Standing broad jump');
        expect(html).toContain('field');
        expect(html).toContain('No assessment attempts recorded yet for this test.');
    });

    it('renders active series with honest D4 wording when no reliability exists', () => {
        const testWithSeries: AssessmentTestHistory = {
            ...baseTest,
            activeSeries: {
                protocolRevision: 2,
                comparisonSeriesKey: 'series-key-abc123456789',
                resolvedContext: {},
                observations: [
                    {
                        observationKey: 'att-1:standing_broad_jump_distance_cm',
                        attemptId: 'att-1',
                        attemptPurpose: 'baseline',
                        attemptState: 'completed',
                        localDate: '2026-10-20',
                        observedAt: '2026-10-20T10:00:00Z',
                        metricId: 'standing_broad_jump_distance_cm',
                        displayName: 'Standing broad jump distance',
                        value: 230,
                        unit: 'cm',
                        validity: 'valid',
                        sourceKind: 'trial-derived',
                        relativeContext: {},
                        rowProgress: { baselineValue: 230, status: 'baseline' },
                        attempt: { id: 'att-1', protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 }, scheduledDate: '2026-10-20', state: 'completed', purpose: 'baseline' },
                        head: {} as unknown as MetricObservationHead,
                        revision: {} as unknown as MetricObservationRevision,
                    },
                    {
                        observationKey: 'att-2:standing_broad_jump_distance_cm',
                        attemptId: 'att-2',
                        attemptPurpose: 'checkpoint',
                        attemptState: 'completed',
                        localDate: '2026-10-25',
                        observedAt: '2026-10-25T10:00:00Z',
                        metricId: 'standing_broad_jump_distance_cm',
                        displayName: 'Standing broad jump distance',
                        value: 241.5,
                        unit: 'cm',
                        validity: 'valid',
                        sourceKind: 'trial-derived',
                        relativeContext: {},
                        rowProgress: { baselineValue: 230, absoluteChange: 11.5, percentChange: 5, status: 'insufficient_evidence' },
                        attempt: { id: 'att-2', protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 }, scheduledDate: '2026-10-25', state: 'completed', purpose: 'checkpoint' },
                        head: {} as unknown as MetricObservationHead,
                        revision: {} as unknown as MetricObservationRevision,
                    },
                ],
                baseline: {
                    value: 230,
                    unit: 'cm',
                    localDate: '2026-10-20',
                    attemptPurpose: 'baseline',
                } as unknown as AssessmentHistoryRow,
                latest: {
                    value: 241.5,
                    unit: 'cm',
                    localDate: '2026-10-25',
                    attemptPurpose: 'checkpoint',
                } as unknown as AssessmentHistoryRow,
                progress: {
                    metricId: 'standing_broad_jump_distance_cm',
                    comparable: true,
                    absoluteChange: 11.5,
                    percentChange: 5.0,
                    status: 'insufficient_evidence',
                    reasons: ['no_reliability_estimate', 'raw_change_favorable'],
                    progressPolicyVersion: 'ov-progress-v1',
                },
            },
        };

        const html = renderToStaticMarkup(<AssessmentSeriesCard test={testWithSeries} onSelectAttempt={vi.fn()} />);

        expect(html).toContain('230 cm');
        expect(html).toContain('241.5 cm');
        expect(html).toContain('+11.5 cm');
        expect(html).toContain('raw change, no reliability estimate');
        expect(html).toContain('trial-derived');
    });

    it('renders older series inside disclosure with explicit not comparable reason (D1)', () => {
        const testWithOther: AssessmentTestHistory = {
            ...baseTest,
            activeSeries: {
                protocolRevision: 2,
                comparisonSeriesKey: 'series-setup-2',
                resolvedContext: {},
                observations: [],
                baseline: null,
                latest: null,
                progress: { metricId: 'test', comparable: false, status: 'insufficient_evidence', reasons: [], progressPolicyVersion: 'v1' },
            },
            otherSeries: [
                {
                    protocolRevision: 1,
                    comparisonSeriesKey: 'series-setup-1',
                    resolvedContext: {},
                    observations: [],
                    baseline: null,
                    latest: null,
                    progress: { metricId: 'test', comparable: false, status: 'insufficient_evidence', reasons: [], progressPolicyVersion: 'v1' },
                    nonComparableReason: 'protocol revision changed',
                },
            ],
        };

        const html = renderToStaticMarkup(<AssessmentSeriesCard test={testWithOther} onSelectAttempt={vi.fn()} />);
        expect(html).toContain('Other comparison series (1)');
        expect(html).toContain('not comparable: protocol revision changed');
    });
});
