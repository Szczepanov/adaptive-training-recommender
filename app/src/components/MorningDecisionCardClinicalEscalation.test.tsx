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
        expect(html).not.toContain('1-Tap Alternatives');
        expect(html).not.toContain('Workout Steps');
    });
});
