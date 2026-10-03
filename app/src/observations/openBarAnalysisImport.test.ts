import { describe, expect, it } from 'vitest';
import { buildComparisonSeries } from './comparability';
import { CONCENTRIC_SEGMENTATION_V2 } from './concentricSegmentation';
import { buildOpenBarAnalysis, openBarSingleRepProfile } from './fixtures/openBarAnalysisFixtures';
import { parseOpenBarAnalysis } from './openBarAnalysis';
import {
    assignOpenBarOrdinals, OPENBAR_CONTEXT_KEYS, OPENBAR_DEVICE_PROVIDER, openBarProposalToDraftRow,
    openBarSourceRefFor, proposeOpenBarTrial, velocityMeasurementMethodId,
} from './openBarAnalysisImport';
import { BACK_SQUAT_1RM_PROTOCOL_V2 } from './physicalCapitalProtocols';
import { assertObservationContext } from './validation';
import { checkVelocityImportApplyBlocked } from './velocityFileImport';

const hash = 'b'.repeat(64);
function proposal(analysis = buildOpenBarAnalysis(), fileHash = hash) {
    const parsed = parseOpenBarAnalysis(JSON.stringify(analysis), CONCENTRIC_SEGMENTATION_V2);
    const outcome = proposeOpenBarTrial({ fileName: 'squat.json', fileHash, parsed }, new Set(), new Set());
    if (outcome.status !== 'proposed') throw new Error(outcome.rejection.reason);
    return outcome.proposal;
}

describe('OpenBar trial mapping (#981)', () => {
    it('proposes raw velocity evidence with complete scalar provenance and an empty load', () => {
        const p = proposal();
        expect(p.device.provider).toBe(OPENBAR_DEVICE_PROVIDER);
        expect(p.loadKg).toBeNull();
        expect(p.repCount).toBe(1);
        expect(p.selectedRep).toBe(1);
        expect(p.validity).toBe('valid');
        expect(p.successful).toBe(true);
        expect(p.sourceRef).toBe(openBarSourceRefFor(hash));
        expect(Object.keys(p.context).sort()).toEqual(Object.values(OPENBAR_CONTEXT_KEYS).sort());
        expect(Object.keys(p.context).length).toBeLessThanOrEqual(32);
        expect(() => assertObservationContext(p.context, 'context')).not.toThrow();
        expect(Object.values(p.context).every(value => typeof value !== 'string' || value.length <= 128)).toBe(true);
    });
    it('selects the fastest eligible rep and makes multiple eligible reps practice evidence', () => {
        const profile = [...openBarSingleRepProfile(), ...openBarSingleRepProfile().map(v => v === 0.6 ? 0.8 : v)];
        const p = proposal(buildOpenBarAnalysis(profile));
        expect(p.repCount).toBe(2);
        expect(p.selectedRep).toBe(2);
        expect(p.validity).toBe('practice');
        expect(p.successful).toBeUndefined();
        expect(p.autoDetectedSuccess).toBe(false);
    });
    it('never selects excluded reps, preserves total count, and lists exclusion reasons', () => {
        const profile = [...openBarSingleRepProfile(), ...openBarSingleRepProfile()];
        const p = proposal(buildOpenBarAnalysis(profile, { dropSamples: [32, 33] }));
        expect(p.repCount).toBe(2);
        expect(p.eligibleRepCount).toBe(1);
        expect(p.selectedRep).toBe(2);
        expect(p.excludedReps[0].exclusion).toBe('spans_gap');
        expect(p.context.openbar_rep_count).toBe(2);
    });
    it('rejects files with no eligible tracked rep', () => {
        const parsed = parseOpenBarAnalysis(JSON.stringify(buildOpenBarAnalysis(openBarSingleRepProfile(), { nullVelocities: [32] })), CONCENTRIC_SEGMENTATION_V2);
        expect(proposeOpenBarTrial({ fileName: 'gap.json', fileHash: hash, parsed }, new Set(), new Set()).status).toBe('rejected');
    });
    it('blocks the same file or a different analysis of the same video within an attempt', () => {
        const parsed = parseOpenBarAnalysis(JSON.stringify(buildOpenBarAnalysis()), CONCENTRIC_SEGMENTATION_V2);
        const file = { fileName: 'squat.json', fileHash: hash, parsed };
        expect(proposeOpenBarTrial(file, new Set([openBarSourceRefFor(hash)]), new Set()).status).toBe('rejected');
        expect(proposeOpenBarTrial({ ...file, fileHash: 'c'.repeat(64) }, new Set(), new Set([parsed.sourceVideoSha256])).status).toBe('rejected');
        expect(proposeOpenBarTrial(file, new Set(), new Set()).status).toBe('proposed');
    });
    it('orders by file name and uses free ordinals without replacing existing evidence', () => {
        const a = { ...proposal(), fileName: 'z.json' };
        const b = { ...proposal(), fileName: 'a.json' };
        assignOpenBarOrdinals([a, b], new Set([1, 3]), 5);
        expect(a.assignedOrdinal).toBe(4);
        expect(b.assignedOrdinal).toBe(2);
        expect(a.ambiguousOrder).toBe(true);
        expect(() => assignOpenBarOrdinals([a, b], new Set([1, 2]), 3)).toThrow(/do not fit/);
        expect(checkVelocityImportApplyBlocked([a], new Set([4]), new Set([1, 3, 4]), 5)).toHaveLength(1);
    });
    it('requires an entered load in the protocol bounds, then confirms kilograms only', () => {
        const p = proposal();
        expect(() => openBarProposalToDraftRow(p, 1, BACK_SQUAT_1RM_PROTOCOL_V2)).toThrow(/load is not a number/);
        expect(() => openBarProposalToDraftRow({ ...p, loadKg: 501 }, 1, BACK_SQUAT_1RM_PROTOCOL_V2)).toThrow(/outside/);
        const row = openBarProposalToDraftRow({ ...p, loadKg: 100 }, 1, BACK_SQUAT_1RM_PROTOCOL_V2);
        expect(row.values.load_kg).toBe(100);
        expect(row.importReview).toEqual({ loadKgConfirmed: true, successConfirmed: false, validityConfirmed: false });
    });
});

