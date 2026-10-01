import { describe, expect, it } from 'vitest';
import type { AssessmentAttempt, MeasurementProtocol } from './models';
import { BACK_SQUAT_1RM_PROTOCOL_V2, STANDING_BROAD_JUMP_PROTOCOL } from './physicalCapitalProtocols';
import {
    annotateWlBatchDuplicates,
    assignWlOrdinals,
    canImportWlAnalysis,
    checkWlApplyBlocked,
    hasAccommodatingResistance,
    parseWlAttemptNumber,
    proposeWlTrial,
    sha256Hex,
    wlFileDateReadings,
    wlProposalToDraftRow,
    wlSourceRefFor,
    WL_ANALYSIS_DEVICE_PROVIDER,
    type WlImportFile,
    type WlTrialProposal,
} from './wlAnalysisImport';
import { WL_ANALYSIS_CSV_PARSER_V1, type WlAnalysisCsvParse, type WlAnalysisRep } from './wlAnalysisCsv';

function makeRep(overrides: Partial<WlAnalysisRep> & { index: number }): WlAnalysisRep {
    return {
        startFrame: 1,
        endFrame: 20,
        frameCount: 20,
        startTimeS: 0,
        endTimeS: 0.633,
        durationS: 0.633,
        meanVelocityMps: 0.56,
        peakVelocityMps: 0.8,
        romCm: 55,
        complete: true,
        ...overrides,
    };
}

function makeParsed(overrides: Partial<WlAnalysisCsvParse> = {}): WlAnalysisCsvParse {
    return {
        parserVersion: WL_ANALYSIS_CSV_PARSER_V1,
        videoId: '1',
        dateRaw: '03/02/2025',
        resolution: '1080x1920',
        frameRate: 30,
        weight: 150,
        tags: 'back squat',
        frames: [
            { ordinal: 1, timeS: 0, velocityMps: 0.5, displacementCm: -55 },
            { ordinal: 2, timeS: 0.033, velocityMps: 0.6, displacementCm: 0 },
        ],
        reps: [makeRep({ index: 0 })],
        summarySignature: 'summary-a',
        ...overrides,
    };
}

function makeFile(fileName: string, parsed: WlAnalysisCsvParse, fileHash = 'a'.repeat(64)): WlImportFile {
    return { fileName, fileHash, parsed };
}

function proposed(file: WlImportFile, sessionDate: string | null = null): WlTrialProposal {
    const outcome = proposeWlTrial(file, sessionDate, new Set());
    if (outcome.status !== 'proposed') throw new Error(`expected proposal: ${outcome.rejection.reason}`);
    return outcome.proposal;
}

describe('wlAnalysisImport tags', () => {
    it('reads attempt N case-insensitively', () => {
        expect(parseWlAttemptNumber('back squat attempt 3')).toBe(3);
        expect(parseWlAttemptNumber('Attempt 12 warmup')).toBe(12);
        expect(parseWlAttemptNumber('back squat')).toBeNull();
        expect(parseWlAttemptNumber('attempt 0')).toBeNull();
    });

    it('detects accommodating resistance mentions', () => {
        expect(hasAccommodatingResistance('squat chains attempt 1')).toBe(true);
        expect(hasAccommodatingResistance('bench band work')).toBe(true);
        expect(hasAccommodatingResistance('back squat attempt 1')).toBe(false);
    });
});

