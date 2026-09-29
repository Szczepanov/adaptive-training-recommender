import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExternalSessionVerdictSummary, Recommendation } from '../engine/models';
import type { MorningDecisionEvidence } from '../engine/decisionEvidence';
import { MorningDecisionCard } from './MorningDecisionCard';

type Prescription = NonNullable<Recommendation['externalPrescription']>;

const externalPrescription: Prescription = {
    planId: 'coach-block-a',
    revision: 3,
    sessionId: 'w2-tempo',
    title: 'Tempo intervals',
    prescription: {
        summary: '3x10 min at tempo with 3 min easy between.',
        steps: [{ name: 'Tempo x3', target: '88-92% FTP', durationMin: 10, sets: 3 }],
    },
};

const evidence = {
    confidence: { badgeClass: 'confidence-high', label: 'High confidence' },
    boundaries: { harderAdjustmentAllowed: true, hardGates: [] },
} as unknown as MorningDecisionEvidence;

const baseProps = {
    userId: 'athlete-1',
    date: '2026-09-29',
    evidence,
    adjustmentDirection: null,
    activeAlternativeId: null,
    todayExecution: null,
    onAdjustLoad: () => undefined,
    onSelectTimeCrunch: () => undefined,
    onSelectHomeAlternative: () => undefined,
    onSelectMobilityAlternative: () => undefined,
    onSelectActiveRecoveryWalk: () => undefined,
    onResetAlternative: () => undefined,
} as const;

function externalRecommendation(
    verdict: ExternalSessionVerdictSummary,
    extra: Partial<Recommendation> = {},
): Recommendation {
    return {
        mode: verdict.decision === 'skip' || verdict.decision === 'defer' ? 'recover' : 'train',
        template: {
            id: verdict.decision === 'skip' || verdict.decision === 'defer' ? 'rest_01' : 'ext:coach-block-a:3:w2-tempo',
            title: verdict.decision === 'skip' || verdict.decision === 'defer' ? 'Rest' : 'Tempo intervals',
            modality: verdict.decision === 'skip' || verdict.decision === 'defer' ? 'Mobility' : 'Cycling',
            category: verdict.decision === 'skip' || verdict.decision === 'defer' ? 'Rest' : 'Intensity',
            durationMin: 30,
            durationMax: 60,
        },
        rationale: verdict.rationale,
        envelopes: { safety: { clinicalEscalationRequired: false } },
        externalVerdict: verdict,
        externalPrescription,
        ...extra,
    } as unknown as Recommendation;
}

