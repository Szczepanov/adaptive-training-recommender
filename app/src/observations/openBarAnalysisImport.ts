/** OpenBar-specific trial proposals. Persistence uses the ordinary assessment capture path. */
import type { DraftTrialRow } from '../utils/assessmentDraftStorage';
import type { MeasurementProtocol, MetricObservationDevice, ObservationContext } from './models';
import { type OpenBarAnalysisParse, type OpenBarRep } from './openBarAnalysis';
import { velocityProposalToDraftRow, type VelocityTrialProposal } from './velocityFileImport';
import { WL_ANALYSIS_CSV_PARSER_V1, WL_ANALYSIS_CSV_PARSER_V2 } from './wlAnalysisCsv';

export const OPENBAR_DEVICE_PROVIDER = 'OpenBar';
export const OPENBAR_CONTEXT_KEYS = {
    parserVersion: 'openbar_parser_version', segmentationRule: 'openbar_segmentation_rule', schemaVersion: 'openbar_schema_version',
    repCount: 'openbar_rep_count', eligibleRepCount: 'openbar_eligible_rep_count', selectedRep: 'openbar_selected_rep', romCm: 'openbar_rom_cm',
    trackerId: 'openbar_tracker_id', trackerImplementation: 'openbar_tracker_implementation', trackerVersion: 'openbar_tracker_version',
    filterImplementation: 'openbar_filter_implementation', filterVersion: 'openbar_filter_version',
    kinematicsInput: 'openbar_kinematics_input', maxGapS: 'openbar_kinematics_max_gap_s', minConfidence: 'openbar_kinematics_min_confidence',
    calibrationMethod: 'openbar_calibration_method', metresPerPixel: 'openbar_metres_per_pixel', plateDiameterM: 'openbar_plate_diameter_m',
    calibrationQuality: 'openbar_calibration_quality', sourceVideoSha256: 'openbar_source_video_sha256', openbarVersion: 'openbar_version',
} as const;

export interface OpenBarTrialProposal extends VelocityTrialProposal {
    sourceVideoSha256: string;
    repCount: number;
    eligibleRepCount: number;
    selectedRep: number;
    romCm: number;
    ambiguousOrder: boolean;
    autoDetectedSuccess: boolean;
    warnings: string[];
    excludedReps: readonly OpenBarRep[];
}
export type OpenBarProposeOutcome =
    | { status: 'proposed'; proposal: OpenBarTrialProposal }
    | { status: 'rejected'; rejection: { fileName: string; reason: string } };

export function openBarSourceRefFor(fileHash: string): string {
    return `openbar-analysis:sha256:${fileHash}`;
}

