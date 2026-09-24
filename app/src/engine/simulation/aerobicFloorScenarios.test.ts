import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './scenarios';
import { runScenario, type ScenarioResult } from './analyze';

/**
 * Issue #757: a novice and an established cyclist under the same 35-minute cap. Their
 * schedules may coincide, but their aerobic coverage must differ in an explained way:
 * the novice's capped rides claim `aerobic_volume` (catalog floor 30 min), while the
 * established athlete's floor (45 min) is unreachable, so the same rides earn no exact
 * coverage and are not displaced by a walk that would otherwise claim the role.
 */
async function run(id: string): Promise<ScenarioResult> {
    const scenario = SCENARIOS.find(item => item.id === id);
    if (!scenario) throw new Error(`missing scenario ${id}`);
    return runScenario(scenario);
}

function selectedRideCoverageTiers(result: ScenarioResult): number[] {
    return result.decisionTraces
        .filter(trace => trace.mode === 'train' && trace.selected.modality === 'Cycling')
        .map(trace => trace.rankingAudit?.coverageNeedTier)
        .filter((tier): tier is 0 | 1 | 2 | 3 => tier !== undefined);
}

describe('athlete-relative aerobic floor scenarios (#757)', () => {
    it('keeps cycling as the aerobic work for both athletes with no walking substitution', async () => {
        for (const id of ['aerobic_floor_novice_35min_cap', 'aerobic_floor_established_35min_cap']) {
            const result = await run(id);
            expect(result.constraintViolations).toEqual([]);
            expect(result.modalityDistribution.Walking ?? 0).toBe(0);
            expect(result.modalityDistribution.Cycling ?? 0).toBeGreaterThanOrEqual(6);
        }
    });

    it('credits capped rides as aerobic coverage only for the novice', async () => {
        const novice = selectedRideCoverageTiers(await run('aerobic_floor_novice_35min_cap'));
        const established = selectedRideCoverageTiers(await run('aerobic_floor_established_35min_cap'));
        expect(novice).toContain(1);
        expect(established.length).toBeGreaterThan(0);
        expect(established).not.toContain(1);
    });
});
