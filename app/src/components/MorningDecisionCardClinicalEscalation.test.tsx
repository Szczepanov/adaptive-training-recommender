import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Recommendation } from '../engine/models';
import type { MorningDecisionEvidence } from '../engine/decisionEvidence';
import type { WorkoutPrescription } from '../workouts';
import { MorningDecisionCard } from './MorningDecisionCard';

const recommendation = {
    mode: 'recover',
    template: {
        title: 'Recovery Mobility',
        modality: 'Mobility',
        category: 'Recovery',
        durationMin: 20,
        durationMax: 30,
    },
    rationale: '1-tap alternative applied: Joint Mobility & Recovery flow.',
    envelopes: {
        safety: {
            clinicalEscalationRequired: true,
            clinicalReason: 'Systemic / cardiopulmonary warning reported.',
        },
    },
} as unknown as Recommendation;

const evidence = {
    confidence: {
        badgeClass: 'confidence-low',
        label: 'Low confidence',
    },
    boundaries: {
        harderAdjustmentAllowed: false,
        hardGates: [],
    },
} as unknown as MorningDecisionEvidence;

const prescription = {
    targetDurationMin: 30,
    displayBlocks: [],
} as unknown as WorkoutPrescription;

describe('MorningDecisionCard clinical escalation', () => {
    it('keeps explanation visible while suppressing every executable or stale prescription surface', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                userId="athlete"
                date="2026-09-02"
                recommendation={recommendation}
                evidence={evidence}
                prescription={prescription}
                adjustmentDirection={null}
                activeAlternativeId="mobility"
                onStartSession={() => undefined}
                onAdjustLoad={() => undefined}
                onSelectTimeCrunch={() => undefined}
                onSelectHomeAlternative={() => undefined}
                onSelectMobilityAlternative={() => undefined}
                onSelectActiveRecoveryWalk={() => undefined}
                onResetAlternative={() => undefined}
            />,
        );

        expect(html).toContain('Clinical Evaluation Recommended');
        expect(html).toContain('Training Paused');
        expect(html).toContain('Systemic / cardiopulmonary warning reported.');
        expect(html).toContain('Why &amp; Invalidation Rules');
        expect(html).not.toContain('Recovery Mobility');
        expect(html).not.toContain('1-tap alternative applied');
        expect(html).not.toContain('Start Session');
        expect(html).not.toContain('View Workout Targets');
        expect(html).not.toContain('Export / Sync');
        expect(html).not.toContain('Copy AI Context');
        expect(html).not.toContain('1-Tap Alternatives');
        expect(html).not.toContain('Workout Steps');
    });

    it('renders the 1-click Copy AI Context button when normal recommendation is active', () => {
        const normalRec = {
            mode: 'train',
            template: {
                title: 'Aerobic Foundation',
                modality: 'Cycling',
                category: 'Easy Endurance',
                durationMin: 60,
                durationMax: 75,
            },
            rationale: 'Readiness is solid.',
            envelopes: {
                safety: {
                    clinicalEscalationRequired: false,
                },
            },
        } as unknown as Recommendation;

        const html = renderToStaticMarkup(
            <MorningDecisionCard
                userId="athlete"
                date="2026-09-02"
                recommendation={normalRec}
                evidence={evidence}
                prescription={prescription}
                adjustmentDirection={null}
                activeAlternativeId={null}
                onStartSession={() => undefined}
                onAdjustLoad={() => undefined}
                onSelectTimeCrunch={() => undefined}
                onSelectHomeAlternative={() => undefined}
                onSelectMobilityAlternative={() => undefined}
                onSelectActiveRecoveryWalk={() => undefined}
                onResetAlternative={() => undefined}
            />,
        );

        expect(html).toContain('Copy AI Context');
    });

    it('separates technical scoring formula into expandable telemetry disclosure while displaying clean coaching rationale', () => {
        const technicalRec = {
            mode: 'train',
            template: {
                title: 'Threshold Intervals',
                modality: 'Running',
                category: 'Threshold',
                durationMin: 45,
                durationMax: 50,
            },
            rationale: 'Coverage tier: 1. Benefit score: 3.40, Fatigue cost penalty: 0.12. (Advances an explicit required weekly programming role.)',
            envelopes: {
                safety: {
                    clinicalEscalationRequired: false,
                },
            },
        } as unknown as Recommendation;

        const html = renderToStaticMarkup(
            <MorningDecisionCard
                userId="athlete"
                date="2026-09-02"
                recommendation={technicalRec}
                evidence={evidence}
                prescription={prescription}
                adjustmentDirection={null}
                activeAlternativeId={null}
                onStartSession={() => undefined}
                onAdjustLoad={() => undefined}
                onSelectTimeCrunch={() => undefined}
                onSelectHomeAlternative={() => undefined}
                onSelectMobilityAlternative={() => undefined}
                onSelectActiveRecoveryWalk={() => undefined}
                onResetAlternative={() => undefined}
            />,
        );

        // Coaching narrative contains the human-facing text
        expect(html).toContain('(Advances an explicit required weekly programming role.)');
        // Technical scoring formula is rendered inside the dedicated details disclosure
        expect(html).toContain('why-technical-details');
        expect(html).toContain('Engine scoring telemetry');
        expect(html).toContain('Coverage tier: 1. Benefit score: 3.40, Fatigue cost penalty: 0.12.');
    });

    it('provides fallback coaching narrative when rationale consists solely of scoring formulas', () => {
        const formulaOnlyRec = {
            mode: 'train',
            template: {
                title: 'Easy Aerobic',
                modality: 'Cycling',
                category: 'Easy Endurance',
                durationMin: 45,
                durationMax: 60,
            },
            rationale: 'Coverage tier: 2. Benefit score: 2.10, Fatigue cost penalty: 0.05.',
            envelopes: {
                safety: {
                    clinicalEscalationRequired: false,
                },
            },
        } as unknown as Recommendation;

        const html = renderToStaticMarkup(
            <MorningDecisionCard
                userId="athlete"
                date="2026-09-02"
                recommendation={formulaOnlyRec}
                evidence={evidence}
                prescription={prescription}
                adjustmentDirection={null}
                activeAlternativeId={null}
                onStartSession={() => undefined}
                onAdjustLoad={() => undefined}
                onSelectTimeCrunch={() => undefined}
                onSelectHomeAlternative={() => undefined}
                onSelectMobilityAlternative={() => undefined}
                onSelectActiveRecoveryWalk={() => undefined}
                onResetAlternative={() => undefined}
            />,
        );

        expect(html).toContain('Optimized for current weekly phase and recovery balance.');
        expect(html).toContain('Coverage tier: 2. Benefit score: 2.10, Fatigue cost penalty: 0.05.');
    });
});