describe('wlAnalysisImport single-rep mapping (D3)', () => {
    it('prefills success from a complete rep and marks it auto-detected', () => {
        const proposal = proposed(makeFile('a.csv', makeParsed()));
        expect(proposal.validity).toBe('valid');
        expect(proposal.successful).toBe(true);
        expect(proposal.autoDetectedSuccess).toBe(true);
        expect(proposal.loadKg).toBe(150);
        expect(proposal.meanVelocityMps).toBe(0.56);
        expect(proposal.peakVelocityMps).toBe(0.8);
        expect(proposal.repCount).toBe(1);
        expect(proposal.device).toEqual({ provider: WL_ANALYSIS_DEVICE_PROVIDER });
        expect(proposal.notes).toMatch(/auto-detected.*confirm/i);
    });

    it('prefills a miss from an incomplete ascent but keeps validity for the athlete', () => {
        const proposal = proposed(makeFile('a.csv', makeParsed({
            reps: [makeRep({ index: 0, complete: false, meanVelocityMps: 0.25, romCm: 30 })],
        })));
        expect(proposal.successful).toBe(false);
        expect(proposal.validity).toBe('valid');
        expect(proposal.autoDetectedSuccess).toBe(true);
    });

    it('records parser version, rep count, selected rep, ROM, frame rate and resolution in context', () => {
        const proposal = proposed(makeFile('a.csv', makeParsed()));
        expect(proposal.context).toEqual({
            wl_parser_version: WL_ANALYSIS_CSV_PARSER_V1,
            wl_rep_count: 1,
            wl_selected_rep: 1,
            wl_rom_cm: 55,
            wl_frame_rate: 30,
            wl_resolution: '1080x1920',
        });
    });

    it('builds a replay-stable content-hash sourceRef, never the file name', () => {
        const proposal = proposed(makeFile('attempt-1.csv', makeParsed(), 'b'.repeat(64)));
        expect(proposal.sourceRef).toBe(`wl-analysis-csv:sha256:${'b'.repeat(64)}`);
        expect(proposal.sourceRef).not.toContain('attempt-1');
        expect(wlSourceRefFor('c'.repeat(64))).toBe(`wl-analysis-csv:sha256:${'c'.repeat(64)}`);
    });
});

describe('wlAnalysisImport multi-rep mapping (D3)', () => {
    it('uses the fastest rep and records a practice trial', () => {
        const proposal = proposed(makeFile('warmup.csv', makeParsed({
            tags: 'back squat warmup',
            reps: [
                makeRep({ index: 0, meanVelocityMps: 0.5, peakVelocityMps: 0.7 }),
                makeRep({ index: 1, meanVelocityMps: 0.62, peakVelocityMps: 0.85, romCm: 56 }),
            ],
        })));
        expect(proposal.repCount).toBe(2);
        expect(proposal.selectedRep).toBe(2);
        expect(proposal.meanVelocityMps).toBe(0.62);
        expect(proposal.peakVelocityMps).toBe(0.85);
        expect(proposal.validity).toBe('practice');
        expect(proposal.successful).toBeUndefined();
        expect(proposal.warnings.some(w => /fastest of 2 reps/i.test(w))).toBe(true);
    });

    it('defaults chains/bands to practice with a comparability note', () => {
        const proposal = proposed(makeFile('chains.csv', makeParsed({ tags: 'back squat chains attempt 1' })));
        expect(proposal.validity).toBe('practice');
        expect(proposal.successful).toBeUndefined();
        expect(proposal.accommodatingResistance).toBe(true);
        expect(proposal.warnings.some(w => /accommodating resistance/i.test(w))).toBe(true);
    });

    it('rejects files with no detected rep instead of creating an empty trial', () => {
        const outcome = proposeWlTrial(makeFile('empty.csv', makeParsed({ reps: [] })), null, new Set());
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') expect(outcome.rejection.reason).toMatch(/no lift was detected/i);
    });
});

describe('wlAnalysisImport duplicates (D6)', () => {
    it('rejects a file whose digest matches an existing row', () => {
        const existing = new Set([wlSourceRefFor('a'.repeat(64))]);
        const outcome = proposeWlTrial(makeFile('copy.csv', makeParsed(), 'a'.repeat(64)), null, existing);
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') expect(outcome.rejection.reason).toMatch(/already imported/i);
    });

    it('warns on identical per-frame data or identical summaries without blocking', () => {
        const base = makeParsed();
        const a = proposed(makeFile('a.csv', base, 'a'.repeat(64)));
        const b = proposed(makeFile('b.csv', { ...base, tags: 'back squat attempt 2' }, 'b'.repeat(64)));
        annotateWlBatchDuplicates([a, b], new Map([
            [a.sourceRef, 'same-summary'],
            [b.sourceRef, 'same-summary'],
        ]));
        expect(b.warnings.some(w => /identical movement data/i.test(w))).toBe(true);
        expect(b.warnings.some(w => /identical summary block/i.test(w))).toBe(true);
        expect(a.warnings.some(w => /identical/i.test(w))).toBe(false);
    });
});

