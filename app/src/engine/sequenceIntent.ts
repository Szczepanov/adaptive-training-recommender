import type { PhaseWeights } from './periodization';

export type SequenceProgressionMode = 'recondition' | 'build' | 'specialize' | 'taper' | 'recovery';
export type QualityDensityMode = 'spread' | 'cluster_allowed' | 'density_emphasis';

/** Derived sequencing preference. It shapes soft ranking only; eligibility,
 * injury gates, recovery-hour rules, and exact weekly roles remain authoritative. */
export interface SequenceIntentPolicy {
    progressionMode: SequenceProgressionMode;
    qualityDensityMode: QualityDensityMode;
    minimumPreferredKeyGapDays: number;
    longSessionPriority: number;
    recoveryProtection: 'ordinary' | 'elevated' | 'taper';
    sourcePhase: PhaseWeights['phaseName'];
}

export interface SequenceIntentPreferenceContext {
    candidateIsKey: boolean;
    candidateIsRecovery: boolean;
    candidateIsLongEndurance: boolean;
    daysSinceLastKeySession: number | null;
    lastWasHighIntensity: boolean;
}

export interface SequenceIntentPreference {
    multiplier: number;
    reasons: string[];
}

export function resolveSequenceIntent(phase: Pick<PhaseWeights, 'phaseName'>): SequenceIntentPolicy {
    switch (phase.phaseName) {
        case 'Build':
            return { progressionMode: 'build', qualityDensityMode: 'spread', minimumPreferredKeyGapDays: 1, longSessionPriority: 0.75, recoveryProtection: 'ordinary', sourcePhase: phase.phaseName };
        case 'Specificity':
            return { progressionMode: 'specialize', qualityDensityMode: 'cluster_allowed', minimumPreferredKeyGapDays: 1, longSessionPriority: 1, recoveryProtection: 'ordinary', sourcePhase: phase.phaseName };
        case 'Peak/Taper':
            return { progressionMode: 'taper', qualityDensityMode: 'spread', minimumPreferredKeyGapDays: 2, longSessionPriority: 0.35, recoveryProtection: 'taper', sourcePhase: phase.phaseName };
        case 'Post-Event Recovery':
            return { progressionMode: 'recovery', qualityDensityMode: 'spread', minimumPreferredKeyGapDays: 3, longSessionPriority: 0.1, recoveryProtection: 'elevated', sourcePhase: phase.phaseName };
        case 'Base':
        default:
            return { progressionMode: 'recondition', qualityDensityMode: 'spread', minimumPreferredKeyGapDays: 2, longSessionPriority: 0.6, recoveryProtection: 'ordinary', sourcePhase: phase.phaseName };
    }
}

/**
 * Converts the phase policy into a bounded soft ranking adjustment. This intentionally
 * cannot make an excluded candidate eligible: it is evaluated only after the optimizer's
 * safety/recovery hard gates. The factors are product calibration, not physiological laws.
 */
export function resolveSequenceIntentPreference(
    policy: SequenceIntentPolicy,
    context: SequenceIntentPreferenceContext,
): SequenceIntentPreference {
    let multiplier = 1;
    const reasons: string[] = [];

    if (
        context.candidateIsKey &&
        context.daysSinceLastKeySession !== null &&
        context.daysSinceLastKeySession < policy.minimumPreferredKeyGapDays
    ) {
        const gapFactor = policy.qualityDensityMode === 'spread'
            ? 0.75
            : policy.qualityDensityMode === 'cluster_allowed'
                ? 0.95
                : 1.05;
        multiplier *= gapFactor;
        reasons.push(`key-session gap ${context.daysSinceLastKeySession}d is below preferred ${policy.minimumPreferredKeyGapDays}d`);
    }

    if (context.lastWasHighIntensity && context.candidateIsKey) {
        let stackFactor = policy.qualityDensityMode === 'cluster_allowed'
            ? 0.65
            : policy.qualityDensityMode === 'density_emphasis'
                ? 0.80
                : 0.35;
        if (policy.recoveryProtection === 'taper') stackFactor = Math.min(stackFactor, 0.25);
        if (policy.recoveryProtection === 'elevated') stackFactor = Math.min(stackFactor, 0.20);
        multiplier *= stackFactor;
        reasons.push(`quality-density policy ${policy.qualityDensityMode} adjusts consecutive high-intensity cost`);
    }

    if (context.lastWasHighIntensity && context.candidateIsRecovery && policy.recoveryProtection !== 'ordinary') {
        const recoveryFactor = policy.recoveryProtection === 'taper' ? 1.25 : 1.35;
        multiplier *= recoveryFactor;
        reasons.push(`${policy.recoveryProtection} recovery protection favors a recovery session after high intensity`);
    }

    if (context.candidateIsLongEndurance) {
        const boundedPriority = Math.min(1, Math.max(0, policy.longSessionPriority));
        const longFactor = 0.9 + (0.2 * boundedPriority);
        multiplier *= longFactor;
        reasons.push(`long-session priority ${boundedPriority.toFixed(2)}`);
    }

    return {
        multiplier: Math.min(1.5, Math.max(0.1, multiplier)),
        reasons,
    };
}
