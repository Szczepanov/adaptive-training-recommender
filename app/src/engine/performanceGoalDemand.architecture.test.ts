import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Stage 2/PG5.1 (ADR-0041): `UserContext.performanceGoalDemands` is a real, live-computed
 * projection with NO consumer yet -- PG5.2/PG5.3/PG7 are deferred. This is a structural
 * regression guard, not a black-box "identical output" test: it can't pass by coincidence
 * the way a fixture-based comparison could, and it is meant to fail loudly the moment any
 * of these files starts reading the field, at which point this assertion should be
 * deliberately relaxed/removed as part of that PG7 (or later) change -- not worked around.
 */
const SELECTION_AND_PLANNING_FILES = [
    'rules.ts',
    'optimizer.ts',
    'evergreenStrategy.ts',
    'evergreenPlanning.ts',
    'weeklyDosePacking.ts',
    'weeklyAllocation.ts',
    'planner.ts',
    'sequenceSearch.ts',
];

describe('performanceGoalDemands has no planning consumer yet (Stage 2/PG5.1 scope guard)', () => {
    it.each(SELECTION_AND_PLANNING_FILES)('%s does not reference performanceGoalDemands', fileName => {
        const source = readFileSync(join(ENGINE_DIR, fileName), 'utf8');
        expect(source).not.toContain('performanceGoalDemands');
    });
});