describe('wlAnalysisImport ordering (D4)', () => {
    function proposalFor(fileName: string, tags: string, weight: number): WlTrialProposal {
        return proposed(makeFile(fileName, makeParsed({ tags, weight })));
    }

    it('uses attempt N as the ordinal and flags untagged files for confirmation', () => {
        const tagged = proposalFor('a.csv', 'squat attempt 2', 150);
        const untagged = proposalFor('b.csv', 'squat', 100);
        assignWlOrdinals([tagged, untagged], 6);
        expect(tagged.assignedOrdinal).toBe(2);
        expect(tagged.ambiguousOrder).toBe(false);
        expect(untagged.assignedOrdinal).toBe(1);
        expect(untagged.ambiguousOrder).toBe(true);
    });

    it('orders untagged files by load then file name', () => {
        const heavy = proposalFor('b.csv', 'squat', 150);
        const light = proposalFor('a.csv', 'squat', 100);
        const alsoLight = proposalFor('c.csv', 'squat', 100);
        assignWlOrdinals([heavy, light, alsoLight], 6);
        expect(light.assignedOrdinal).toBe(1);
        expect(alsoLight.assignedOrdinal).toBe(2);
        expect(heavy.assignedOrdinal).toBe(3);
    });

    it('blocks two files claiming the same attempt number', () => {
        const first = proposalFor('a.csv', 'squat attempt 1', 100);
        const second = proposalFor('b.csv', 'squat attempt 1', 120);
        expect(() => assignWlOrdinals([first, second], 6)).toThrow(/both claim attempt 1/i);
    });

    it('blocks ordinals beyond the protocol maxTrials', () => {
        const over = proposalFor('a.csv', 'squat attempt 9', 100);
        expect(() => assignWlOrdinals([over], 6)).toThrow(/at most 6 attempts/i);
        const many = [1, 2, 3].map(n => proposalFor(`${n}.csv`, 'squat', 100 * n));
        expect(() => assignWlOrdinals(many, 2)).toThrow(/do not fit/i);
    });
});

describe('wlAnalysisImport file dates', () => {
    it('reads both DD/MM and MM/DD interpretations', () => {
        expect(wlFileDateReadings('03/02/2025')).toEqual(['2025-02-03', '2025-03-02']);
        expect(wlFileDateReadings('31/02/2025')).toEqual([]);
        expect(wlFileDateReadings('not a date')).toEqual([]);
    });

    it('passes when the session matches either reading, warns otherwise', () => {
        const matching = proposed(makeFile('a.csv', makeParsed({ dateRaw: '03/02/2025' })), '2025-02-03');
        expect(matching.dateMismatch).toBe(false);
        const otherReading = proposed(makeFile('a.csv', makeParsed({ dateRaw: '03/02/2025' })), '2025-03-02');
        expect(otherReading.dateMismatch).toBe(false);
        const mismatch = proposed(makeFile('a.csv', makeParsed({ dateRaw: '03/02/2025' })), '2025-04-01');
        expect(mismatch.dateMismatch).toBe(true);
        expect(mismatch.warnings.some(w => /does not match the session date/i.test(w))).toBe(true);
    });
});

