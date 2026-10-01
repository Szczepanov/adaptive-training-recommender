import { assessmentTrialIdFor } from '../observations/assessmentTrials';
import type {
    AssessmentTrial,
    ComparisonContext,
    MetricObservationDevice,
} from '../observations/models';
import type { DraftTrialRow } from './assessmentDraftStorage';

function normalizeDevice(device: MetricObservationDevice | undefined): MetricObservationDevice | undefined {
    const provider = device?.provider?.trim();
    if (!device || !provider) return undefined;
    const model = device.model?.trim();
    const deviceId = device.deviceId?.trim();
    return { provider, ...(model ? { model } : {}), ...(deviceId ? { deviceId } : {}) };
}

/**
 * Build immutable trial records from draft rows: typed comparison context, normalized
 * device provenance, per-row import `sourceRef`/`context` pass-through and one
 * `createdAt` per save.
 */
export function draftRowsToTrials(
    rows: readonly DraftTrialRow[],
    attemptId: string,
    context: ComparisonContext,
    defaultDevice: MetricObservationDevice,
    createdAt: string,
): AssessmentTrial[] {
    const fallbackDevice = normalizeDevice(defaultDevice);
    return rows.map(row => {
        const device = normalizeDevice(row.device) ?? fallbackDevice;
        return {
            id: assessmentTrialIdFor(row.ordinal, 0),
            assessmentAttemptId: attemptId,
            ordinal: row.ordinal,
            correctionIndex: 0,
            validity: row.validity,
            ...(row.invalidReason?.trim() ? { invalidReason: row.invalidReason.trim() } : {}),
            values: row.values,
            context: row.context ? { ...context, ...row.context } : context,
            createdAt,
            ...(row.notes?.trim() ? { notes: row.notes.trim() } : {}),
            ...(device ? { device } : {}),
            ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}),
        };
    });
}

export function hasDeviceWithoutProvider(device: MetricObservationDevice | undefined): boolean {
    return !!device && !device.provider?.trim() && !!(device.model?.trim() || device.deviceId?.trim());
}
