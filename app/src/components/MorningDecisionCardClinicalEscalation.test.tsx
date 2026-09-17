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
            rationale: 'Base phase build toward your goal event. Coverage tier: 1. Benefit score: 3.40, Fatigue cost penalty: 0.12. (Advances an explicit required weekly programming role.) (Sequence intent: recondition/spread, preferred key gap 2d.)',
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

        const whyCallout = html.match(/<div class="hero-why-callout"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
        const whyText = whyCallout.match(/<p class="why-text">([\s\S]*?)<\/p>/)?.[1] ?? '';
        const technicalDetails = whyCallout.match(/<details class="why-technical-details">([\s\S]*?)<\/details>/)?.[1] ?? '';

        // Coaching narrative contains the human-facing sentence and none of the engine
        // internals -- an athlete reads what the plan is for, not how it was scored.
        expect(whyText).toContain('Base phase build toward your goal event.');
        expect(whyText).not.toContain('Coverage tier');
        expect(whyText).not.toContain('Advances an explicit required weekly programming role');
        expect(whyText).not.toContain('Sequence intent');
        // Every technical clause -- the leading score formula and every parenthetical
        // scoring/sequencing clause that follows it -- is rendered inside the dedicated
        // details disclosure instead.
        expect(technicalDetails).toContain('Engine scoring telemetry');
        expect(technicalDetails).toContain('Coverage tier: 1. Benefit score: 3.40, Fatigue cost penalty: 0.12.');
        expect(technicalDetails).toContain('(Advances an explicit required weekly programming role.)');
        expect(technicalDetails).toContain('(Sequence intent: recondition/spread, preferred key gap 2d.)');
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

        const whyCallout = html.match(/<div class="hero-why-callout"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
        const whyText = whyCallout.match(/<p class="why-text">([\s\S]*?)<\/p>/)?.[1] ?? '';
        const technicalDetails = whyCallout.match(/<details class="why-technical-details">([\s\S]*?)<\/details>/)?.[1] ?? '';

        expect(whyText).toContain('Optimized for current weekly phase and recovery balance.');
        expect(technicalDetails).toContain('Engine scoring telemetry');
        expect(technicalDetails).toContain('Coverage tier: 2. Benefit score: 2.10, Fatigue cost penalty: 0.05.');
    });
});
