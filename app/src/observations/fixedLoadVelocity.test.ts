import { describe, expect, it } from 'vitest';
import { deriveTrialObservationRevisions } from './assessmentDerivation';
import { reduceAssessmentTrials } from './assessmentReducers';
import { assertValidAssessmentTrial } from './assessmentTrials';
import { buildComparisonSeries } from './comparability';
import { makeTrial, trialAttempt } from './fixtures/assessmentTrialFixtures';
import { buildOpenBarAnalysis } from './fixtures/openBarAnalysisFixtures';
import { parseOpenBarAnalysis } from './openBarAnalysis';
import { CONCENTRIC_SEGMENTATION_V2 } from './concentricSegmentation';
import { proposeOpenBarTrial, velocityMeasurementMethodId } from './openBarAnalysisImport';
import type { AssessmentTrial, ComparisonContext, ObservationContext } from './models';
import { getPerformanceTestDefinition } from './performanceTestingCatalog';
import { BACK_SQUAT_FIXED_LOAD_VELOCITY_PROTOCOL, BENCH_PRESS_FIXED_LOAD_VELOCITY_PROTOCOL, BENCH_PRESS_1RM_PROTOCOL, PHYSICAL_CAPITAL_PROTOCOL_REVISIONS } from './physicalCapitalProtocols';
import { assertValidMeasurementProtocol, getComparisonDimensionDefinition } from './protocols';
import { getMetricDefinition } from './registry';
import { buildAssessmentHistory } from './assessmentHistory';
import { buildAssessmentHistoryCsv } from './assessmentCsvExport';
import { buildAssessmentDiagnosticExport } from './assessmentExport';

const protocol = BENCH_PRESS_FIXED_LOAD_VELOCITY_PROTOCOL;
const context: ComparisonContext = { test_load_kg: 60, measurement_method_id: 'manual', equipment_setup_id: 'bench-a-camera-a' };
const trial = (ordinal: number, velocity: number, overrides: Partial<AssessmentTrial> = {}) => makeTrial(ordinal,
    { load_kg: 60, successful: true, mean_concentric_velocity_mps: velocity }, { context, ...overrides });
const derive = (trials: readonly AssessmentTrial[], comparisonContext = context) => deriveTrialObservationRevisions({
    protocol, attempt: trialAttempt({ protocolRef: { id: protocol.id, revision: 1 } }), trials,
    context: comparisonContext, observedAt: '2026-10-19T07:45:00.000Z',
});

