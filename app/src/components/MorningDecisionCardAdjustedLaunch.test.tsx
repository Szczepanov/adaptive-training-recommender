import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Recommendation } from '../engine/models';
import type { MorningDecisionEvidence } from '../engine/decisionEvidence';
import type { SessionExecution } from '../sessions/models';
import type { WorkoutPrescription } from '../workouts';
import { MorningDecisionCard } from './MorningDecisionCard';

// morning-decision-ux.md §4: an athlete adjustment with no displayable prescription must
// never launch the stale unadjusted primarySession, and the withheld Start is explained.

const evidence = {
    confidence: { badgeClass: 'confidence-high', label: 'High confidence' },
    boundaries: { harderAdjustmentAllowed: true, hardGates: [] },
} as unknown as MorningDecisionEvidence;

const baseProps = {
    userId: 'athlete-1',
    date: '2026-10-01',
    evidence,
    adjustmentDirection: null,
    activeAlternativeId: null,
    todayExecution: null,
    onStartSession: () => undefined,
    onAdjustLoad: () => undefined,
    onSelectTimeCrunch: () => undefined,
    onSelectHomeAlternative: () => undefined,
    onSelectMobilityAlternative: () => undefined,
    onSelectActiveRecoveryWalk: () => undefined,
    onResetAlternative: () => undefined,
} as const;

/** Home's M3.3 authored replacement after a `time-30` crunch: binding kept, no prescription. */
const authoredTimeCrunched = {
    mode: 'train',
    template: {
        id: 'authored:my-tempo:2',
        title: 'My Tempo Run',
        modality: 'Running',
        category: 'Endurance',
        durationMin: 30,
        durationMax: 35,
    },
    rationale: 'Authored session accepted. (Authored replacement for today). (Time-crunch adjusted to 30 min).',
    envelopes: { safety: { clinicalEscalationRequired: false } },
    executionDose: { volume: 0.5, intensity: 1 },
    primarySession: {
        sessionSource: { kind: 'manual', definitionId: 'my-tempo', revision: 2, contentHash: 'sha256:authored' },
        prescriptionHash: 'hash-authored',
        occurrenceId: 'occ-1',
    },
} as unknown as Recommendation;

const execution = (state: SessionExecution['state']): SessionExecution => ({
    userId: 'athlete-1',
    executionId: 'exec-1',
    sessionSource: { kind: 'manual', definitionId: 'my-tempo', revision: 2, contentHash: 'sha256:authored' },
    prescriptionHash: 'hash-authored',
    date: '2026-10-01',
    startedAt: '2026-10-01T07:00:00Z',
    updatedAt: '2026-10-01T07:00:00Z',
    state,
    schemaVersion: 1,
});

const WITHHELD_TITLE = 'Start is unavailable while this adjustment is applied';
const WITHHELD_ANY = 'is unavailable while this adjustment is applied';

describe('MorningDecisionCard adjusted launch with no displayable prescription', () => {
    it('withholds Start on a time-crunched authored replacement and explains why', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard {...baseProps} recommendation={authoredTimeCrunched} activeAlternativeId="time-30" />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).toContain(WITHHELD_TITLE);
        expect(html).toContain('Your own session can only run exactly as written');
        expect(html).toContain('Reset to the original session to start it.');
        expect(html).toContain('<span aria-hidden="true">↺</span> Reset to Original Session');
        expect(html).toContain('role="note"');
    });

    it('withholds Start on an authored replacement with a load adjustment that resolved no prescription', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard {...baseProps} recommendation={authoredTimeCrunched} adjustmentDirection="easier" />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).toContain(WITHHELD_TITLE);
    });

    it('starts the authored binding normally when no adjustment is applied', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard {...baseProps} recommendation={authoredTimeCrunched} />,
        );
        expect(html).toContain('Start Session →');
        expect(html).not.toContain(WITHHELD_TITLE);
    });

    it('withholds Resume for an in-progress authored execution while adjusted', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                recommendation={authoredTimeCrunched}
                activeAlternativeId="time-30"
                todayExecution={execution('in_progress')}
            />,
        );
        expect(html).not.toContain('Resume Session →');
        expect(html).toContain('Resume is unavailable while this adjustment is applied');
        expect(html).toContain('Reset to the original session to resume it.');
    });

    it('withholds Redo after a completed authored execution while adjusted', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                recommendation={authoredTimeCrunched}
                activeAlternativeId="time-30"
                todayExecution={execution('completed')}
            />,
        );
        expect(html).toContain('Completed ✓');
        expect(html).not.toContain('Redo Session');
        expect(html).toContain('Redo is unavailable while this adjustment is applied');
        expect(html).toContain('Reset to the original session to redo it.');
    });

    it('offers no Redo when nothing would launch for the displayed alternative', () => {
        // A one-tap alternative that drops the binding and resolves no prescription: Redo
        // would otherwise be a silent no-op.
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                activeAlternativeId="mobility"
                recommendation={{ ...authoredTimeCrunched, primarySession: undefined } as unknown as Recommendation}
                todayExecution={execution('completed')}
            />,
        );
        expect(html).toContain('Completed ✓');
        expect(html).not.toContain('Redo Session');
        expect(html).not.toContain(WITHHELD_ANY);
    });

    it('leaves a time-crunched imported proceed session to the verdict banner (no second notice)', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                activeAlternativeId="time-30"
                recommendation={{
                    ...authoredTimeCrunched,
                    template: { ...authoredTimeCrunched.template, id: 'ext:coach-block-a:3:w2-tempo', title: 'Tempo intervals' },
                    rationale: 'Today’s readiness supports this session as written.',
                    externalVerdict: { decision: 'proceed', gateFailures: [], rationale: 'Today’s readiness supports this session as written.' },
                    externalPrescription: {
                        planId: 'coach-block-a',
                        revision: 3,
                        sessionId: 'w2-tempo',
                        title: 'Tempo intervals',
                        prescription: { summary: '3x10 min at tempo.', steps: [] },
                    },
                    primarySession: {
                        sessionSource: { kind: 'external_plan', planId: 'coach-block-a', revision: 3, sessionId: 'w2-tempo', contentHash: 'sha256:ext' },
                        prescriptionHash: 'hash-external',
                    },
                } as unknown as Recommendation}
            />,
        );
        expect(html).not.toContain('Start Session →');
        expect(html).toContain('Start is unavailable while a time or load adjustment is applied');
        expect(html).not.toContain(WITHHELD_ANY);
    });

    it('still starts the displayed catalog prescription when an adjustment has one', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                recommendation={authoredTimeCrunched}
                adjustmentDirection="easier"
                prescription={{ targetDurationMin: 30, displayBlocks: [] } as unknown as WorkoutPrescription}
            />,
        );
        expect(html).toContain('Start Session →');
        expect(html).not.toContain(WITHHELD_TITLE);
    });

    it('shows no withheld notice while clinical escalation pauses training', () => {
        const html = renderToStaticMarkup(
            <MorningDecisionCard
                {...baseProps}
                activeAlternativeId="time-30"
                recommendation={{
                    ...authoredTimeCrunched,
                    envelopes: { safety: { clinicalEscalationRequired: true, clinicalReason: 'Red-flag symptoms reported.' } },
                } as unknown as Recommendation}
            />,
        );
        expect(html).toContain('Training Paused');
        expect(html).not.toContain(WITHHELD_ANY);
    });
});