describe('Velocity measurement-method identity (ADR-0047, #981)', () => {
    it('separates WL, OpenBar and manual derivations', () => {
        const p = proposal();
        const openBar = velocityMeasurementMethodId(p.device, p.context);
        expect(openBar).toBe('openbar-analysis-v1/concentric-segmentation-v2/opencv-csrt@1/savitzky-golay@1');
        for (const version of ['wl-analysis-csv-v1', 'wl-analysis-csv-v2']) {
            expect(velocityMeasurementMethodId({ provider: 'WL Analysis' }, { wl_parser_version: version })).toBe(version);
            expect(openBar).not.toBe(version);
        }
        expect(velocityMeasurementMethodId(undefined, undefined)).toBe('manual');
    });
    it.each(['openbar_tracker_implementation', 'openbar_tracker_version', 'openbar_filter_implementation', 'openbar_filter_version', 'openbar_segmentation_rule'])('changes identity when %s changes', key => {
        const p = proposal();
        expect(velocityMeasurementMethodId(p.device, { ...p.context, [key]: 'other' })).not.toBe(velocityMeasurementMethodId(p.device, p.context));
    });
    it('distinguishes raw from filtered and refuses incomplete imported provenance', () => {
        const p = proposal(buildOpenBarAnalysis(undefined, { filtered: false }));
        expect(velocityMeasurementMethodId(p.device, p.context)).toMatch(/\/raw$/);
        expect(() => velocityMeasurementMethodId(p.device, { openbar_parser_version: 'openbar-analysis-v1' })).toThrow(/needs/);
    });
    it('builds distinct existing comparison-series keys for WL and OpenBar on the same protocol/setup', async () => {
        const p = proposal();
        const protocol = {
            ...BACK_SQUAT_1RM_PROTOCOL_V2,
            comparisonContext: {
                required: ['equipment_setup_id', 'measurement_method_id'] as const,
                seriesDefining: ['equipment_setup_id', 'measurement_method_id'] as const,
                contextOnly: [], canonicalizationVersion: 'comparison-series-v1',
            },
        };
        const wl = await buildComparisonSeries('strength_1rm_kg', 'kg', protocol, { equipment_setup_id: 'rack-a', measurement_method_id: 'wl-analysis-csv-v2' });
        const openBar = await buildComparisonSeries('strength_1rm_kg', 'kg', protocol, { equipment_setup_id: 'rack-a', measurement_method_id: velocityMeasurementMethodId(p.device, p.context) });
        expect(openBar.key).not.toBe(wl.key);
    });
});
