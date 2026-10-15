import type { RepetitionEntryPayload } from '../../../sessions/models';
import type { IntensityGauge } from '../../../engine/models';

export type GaugeScaleType = 'none' | 'rpe' | 'rir' | 'velocity_loss' | 'technical';

export interface RepetitionDraft {
    reps: string;
    weight: string;
    isWarmup: boolean;
    gaugeScale: GaugeScaleType;
    gaugeVal: string;
    technicalMet: boolean;
    technicalNote: string;
}

function parseBounded(raw: string, min: number, max: number): number | undefined {
    if (raw.trim().length === 0) return undefined;
    const val = parseFloat(raw);
    return Number.isFinite(val) && val >= min && val <= max ? val : undefined;
}

/** Builds the optional intensity gauge; an out-of-range or empty value yields no gauge. */
export function buildIntensityGauge(draft: RepetitionDraft): IntensityGauge | undefined {
    switch (draft.gaugeScale) {
        case 'rpe': {
            const value = parseBounded(draft.gaugeVal, 1, 10);
            return value === undefined ? undefined : { scale: 'rpe_rts', value };
        }
        case 'rir': {
            const value = parseBounded(draft.gaugeVal, 0, 10);
            return value === undefined ? undefined : { scale: 'rir', value };
        }
        case 'velocity_loss': {
            const percent = parseBounded(draft.gaugeVal, 0, 100);
            return percent === undefined ? undefined : { scale: 'velocity_loss', percent };
        }
        case 'technical':
            return {
                scale: 'technical',
                met: draft.technicalMet,
                ...(draft.technicalNote.trim().length > 0 ? { note: draft.technicalNote.trim() } : {}),
            };
        default:
            return undefined;
    }
}

/** Returns `null` when the draft cannot be logged (reps missing, non-numeric or not positive). */
export function buildRepetitionPayload(draft: RepetitionDraft): RepetitionEntryPayload | null {
    const reps = parseInt(draft.reps, 10);
    if (isNaN(reps) || reps <= 0) return null;
    const weightKg = draft.weight.trim().length > 0 ? parseFloat(draft.weight) : undefined;
    const gauge = buildIntensityGauge(draft);
    return {
        kind: 'repetition',
        setIndex: 1, // dynamically indexed by caller
        reps,
        ...(weightKg !== undefined ? { weightKg } : {}),
        isWarmup: draft.isWarmup,
        ...(gauge ? { gauge } : {}),
    };
}

export interface SingleFlightGuard { current: boolean }

/**
 * Runs `work` unless a previous run is still in flight. The guard is a plain mutable flag (a React
 * ref) because state updates are not synchronous enough to stop two submit events in one tick.
 * Returns whether `work` ran. The guard is always released, including when `work` throws.
 */
export async function runSingleFlight(guard: SingleFlightGuard, work: () => Promise<void>): Promise<boolean> {
    if (guard.current) return false;
    guard.current = true;
    try {
        await work();
        return true;
    } finally {
        guard.current = false;
    }
}

export interface SelectableField { focus(): void; select(): void }

/** Focuses a field and selects its content so the next weight overwrites the previous one. */
export function focusAndSelect(field: SelectableField | null | undefined): void {
    if (!field) return;
    field.focus();
    field.select();
}
