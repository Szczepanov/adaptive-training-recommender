import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExternalSessionVerdictSummary, Recommendation } from '../engine/models';
import { ExternalVerdictBanner } from './ExternalVerdictBanner';

type Prescription = NonNullable<Recommendation['externalPrescription']>;

const prescription: Prescription = {
    planId: 'coach-block-a',
    revision: 3,
    sessionId: 'w2-tempo',
    title: 'Tempo intervals',
    prescription: {
        summary: '3x10 min at tempo with 3 min easy between.',
        steps: [
            { name: 'Warm up', target: 'Easy spin', durationMin: 15 },
            { name: 'Tempo x3', target: '88-92% FTP', durationMin: 10, sets: 3, notes: '3 min easy between' },
        ],
    },
};

function verdict(overrides: Partial<ExternalSessionVerdictSummary>): ExternalSessionVerdictSummary {
    return {
        decision: 'proceed',
        gateFailures: [],
        rationale: 'Readiness supports this session as written.',
        ...overrides,
    };
}

function render(prescriptionOverride: Prescription, verdictOverride: ExternalSessionVerdictSummary): string {
    return renderToStaticMarkup(
        <ExternalVerdictBanner prescription={prescriptionOverride} verdict={verdictOverride} />,
    );
}

describe('ExternalVerdictBanner (#909)', () => {
    it.each([
        ['proceed', 'Do it as written'],
        ['scale', 'Do the reduced version'],
        ['defer', 'Move it to another day'],
        ['skip', 'Not today'],
        ['advisory', 'Your call'],
    ] as const)('renders the %s verdict with its athlete-facing label', (decision, label) => {
        const html = render(prescription, verdict({ decision }));
        expect(html).toContain(label);
        expect(html).toContain('Imported plan session');
    });

    it.each(['proceed', 'scale', 'defer', 'skip', 'advisory'] as const)(
        'identifies the plan source and revision for the %s verdict',
        decision => {
            const html = render(prescription, verdict({ decision }));
            expect(html).toContain('coach-block-a');
            expect(html).toContain('revision 3');
            expect(html).toContain('Tempo intervals');
        },
    );

    it('states hard-gate failures in the engine reason vocabulary, not raw codes', () => {
        const html = render(
            prescription,
            verdict({
                decision: 'defer',
                gateFailures: ['time_limit', 'equipment'],
                rationale: 'Readiness puts today in recovery. Move this session rather than doing a diminished version of it.',
            }),
        );
        expect(html).toContain('less time available today than this session needs');
        expect(html).toContain('equipment this session needs is not available');
        expect(html).not.toContain('time_limit');
    });

    it('a skip verdict never presents the prescription as actionable', () => {
        const html = render(
            prescription,
            verdict({
                decision: 'skip',
                gateFailures: ['environment'],
                rationale: "Today's constraints exclude this session: today&#x27;s environment does not match where this session has to happen.",
                fallbackSuggestion: 'An easy indoor spin keeps the week honest.',
            }),
        );
        expect(html).toContain('Nothing from this session is prescribed today');
        expect(html).not.toContain('As your plan wrote it');
        // The author's fallback stays explicitly advisory.
        expect(html).toContain('Your plan&#x27;s note on what to do instead');
        expect(html).toContain('has <strong>not</strong> been checked');
    });

    it('a defer verdict never presents the prescription as actionable', () => {
        const html = render(
            prescription,
            verdict({ decision: 'defer', rationale: 'Move this session rather than doing a diminished version of it.' }),
        );
        expect(html).toContain('Nothing from this session is prescribed today');
        expect(html).not.toContain('Tempo x3');
    });

    it('a scale verdict shows the adjudicated reduced summary, not the original dose', () => {
        const html = render(
            prescription,
            verdict({
                decision: 'scale',
                scaledSummary: 'Cut to 2x10 min tempo, keep the warm-up.',
                executionDose: { volume: 0.66, intensity: 1 },
                rationale: 'Readiness caps today below the written dose; the reduced version keeps the intent.',
            }),
        );
        expect(html).toContain('Reduced version, as your plan wrote it');
        expect(html).toContain('Cut to 2x10 min tempo');
        expect(html).toContain('66% of the written volume');
        expect(html).not.toContain('Tempo x3');
        expect(html).toContain('Start is unavailable for this reduced form');
    });

    it('a scale verdict without an authored reduced form still names the reduction, never the full dose as written', () => {
        const html = render(
            prescription,
            verdict({
                decision: 'scale',
                executionDose: { volume: 0.5, intensity: 1 },
                rationale: 'Readiness caps today’s systemic load, and your plan gives no reduced form, so hold the intent and cut the volume.',
            }),
        );
        expect(html).toContain('Do the reduced version');
        expect(html).toContain('Reduced volume for today');
        expect(html).not.toContain('As your plan wrote it');
        expect(html).toContain('50% of the written volume');
        expect(html).toContain('cap total volume at 50% of the written dose');
        expect(html).not.toContain('3x10 min at tempo');
        expect(html).not.toContain('Tempo x3');
    });
    it('a v6 scale verdict with a prepared reduced binding says Start runs the reduced version', () => {
        const html = renderToStaticMarkup(
            <ExternalVerdictBanner
                prescription={{
                    ...prescription,
                    scaling: { reducible: true, reducedDefinition: { id: 'w2-tempo' } } as Prescription['scaling'],
                }}
                verdict={verdict({ decision: 'scale', scaledSummary: 'Five minutes only', executionDose: { volume: 0.5, intensity: 1 } })}
                reducedLaunch="available"
            />,
        );
        expect(html).toContain('Start runs your plan’s own reduced version exactly as written');
        expect(html).not.toContain('Start is unavailable');
        expect(html).not.toContain('does not include executable reduced steps');
        expect(html).not.toContain('Tempo x3');
    });

    it('a v6 scale verdict whose reduced binding was not prepared does not claim the plan lacks reduced steps', () => {
        const html = render(
            { ...prescription, scaling: { reducible: true, reducedDefinition: { id: 'w2-tempo' } } as Prescription['scaling'] },
            verdict({ decision: 'scale', executionDose: { volume: 0.5, intensity: 1 } }),
        );
        expect(html).toContain('your plan’s reduced version could not be prepared for today');
        expect(html).not.toContain('does not include executable reduced steps');
    });

    it('an adjusted v6 scale day names the adjustment, not a missing reduced form', () => {
        const html = renderToStaticMarkup(
            <ExternalVerdictBanner
                prescription={{
                    ...prescription,
                    scaling: { reducible: true, reducedDefinition: { id: 'w2-tempo' } } as Prescription['scaling'],
                }}
                verdict={verdict({ decision: 'scale', executionDose: { volume: 0.5, intensity: 1 } })}
                reducedLaunch="adjusted"
            />,
        );
        expect(html).toContain('Start is unavailable while a time or load adjustment is applied');
        expect(html).not.toContain('could not be prepared');
    });

    it('reducedLaunch adds no launch note outside a scale verdict', () => {
        const html = renderToStaticMarkup(
            <ExternalVerdictBanner prescription={prescription} verdict={verdict({ decision: 'proceed' })} reducedLaunch="available" />,
        );
        expect(html).not.toContain('Start runs your plan');
    });

    it('a proceed verdict shows the authored prescription with its steps', () => {
        const html = render(prescription, verdict({ decision: 'proceed' }));
        expect(html).toContain('As your plan wrote it');
        expect(html).toContain('3x10 min at tempo');
        expect(html).toContain('Tempo x3');
    });

    it('an advisory event verdict is marked as an event and stays the athlete’s call', () => {
        const html = render(
            { ...prescription, isEvent: true },
            verdict({
                decision: 'advisory',
                rationale: 'This is your event, so the decision to start is yours.',
            }),
        );
        expect(html).toContain('Your call');
        expect(html).toContain('Event');
        expect(html).toContain('As your plan wrote it');
    });
});
