/** Shared velocity-file import checks and draft mapping; source-specific interpretation stays in adapters. */
import type { AssessmentAttempt, MeasurementProtocol, MetricObservationDevice, ObservationValidity } from './models';
import type { DraftTrialRow } from '../utils/assessmentDraftStorage';

export interface VelocityTrialProposal {
    fileName: string;
    assignedOrdinal: number | null;
    sourceRef: string;
    loadKg: number | null;
    meanVelocityMps: number;
    peakVelocityMps: number;
    successful: boolean | undefined;
    validity: ObservationValidity;
    notes: string;
    device: MetricObservationDevice;
    context: Record<string, string | number | boolean | null>;
}

export function hasVelocityImportSchema(protocol: MeasurementProtocol): boolean {
    const fields = new Map(protocol.capture?.fields.map(field => [field.id, field] as const) ?? []);
    const load = fields.get('load_kg');
    const mean = fields.get('mean_concentric_velocity_mps');
    const peak = fields.get('peak_velocity_mps');
    const successful = fields.get('successful');
    return load?.valueKind === 'number' && load.unit === 'kg'
        && mean?.valueKind === 'number' && mean.unit === 'm/s'
        && peak?.valueKind === 'number' && peak.unit === 'm/s'
        && successful?.valueKind === 'boolean';
}

/** True only on the capture screen of an open attempt with the complete velocity import schema (D7). */
export function canImportVelocityFile(protocol: MeasurementProtocol, attempt: AssessmentAttempt): boolean {
    return attempt.state === 'in_progress' && hasVelocityImportSchema(protocol);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Import needs WebCrypto (SHA-256), which this browser did not provide. Type the values by hand instead.');
    }
    const digest = await subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function checkVelocityImportApplyBlocked(
    proposals: readonly VelocityTrialProposal[],
    storedOrdinals: ReadonlySet<number>,
    occupiedOrdinals: ReadonlySet<number>,
    maxTrials: number,
): string[] {
    const errors: string[] = [];
    for (const proposal of proposals) {
        if (proposal.assignedOrdinal !== null && storedOrdinals.has(proposal.assignedOrdinal)) {
            errors.push(
                `Attempt ${proposal.assignedOrdinal} ("${proposal.fileName}") is already saved and cannot be overwritten.`,
            );
        }
    }
    const assigned = new Set(
        proposals.map(proposal => proposal.assignedOrdinal).filter((ordinal): ordinal is number => ordinal !== null),
    );
    const growth = [...assigned].filter(ordinal => !occupiedOrdinals.has(ordinal)).length;
    if (occupiedOrdinals.size + growth > maxTrials) {
        errors.push(
            `These files need ${growth} new row(s) but this test allows at most ${maxTrials} attempts.`,
        );
    }
    return errors;
}

function requireFiniteNumber(value: unknown, label: string, fileName: string): asserts value is number {
    if (!Number.isFinite(value)) throw new Error(`File "${fileName}": ${label} is not a number.`);
}

function requireNumberField(
    protocol: MeasurementProtocol,
    sourceLabel: string,
    fieldId: string,
    unit: 'kg' | 'm/s',
    value: number,
    fileName: string,
): void {
    const field = protocol.capture?.fields.find(candidate => candidate.id === fieldId);
    if (!field || field.valueKind !== 'number' || field.unit !== unit) {
        throw new Error(`This protocol does not declare ${sourceLabel} field ${fieldId} in ${unit}.`);
    }
    if (value < field.minimum || value > field.maximum) {
        throw new Error(
            `File "${fileName}": ${field.label.toLowerCase()} ${value} ${unit} is outside this test's `
            + `${field.minimum}–${field.maximum} ${unit} range.`,
        );
    }
}

function requireBooleanField(protocol: MeasurementProtocol, sourceLabel: string, fieldId: string): void {
    const field = protocol.capture?.fields.find(candidate => candidate.id === fieldId);
    if (!field || field.valueKind !== 'boolean') {
        throw new Error(`This protocol does not declare ${sourceLabel} field ${fieldId} as a boolean.`);
    }
}

/**
 * Build the draft row for an ordered proposal. The caller fills a free row or creates
 * one; stored (immutable) rows are never overwritten — the panel blocks those upfront.
 */
export function velocityProposalToDraftRow(
    proposal: VelocityTrialProposal,
    ordinal: number,
    protocol: MeasurementProtocol,
    sourceLabel: string,
): DraftTrialRow {
    requireFiniteNumber(proposal.loadKg, 'load', proposal.fileName);
    requireFiniteNumber(proposal.meanVelocityMps, 'mean velocity', proposal.fileName);
    requireFiniteNumber(proposal.peakVelocityMps, 'peak velocity', proposal.fileName);
    requireNumberField(protocol, sourceLabel, 'load_kg', 'kg', proposal.loadKg, proposal.fileName);
    requireNumberField(protocol, sourceLabel, 'mean_concentric_velocity_mps', 'm/s', proposal.meanVelocityMps, proposal.fileName);
    requireNumberField(protocol, sourceLabel, 'peak_velocity_mps', 'm/s', proposal.peakVelocityMps, proposal.fileName);
    requireBooleanField(protocol, sourceLabel, 'successful');
    const values: Record<string, number | boolean> = {
        load_kg: proposal.loadKg,
        mean_concentric_velocity_mps: proposal.meanVelocityMps,
        peak_velocity_mps: proposal.peakVelocityMps,
    };
    if (proposal.successful !== undefined) values.successful = proposal.successful;
    return {
        ordinal,
        values,
        validity: proposal.validity,
        ...(proposal.notes ? { notes: proposal.notes } : {}),
        device: proposal.device,
        sourceRef: proposal.sourceRef,
        context: proposal.context,
        importReview: {
            loadKgConfirmed: false,
            successConfirmed: proposal.successful === undefined,
            validityConfirmed: false,
        },
    };
}
