import { describe, expect, it } from 'vitest';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import type { AuthoredPlanBlock, UserEvent } from './models';

const event: UserEvent = { id: 'race', title: 'Road race', date: '2026-09-13', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event', demandProfile: resolveDemandProfile('cycling_event', 'road_race') };
const travel: AuthoredPlanBlock = { id: 'trip-august', userId: 'u1', eventId: 'race', phase: 'travel', startDate: '2026-08-19', endDate: '2026-08-22', volumeScale: 0.6, intensityScale: 0.5, createdAt: '', updatedAt: '' };

describe('authored travel PlanBlock', () => {
  it('overrides the derived block and supplies exactly one aerobic and strength role', () => {
    const result = buildCyclingEventPlan(event, [travel]);
    if (result.status !== 'AVAILABLE') throw new Error(JSON.stringify(result));
    const active = result.data.blocks.find(block => block.startDate <= '2026-08-20' && '2026-08-20' <= block.endDate);
    expect(active).toMatchObject({ id: 'authored_trip-august', phase: 'travel' });
    const roles = result.data.objectives.filter(objective => objective.blockId === 'authored_trip-august').map(objective => objective.coverageKey).sort();
    expect(roles).toEqual(['travel_aerobic', 'travel_strength']);
  });
});
