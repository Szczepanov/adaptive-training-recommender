import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExternalSessionVerdictSummary, Recommendation } from '../engine/models';
import type { SessionDefinition } from '../sessions/models';
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

    it.each([
        ['a time-crunch alternative', { activeAlternativeId: 'time-20' }],
        ['an easier load adjustment', { adjustmentDirection: 'easier' as const }],
    ])('a proceed day with %s never falls through to the stale full imported binding', (_label, adjustment) => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                {...adjustment}
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
        expect(html).not.toContain('Start Session →');
        expect(html).toContain('original Start is unavailable while a time, load, or alternative adjustment is applied');
    });

    it('a proceed-day adjustment may still launch a separately prepared catalog prescription', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                activeAlternativeId="stimulus:cyc-endurance"
                prescription={{ targetDurationMin: 30, displayBlocks: [] } as never}
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
        expect(html).toContain('Start Session →');
        expect(html).toContain('original Start is unavailable while a time, load, or alternative adjustment is applied');
    });

    it('a legacy scale verdict (no reducedDefinition) shows the reduced summary but blocks the unscaled imported Start path', () => {
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

    // #949: a v6 plan carries the coach's exact reduced SessionDefinition, and Home freezes
    // the scale binding to it, so that binding -- and only that binding -- gets a Start path.
    const v6ExternalPrescription: Prescription = {
        ...externalPrescription,
        scaling: {
            reducible: true,
            reducedSummary: 'Cut to 2x10 min tempo, keep the warm-up.',
            reducedDefinition: { id: 'w2-tempo', title: 'Tempo intervals (reduced)' } as SessionDefinition,
        },
    };
    const scaleVerdict: ExternalSessionVerdictSummary = {
        decision: 'scale',
        gateFailures: [],
        scaledSummary: 'Cut to 2x10 min tempo, keep the warm-up.',
        executionDose: { volume: 0.66, intensity: 1 },
        rationale: 'Readiness caps today below the written dose; the reduced version keeps the intent.',
    };
    const reducedBinding = {
        sessionSource: {
            kind: 'external_plan' as const,
            planId: 'coach-block-a',
            revision: 3,
            sessionId: 'w2-tempo',
            contentHash: 'fresh-binding',
        },
        occurrenceId: 'occ-today',
        prescriptionHash: 'reduced-hash',
    };
    const reducedPreparedLaunch = {
        variant: 'reduced' as const,
        prescriptionHash: reducedBinding.prescriptionHash,
    };

    it('a v6 scale verdict starts the prepared exact reduced binding', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(scaleVerdict, {
                    externalPrescription: v6ExternalPrescription,
                    primarySession: reducedBinding,
                    externalPreparedLaunch: reducedPreparedLaunch,
                })}
            />,
        );
        expect(html).toContain('Do the reduced version');
        expect(html).toContain('Start Session →');
        expect(html).toContain('aria-label="Start Tempo intervals"');
        expect(html).toContain('Start runs your plan’s own reduced version exactly as written');
        expect(html).not.toContain('Start is unavailable');
    });

    it('never mistakes a full-dose binding for the reduced snapshot merely because the source identity matches', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(scaleVerdict, {
                    externalPrescription: v6ExternalPrescription,
                    primarySession: { ...reducedBinding, prescriptionHash: 'full-hash' },
                    externalPreparedLaunch: { variant: 'full', prescriptionHash: 'full-hash' },
                })}
            />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).toContain('your plan’s reduced version could not be prepared for today');
    });

    it('blocks Start when reduced launch evidence names a different immutable prescription', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(scaleVerdict, {
                    externalPrescription: v6ExternalPrescription,
                    primarySession: reducedBinding,
                    externalPreparedLaunch: { variant: 'reduced', prescriptionHash: 'different-reduced-hash' },
                })}
            />,
        );
        expect(html).not.toContain('Start Session →');
    });

    it('a v6 scale verdict without a prepared binding stays blocked and says why', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(scaleVerdict, { externalPrescription: v6ExternalPrescription })}
            />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).toContain('your plan’s reduced version could not be prepared for today');
        expect(html).not.toContain('does not include executable reduced steps');
    });

    it('a v6 scale verdict never starts a binding to a different imported session', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(scaleVerdict, {
                    externalPrescription: v6ExternalPrescription,
                    primarySession: {
                        ...reducedBinding,
                        sessionSource: { ...reducedBinding.sessionSource, sessionId: 'w3-threshold' },
                    },
                    externalPreparedLaunch: reducedPreparedLaunch,
                })}
            />,
        );
        expect(html).not.toContain('Start Session →');
    });

    it.each(['skip', 'defer'] as const)('a %s verdict stays blocked even with a reduced definition and binding', decision => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(
                    { decision, gateFailures: [], rationale: 'Move this session rather than doing a diminished version of it.' },
                    { externalPrescription: v6ExternalPrescription, primarySession: reducedBinding, externalPreparedLaunch: reducedPreparedLaunch },
                )}
            />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).not.toContain('Resume Session →');
    });

    it.each([
        ['a time-crunch alternative', { activeAlternativeId: 'time-20' }],
        ['an easier load adjustment', { adjustmentDirection: 'easier' as const }],
    ])('a v6 scale day with %s never starts the unadjusted reduced binding', (_label, adjustment) => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                {...adjustment}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(scaleVerdict, {
                    externalPrescription: v6ExternalPrescription,
                    primarySession: reducedBinding,
                    externalPreparedLaunch: reducedPreparedLaunch,
                })}
            />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).toContain('Start is unavailable while a time or load adjustment is applied');
    });

    it('a completed v6 reduced session keeps its Redo path', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                todayExecution={{ state: 'completed' } as never}
                onStartSession={() => undefined}
                recommendation={externalRecommendation(scaleVerdict, {
                    externalPrescription: v6ExternalPrescription,
                    primarySession: reducedBinding,
                    externalPreparedLaunch: reducedPreparedLaunch,
                })}
            />,
        );
        expect(html).toContain('Redo Session');
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
