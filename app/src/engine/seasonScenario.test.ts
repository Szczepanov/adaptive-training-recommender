import { describe, expect, it } from 'vitest';
import { evaluatePeriodizationPhase } from './periodization';
import { resolveSeasonRoadmap } from './seasonRoadmap';
import { runScenario } from './simulation/analyze';
import { SEASON_ROADMAP_SCENARIO } from './simulation/scenarios';
import { supportingOutcomeReviewDiagnostics } from './developmentAuthority';
import type { IntentBlock } from './blockIntent';
import type { UserEvent } from './models';

const events = SEASON_ROADMAP_SCENARIO.events as readonly UserEvent[];
const START = SEASON_ROADMAP_SCENARIO.startDate;

describe('A+B+B+/C cycling season simulation', () => {
    it('keeps one coherent roadmap with the A event as the macrocycle target', () => {
        const roadmap = resolveSeasonRoadmap(events, START);
        expect(roadmap.primaryEventId).toBe('season-a-gran-fondo');
        expect(roadmap.entries.map(entry => [entry.eventId, entry.role])).toEqual([
            ['season-a-gran-fondo', 'primary_peak'],
            ['season-b-club', 'benchmark'],
            ['season-b-plus-stage', 'benchmark_peak'],
            ['season-c-crit', 'train_through'],
        ]);
        expect(roadmap.conflicts).toEqual([]);
    });

    it('transitions authority and dose limits across the season, one owner per date', async () => {
        const result = await runScenario(SEASON_ROADMAP_SCENARIO);
        expect(result.constraintViolations).toEqual([]);
        const dates = [...new Set(result.decisionTraces.map(trace => trace.date))].sort();
        expect(dates.length).toBeGreaterThan(60);
        const limited: Record<string, string> = {};
        for (const date of dates) {
            const periodization = evaluatePeriodizationPhase(events as UserEvent[], date);
            const roadmap = periodization.seasonRoadmap!;
            // The distant A event is the focus until it is raced; supporting events never take over.
            if (date <= '2026-10-16') expect(periodization.focusEvent?.id).toBe('season-a-gran-fondo');
            // Exactly one owner for each upcoming date.
            const owners = roadmap.entries.filter(entry => entry.status === 'upcoming' && entry.dateOwner).map(entry => entry.date);
            expect(new Set(owners).size).toBe(owners.length);
            const scale = periodization.phase.supportingEventScale;
            if (scale) limited[date] = scale.eventId;
        }
        // B (2026-09-04, 5-day taper from 08-30) and B+ (2026-09-18, taper from 09-13) are limited; C and the A taper are not.
        expect(Object.values(limited).every(id => id === 'season-b-club' || id === 'season-b-plus-stage')).toBe(true);
        expect(limited['2026-09-02']).toBe('season-b-club');
        expect(limited['2026-09-16']).toBe('season-b-plus-stage');
        expect(limited['2026-08-21']).toBeUndefined();
        expect(limited['2026-10-14']).toBeUndefined();
        const aTaper = evaluatePeriodizationPhase(events as UserEvent[], '2026-10-13');
        expect(aTaper.phase.phaseName).toBe('Peak/Taper');
    }, 60000);

    it('replaces one quality requirement for the C race window instead of layering objectives', async () => {
        const result = await runScenario(SEASON_ROADMAP_SCENARIO);
        const threshold = (date: string) => result.decisionTraces.find(trace => trace.date === date)!
            .activeObjectives.find(objective => objective.key === 'threshold_quality')!.requiredCredit;
        // C race on 2026-08-21: reserved from D-3 through race day, restored the day after.
        expect(threshold('2026-08-17')).toBe(1);
        for (const date of ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']) {
            expect(threshold(date)).toBe(0);
            expect(result.decisionTraces.find(trace => trace.date === date)!.contributorObjectiveChanges.dropped).toContain('threshold_quality');
        }
        expect(threshold('2026-08-22')).toBe(1);
        expect(result.decisionTraces.every(trace => trace.contributorObjectiveChanges.added.length === 0)).toBe(true);
    }, 60000);
});

describe('supporting-outcome revalidation of development blocks', () => {
    const block = {
        id: 'b', revision: 1, dateRange: { startDate: '2026-08-01', endDate: '2026-09-30' },
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-20' },
    } as unknown as IntentBlock;
    const done = (id: string, date: string, lifecycle: UserEvent['lifecycle'] = 'completed'): UserEvent => ({
        ...events[1], id, date, lifecycle,
    });

    it('withholds an unreviewed block after a supporting event result, and not after a review', () => {
        const roadmap = resolveSeasonRoadmap([done('b-done', '2026-09-10')], '2026-09-12');
        expect(supportingOutcomeReviewDiagnostics(block, 'a', roadmap)).toEqual(['supporting_outcome_review_due:b-done']);
        // Last confirmed review inferred as 2026-09-06; a result before it was already seen.
        const early = resolveSeasonRoadmap([done('b-early', '2026-09-05')], '2026-09-12');
        expect(supportingOutcomeReviewDiagnostics(block, 'a', early)).toEqual([]);
        // A DNF counts as an outcome too.
        expect(supportingOutcomeReviewDiagnostics(block, 'a', resolveSeasonRoadmap([done('b-dnf', '2026-09-10', 'DNF')], '2026-09-12')))
            .toEqual(['supporting_outcome_review_due:b-dnf']);
    });

    it('ignores the bound event, upcoming events, results before the block and a missing roadmap', () => {
        const roadmap = resolveSeasonRoadmap([done('a', '2026-09-10'), done('pre', '2026-07-20'), events[1]], '2026-09-12');
        expect(supportingOutcomeReviewDiagnostics(block, 'a', roadmap)).toEqual([]);
        expect(supportingOutcomeReviewDiagnostics(block, 'a', undefined)).toEqual([]);
    });
});
