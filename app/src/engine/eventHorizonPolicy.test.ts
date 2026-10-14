import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CYCLING_FINAL_BUILD_DAYS,
    DEFAULT_CYCLING_SPECIFICITY_DAYS,
    DEFAULT_LONG_HORIZON_AUTHORITY,
    DEFAULT_POST_EVENT_RECOVERY_DAYS,
    EVENT_HORIZON_POLICY_VERSION,
    resolveEventPhaseHorizonPolicy,
} from './eventHorizonPolicy';
import { evaluatePeriodizationPhase } from './periodization';
import { buildCyclingEventPlan, resolveActivePlanDefinitionForEvent } from './planSchedule';
import { resolvePlanningContext } from './planningMode';
import { resolveDemandProfile } from './eventPresets';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { UserEvent, AuthoredPlanBlock } from './models';

describe('eventHorizonPolicy', () => {
    const cyclingDemand = resolveDemandProfile('cycling_event', 'road_race');
    const baseEvent: UserEvent = {
        id: 'event-01',
        title: 'Target Gran Fondo',
        date: '2026-10-01',
        priority: 'A',
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: cyclingDemand,
    };

    it('resolves standard cycling defaults when no overrides are specified', () => {
        const policy = resolveEventPhaseHorizonPolicy(baseEvent);
        expect(policy.policyVersion).toBe(EVENT_HORIZON_POLICY_VERSION);
        expect(policy.finalBuildStartDaysBefore).toBe(DEFAULT_CYCLING_FINAL_BUILD_DAYS);
        expect(policy.specificityStartDaysBefore).toBe(DEFAULT_CYCLING_SPECIFICITY_DAYS);
        expect(policy.recoveryDaysAfter).toBe(DEFAULT_POST_EVENT_RECOVERY_DAYS);
        expect(policy.longHorizonAuthority).toBe(DEFAULT_LONG_HORIZON_AUTHORITY);
        expect(policy.source).toBe('cycling_default');
    });

    it('honors event-level phaseHorizons overrides', () => {
        const customEvent: UserEvent = {
            ...baseEvent,
            phaseHorizons: {
                finalBuildStartDaysBefore: 70,
                specificityStartDaysBefore: 28,
                recoveryDaysAfter: 5,
            },
        };

        const policy = resolveEventPhaseHorizonPolicy(customEvent);
        expect(policy.finalBuildStartDaysBefore).toBe(70);
        expect(policy.specificityStartDaysBefore).toBe(28);
        expect(policy.recoveryDaysAfter).toBe(5);
        expect(policy.source).toBe('event_authored');
    });

    it('clamps specificity strictly below finalBuildStartDaysBefore to prevent inverted date ranges', () => {
        const invalidEvent: UserEvent = {
            ...baseEvent,
            phaseHorizons: {
                finalBuildStartDaysBefore: 40,
                specificityStartDaysBefore: 60,
            },
        };

        const policy = resolveEventPhaseHorizonPolicy(invalidEvent);
        expect(policy.finalBuildStartDaysBefore).toBe(40);
        expect(policy.specificityStartDaysBefore).toBe(39);
    });

    it('honors explicit caller options when passed', () => {
        const policy = resolveEventPhaseHorizonPolicy(baseEvent, {
            finalBuildStartDaysBefore: 56,
            specificityStartDaysBefore: 21,
            source: 'plan_override',
        });
        expect(policy.finalBuildStartDaysBefore).toBe(56);
        expect(policy.specificityStartDaysBefore).toBe(21);
        expect(policy.source).toBe('plan_override');
        expect(policy.provenanceNote).toContain('Plan override');
    });

    it('rejects negative, NaN, and fractional horizon values and falls back safely', () => {
        const invalidEvent: UserEvent = {
            ...baseEvent,
            phaseHorizons: {
                finalBuildStartDaysBefore: -10,
                specificityStartDaysBefore: Number.NaN,
                recoveryDaysAfter: 0.5,
            },
        };

        const policy = resolveEventPhaseHorizonPolicy(invalidEvent);
        // Falls back to safe default positive integers
        expect(policy.finalBuildStartDaysBefore).toBe(DEFAULT_CYCLING_FINAL_BUILD_DAYS);
        expect(policy.specificityStartDaysBefore).toBe(DEFAULT_CYCLING_SPECIFICITY_DAYS);
        expect(policy.recoveryDaysAfter).toBe(DEFAULT_POST_EVENT_RECOVERY_DAYS);
    });

    it('ensures specificity is at least the taper duration and finalBuild exceeds specificity', () => {
        // Cycling A-event has race-week taper (minimum 3 days)
        const eventWithTaper: UserEvent = {
            ...baseEvent,
            taper: { startDate: '2026-09-24' }, // 7 days taper
            phaseHorizons: {
                finalBuildStartDaysBefore: 5,
                specificityStartDaysBefore: 2, // Less than taper duration (7 days)
            },
        };

        const policy = resolveEventPhaseHorizonPolicy(eventWithTaper);
        // Specificity is clamped up to taper duration (7)
        expect(policy.specificityStartDaysBefore).toBe(7);
        // Final build is adjusted to strictly exceed specificity (8)
        expect(policy.finalBuildStartDaysBefore).toBe(8);
    });

    it('emits non-misleading provenance when only options.source is passed', () => {
        const policy = resolveEventPhaseHorizonPolicy(baseEvent, { source: 'plan_override' });
        expect(policy.provenanceNote).not.toContain('Authored horizon override');
        expect(policy.provenanceNote).toContain('Policy source plan_override');
    });

    it('falls back to focusEvent policy if injected horizonPolicy belongs to another event', () => {
        const eventA: UserEvent = { ...baseEvent, id: 'event-A', priority: 'A', date: '2026-10-01' };
        const eventB: UserEvent = { ...baseEvent, id: 'event-B', priority: 'B', date: '2026-10-05' };

        const policyForB = resolveEventPhaseHorizonPolicy(eventB, { finalBuildStartDaysBefore: 50 });
        expect(policyForB.eventId).toBe('event-B');
        expect(policyForB.finalBuildStartDaysBefore).toBe(50);

        // evaluatePeriodizationPhase evaluates eventA as focus event
        const periodization = evaluatePeriodizationPhase([eventA, eventB], '2026-09-01', undefined, policyForB);
        expect(periodization.focusEvent?.id).toBe('event-A');
        // policyForB must NOT govern eventA! It resolves fresh for eventA
        expect(periodization.horizonPolicy.eventId).toBe('event-A');
        expect(periodization.horizonPolicy.finalBuildStartDaysBefore).toBe(DEFAULT_CYCLING_FINAL_BUILD_DAYS);
    });
});

