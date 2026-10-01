import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
    canStartFreshAssessmentAttempt,
    describeAbandonedAssessment,
} from './TestingWorkflow';
import { CanonicalResultPreview } from './CanonicalResultPreview';
import { TrialCaptureTable } from './TrialCaptureTable';
import { TrialCorrectionPanel } from './TrialCorrectionPanel';
import {
    BENCH_PRESS_1RM_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
    WALL_TOUCH_CMJ_PROTOCOL,
} from '../../observations/physicalCapitalProtocols';
import type { AssessmentAttempt, AssessmentTrial } from '../../observations/models';

describe('describeAbandonedAssessment', () => {
    it('names the lost attempt and protocol lock (#494)', () => {
        const copy = describeAbandonedAssessment(
            { id: 'attempt-1', purpose: 'baseline' },
            { title: '20-min FTP test', revision: 3 },
        );

        expect(copy).toContain('attempt-1');
        expect(copy).toContain('20-min FTP test');
        expect(copy).toContain('rev 3');
        expect(copy).toContain('baseline');
    });

    it('states what was lost, that abandonment is terminal, and that re-testing needs a fresh attempt (#494)', () => {
        const copy = describeAbandonedAssessment(
            { id: 'attempt-1', purpose: 'checkpoint' },
            { title: '20-min FTP test', revision: 3 },
        );

        expect(copy).toContain('will never produce a benchmark observation');
        expect(copy).toContain('terminal');
        expect(copy).toContain('cannot be resumed');
        expect(copy).toContain('start a fresh attempt');
    });
});

describe('canStartFreshAssessmentAttempt', () => {
    it('allows a fresh attempt only after terminal abandonment is persisted (#494)', () => {
        expect(canStartFreshAssessmentAttempt({ state: 'abandoned' })).toBe(true);
        expect(canStartFreshAssessmentAttempt({ state: 'scheduled' })).toBe(false);
        expect(canStartFreshAssessmentAttempt({ state: 'in_progress' })).toBe(false);
        expect(canStartFreshAssessmentAttempt({ state: 'completed' })).toBe(false);
        expect(canStartFreshAssessmentAttempt(null)).toBe(false);
    });
});

describe('CanonicalResultPreview', () => {
    it('shows live canonical jump distance with source trial badge', () => {
        const trials: AssessmentTrial[] = [
            {
                id: 'trial-1',
                assessmentAttemptId: 'att-1',
                ordinal: 1,
                correctionIndex: 0,
                validity: 'valid',
                values: { distance_cm: 230 },
                context: { test_environment: 'indoor-gym-floor' },
                createdAt: '2026-10-20T10:00:00.000Z',
            },
            {
                id: 'trial-2',
                assessmentAttemptId: 'att-1',
                ordinal: 2,
                correctionIndex: 0,
                validity: 'valid',
                values: { distance_cm: 238 },
                context: { test_environment: 'indoor-gym-floor' },
                createdAt: '2026-10-20T10:05:00.000Z',
            },
        ];

        const html = renderToStaticMarkup(
            <CanonicalResultPreview
                protocol={STANDING_BROAD_JUMP_PROTOCOL}
                assessmentAttemptId="att-1"
                trials={trials}
            />,
        );

        expect(html).toContain('238 cm');
        expect(html).toContain('attempt 2');
    });

    it('shows 1RM with missed heavier lift evidence callout', () => {
        const trials: AssessmentTrial[] = [
            {
                id: 'trial-1',
                assessmentAttemptId: 'att-1',
                ordinal: 1,
                correctionIndex: 0,
                validity: 'valid',
                values: { load_kg: 100, successful: true },
                context: { grip_style: 'standard', rack_setting: 'pin-5' },
                createdAt: '2026-10-20T10:00:00.000Z',
            },
            {
                id: 'trial-2',
                assessmentAttemptId: 'att-1',
                ordinal: 2,
                correctionIndex: 0,
                validity: 'valid',
                values: { load_kg: 107.5, successful: true },
                context: { grip_style: 'standard', rack_setting: 'pin-5' },
                createdAt: '2026-10-20T10:05:00.000Z',
            },
            {
                id: 'trial-3',
                assessmentAttemptId: 'att-1',
                ordinal: 3,
                correctionIndex: 0,
                validity: 'valid',
                values: { load_kg: 112.5, successful: false },
                context: { grip_style: 'standard', rack_setting: 'pin-5' },
                createdAt: '2026-10-20T10:10:00.000Z',
            },
        ];

        const html = renderToStaticMarkup(
            <CanonicalResultPreview
                protocol={BENCH_PRESS_1RM_PROTOCOL}
                assessmentAttemptId="att-1"
                trials={trials}
            />,
        );

        expect(html).toContain('107.5 kg');
        expect(html).toContain('attempt 2');
        expect(html).toContain('a missed 112.5 kg is kept as evidence');
    });

    it('shows no valid attempt message when all trials are invalid', () => {
        const trials: AssessmentTrial[] = [
            {
                id: 'trial-1',
                assessmentAttemptId: 'att-1',
                ordinal: 1,
                correctionIndex: 0,
                validity: 'invalid',
                invalidReason: 'Stepped over line on landing',
                values: { distance_cm: 240 },
                context: { test_environment: 'indoor-gym-floor' },
                createdAt: '2026-10-20T10:00:00.000Z',
            },
        ];

        const html = renderToStaticMarkup(
            <CanonicalResultPreview
                protocol={STANDING_BROAD_JUMP_PROTOCOL}
                assessmentAttemptId="att-1"
                trials={trials}
            />,
        );

        expect(html).toContain('No valid attempt recorded yet');
    });
});

