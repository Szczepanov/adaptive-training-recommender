import { describe, expect, it } from 'vitest';
import { evaluatePeriodizationPhase, resolveMultiEventObjectives } from './periodization';
import type { UserEvent } from './models';

const ZERO_DEMAND = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0,
    sprintPower: 0, fatigueResistance: 0, neuromuscular: 0,
};

function event(overrides: Partial<UserEvent> & Pick<UserEvent, 'id' | 'date' | 'priority'>): UserEvent {
    return {
        title: overrides.id, lifecycle: 'scheduled', category: 'cycling_event',
        demandProfile: ZERO_DEMAND,
        ...overrides,
    };
}

describe('evaluatePeriodizationPhase: taper authority total order (Phase 5.6)', () => {
    it('priority tie is broken by proximity (fewer days first)', () => {
        const events = [
            event({ id: 'far', date: '2026-09-01', priority: 'A' }),
            event({ id: 'near', date: '2026-08-20', priority: 'A' }),
        ];
        const result = evaluatePeriodizationPhase(events, '2026-08-08');
        expect(result.focusEvent?.id).toBe('near');
        expect(result.governingEventTie).toEqual([]);
    });

    it('proximity tie is broken by planning date ascending, then event id lexicographically', () => {
        // Same priority, same daysToEvent (both 2026-08-20 relative to 2026-08-08) --
        // decidable only by id.
        const events = [
            event({ id: 'zzz', date: '2026-08-20', priority: 'A' }),
            event({ id: 'aaa', date: '2026-08-20', priority: 'A' }),
        ];
        const result = evaluatePeriodizationPhase(events, '2026-08-08');
        expect(result.focusEvent?.id).toBe('aaa');
    });

    it('planning date ranks ahead of the id backstop when it differs from the event date', () => {
        // Same priority and event date (so the id backstop alone would pick 'aaa'
        // lexicographically), but 'zzz' has the earlier timing.planningDate -- proving the
        // ordering actually consults planningDate rather than only ever falling through to
        // the id tie-breaker.
        const events = [
            event({ id: 'aaa', date: '2026-08-20', priority: 'A', timing: { earliestDate: '2026-08-20', latestDate: '2026-08-20', planningDate: '2026-08-21' } }),
            event({ id: 'zzz', date: '2026-08-20', priority: 'A', timing: { earliestDate: '2026-08-20', latestDate: '2026-08-20', planningDate: '2026-08-19' } }),
        ];
        const result = evaluatePeriodizationPhase(events, '2026-08-08');
        expect(result.focusEvent?.id).toBe('zzz');
        expect(result.governingEventTie).toEqual([]);
    });

    it('a genuine tie through every real criterion is surfaced via governingEventTie, not silently resolved', () => {
        const events = [
            event({ id: 'race-a', date: '2026-08-20', priority: 'A' }),
            event({ id: 'race-b', date: '2026-08-20', priority: 'A' }),
        ];
        const result = evaluatePeriodizationPhase(events, '2026-08-08');
        expect(result.governingEventTie.map(e => e.id).sort()).toEqual(['race-a', 'race-b']);
        // The id backstop still deterministically picks one as focusEvent.
        expect(result.focusEvent?.id).toBe('race-a');
    });

    it('a proximity difference (not a tie) does not trigger governingEventTie even at the same priority', () => {
        const events = [
            event({ id: 'far', date: '2026-09-01', priority: 'A' }),
            event({ id: 'near', date: '2026-08-20', priority: 'A' }),
        ];
        const result = evaluatePeriodizationPhase(events, '2026-08-08');
        expect(result.governingEventTie).toEqual([]);
    });

    it('priority strictly outranks proximity (a closer B-event never beats a farther A-event)', () => {
        const events = [
            event({ id: 'a-far', date: '2026-10-01', priority: 'A' }),
            event({ id: 'b-near', date: '2026-08-15', priority: 'B' }),
        ];
        const result = evaluatePeriodizationPhase(events, '2026-08-08');
        expect(result.focusEvent?.id).toBe('a-far');
    });
});