describe('policy-owned horizon integration between periodization and planSchedule', () => {
    const eventDate = '2026-10-01';
    const cyclingDemand = resolveDemandProfile('cycling_event', 'road_race');
    const event: UserEvent = {
        id: 'event-a',
        title: 'Championship Road Race',
        date: eventDate,
        priority: 'A',
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: cyclingDemand,
    };

    // Helper to compute date string D minus N days
    const dateMinus = (days: number): string => addDaysToLocalDateString(eventDate, -days);

    describe('boundary behavior at D-(build+1) vs D-build', () => {
        it('marks D-(build+1) (D-85) as Base and outside generated plan blocks, while D-build (D-84) enters Build and generated plan blocks', () => {
            const dateD85 = dateMinus(85);
            const dateD84 = dateMinus(84);

            const periodizationD85 = evaluatePeriodizationPhase([event], dateD85);
            const periodizationD84 = evaluatePeriodizationPhase([event], dateD84);

            expect(periodizationD85.phase.phaseName).toBe('Base');
            expect(periodizationD84.phase.phaseName).toBe('Build');

            const planResult = buildCyclingEventPlan(event);
            expect(planResult.status).toBe('AVAILABLE');
            if (planResult.status !== 'AVAILABLE') return;

            // Plan blocks start at D-84
            const blockD85 = planResult.data.blocks.find(b => dateD85 >= b.startDate && dateD85 <= b.endDate);
            const blockD84 = planResult.data.blocks.find(b => dateD84 >= b.startDate && dateD84 <= b.endDate);

            expect(blockD85).toBeUndefined();
            expect(blockD84).toBeDefined();
            expect(blockD84?.id).toBe('block_build');
        });
    });

    describe('boundary behavior at D-(specificity+1) vs D-specificity', () => {
        it('marks D-(specificity+1) (D-36) as Build and D-specificity (D-35) as Specificity across periodization and planSchedule', () => {
            const dateD36 = dateMinus(36);
            const dateD35 = dateMinus(35);

            const periodizationD36 = evaluatePeriodizationPhase([event], dateD36);
            const periodizationD35 = evaluatePeriodizationPhase([event], dateD35);

            expect(periodizationD36.phase.phaseName).toBe('Build');
            expect(periodizationD35.phase.phaseName).toBe('Specificity');

            const planResult = buildCyclingEventPlan(event);
            expect(planResult.status).toBe('AVAILABLE');
            if (planResult.status !== 'AVAILABLE') return;

            const blockD36 = planResult.data.blocks.find(b => dateD36 >= b.startDate && dateD36 <= b.endDate);
            const blockD35 = planResult.data.blocks.find(b => dateD35 >= b.startDate && dateD35 <= b.endDate);

            expect(blockD36?.id).toBe('block_build');
            expect(blockD35?.id).toBe('block_peak');
        });
    });

    describe('lockstep movement under non-default policy fixture (D-70 / D-28)', () => {
        const customEvent: UserEvent = {
            ...event,
            phaseHorizons: {
                finalBuildStartDaysBefore: 70,
                specificityStartDaysBefore: 28,
            },
        };

        it('moves both evaluatePeriodizationPhase and buildCyclingEventPlan in lockstep', () => {
            const horizonPolicy = resolveEventPhaseHorizonPolicy(customEvent);
            expect(horizonPolicy.finalBuildStartDaysBefore).toBe(70);
            expect(horizonPolicy.specificityStartDaysBefore).toBe(28);

            // D-71 is Base, D-70 is Build
            const dateD71 = dateMinus(71);
            const dateD70 = dateMinus(70);
            const periodizationD71 = evaluatePeriodizationPhase([customEvent], dateD71, undefined, horizonPolicy);
            const periodizationD70 = evaluatePeriodizationPhase([customEvent], dateD70, undefined, horizonPolicy);

            expect(periodizationD71.phase.phaseName).toBe('Base');
            expect(periodizationD70.phase.phaseName).toBe('Build');

            // D-29 is Build, D-28 is Specificity
            const dateD29 = dateMinus(29);
            const dateD28 = dateMinus(28);
            const periodizationD29 = evaluatePeriodizationPhase([customEvent], dateD29, undefined, horizonPolicy);
            const periodizationD28 = evaluatePeriodizationPhase([customEvent], dateD28, undefined, horizonPolicy);

            expect(periodizationD29.phase.phaseName).toBe('Build');
            expect(periodizationD28.phase.phaseName).toBe('Specificity');

            // Plan schedule reflects the custom horizon
            const planResult = buildCyclingEventPlan(customEvent, undefined, undefined, horizonPolicy);
            expect(planResult.status).toBe('AVAILABLE');
            if (planResult.status !== 'AVAILABLE') return;

            const blockD71 = planResult.data.blocks.find(b => dateD71 >= b.startDate && dateD71 <= b.endDate);
            const blockD70 = planResult.data.blocks.find(b => dateD70 >= b.startDate && dateD70 <= b.endDate);
            const blockD29 = planResult.data.blocks.find(b => dateD29 >= b.startDate && dateD29 <= b.endDate);
            const blockD28 = planResult.data.blocks.find(b => dateD28 >= b.startDate && dateD28 <= b.endDate);

            expect(blockD71).toBeUndefined();
            expect(blockD70).toBeDefined();
            expect(blockD70?.id).toBe('block_build');

            expect(blockD29?.id).toBe('block_build');
            expect(blockD28?.id).toBe('block_peak');
        });
    });

    describe('explicit authored block before generated final build activates structured authority', () => {
        it('treats an athlete-authored block at D-100 as structured authority without modifying generic constants', () => {
            const dateD100 = dateMinus(100);
            const authoredBlocks: AuthoredPlanBlock[] = [
                {
                    id: 'foundation-travel-block',
                    userId: 'u1',
                    eventId: event.id,
                    phase: 'travel',
                    startDate: dateMinus(105),
                    endDate: dateMinus(95),
                    volumeScale: 0.8,
                    intensityScale: 0.8,
                    createdAt: '2026-01-01',
                    updatedAt: '2026-01-01',
                },
            ];

            // Periodization at D-100 is Base phase (since it is outside the final build horizon D-84)
            const periodization = evaluatePeriodizationPhase([event], dateD100);
            expect(periodization.phase.phaseName).toBe('Base');

            // Planning context: at D-100, because an authored block covers this date,
            // structured plan authority is active!
            const context = resolvePlanningContext(
                null,
                periodization,
                dateD100,
                null,
                authoredBlocks,
            );

            expect(context.mode).toBe('event_directed');
            expect(context.eventStrategy).toBe('structured_plan');

            const activePlan = resolveActivePlanDefinitionForEvent(
                event,
                dateD100,
                authoredBlocks,
                0,
                periodization.horizonPolicy,
            );
            expect(activePlan).not.toBeNull();
            expect(activePlan?.blocks.some(b => b.id === 'authored_foundation-travel-block')).toBe(true);
        });
    });

    describe('taper remains independent of final build start', () => {
        it('taper starts within race-week/taper window and is not conflated with final build or specificity', () => {
            // Event on Sunday 2026-10-04
            const sundayEvent: UserEvent = {
                ...event,
                date: '2026-10-04',
            };

            const periodization = evaluatePeriodizationPhase([sundayEvent], '2026-10-02'); // Friday before race
            expect(periodization.phase.taperActive).toBe(true);
            expect(periodization.phase.phaseName).toBe('Peak/Taper');
            // Horizon policy is still present and owns final build/specificity horizons
            expect(periodization.horizonPolicy.finalBuildStartDaysBefore).toBe(84);
            expect(periodization.horizonPolicy.specificityStartDaysBefore).toBe(35);
        });
    });
});
