import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeekAheadStrip } from './WeekAheadStrip';
import type { WeekAheadDay, WeekAheadPlan } from '../engine/planner';

function weekAheadDay(rationale: string): WeekAheadDay {
    return {
        date: '2026-09-18',
        dayOffset: 1,
        confidence: 'provisional',
        phaseName: 'Base',
        template: {
            title: 'Endurance Run',
            category: 'Aerobic',
            modality: 'Running',
            durationMin: 40,
            durationMax: 55,
        },
        mode: 'train',
        rationale,
        addressesObjectives: [],
    } as unknown as WeekAheadDay;
}

function weekAheadPlan(rationale: string): WeekAheadPlan {
    return {
        startDate: '2026-09-18',
        days: [weekAheadDay(rationale)],
        objectiveCredits: [],
        microcycleObjectives: [],
        droppedContributorObjectives: [],
        allocationReport: { outcomes: [] },
    } as unknown as WeekAheadPlan;
}

describe('WeekAheadStrip rationale display (UX review follow-up)', () => {
    it('moves engine scoring internals into a collapsed detail instead of the visible rationale', () => {
        const html = renderToStaticMarkup(
            <WeekAheadStrip
                plan={weekAheadPlan(
                    'Base phase. Coverage tier: 1. Benefit score: 1.27, Fatigue cost penalty: 1.30. (Advances an explicit required weekly programming role.) (Sequence intent: recondition/spread, preferred key gap 2d.)',
                )}
            />,
        );

        const rationaleMatch = html.match(/<p class="detail-rationale">(.*?)<\/p>/);
        expect(rationaleMatch?.[1]).toBe('Base phase.');
        expect(rationaleMatch?.[1]).not.toContain('Coverage tier');
        expect(html).toContain('Engine scoring telemetry');
        expect(html).toContain('Sequence intent: recondition/spread, preferred key gap 2d.');
    });

    it('renders a plain rationale with no technical-detail disclosure at all', () => {
        const html = renderToStaticMarkup(<WeekAheadStrip plan={weekAheadPlan('Recovery day after yesterday\'s long run.')} />);

        expect(html).toContain('<p class="detail-rationale">Recovery day after yesterday&#x27;s long run.</p>');
        expect(html).not.toContain('Engine scoring telemetry');
    });
});
