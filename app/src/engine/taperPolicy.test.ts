import { describe, expect, it } from 'vitest';
import type { UserEvent } from './models';
import { evaluatePeriodizationPhase } from './periodization';
import { resolveEventTaper } from './taperPolicy';

const zeroDemand = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0,
    sprintPower: 0, fatigueResistance: 0, neuromuscular: 0,
};

function generalTarget(taper?: UserEvent['taper']): UserEvent {
    return {
        id: 'general-target', title: 'General fitness milestone', date: '2026-08-20', priority: 'A',
        lifecycle: 'scheduled', category: 'general_target', demandProfile: zeroDemand, taper,
    };
}

describe('resolveEventTaper', () => {
    it('never infers a taper from priority for a general target', () => {
        const target = generalTarget();
        expect(resolveEventTaper(target)).toBeNull();

        for (const date of ['2026-08-01', '2026-08-06', '2026-08-14', '2026-08-19', '2026-08-20']) {
            expect(evaluatePeriodizationPhase([target], date).phase.taperActive).toBe(false);
        }
    });

    it('honours an explicitly authored general-target taper start', () => {
        const target = generalTarget({ startDate: '2026-08-14' });
        expect(resolveEventTaper(target)).toMatchObject({ startDate: '2026-08-14', endDate: '2026-08-19' });
        expect(evaluatePeriodizationPhase([target], '2026-08-14').phase.taperActive).toBe(true);
    });

    it('keeps the cycling A-event race-week default', () => {
        const cycling: UserEvent = { ...generalTarget(), category: 'cycling_event', id: 'race' };
        expect(resolveEventTaper(cycling)).toMatchObject({ startDate: '2026-08-17', endDate: '2026-08-19' });
    });
});
