/**
 * Issue #897 PR B2: map parsed WL Analysis files onto strength trial rows (D3–D6).
 *
 * Pure mapping logic: file -> trial proposal, batch ordering, duplicate detection and
 * draft-row construction. Hashing the raw bytes (SHA-256 via `crypto.subtle`) and reading
 * files live in the UI panel; everything else here is synchronous and unit-tested.
 *
 * Out of scope: protocols, canonical metrics, engine/policy changes (evidence only).
 */

import type {
    MeasurementProtocol,
    MetricObservationDevice,
    ObservationValidity,
} from './models';
import type { DraftTrialRow } from '../utils/assessmentDraftStorage';
import {
    wlFrameDataSignature,
    type WlAnalysisCsvParse,
} from './wlAnalysisCsv';

/** Trial device provider recorded for imported rows without an explicit override. */
export const WL_ANALYSIS_DEVICE_PROVIDER = 'WL Analysis';

/** Scalar trial-context keys recorded for every imported row (D5). */
export const WL_CONTEXT_KEYS = {
    parserVersion: 'wl_parser_version',
    repCount: 'wl_rep_count',
    selectedRep: 'wl_selected_rep',
    romCm: 'wl_rom_cm',
    frameRate: 'wl_frame_rate',
    resolution: 'wl_resolution',
} as const;

export { canImportVelocityFile as canImportWlAnalysis, checkVelocityImportApplyBlocked as checkWlApplyBlocked, sha256Hex } from './velocityFileImport';
import { velocityProposalToDraftRow } from './velocityFileImport';

export interface WlImportFile {
    fileName: string;
    /** Lowercase 64-hex SHA-256 of the raw file bytes. */
    fileHash: string;
    parsed: WlAnalysisCsvParse;
}

export interface WlTrialProposal {
    fileName: string;
    sourceRef: string;
    loadKg: number;
    meanVelocityMps: number;
    peakVelocityMps: number;
    romCm: number;
    repCount: number;
    /** One-based position of the chosen rep among the detected reps. */
    selectedRep: number;
    /** Pre-filled from the completed ascent; the athlete confirms success/miss. */
    successful: boolean | undefined;
    validity: ObservationValidity;
    /** True for single-rep files: success was inferred, not observed. */
    autoDetectedSuccess: boolean;
    accommodatingResistance: boolean;
    attemptNumber: number | null;
    /** Assigned by `assignWlOrdinals`; null until ordering runs. */
    assignedOrdinal: number | null;
    /** True when the ordinal was assumed (no `attempt N` tag): the athlete confirms. */
    ambiguousOrder: boolean;
    dateMismatch: boolean;
    warnings: string[];
    notes: string;
    device: MetricObservationDevice;
    context: Record<string, string | number | boolean | null>;
    frameSignature: string;
}

export interface WlImportRejection {
    fileName: string;
    reason: string;
}

export type WlProposeOutcome =
    | { status: 'proposed'; proposal: WlTrialProposal }
    | { status: 'rejected'; rejection: WlImportRejection };

const ATTEMPT_TAG_PATTERN = /attempt\s+(\d+)/i;
const ACCOMMODATING_PATTERN = /chain|band/i;
const FILE_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export function parseWlAttemptNumber(tags: string): number | null {
    const match = tags.match(ATTEMPT_TAG_PATTERN);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) && value >= 1 ? value : null;
}

export function hasAccommodatingResistance(tags: string): boolean {
    return ACCOMMODATING_PATTERN.test(tags);
}

export function wlSourceRefFor(fileHash: string): string {
    return `wl-analysis-csv:sha256:${fileHash}`;
}

