import { describe, expect, it } from 'vitest';
import { runScenario } from './analyze';
import { SCENARIOS } from './scenarios';
import { workoutForTemplate } from '../../workouts/prescription';
import { athleticCapabilitiesCreditedBy } from '../../workouts/athleticCapability';
import { getDayDiff } from '../../utils/localDate';

/** Issue #805 Phase 7: 8-week projection of an identical athlete with and without the
 * broad-athleticism opt-in. Cadence and no-inflation are deterministic engine claims. */

interface SimulatedDay { date: string; templateId: string }

async function simulatedDays(id: string): Promise<SimulatedDay[]> {
    const scenario = SCENARIOS.find(item => item.id === id)!;
    const result = await runScenario(scenario);
    return result.decisionTraces.map(trace => ({
        date: trace.date,
        templateId: (trace.selected as { templateId: string }).templateId,
    }));
}

const isTraining = (templateId: string) => !templateId.startsWith('rest_') && !templateId.startsWith('mob_');

describe('capability maintenance 8-week simulation (#805)', () => {
    it('recurs field capability work no earlier than 14 days after the prior qualifying touch, without adding sessions', async () => {
        const optedIn = await simulatedDays('capability_maintenance_opted_in_8wk');
        const optedOut = await simulatedDays('capability_maintenance_opted_out_8wk');
        const scenario = SCENARIOS.find(item => item.id === 'capability_maintenance_opted_in_8wk')!;

        expect(optedOut.some(day => day.templateId.startsWith('field_'))).toBe(false);
        expect(optedIn.filter(day => isTraining(day.templateId)).length)
            .toBeLessThanOrEqual(optedOut.filter(day => isTraining(day.templateId)).length);

        const touches = [
            ...(scenario.initialHistory ?? []).map(exposure => ({ date: exposure.date, workoutId: exposure.workoutId })),
            ...optedIn.map(day => ({ date: day.date, workoutId: workoutForTemplate(day.templateId)?.id })),
        ].sort((left, right) => left.date.localeCompare(right.date));
        const capabilityDays = optedIn.filter(day => athleticCapabilitiesCreditedBy({ workoutId: workoutForTemplate(day.templateId)?.id }).length > 0);
        expect(capabilityDays.length).toBeGreaterThan(0);
        for (const day of capabilityDays) {
            const credited = athleticCapabilitiesCreditedBy({ workoutId: workoutForTemplate(day.templateId)?.id });
            // At least one capability this session credits was owed: its previous qualifying
            // touch is >= 14 days earlier (no weekly checkbox, no pulled-forward placement).
            const owedCapability = credited.some(capability => {
                const previous = touches
                    .filter(touch => touch.date < day.date
                        && athleticCapabilitiesCreditedBy({ workoutId: touch.workoutId }).includes(capability))
                    .at(-1);
                return !previous || getDayDiff(day.date, previous.date) >= 14;
            });
            expect(owedCapability, `${day.date} ${day.templateId}`).toBe(true);
        }
    }, 120_000);
});