describe('MorningDecisionCard imported-session verdict (#909)', () => {
    it('renders the verdict banner with source and revision on an excluded day', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                recommendation={externalRecommendation({
                    decision: 'skip',
                    gateFailures: ['time_limit'],
                    rationale: 'Today’s constraints exclude this session: you have less time available today than this session needs.',
                })}
            />,
        );
        expect(html).toContain('Imported plan session');
        expect(html).toContain('Not today');
        expect(html).toContain('coach-block-a');
        // The banner owns the explanation here: the hero must not repeat the same
        // rationale a second time under "Why today".
        expect(html).not.toContain('Why today:');
    });

    it('an excluded imported session offers no Start path even when a binding is present', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(
                    {
                        decision: 'skip',
                        gateFailures: ['equipment'],
                        rationale: 'Today’s constraints exclude this session: the equipment this session needs is not available to you.',
                    },
                    {
                        primarySession: {
                            sessionSource: {
                                kind: 'external_plan',
                                planId: 'coach-block-a',
                                revision: 3,
                                sessionId: 'w2-tempo',
                                contentHash: 'stale-binding',
                            },
                            prescriptionHash: 'stale-hash',
                        },
                    },
                )}
            />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).not.toContain('Resume Session →');
        expect(html).not.toContain('Redo Session');
        expect(html).toContain('Nothing from this session is prescribed today');
    });

    it('a defer verdict likewise offers no Start path', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation({
                    decision: 'defer',
                    gateFailures: [],
                    rationale: 'Readiness puts today in recovery. Move this session rather than doing a diminished version of it.',
                })}
            />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).toContain('Move it to another day');
    });

    it('a proceed verdict keeps the Start path and shows the authored prescription', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(
                    {
                        decision: 'proceed',
                        gateFailures: [],
                        rationale: 'Readiness supports this session as written.',
                    },
                    {
                        primarySession: {
                            sessionSource: {
                                kind: 'external_plan',
                                planId: 'coach-block-a',
                                revision: 3,
                                sessionId: 'w2-tempo',
                                contentHash: 'fresh-binding',
                            },
                            prescriptionHash: 'fresh-hash',
                        },
                    },
                )}
            />,
        );
        expect(html).toContain('Do it as written');
        expect(html).toContain('Start Session →');
    });

    it('a scale verdict shows the reduced summary but blocks the unscaled imported Start path', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(
                    {
                        decision: 'scale',
                        gateFailures: [],
                        scaledSummary: 'Cut to 2x10 min tempo, keep the warm-up.',
                        executionDose: { volume: 0.66, intensity: 1 },
                        rationale: 'Readiness caps today below the written dose; the reduced version keeps the intent.',
                    },
                    {
                        primarySession: {
                            sessionSource: {
                                kind: 'external_plan',
                                planId: 'coach-block-a',
                                revision: 3,
                                sessionId: 'w2-tempo',
                                contentHash: 'fresh-binding',
                            },
                            prescriptionHash: 'fresh-hash',
                        },
                    },
                )}
            />,
        );
        expect(html).toContain('Do the reduced version');
        expect(html).toContain('Cut to 2x10 min tempo');
        expect(html).toContain('Start is unavailable for this reduced form');
        expect(html).toContain('20–40 min · reduced');
        expect(html).not.toContain('Start Session →');
        expect(html).not.toContain('Resume Session →');
    });

    it('an event-advisory day keeps the ranked pick’s own Why-today explanation', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(
                    {
                        decision: 'advisory',
                        gateFailures: [],
                        rationale: 'This is your event, so the decision to start is yours.',
                    },
                    {
                        // Production advisory days carry the ranked pick's own template and
                        // rationale alongside the verdict, not the synthetic imported one.
                        template: {
                            id: 'cyc_end_01',
                            title: 'Easy Endurance Ride',
                            modality: 'Cycling',
                            category: 'Easy Endurance',
                            description: 'Aerobic base miles.',
                            durationMin: 45,
                            durationMax: 60,
                            requiredEquipment: [],
                            environment: 'either',
                            safetyTags: [],
                            systemicCost: 0.3,
                        },
                        rationale: 'High readiness signals suggest capacity for endurance work today.',
                    },
                )}
            />,
        );
        expect(html).toContain('Your call');
        expect(html).toContain('Why today:');
    });

    it('an excluded day offers no Start even when an adjusted catalog prescription is present', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                prescription={{ targetDurationMin: 30, displayBlocks: [] } as never}
                adjustmentDirection="easier"
                activeAlternativeId="mobility"
                recommendation={externalRecommendation({
                    decision: 'defer',
                    gateFailures: [],
                    rationale: 'Readiness puts today in recovery. Move this session rather than doing a diminished version of it.',
                })}
            />,
        );
        expect(html).toContain('Move it to another day');
        expect(html).not.toContain('Start Session →');
        expect(html).not.toContain('Resume Session →');
    });

    it('a day without an imported session renders no verdict banner', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={{
                    mode: 'train',
                    template: {
                        title: 'Easy Endurance Ride',
                        modality: 'Cycling',
                        category: 'Endurance',
                        durationMin: 45,
                        durationMax: 60,
                    },
                    rationale: 'High readiness signals suggest capacity for endurance work today.',
                    envelopes: { safety: { clinicalEscalationRequired: false } },
                } as unknown as Recommendation}
            />,
        );
        expect(html).not.toContain('Imported plan session');
    });
});