describe('TrialCaptureTable', () => {
    const attempt: AssessmentAttempt = {
        id: 'att-1',
        protocolRef: { id: BENCH_PRESS_1RM_PROTOCOL.id, revision: 1 },
        scheduledDate: '2026-10-20',
        state: 'in_progress',
        purpose: 'baseline',
    };

    it('renders raw-video reminder on strength protocols without implying cloud video storage', () => {
        const html = renderToStaticMarkup(
            <TrialCaptureTable
                userId="user-1"
                protocol={BENCH_PRESS_1RM_PROTOCOL}
                attempt={attempt}
                contextValues={{ grip_style: 'standard', rack_setting: 'pin-5' }}
                onContextChange={vi.fn()}
                defaultDevice={{ provider: 'manual' }}
                onDefaultDeviceChange={vi.fn()}
                onSave={vi.fn()}
                saving={false}
            />,
        );

        expect(html).toContain('Raw video reminder:');
        expect(html).toContain('keep the original raw video outside the app');
        expect(html).not.toContain('Upload video');
    });

    it('renders CMJ standing reach carry forward hint setup', () => {
        const cmjAttempt: AssessmentAttempt = {
            id: 'att-cmj',
            protocolRef: { id: WALL_TOUCH_CMJ_PROTOCOL.id, revision: 1 },
            scheduledDate: '2026-10-20',
            state: 'in_progress',
            purpose: 'baseline',
        };

        const html = renderToStaticMarkup(
            <TrialCaptureTable
                userId="user-1"
                protocol={WALL_TOUCH_CMJ_PROTOCOL}
                attempt={cmjAttempt}
                contextValues={{ wall_surface: 'smooth-brick' }}
                onContextChange={vi.fn()}
                defaultDevice={{ provider: 'tape-measure' }}
                onDefaultDeviceChange={vi.fn()}
                onSave={vi.fn()}
                saving={false}
                presentationHints={{ carryForwardFieldIds: ['standing_reach_cm'] }}
            />,
        );

        expect(html).toContain('Standing reach (cm)');
        expect(html).toContain('Touch height (cm)');
    });

    it('renders trials persisted by an interrupted save read-only and keeps new rows editable', () => {
        const jumpAttempt: AssessmentAttempt = {
            id: 'att-jump',
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
            scheduledDate: '2026-10-20',
            state: 'in_progress',
            purpose: 'baseline',
        };
        const stored: AssessmentTrial = {
            id: 'trial-1-0',
            assessmentAttemptId: 'att-jump',
            ordinal: 1,
            correctionIndex: 0,
            validity: 'valid',
            values: { distance_cm: 231 },
            context: { test_environment: 'indoor-gym-floor' },
            createdAt: '2026-10-20T10:00:00.000Z',
        };

        const html = renderToStaticMarkup(
            <TrialCaptureTable
                userId="user-1"
                protocol={STANDING_BROAD_JUMP_PROTOCOL}
                attempt={jumpAttempt}
                contextValues={{ test_environment: 'indoor-gym-floor' }}
                onContextChange={vi.fn()}
                defaultDevice={{ provider: '' }}
                onDefaultDeviceChange={vi.fn()}
                onSave={vi.fn()}
                saving={false}
                initialTrials={[stored]}
            />,
        );

        expect(html).toContain('Trial 1 · saved');
        expect(html.match(/<fieldset class="trial-row-card" disabled="">/g)).toHaveLength(1);
        expect(html).not.toContain('aria-label="Remove Trial 1"');
    });
});

describe('TrialCorrectionPanel', () => {
    it('renders Active vs Superseded badges for trial history', () => {
        const attempt: AssessmentAttempt = {
            id: 'att-1',
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
            scheduledDate: '2026-10-20',
            state: 'completed',
            purpose: 'baseline',
        };

        const trials: AssessmentTrial[] = [
            {
                id: 'trial-1',
                assessmentAttemptId: 'att-1',
                ordinal: 1,
                correctionIndex: 0,
                validity: 'valid',
                values: { distance_cm: 230 },
                context: { test_environment: 'indoor-gym-floor' },
                createdAt: '2026-10-20T10:00:00.000Z',
            },
            {
                id: 'trial-2',
                assessmentAttemptId: 'att-1',
                ordinal: 2,
                correctionIndex: 0,
                validity: 'invalid',
                invalidReason: 'Tape slipped',
                values: { distance_cm: 220 },
                context: { test_environment: 'indoor-gym-floor' },
                createdAt: '2026-10-20T10:05:00.000Z',
            },
            {
                id: 'trial-2-c1',
                assessmentAttemptId: 'att-1',
                ordinal: 2,
                correctionIndex: 1,
                supersedesTrialId: 'trial-2',
                correctionReason: 'Verified tape was held at 0 mark, actual jump 238 cm',
                validity: 'valid',
                values: { distance_cm: 238 },
                context: { test_environment: 'indoor-gym-floor' },
                createdAt: '2026-10-20T10:15:00.000Z',
            },
        ];

        const html = renderToStaticMarkup(
            <TrialCorrectionPanel
                userId="user-1"
                protocol={STANDING_BROAD_JUMP_PROTOCOL}
                attempt={attempt}
                trials={trials}
                context={{ test_environment: 'indoor-gym-floor' }}
                observedAt="2026-10-20T10:15:00.000Z"
                onCorrectionComplete={vi.fn()}
            />,
        );

        expect(html).toContain('badge-superseded');
        expect(html).toContain('badge-active');
        expect(html).toContain('Verified tape was held at 0 mark');
        expect(html).toContain('238 cm');
    });
});