describe('resolveMultiEventObjectives (Phase 5.6)', () => {
    const cyclingDemand = { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.5, repeatedSurges: 0.7, sprintPower: 0.2, fatigueResistance: 0.8, neuromuscular: 0.3 };

    it('a B-event 12 days out contributes race-specific exposure without capturing the macrocycle (the plan\'s own example)', () => {
        // A-event 70 days out is the taper authority (Base/Build phase, not tapering).
        // B-event 12 days out is a contributor -- outside its own 5-day B-taper window,
        // so it contributes full-strength race-specific work, not a tapered version.
        const aEvent = event({ id: 'a-event', date: '2026-10-17', priority: 'A', demandProfile: cyclingDemand }); // ~70 days out
        const bEvent = event({ id: 'b-event', date: '2026-08-20', priority: 'B', demandProfile: cyclingDemand }); // 12 days out
        const currentDate = '2026-08-08';

        const authorityResult = evaluatePeriodizationPhase([aEvent, bEvent], currentDate);
        expect(authorityResult.focusEvent?.id).toBe('a-event');
        expect(authorityResult.phase.taperActive).toBe(false);

        const resolution = resolveMultiEventObjectives([aEvent, bEvent], currentDate, authorityResult, []);
        const raceSpecific = resolution.objectives.find(o => o.key === 'race_specific_endurance');
        expect(raceSpecific).toBeDefined();
        expect(raceSpecific?.title).toBe('Cycling Race-Specific Endurance'); // full-strength, not taper-calibrated
        expect(resolution.droppedContributorObjectives).toEqual([]);
    });

    it('two contributors of different modalities sharing an objective key union their allowedModalities, order-invariant', () => {
        // A Running B-event and a Cycling B-event both produce threshold_quality
        // (thresholdPower >= 0.5, not tapering). objectivesFromDemand scopes each
        // contributor's own qualification.allowedModalities to its own event category, so
        // a naive first-contributor-wins merge would let whichever one is processed first
        // silently exclude the other modality's sessions from satisfying the shared key.
        const aEvent = event({ id: 'a-event', date: '2026-10-17', priority: 'A', demandProfile: ZERO_DEMAND }); // far out, not tapering
        const bRunning = event({ id: 'b-running', date: '2026-08-25', priority: 'B', category: 'running_race', demandProfile: cyclingDemand });
        const bCycling = event({ id: 'b-cycling', date: '2026-08-20', priority: 'B', category: 'cycling_event', demandProfile: cyclingDemand });
        const currentDate = '2026-08-08';

        const authorityResult = evaluatePeriodizationPhase([aEvent, bRunning, bCycling], currentDate);
        expect(authorityResult.phase.taperActive).toBe(false);

        const forward = resolveMultiEventObjectives([aEvent, bRunning, bCycling], currentDate, authorityResult, []);
        const reversed = resolveMultiEventObjectives([aEvent, bCycling, bRunning], currentDate, authorityResult, []);

        const forwardThreshold = forward.objectives.find(o => o.key === 'threshold_quality');
        const reversedThreshold = reversed.objectives.find(o => o.key === 'threshold_quality');

        expect(forwardThreshold).toBeDefined();
        expect(reversedThreshold).toBeDefined();
        expect(forwardThreshold?.qualification?.allowedModalities?.slice().sort()).toEqual(['Cycling', 'Running']);
        // Order-invariant: swapping which contributor is processed first must not change
        // the merged result.
        expect(reversedThreshold?.qualification?.allowedModalities?.slice().sort()).toEqual(['Cycling', 'Running']);
    });

    it('two contributors sharing an objective key resolve to max(requiredCredit), not sum', () => {
        const aEvent = event({ id: 'a-event', date: '2026-10-17', priority: 'A', demandProfile: ZERO_DEMAND });
        const bEvent1 = event({ id: 'b-1', date: '2026-08-20', priority: 'B', demandProfile: { ...cyclingDemand, aerobicEndurance: 0.9 } });
        const bEvent2 = event({ id: 'b-2', date: '2026-08-25', priority: 'B', demandProfile: { ...cyclingDemand, aerobicEndurance: 0.5 } });
        const currentDate = '2026-08-08';

        const authorityResult = evaluatePeriodizationPhase([aEvent, bEvent1, bEvent2], currentDate);
        const resolution = resolveMultiEventObjectives([aEvent, bEvent1, bEvent2], currentDate, authorityResult, []);

        const zone2 = resolution.objectives.find(o => o.key === 'zone2_aerobic');
        expect(zone2).toBeDefined();
        // Both contributors' aerobicEndurance >= 0.4 -> targetExposures 2 (>=0.7) from
        // b-1 and 1 from b-2; the merged result takes the max (2), never 2+1=3.
        expect(zone2?.targetExposures).toBe(2);
    });

    it('a contributor threshold_quality objective inside the authority\'s taper window is dropped with its reason recorded', () => {
        const aEvent = event({ id: 'a-event', date: '2026-08-15', priority: 'A', taper: { startDate: '2026-08-08' }, demandProfile: cyclingDemand }); // explicit taper starts today
        const bEvent = event({ id: 'b-event', date: '2026-08-25', priority: 'B', demandProfile: { ...cyclingDemand, thresholdPower: 0.9, vo2MaxPower: 0, repeatedSurges: 0 } });
        const currentDate = '2026-08-08';

        const authorityResult = evaluatePeriodizationPhase([aEvent, bEvent], currentDate);
        expect(authorityResult.focusEvent?.id).toBe('a-event');
        expect(authorityResult.phase.taperActive).toBe(true);

        const resolution = resolveMultiEventObjectives([aEvent, bEvent], currentDate, authorityResult, []);

        expect(resolution.objectives.some(o => o.key === 'threshold_quality')).toBe(false);
        const dropped = resolution.droppedContributorObjectives.find(d => d.objectiveKey === 'threshold_quality');
        expect(dropped).toBeDefined();
        expect(dropped?.eventId).toBe('b-event');
        expect(dropped?.reason).toBe('inadmissible_during_taper');
        expect(dropped?.message).toContain('taper window');
    });

    it('an authority objective of the same key outranks a contributor\'s on every field except the required amount', () => {
        const aEvent = event({ id: 'a-event', date: '2026-10-17', priority: 'A', demandProfile: ZERO_DEMAND });
        const bEvent = event({ id: 'b-event', date: '2026-08-20', priority: 'B', demandProfile: cyclingDemand });
        const currentDate = '2026-08-08';
        const authorityResult = evaluatePeriodizationPhase([aEvent, bEvent], currentDate);

        const authorityObjectives = [{
            id: 'obj_z2_authority', key: 'zone2_aerobic' as const, title: 'Authority Aerobic Base',
            targetExposures: 1, completedExposures: 0, targetStimulus: { aerobicEndurance: 0.8 },
        }];
        const resolution = resolveMultiEventObjectives([aEvent, bEvent], currentDate, authorityResult, authorityObjectives);

        const zone2 = resolution.objectives.find(o => o.key === 'zone2_aerobic');
        expect(zone2?.id).toBe('obj_z2_authority'); // authority's identity wins
        expect(zone2?.title).toBe('Authority Aerobic Base'); // authority's title wins
        // The contributor's cyclingDemand.aerobicEndurance (0.8, >= 0.7) yields
        // targetExposures 2, which the max-merge raises the authority's 1 to.
        expect(zone2?.targetExposures).toBe(2);
    });

    it('ignores a contributor outside its contribution window (too far out) and a non-scheduled event', () => {
        const aEvent = event({ id: 'a-event', date: '2026-10-17', priority: 'A', demandProfile: ZERO_DEMAND });
        const tooFar = event({ id: 'too-far', date: '2027-06-01', priority: 'B', demandProfile: cyclingDemand });
        const cancelled = event({ id: 'cancelled', date: '2026-08-20', priority: 'B', lifecycle: 'cancelled', demandProfile: cyclingDemand });
        const currentDate = '2026-08-08';
        const authorityResult = evaluatePeriodizationPhase([aEvent, tooFar, cancelled], currentDate);

        const resolution = resolveMultiEventObjectives([aEvent, tooFar, cancelled], currentDate, authorityResult, []);
        expect(resolution.objectives.find(o => o.key === 'race_specific_endurance')).toBeUndefined();
        expect(resolution.droppedContributorObjectives).toEqual([]);
    });

    it('is a no-op when there is no eligible authority event at all', () => {
        const authorityResult = evaluatePeriodizationPhase([], '2026-08-08');
        const resolution = resolveMultiEventObjectives([], '2026-08-08', authorityResult, []);
        expect(resolution).toEqual({ objectives: [], droppedContributorObjectives: [] });
    });
});
