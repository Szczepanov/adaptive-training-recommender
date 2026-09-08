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
