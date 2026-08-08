import { describe, it } from 'vitest';
import { runAllScenarios, runScenario } from './simulation/analyze';
import { SCENARIOS } from './simulation/scenarios';

function scenario(id: string) {
    const found = SCENARIOS.find(item => item.id === id);
    if (!found) throw new Error(`Missing scenario ${id}`);
    return found;
}

describe('temporary Phase 4 scenario diagnostics', () => {
    it('prints criterium, triathlon, and readiness trajectories', async () => {
        for (const id of ['cycling_criterium_A', 'cycling_criterium_fresh_A', 'cycling_criterium_stressed_A', 'triathlon_olympic_A']) {
            const result = await runScenario(scenario(id));
            console.log(`DIAG:${id}:${JSON.stringify({
                categoryDistribution: result.categoryDistribution,
                modalityDistribution: result.modalityDistribution,
                restOrRecoveryDayCount: result.restOrRecoveryDayCount,
                objectiveResolution: result.objectiveResolution,
                objectiveCredits: result.objectiveCredits,
                anchorWeeks: result.anchorWeeks,
                fatigueTierDayCounts: result.fatigueTierDayCounts,
                qualityWarnings: result.qualityWarnings,
            })}`);
        }
        const report = await runAllScenarios();
        console.log(`DIAG:readinessSensitivity:${JSON.stringify(report.readinessSensitivity)}`);
    });
});