describe('ADR-0047 fixed-load velocity', () => {
    it('projects a derived fixed-load benchmark through history, CSV and diagnostic JSON', async () => {
        const attempt = trialAttempt({ protocolRef: { id: protocol.id, revision: 1 }, state: 'completed', completedAt: '2026-10-19T07:45:00.000Z' });
        const trials = [trial(1, 0.8)];
        const revision = (await derive(trials)).observations[0];
        const head = { observationKey: revision.observationKey, assessmentAttemptId: attempt.id, metricId: revision.metricId, headRevision: 1, createdAt: revision.createdAt, updatedAt: revision.createdAt };
        const definition = getPerformanceTestDefinition(`${protocol.id}-r1`);
        const history = buildAssessmentHistory({ definitions: [definition], protocols: [protocol], attempts: [attempt], observations: [{ head, revision }] });
        expect(history.tests[0].metrics[0].activeSeries?.baseline).toMatchObject({ value: 0.8, unit: 'm/s', sourceKind: 'trial-derived' });
        expect(buildAssessmentHistoryCsv(history)).toContain('strength_fixed_load_mean_velocity_mps');
        const evidence = buildAssessmentDiagnosticExport({ exportedAt: revision.createdAt, protocols: PHYSICAL_CAPITAL_PROTOCOL_REVISIONS, attempts: [attempt], trials, canonicalObservations: [{ observationKey: revision.observationKey, head, revisions: [revision] }], resolvedContext: [{ attemptId: attempt.id, protocolId: protocol.id, protocolRevision: 1, context, seriesKeys: { [revision.metricId]: revision.comparisonSeriesKey } }] });
        expect(evidence.protocols).toContain(protocol);
        expect(evidence.canonicalObservations[0].revisions[0]).toMatchObject({ value: 0.8, context });
        expect(evidence.trials[0]).toMatchObject({ values: { load_kg: 60, mean_concentric_velocity_mps: 0.8 } });
    });

    it('registers separate immutable protocols, import fields, metric and numeric load dimension', () => {
        expect(getMetricDefinition('strength_fixed_load_mean_velocity_mps')).toMatchObject({ unit: 'm/s', direction: 'higher_is_better' });
        expect(getComparisonDimensionDefinition('test_load_kg').valueKind).toBe('number');
        for (const candidate of [protocol, BACK_SQUAT_FIXED_LOAD_VELOCITY_PROTOCOL]) {
            expect(() => assertValidMeasurementProtocol(candidate)).not.toThrow();
            expect(PHYSICAL_CAPITAL_PROTOCOL_REVISIONS).toContain(candidate);
            expect(getPerformanceTestDefinition(`${candidate.id}-r1`).protocol).toBe(candidate);
            expect(candidate.capture?.fields.find(f => f.id === 'mean_concentric_velocity_mps')?.required).toBe(true);
        }
        expect(BENCH_PRESS_1RM_PROTOCOL.metricIds).toEqual(['strength_1rm_kg']);
        expect(BENCH_PRESS_1RM_PROTOCOL.capture?.fields.find(f => f.id === 'mean_concentric_velocity_mps')?.required).toBe(false);
    });

    it('selects highest eligible mean velocity, with deterministic ties and source provenance', async () => {
        const result = await derive([trial(3, 0.8), trial(1, 0.8), trial(2, 2, { validity: 'practice' }), trial(4, 3, { validity: 'questionable' }), trial(5, 4, { validity: 'invalid', invalidReason: 'Bounce' })]);
        expect(result.observations[0]).toMatchObject({ value: 0.8, unit: 'm/s', algorithmVersion: 'assessment-reducer-v1', context,
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: trialAttempt().id, trialId: 'trial-1' }] });
        expect(result.observations[0].observationKey).toBe(`${trialAttempt().id}:strength_fixed_load_mean_velocity_mps`);
    });

    it.each([
        { load_kg: 61, successful: true, mean_concentric_velocity_mps: 1 },
        { load_kg: 60, successful: false, mean_concentric_velocity_mps: 1 },
    ])('rejects ineligible valid evidence before reduction or persistence: %j', values => {
        const row = trial(1, 1, { values });
        expect(() => assertValidAssessmentTrial(row, protocol)).toThrow();
        expect(() => reduceAssessmentTrials(protocol, row.assessmentAttemptId, [row])).toThrow();
        expect(() => assertValidAssessmentTrial({ ...row, validity: 'practice' }, protocol)).not.toThrow();
    });

    it.each(['test_load_kg', 'measurement_method_id', 'equipment_setup_id'] as const)('refuses relabeling stored evidence via %s', async dimension => {
        const changed = { ...context, [dimension]: dimension === 'test_load_kg' ? 70 : 'other' };
        await expect(derive([trial(1, 0.8)], changed)).rejects.toThrow(/context|locked|method/i);
    });

    it('never labels imported WL as manual or blends parser versions', async () => {
        const wl = trial(1, 0.8, { sourceRef: `wl-analysis-csv:sha256:${'a'.repeat(64)}`, device: { provider: 'WL Analysis' }, context: { ...context, measurement_method_id: 'wl-analysis-csv-v2', wl_parser_version: 'wl-analysis-csv-v2' } });
        await expect(derive([wl], { ...context, measurement_method_id: 'wl-analysis-csv-v2' })).resolves.toMatchObject({ missingMetricIds: [] });
        await expect(derive([wl])).rejects.toThrow();
        expect(() => assertValidAssessmentTrial({ ...wl, context: { ...wl.context, measurement_method_id: 'manual' } }, protocol)).toThrow(/method/i);
        await expect(derive([wl, trial(2, 0.9)], { ...context, measurement_method_id: 'wl-analysis-csv-v2' })).rejects.toThrow();
    });

    it.each(['wl-analysis-csv', 'openbar-analysis'])('rejects %s source refs with missing parser provenance', prefix => {
        expect(() => assertValidAssessmentTrial(trial(1, 0.8, { sourceRef: `${prefix}:sha256:${'a'.repeat(64)}` }), protocol)).toThrow(/provenance/);
    });

    it('binds OpenBar evidence to its full actual configuration identity', async () => {
        const parsed = parseOpenBarAnalysis(JSON.stringify(buildOpenBarAnalysis()), CONCENTRIC_SEGMENTATION_V2);
        const proposed = proposeOpenBarTrial({ fileName: 'rep.json', fileHash: 'a'.repeat(64), parsed }, new Set(), new Set());
        expect(proposed.status).toBe('proposed');
        if (proposed.status !== 'proposed') return;
        const p = proposed.proposal;
        const method = velocityMeasurementMethodId(p.device, p.context);
        const locked = { ...context, measurement_method_id: method };
        const row = trial(1, 0.7, { sourceRef: p.sourceRef, device: p.device, context: { ...locked, ...p.context } });
        await expect(derive([row], locked)).resolves.toMatchObject({ missingMetricIds: [] });
        expect(() => assertValidAssessmentTrial({ ...row, context: { ...row.context, openbar_tracker_version: 'other' } }, protocol)).toThrow(/method/i);
        for (const sourceRef of [undefined, 'execution:manual', `wl-analysis-csv:sha256:${'a'.repeat(64)}`, 'openbar-analysis:sha256:bad']) {
            expect(() => assertValidAssessmentTrial({ ...row, sourceRef }, protocol)).toThrow(/provenance/);
        }
        const invalidConfigurations: ObservationContext[] = [{ openbar_tracker_version: null }, { openbar_filter_parameters: 3 }, { openbar_kinematics_max_gap_s: 0 }, { openbar_kinematics_min_confidence: 2 }, { openbar_filter_implementation: null, openbar_filter_version: null }, { openbar_kinematics_parameters: 'arbitrary' }, { openbar_tracker_implementation: 'other tracker' }, { openbar_calibration_method: 'plate diameter@1' }];
        for (const change of invalidConfigurations) {
            const changedContext = { ...row.context, ...change };
            expect(() => assertValidAssessmentTrial({ ...row, context: changedContext }, protocol)).toThrow();
        }
        const unsupportedComponents: ObservationContext[] = [{ openbar_tracker_implementation: 'other tracker' }, { openbar_calibration_method: 'plate diameter@1' }];
        for (const change of unsupportedComponents) {
            const changedContext = { ...row.context, ...change };
            const relabeled = { ...changedContext, measurement_method_id: velocityMeasurementMethodId(row.device, changedContext) };
            expect(() => assertValidAssessmentTrial({ ...row, context: relabeled }, protocol)).toThrow(/canonical/);
        }
    });

    it.each([undefined, 'execution:manual', 'wl-analysis-csv:sha256:bad', `openbar-analysis:sha256:${'a'.repeat(64)}`])('rejects WL parser attribution without a WL SHA-256 source: %s', sourceRef => {
        const row = trial(1, 0.8, { sourceRef, device: { provider: 'WL Analysis' }, context: { ...context, wl_parser_version: 'wl-analysis-csv-v2', measurement_method_id: 'wl-analysis-csv-v2' } });
        expect(() => assertValidAssessmentTrial(row, protocol)).toThrow(/provenance/);
        expect(() => assertValidAssessmentTrial({ ...row, validity: 'practice' }, protocol)).toThrow(/provenance/);
    });

    it('accepts unfiltered OpenBar only with coherent raw filter provenance and its full method', async () => {
        const parsed = parseOpenBarAnalysis(JSON.stringify(buildOpenBarAnalysis(undefined, { filtered: false })), CONCENTRIC_SEGMENTATION_V2);
        const proposed = proposeOpenBarTrial({ fileName: 'raw.json', fileHash: 'b'.repeat(64), parsed }, new Set(), new Set());
        if (proposed.status !== 'proposed') throw new Error('Synthetic raw OpenBar proposal was rejected');
        const p = proposed.proposal;
        const locked = { ...context, measurement_method_id: velocityMeasurementMethodId(p.device, p.context) };
        const row = trial(1, 0.7, { sourceRef: p.sourceRef, device: p.device, context: { ...locked, ...p.context } });
        await expect(derive([row], locked)).resolves.toMatchObject({ missingMetricIds: [] });
        expect(() => assertValidAssessmentTrial({ ...row, context: { ...row.context, openbar_filter_parameters: 'order=n%3A2' } }, protocol)).toThrow(/configuration/);
    });

    it('uses current correction heads and cannot revive superseded faster evidence', async () => {
        const corrected = trial(1, 0.6, { correctionIndex: 1, id: 'trial-1-c1', supersedesTrialId: 'trial-1', correctionReason: 'Corrected analysis' });
        const result = await derive([trial(1, 0.9), trial(2, 0.7), corrected]);
        expect(result.observations[0].value).toBe(0.7);
        expect(result.observations[0].derivedFromEvidenceRefs?.[0].trialId).toBe('trial-2');
    });

    it.each([
        { ...context, test_load_kg: 70 }, { ...context, measurement_method_id: 'wl-analysis-csv-v1' },
        { ...context, measurement_method_id: 'wl-analysis-csv-v2' }, { ...context, equipment_setup_id: 'bench-b' },
    ])('separates series when load, method/parser or equipment changes: %j', async changed => {
        const base = await buildComparisonSeries('strength_fixed_load_mean_velocity_mps', 'm/s', protocol, context);
        const other = await buildComparisonSeries('strength_fixed_load_mean_velocity_mps', 'm/s', protocol, changed);
        expect(other.key).not.toBe(base.key);
    });
});
