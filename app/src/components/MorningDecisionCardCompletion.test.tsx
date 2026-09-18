import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Recommendation } from '../engine/models';
import type { MorningDecisionEvidence } from '../engine/decisionEvidence';
import type { WorkoutPrescription } from '../workouts';
import type { SessionExecution } from '../sessions/models';
import { MorningDecisionCard } from './MorningDecisionCard';

const recommendation = {
    mode: 'train',
    template: {
        title: 'Threshold Intervals',
        modality: 'Running',
        category: 'Intensity',
        durationMin: 45,
        durationMax: 60,
    },
    primarySession: {
        sessionSource: { kind: 'catalog', workoutId: 'running_threshold', catalogVersion: '1' },
        prescriptionHash: 'hash-running-threshold',
    },
    rationale: 'High readiness signals suggest high capacity for threshold intervals today.',
    envelopes: {
        safety: {
            clinicalEscalationRequired: false,
        },
    },
} as unknown as Recommendation;

const strengthRecommendation = {
    mode: 'train',
    template: {
        title: 'Full Body Strength',
        modality: 'Strength',
        category: 'Resistance',
        durationMin: 45,
        durationMax: 60,
    },
    primarySession: {
        sessionSource: { kind: 'catalog', workoutId: 'full_body_strength', catalogVersion: '1' },
        prescriptionHash: 'hash-strength-1',
    },
    rationale: 'Strength progression scheduled.',
    envelopes: {
        safety: {
            clinicalEscalationRequired: false,
        },
    },
} as unknown as Recommendation;

const evidence = {
    confidence: {
        badgeClass: 'confidence-high',
        label: 'High confidence',
    },
    boundaries: {
        harderAdjustmentAllowed: true,
        hardGates: [],
    },
} as unknown as MorningDecisionEvidence;

const prescription = {
    targetDurationMin: 50,
    displayBlocks: [],
} as unknown as WorkoutPrescription;

const baseExecution: SessionExecution = {
    userId: 'athlete-1',
    executionId: 'exec-today-1',
    sessionSource: { kind: 'catalog', workoutId: 'running_threshold', catalogVersion: '1' },
    prescriptionHash: 'hash-running-threshold',
    date: '2026-09-18',
    startedAt: '2026-09-18T08:00:00Z',
    updatedAt: '2026-09-18T08:00:00Z',
    state: 'in_progress',
    schemaVersion: 1,
};

describe('MorningDecisionCard session completion & resume state', () => {
    it('renders "Start Session →" CTA when no execution exists for today', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                userId="athlete-1"
                date="2026-09-18"
                recommendation={recommendation}
                evidence={evidence}
                prescription={prescription}
                adjustmentDirection={null}
                activeAlternativeId={null}
                todayExecution={null}
                onStartSession={() => undefined}
                onAdjustLoad={() => undefined}
                onSelectTimeCrunch={() => undefined}
                onSelectHomeAlternative={() => undefined}
                onSelectMobilityAlternative={() => undefined}
                onSelectActiveRecoveryWalk={() => undefined}
                onResetAlternative={() => undefined}
            />,
        );

        expect(html).toContain('Start Session →');
        expect(html).not.toContain('Resume Session →');
        expect(html).not.toContain('Completed ✓');
        expect(html).not.toContain('Redo Session');
    });

    it('renders "Resume Session →" when an execution is currently in progress', () => {
        const inProgressExecution: SessionExecution = {
            ...baseExecution,
            state: 'in_progress',
        };

        const html = renderToStaticMarkup(
            <MorningDecisionCard
                userId="athlete-1"
                date="2026-09-18"
                recommendation={recommendation}
                evidence={evidence}
                prescription={prescription}
                adjustmentDirection={null}
                activeAlternativeId={null}
                todayExecution={inProgressExecution}
                onStartSession={() => undefined}
                onAdjustLoad={() => undefined}
                onSelectTimeCrunch={() => undefined}
                onSelectHomeAlternative={() => undefined}
                onSelectMobilityAlternative={() => undefined}
                onSelectActiveRecoveryWalk={() => undefined}
                onResetAlternative={() => undefined}
            />,
        );

        expect(html).toContain('Resume Session →');
        expect(html).not.toContain('Start Session →');
        expect(html).not.toContain('Completed ✓');
        expect(html).not.toContain('Redo Session');
    });

    it('renders "Completed ✓" and "Redo Session" when an execution has completed today', () => {
        const completedExecution: SessionExecution = {
            ...baseExecution,
            state: 'completed',
            completedAt: '2026-09-18T08:50:00Z',
        };

        const html = renderToStaticMarkup(
            <MorningDecisionCard
                userId="athlete-1"
                date="2026-09-18"
                recommendation={recommendation}
                evidence={evidence}
                prescription={prescription}
                adjustmentDirection={null}
                activeAlternativeId={null}
                todayExecution={completedExecution}
                onStartSession={() => undefined}
                onAdjustLoad={() => undefined}
                onSelectTimeCrunch={() => undefined}
                onSelectHomeAlternative={() => undefined}
                onSelectMobilityAlternative={() => undefined}
                onSelectActiveRecoveryWalk={() => undefined}
                onResetAlternative={() => undefined}
            />,
        );

        expect(html).not.toContain('Start Session →');
        expect(html).not.toContain('Resume Session →');
        expect(html).toContain('Completed ✓');
        expect(html).toContain('role="status"');
        expect(html).toContain('View Targets');
        expect(html).toContain('Redo Session');
    });

    it('renders strength modality emoji and resume state for strength session in progress', () => {
        const inProgressExecution: SessionExecution = {
            ...baseExecution,
            state: 'in_progress',
        };

        const html = renderToStaticMarkup(
            <MorningDecisionCard
                userId="athlete-1"
                date="2026-09-18"
                recommendation={strengthRecommendation}
                evidence={evidence}
                prescription={prescription}
                adjustmentDirection={null}
                activeAlternativeId={null}
                todayExecution={inProgressExecution}
                onStartSession={() => undefined}
                onAdjustLoad={() => undefined}
                onSelectTimeCrunch={() => undefined}
                onSelectHomeAlternative={() => undefined}
                onSelectMobilityAlternative={() => undefined}
                onSelectActiveRecoveryWalk={() => undefined}
                onResetAlternative={() => undefined}
            />,
        );

        expect(html).toContain('🏋️');
        expect(html).toContain('Resume Session →');
    });
});
