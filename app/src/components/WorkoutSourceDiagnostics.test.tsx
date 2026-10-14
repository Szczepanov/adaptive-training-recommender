import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
    FAILURE_STATE_CODES,
    STATE_REASONS,
    projectWorkoutSourceDiagnostics,
    type FailureStateCode,
} from '../training-occurrence/workoutSourceDiagnostics';
import {
    garminActivity,
    garminActivityWithoutSets,
    garminOnlyView,
    structuredOnlyView,
    workoutView,
} from '../training-occurrence/workoutSourceDiagnostics.fixtures';
import { STATE_COPY, STATUS_LABEL, describeAssessment } from './workoutSourceDiagnosticsCopy';
import { WorkoutSourceDiagnostics, WorkoutWindowProjectionFailed } from './WorkoutSourceDiagnostics';

const render = (view: Parameters<typeof WorkoutSourceDiagnostics>[0]['workout']) =>
    renderToStaticMarkup(<WorkoutSourceDiagnostics workout={view} />);

describe('copy tables', () => {
    it('have a sentence for every reason of every state and status (no state can render blank)', () => {
        for (const code of FAILURE_STATE_CODES) {
            const copy = STATE_COPY[code] as unknown as Record<string, Record<string, string> | string>;
            expect(copy.name).toBeTruthy();
            expect(copy.clear).toBeTruthy();
            for (const status of ['holds', 'not_applicable', 'not_observable'] as const) {
                const reasons: readonly string[] = STATE_REASONS[code][status];
                expect(Object.keys(copy[status] as Record<string, string>).sort()).toEqual([...reasons].sort());
                for (const reason of reasons) expect((copy[status] as Record<string, string>)[reason]).toMatch(/\S{3,}/);
            }
        }
    });

    it('never words an unknown as none / zero / empty / healthy / all-synced', () => {
        for (const code of FAILURE_STATE_CODES) {
            const unknowns = Object.values(STATE_COPY[code].not_observable as Record<string, string>);
            for (const sentence of unknowns) {
                expect(sentence).toMatch(/unknown|cannot|not recorded|could not/i);
                expect(sentence).not.toMatch(/\b(no data|zero|healthy|all good|nothing to|everything is synced)\b/i);
                expect(sentence).not.toMatch(/^(none|empty|ok)\b/i);
            }
        }
        expect(STATUS_LABEL.not_observable).toBe('Unknown');
    });

    it('describeAssessment lists every co-occurring reason', () => {
        const view = structuredOnlyView({ sourceReads: { outbox: { status: 'read', queued: 1, failed: 1 } } });
        const { states } = projectWorkoutSourceDiagnostics(view);
        expect(describeAssessment('entry_write_unsettled', states.entry_write_unsettled)).toHaveLength(2);
    });
});

describe('WorkoutSourceDiagnostics -- every #895 section 10 state is named when it holds', () => {
    const cases: Array<[FailureStateCode, string, ReturnType<typeof workoutView>]> = [
        ['session_execution_absent', 'Session record absent', garminOnlyView()],
        ['entry_write_unsettled', 'Diary writes pending or failed', workoutView({ sourceReads: { outbox: { status: 'read', queued: 0, failed: 1 } } })],
        ['garmin_activity_absent', 'Garmin activity absent', structuredOnlyView()],
        ['garmin_detail_unavailable', 'Garmin detail unavailable', garminOnlyView({ garmin: garminActivityWithoutSets() })],
        ['garmin_detail_empty', 'Garmin detail empty', garminOnlyView({ garmin: garminActivity({ exerciseSets: [] }) })],
        ['reconciliation_no_candidate', 'No matching candidate found', structuredOnlyView()],
        ['reconciliation_ambiguous', 'Ambiguous matching candidates', structuredOnlyView({ reconciliation: { state: 'ambiguous' } })],
        ['read_model_projection_failed', 'Read-model projection failed', structuredOnlyView({ sourceReads: { structured: { status: 'entries_unavailable' } } })],
    ];

    it.each(cases)('%s renders its name and a sentence', (code, name, view) => {
        const html = render(view);
        expect(html).toContain(name);
        const { states } = projectWorkoutSourceDiagnostics(view);
        for (const sentence of describeAssessment(code, states[code])) {
            expect(html).toContain(sentence.replaceAll("'", '&#x27;'));
        }
    });

    it('lists all eight checks with their issue numbers inside the collapsed diagnostics', () => {
        const html = render(workoutView());
        for (let state = 1; state <= 8; state++) expect(html).toContain(`State ${state}`);
        expect(html).toContain('<details');
    });
});