export function proposeOpenBarTrial(
    file: { fileName: string; fileHash: string; parsed: OpenBarAnalysisParse },
    existingSourceRefs: ReadonlySet<string>,
    existingSourceVideoHashes: ReadonlySet<string>,
): OpenBarProposeOutcome {
    const reject = (reason: string): OpenBarProposeOutcome => ({ status: 'rejected', rejection: { fileName: file.fileName, reason } });
    if (!/^[a-f0-9]{64}$/.test(file.fileHash)) return reject('The analysis file needs a valid SHA-256 fingerprint.');
    const sourceRef = openBarSourceRefFor(file.fileHash);
    const { parsed } = file;
    if (existingSourceRefs.has(sourceRef)) return reject('This analysis file is already in the attempt.');
    if (existingSourceVideoHashes.has(parsed.sourceVideoSha256)) return reject('An analysis of this video is already in the attempt. Use one analysis per video.');
    const eligible = parsed.reps.filter(rep => rep.exclusion === null);
    if (eligible.length === 0) {
        const exclusions = parsed.reps.map(rep => `Rep ${rep.index + 1}: ${rep.exclusion === 'spans_gap' ? 'tracking gap' : 'movement at the edge of the clip'}`).join('; ');
        return reject(`No fully tracked repetition is available.${exclusions ? ` ${exclusions}.` : ''} Record tracking before and after the ascent, then try again.`);
    }
    const selected = eligible.reduce((best, rep) => rep.meanVelocityMps > best.meanVelocityMps ? rep : best);
    const singleRep = eligible.length === 1;
    const p = parsed.provenance;
    const context: ObservationContext = {
        [OPENBAR_CONTEXT_KEYS.parserVersion]: parsed.parserVersion,
        [OPENBAR_CONTEXT_KEYS.segmentationRule]: parsed.segmentationRule,
        [OPENBAR_CONTEXT_KEYS.schemaVersion]: parsed.schemaVersion,
        [OPENBAR_CONTEXT_KEYS.repCount]: parsed.reps.length,
        [OPENBAR_CONTEXT_KEYS.eligibleRepCount]: eligible.length,
        [OPENBAR_CONTEXT_KEYS.selectedRep]: selected.index + 1,
        [OPENBAR_CONTEXT_KEYS.romCm]: selected.romCm,
        [OPENBAR_CONTEXT_KEYS.trackerId]: p.trackerId,
        [OPENBAR_CONTEXT_KEYS.trackerImplementation]: p.tracker.implementation,
        [OPENBAR_CONTEXT_KEYS.trackerVersion]: p.tracker.version,
        [OPENBAR_CONTEXT_KEYS.filterImplementation]: p.filter?.implementation ?? null,
        [OPENBAR_CONTEXT_KEYS.filterVersion]: p.filter?.version ?? null,
        [OPENBAR_CONTEXT_KEYS.kinematicsInput]: p.kinematicsInput,
        [OPENBAR_CONTEXT_KEYS.maxGapS]: p.maxGapS,
        [OPENBAR_CONTEXT_KEYS.minConfidence]: p.minConfidence,
        [OPENBAR_CONTEXT_KEYS.calibrationMethod]: p.calibrationMethod,
        [OPENBAR_CONTEXT_KEYS.metresPerPixel]: p.metresPerPixel,
        [OPENBAR_CONTEXT_KEYS.plateDiameterM]: p.plateDiameterM,
        [OPENBAR_CONTEXT_KEYS.calibrationQuality]: p.calibrationQuality,
        [OPENBAR_CONTEXT_KEYS.sourceVideoSha256]: parsed.sourceVideoSha256,
        [OPENBAR_CONTEXT_KEYS.openbarVersion]: p.openbarVersion,
    };
    if (Object.values(context).some(value => typeof value === 'string' && value.length > 128)) {
        return reject('The analysis provenance is too long to store. Use provenance values of at most 128 characters.');
    }
    return {
        status: 'proposed',
        proposal: {
            fileName: file.fileName, sourceRef, sourceVideoSha256: parsed.sourceVideoSha256,
            loadKg: null, meanVelocityMps: selected.meanVelocityMps, peakVelocityMps: selected.peakVelocityMps,
            romCm: selected.romCm, repCount: parsed.reps.length, eligibleRepCount: eligible.length, selectedRep: selected.index + 1,
            successful: singleRep ? selected.complete : undefined,
            validity: singleRep ? 'valid' : 'practice', autoDetectedSuccess: singleRep,
            assignedOrdinal: null, ambiguousOrder: true,
            warnings: ['Order assumed from file names — confirm the attempt order.'],
            excludedReps: parsed.reps.filter(rep => rep.exclusion !== null),
            notes: `OpenBar: rep ${selected.index + 1}/${parsed.reps.length}; ROM ${selected.romCm} cm`,
            device: { provider: OPENBAR_DEVICE_PROVIDER }, context,
        },
    };
}

/** Fill unused planned rows first; never replace a saved row or a row already containing evidence. */
export function assignOpenBarOrdinals(proposals: OpenBarTrialProposal[], unavailableOrdinals: ReadonlySet<number>, maxTrials: number): void {
    const taken = new Set(unavailableOrdinals);
    for (const proposal of [...proposals].sort((a, b) => a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0)) {
        let ordinal = 1;
        while (taken.has(ordinal)) ordinal += 1;
        if (ordinal > maxTrials) throw new Error(`These files do not fit into this test (at most ${maxTrials} attempts). Import fewer files.`);
        proposal.assignedOrdinal = ordinal;
        proposal.ambiguousOrder = true;
        taken.add(ordinal);
    }
}

export function openBarProposalToDraftRow(proposal: OpenBarTrialProposal, ordinal: number, protocol: MeasurementProtocol): DraftTrialRow {
    const row = velocityProposalToDraftRow(proposal, ordinal, protocol, 'OpenBar');
    return { ...row, importReview: { ...row.importReview!, loadKgConfirmed: true } };
}

/** ADR-0047 contract: imported derivations belong to distinct comparison-method identities. */
export function velocityMeasurementMethodId(device: MetricObservationDevice | undefined, context: ObservationContext | undefined): string {
    const c = context ?? {};
    const component = (key: string): string => {
        const value = c[key];
        if (typeof value !== 'string' || !value.trim()) throw new Error(`Imported velocity method needs ${key}.`);
        return encodeURIComponent(value.trim().toLowerCase());
    };
    if (c.openbar_parser_version !== undefined) {
        const filter = c.openbar_filter_implementation === null && c.openbar_filter_version === null
            ? 'raw' : `${component('openbar_filter_implementation')}@${component('openbar_filter_version')}`;
        return `${component('openbar_parser_version')}/${component('openbar_segmentation_rule')}`
            + `/${component('openbar_tracker_implementation')}@${component('openbar_tracker_version')}/${filter}`;
    }
    if (c.wl_parser_version !== undefined) {
        const parser = component('wl_parser_version');
        if (parser !== WL_ANALYSIS_CSV_PARSER_V1 && parser !== WL_ANALYSIS_CSV_PARSER_V2) throw new Error('Imported velocity uses an unsupported WL parser.');
        return parser;
    }
    // A manually typed velocity has no parser derivation, regardless of the device label.
    void device;
    return 'manual';
}
