import type { ExternalPrescriptionStep } from '../engine/models';

export function stepTiming(step: ExternalPrescriptionStep): string | null {
    const parts: string[] = [];
    if (step.durationMin !== undefined) parts.push(`${step.durationMin} min`);
    if (step.durationSec !== undefined) parts.push(`${step.durationSec} s`);
    if (step.sets !== undefined && step.sets > 1) parts.push(`${step.sets} sets`);
    if (step.repeat !== undefined && step.repeat > 1) parts.push(`× ${step.repeat}`);
    if (step.recoveryMin !== undefined) parts.push(`${step.recoveryMin} min recovery`);
    if (step.recoverySec !== undefined) parts.push(`${step.recoverySec} s recovery`);
    if (step.setRecoveryMin !== undefined) parts.push(`${step.setRecoveryMin} min between sets`);
    if (step.setRecoverySec !== undefined) parts.push(`${step.setRecoverySec} s between sets`);
    return parts.length > 0 ? parts.join(' · ') : null;
}