describe('WorkoutSourceDiagnostics -- visible notices vs collapsed detail', () => {
    it('shows a visible, named notice for ambiguous matching', () => {
        const html = render(structuredOnlyView({ reconciliation: { state: 'ambiguous' } }));
        expect(html).toContain('aria-label="Missing or unknown data"');
        expect(html).toContain('Ambiguous matching candidates');
    });

    it('shows no notice for a healthy matched workout', () => {
        expect(render(workoutView())).not.toContain('aria-label="Missing or unknown data"');
    });

    it('does not raise a notice for an expected single-source workout, but still explains it on request', () => {
        const html = render(structuredOnlyView());
        expect(html).not.toContain('aria-label="Missing or unknown data"');
        expect(html).toContain('No Garmin activity is linked to this workout.');
    });

    it('reports co-occurring problems together', () => {
        const html = render(structuredOnlyView({ sourceReads: { outbox: { status: 'read', queued: 0, failed: 2 }, structured: { status: 'execution_missing' } } }));
        expect(html).toContain('Diary writes pending or failed');
        expect(html).toContain('Session record absent');
    });

    it('carries the status as text, not colour alone', () => {
        const html = render(structuredOnlyView({ reconciliation: { state: 'ambiguous' } }));
        expect(html).toContain('Detected');
        expect(html).toContain('Not detected');
        expect(html).toContain('Not applicable');
    });
});

describe('WorkoutSourceDiagnostics -- unknown never renders as empty, zero or healthy', () => {
    it('renders an unreadable receipt store as unknown, not as 0 unsent writes', () => {
        const html = render(workoutView({ sourceReads: { outbox: { status: 'unreadable' } } }));
        expect(html).toContain('could not be read');
        expect(html).not.toMatch(/0 waiting/);
        expect(html).toContain('Unknown');
    });

    it('renders zero local receipts with the per-device caveat, never as "synced"', () => {
        const html = render(workoutView({ sourceReads: { outbox: { status: 'read', queued: 0, failed: 0 } } }));
        expect(html).toContain('other devices cannot be checked from here');
        expect(html).not.toMatch(/all (writes )?synced/i);
    });

    it('renders the outbox depth when receipts exist', () => {
        const html = render(workoutView({ sourceReads: { outbox: { status: 'read', queued: 3, failed: 1 } } }));
        expect(html).toContain('3 waiting');
        expect(html).toContain('1 rejected');
    });

    it('renders unevaluated matching as unknown rather than "no candidate"', () => {
        const html = render(structuredOnlyView({ sourceReads: { reconciliationSweep: 'failed' } }));
        expect(html).toContain('The latest matching check failed');
        expect(html).toContain('aria-label="Missing or unknown data"');
    });

    it('says the Garmin detail download outcome is not recorded', () => {
        const html = render(garminOnlyView({ garmin: garminActivityWithoutSets() }));
        expect(html).toContain('Whether the download failed or never ran is not recorded');
    });
});

describe('WorkoutWindowProjectionFailed', () => {
    it('names state 8 and refuses to look like an empty list', () => {
        const html = renderToStaticMarkup(<WorkoutWindowProjectionFailed range={{ from: '2026-08-20', toExclusive: '2026-08-27' }} />);
        expect(html).toContain('Read-model projection failed');
        expect(html).toContain('not an empty list');
        expect(html).not.toContain('No workouts were recorded');
        expect(html).toContain('role="alert"');
        expect(html).toContain('Copy source diagnostics');
    });

    it('omits the export control when no window is known', () => {
        const html = renderToStaticMarkup(<WorkoutWindowProjectionFailed range={null} />);
        expect(html).not.toContain('Copy source diagnostics');
    });
});