function validIsoDate(year: string, monthRaw: string, dayRaw: string): string | null {
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const yearNumber = Number(year);
    if (!Number.isInteger(yearNumber) || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(yearNumber, month - 1, day));
    if (date.getUTCFullYear() !== yearNumber || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Both valid readings of an ambiguous `DD/MM/YYYY`-or-`MM/DD/YYYY` file date. */
export function wlFileDateReadings(dateRaw: string): string[] {
    const match = dateRaw.trim().match(FILE_DATE_PATTERN);
    if (!match) return [];
    const [, first, second, year] = match;
    const readings = new Set<string>();
    const ddMm = validIsoDate(year, second, first);
    const mmDd = validIsoDate(year, first, second);
    if (ddMm) readings.add(ddMm);
    if (mmDd) readings.add(mmDd);
    return [...readings];
}

function fastestRepIndex(parsed: WlAnalysisCsvParse): number {
    let best = 0;
    for (let i = 1; i < parsed.reps.length; i += 1) {
        if (parsed.reps[i].meanVelocityMps > parsed.reps[best].meanVelocityMps) best = i;
    }
    return best;
}

/**
 * Map one parsed file to a trial proposal (D3). Rejections carry a plain-language reason
 * and never produce a trial row.
 */
export function proposeWlTrial(
    file: WlImportFile,
    sessionDate: string | null,
    existingSourceRefs: ReadonlySet<string>,
): WlProposeOutcome {
    const { fileName, parsed } = file;
    const sourceRef = wlSourceRefFor(file.fileHash);
    if (existingSourceRefs.has(sourceRef)) {
        return {
            status: 'rejected',
            rejection: {
                fileName,
                reason: 'This file was already imported (same content). Each file can only be imported once.',
            },
        };
    }
    if (parsed.reps.length === 0) {
        return {
            status: 'rejected',
            rejection: {
                fileName,
                reason: 'No lift was detected in this file (no upward movement with enough range). Film one attempt per video and try again.',
            },
        };
    }

    const single = parsed.reps.length === 1;
    const selected = single ? 0 : fastestRepIndex(parsed);
    const rep = parsed.reps[selected];
    const accommodating = hasAccommodatingResistance(parsed.tags);
    const attemptNumber = parseWlAttemptNumber(parsed.tags);

    // Multi-rep warm-up sets use the standard load-velocity-profile convention: the
    // fastest rep's mean/peak velocity represents the set.
    const validity: ObservationValidity = single && !accommodating ? 'valid' : 'practice';
    const successful = single && !accommodating ? rep.complete : undefined;
    const autoDetectedSuccess = single && !accommodating;

    const warnings: string[] = [];
    if (!single) {
        warnings.push(`Warm-up set: using the fastest of ${parsed.reps.length} reps (rep ${selected + 1}). Recorded as practice.`);
    }
    if (accommodating) {
        warnings.push('Tags mention chains or bands: accommodating resistance is not comparable with straight-weight attempts. Recorded as practice.');
    }

    let dateMismatch = false;
    const readings = wlFileDateReadings(parsed.dateRaw);
    if (sessionDate && readings.length > 0 && !readings.includes(sessionDate)) {
        dateMismatch = true;
        warnings.push(`File date ${parsed.dateRaw} does not match the session date under either DD/MM or MM/DD reading. Check it is the right video.`);
    } else if (sessionDate && readings.length === 0) {
        warnings.push(`Could not read the file date ("${parsed.dateRaw}"). Check it is the right video.`);
    }

    const notesParts: string[] = [];
    if (autoDetectedSuccess) {
        notesParts.push(`WL Analysis auto-detected ${rep.complete ? 'success' : 'miss'} — confirm`);
    }
    if (accommodating) notesParts.push('accommodating resistance, not comparable with straight-weight attempts');
    if (!single) notesParts.push(`fastest of ${parsed.reps.length} reps (rep ${selected + 1})`);

    return {
        status: 'proposed',
        proposal: {
            fileName,
            sourceRef,
            loadKg: parsed.weight,
            meanVelocityMps: rep.meanVelocityMps,
            peakVelocityMps: rep.peakVelocityMps,
            romCm: rep.romCm,
            repCount: parsed.reps.length,
            selectedRep: selected + 1,
            successful,
            validity,
            autoDetectedSuccess,
            accommodatingResistance: accommodating,
            attemptNumber,
            assignedOrdinal: null,
            ambiguousOrder: attemptNumber === null,
            dateMismatch,
            warnings,
            notes: notesParts.join('; '),
            device: { provider: WL_ANALYSIS_DEVICE_PROVIDER },
            context: {
                // Preserve the actual derivation method (ADR-0046 D-AT-IMPORT); a future ADR-0047
                // fixed-load series must carry this parser version in its measurement-method identity.
                [WL_CONTEXT_KEYS.parserVersion]: parsed.parserVersion,
                [WL_CONTEXT_KEYS.repCount]: parsed.reps.length,
                [WL_CONTEXT_KEYS.selectedRep]: selected + 1,
                [WL_CONTEXT_KEYS.romCm]: rep.romCm,
                [WL_CONTEXT_KEYS.frameRate]: parsed.frameRate,
                [WL_CONTEXT_KEYS.resolution]: parsed.resolution,
            },
            frameSignature: wlFrameDataSignature(parsed.frames),
        },
    };
}

/**
 * Warn when two files in one batch carry identical per-frame data or identical summary
 * blocks: the same video was probably exported twice (D6). Never blocks; never silent.
 */
export function annotateWlBatchDuplicates(proposals: WlTrialProposal[], summaryBySourceRef: ReadonlyMap<string, string>): void {
    const seenFrames = new Map<string, string>();
    const seenSummary = new Map<string, string>();
    for (const proposal of proposals) {
        const frameHolder = seenFrames.get(proposal.frameSignature);
        if (frameHolder && frameHolder !== proposal.fileName) {
            proposal.warnings.push(`Identical movement data to ${frameHolder}: the same video may have been exported twice.`);
        } else {
            seenFrames.set(proposal.frameSignature, proposal.fileName);
        }
        const summary = summaryBySourceRef.get(proposal.sourceRef) ?? '';
        if (summary.length > 0) {
            const summaryHolder = seenSummary.get(summary);
            if (summaryHolder && summaryHolder !== proposal.fileName) {
                proposal.warnings.push(`Identical summary block to ${summaryHolder}: the same video may have been exported twice.`);
            } else {
                seenSummary.set(summary, proposal.fileName);
            }
        }
    }
}

/**
 * Assign row ordinals (D4): `attempt N` tags set the ordinal; files without one are
 * ordered by load ascending then file name and flagged for confirmation. Duplicate
 * attempt numbers block the import; ordinals must fit `maxTrials`.
 */
export function assignWlOrdinals(proposals: WlTrialProposal[], maxTrials: number): void {
    const claimed = new Map<number, string>();
    for (const proposal of proposals) {
        if (proposal.attemptNumber === null) continue;
        const holder = claimed.get(proposal.attemptNumber);
        if (holder) {
            throw new Error(
                `Files "${holder}" and "${proposal.fileName}" both claim attempt ${proposal.attemptNumber}. `
                + 'Tag each video with a different attempt number in WL Analysis and try again.',
            );
        }
        claimed.set(proposal.attemptNumber, proposal.fileName);
        if (proposal.attemptNumber > maxTrials) {
            throw new Error(
                `File "${proposal.fileName}" claims attempt ${proposal.attemptNumber}, but this test allows at most ${maxTrials} attempts.`,
            );
        }
    }
    if (proposals.length > maxTrials) {
        throw new Error(
            `These ${proposals.length} files do not fit into this test (at most ${maxTrials} attempts). Import fewer files.`,
        );
    }
    const taken = new Set(claimed.keys());
    const implicit = proposals
        .filter(proposal => proposal.attemptNumber === null)
        .sort((a, b) => a.loadKg - b.loadKg || a.fileName.localeCompare(b.fileName));
    for (const proposal of implicit) {
        let ordinal = 1;
        while (taken.has(ordinal)) ordinal += 1;
        proposal.assignedOrdinal = ordinal;
        proposal.ambiguousOrder = true;
        taken.add(ordinal);
        if (implicit.length > 1 || claimed.size > 0) {
            proposal.warnings.push(`No attempt number in the tags: ordered by load (${proposal.loadKg} kg). Confirm the order.`);
        }
    }
    for (const proposal of proposals) {
        if (proposal.attemptNumber !== null) {
            proposal.assignedOrdinal = proposal.attemptNumber;
            proposal.ambiguousOrder = false;
        }
    }
}

/** WL compatibility wrapper: preserves labels, bounds validation and review defaults. */
export function wlProposalToDraftRow(
    proposal: WlTrialProposal,
    ordinal: number,
    protocol: MeasurementProtocol,
): DraftTrialRow {
    return velocityProposalToDraftRow(proposal, ordinal, protocol, 'WL Analysis');
}