describe('wlAnalysisImport draft rows (D5)', () => {
    it('fills declared strength fields and passes provenance through', () => {
        const proposal = proposed(makeFile('a.csv', makeParsed()));
        proposal.assignedOrdinal = 1;
        const row = wlProposalToDraftRow(proposal, 1, BACK_SQUAT_1RM_PROTOCOL_V2);
        expect(row.values).toEqual({
            load_kg: 150,
            mean_concentric_velocity_mps: 0.56,
            peak_velocity_mps: 0.8,
            successful: true,
        });
        expect(row.validity).toBe('valid');
        expect(row.sourceRef).toBe(proposal.sourceRef);
        expect(row.context).toEqual(proposal.context);
        expect(row.device).toEqual({ provider: WL_ANALYSIS_DEVICE_PROVIDER });
        expect(row.importReview).toEqual({
            loadKgConfirmed: false,
            successConfirmed: false,
            validityConfirmed: false,
        });
    });

    it('rejects a load outside the protocol bounds', () => {
        const proposal = proposed(makeFile('a.csv', makeParsed({ weight: 900 })));
        proposal.assignedOrdinal = 1;
        expect(() => wlProposalToDraftRow(proposal, 1, BACK_SQUAT_1RM_PROTOCOL_V2)).toThrow(/outside this test's .* range/i);
    });
});

describe('wlAnalysisImport apply guards', () => {
    function ordered(tags: string, attemptNumber: number | null): WlTrialProposal {
        const parsed = makeParsed({ tags });
        const proposal = proposed(makeFile(`${tags}.csv`, parsed));
        proposal.attemptNumber = attemptNumber;
        proposal.assignedOrdinal = attemptNumber;
        return proposal;
    }

    it('fills unsaved draft rows but never overwrites saved ones', () => {
        const proposals = [ordered('squat attempt 1', 1), ordered('squat attempt 2', 2)];
        // Ordinals 1-6 exist as empty planned draft rows: filling them is allowed.
        expect(checkWlApplyBlocked(proposals, new Set(), new Set([1, 2, 3, 4, 5, 6]), 15)).toEqual([]);
        // Ordinal 2 already saved: blocked.
        expect(checkWlApplyBlocked(proposals, new Set([2]), new Set([1, 2, 3, 4, 5, 6]), 15)).toEqual([
            expect.stringMatching(/attempt 2.*already saved/i),
        ]);
    });

    it('blocks growth beyond maxTrials', () => {
        const proposals = [ordered('squat attempt 7', 7), ordered('squat attempt 8', 8)];
        expect(checkWlApplyBlocked(proposals, new Set(), new Set([1, 2, 3, 4, 5, 6]), 6)).toEqual([
            expect.stringMatching(/at most 6 attempts/i),
        ]);
    });
});

describe('wlAnalysisImport scope (D7)', () => {
    const attempt = (state: AssessmentAttempt['state']): AssessmentAttempt => ({
        id: 'att-1',
        protocolRef: { id: 'strength-back-squat-1rm', revision: 2 },
        state,
        purpose: 'baseline',
    });

    it('offers import only in capture of an open attempt with the complete WL field schema', () => {
        expect(canImportWlAnalysis(BACK_SQUAT_1RM_PROTOCOL_V2, attempt('in_progress'))).toBe(true);
        expect(canImportWlAnalysis(BACK_SQUAT_1RM_PROTOCOL_V2, attempt('completed'))).toBe(false);
        expect(canImportWlAnalysis(BACK_SQUAT_1RM_PROTOCOL_V2, attempt('scheduled'))).toBe(false);
        expect(canImportWlAnalysis(STANDING_BROAD_JUMP_PROTOCOL, attempt('in_progress'))).toBe(false);

        const missingPeak: MeasurementProtocol = {
            ...BACK_SQUAT_1RM_PROTOCOL_V2,
            capture: {
                ...BACK_SQUAT_1RM_PROTOCOL_V2.capture!,
                fields: BACK_SQUAT_1RM_PROTOCOL_V2.capture!.fields.filter(field => field.id !== 'peak_velocity_mps'),
            },
        };
        expect(canImportWlAnalysis(missingPeak, attempt('in_progress'))).toBe(false);
    });
});

describe('wlAnalysisImport same-batch source identity', () => {
    it('rejects the second proposal once the first digest is registered for the batch', () => {
        const seen = new Set<string>();
        const first = proposeWlTrial(makeFile('first.csv', makeParsed(), 'c'.repeat(64)), null, seen);
        expect(first.status).toBe('proposed');
        if (first.status !== 'proposed') return;
        seen.add(first.proposal.sourceRef);

        const second = proposeWlTrial(makeFile('second.csv', makeParsed(), 'c'.repeat(64)), null, seen);
        expect(second.status).toBe('rejected');
        if (second.status === 'rejected') expect(second.rejection.reason).toMatch(/already imported/i);
    });
});

describe('wlAnalysisImport hashing', () => {
    it('computes the SHA-256 hex of raw bytes', async () => {
        const bytes = new TextEncoder().encode('abc');
        expect(await sha256Hex(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
});
