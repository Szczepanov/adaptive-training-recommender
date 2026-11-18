import type { IntensityGauge } from '../../../ledger/models';
import type { SessionStep } from '../../../sessions/models';

/**
 * Optional RPE for sets that are not rep-based (holds, carries, distance splits). RIR and
 * velocity loss only make sense for repetitions, so these cards offer RPE alone.
 */
export function buildRpeGauge(raw: string): IntensityGauge | undefined {
    if (raw.trim().length === 0) return undefined;
    const value = parseFloat(raw);
    return Number.isFinite(value) && value >= 1 && value <= 10 ? { scale: 'rpe_rts', value } : undefined;
}

export function rpePlaceholderFor(step: SessionStep): string {
    const prescribed = step.effort?.kind === 'rpe' ? step.effort.target : step.effort?.rpe;
    if (typeof prescribed === 'number') return `Target: ${prescribed}`;
    if (typeof prescribed === 'object') return `Target: ${prescribed.min}-${prescribed.max}`;
    return 'Optional';
}
