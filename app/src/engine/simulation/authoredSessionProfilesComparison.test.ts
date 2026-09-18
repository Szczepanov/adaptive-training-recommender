import { describe, expect, it } from 'vitest';
import { runAuthoredSessionProfilesComparison } from './authoredSessionProfilesComparison';
import type { ExternalPlanSessionV2 } from '../../sessions/externalPlanV2';
import type { SessionDefinition } from '../../sessions/models';

import fixture02 from '../../sessions/fixtures/02-lower-olympic-variants.json';
import fixture03 from '../../sessions/fixtures/03-upper-body-absorption-and-spin.json';

/**
 * M8.1 done-when check: "the upper-only sample no longer claims heavy lower work in
 * candidate output, the lower/Olympic sample does, every gate discrepancy is reported."
 * Neither fixture carries an authored `gating` block (they're logged via
 * `unplanned_fixture`, not an external plan) -- a plausible authored coarse guess is
 * synthesized here, deliberately not tuned to favor either adapter, exactly as an
 * athlete's real importer would produce without knowing the session's real movement
 * content.
 */
function v2Session(definition: SessionDefinition): ExternalPlanSessionV2 {
    return {
        id: definition.id,
        title: definition.title,
        priority: 'key',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
        gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
        definition,
    };
}

describe('runAuthoredSessionProfilesComparison', () => {
    const report = runAuthoredSessionProfilesComparison([
        v2Session(fixture02 as unknown as SessionDefinition),
        v2Session(fixture03 as unknown as SessionDefinition),
    ]);
    const [lowerOlympicRow, upperOnlyRow] = report.rows;

    it('keeps avoid_heavy_lower_body for the lower/Olympic sample -- current and candidate agree', () => {
        expect(lowerOlympicRow.current.safetyTags).toContain('avoid_heavy_lower_body');
        expect(lowerOlympicRow.candidate.safetyTags).toContain('avoid_heavy_lower_body');
        // The candidate correctly drops avoid_overhead_pressing here (no overhead-press
        // movement in this session) -- a real, separately-reported discrepancy on a
        // different tag, not a disagreement about heavy lower work.
        const safetyDiscrepancy = lowerOlympicRow.discrepancies.find(d => d.field === 'safetyTags');
        expect(safetyDiscrepancy?.candidate).toContain('avoid_heavy_lower_body');
    });

    it('reports the upper-only sample\'s candidate as no longer claiming heavy lower work, unlike today\'s adapter', () => {
        expect(upperOnlyRow.current.safetyTags).toContain('avoid_heavy_lower_body');
        expect(upperOnlyRow.candidate.safetyTags).not.toContain('avoid_heavy_lower_body');
        const safetyDiscrepancy = upperOnlyRow.discrepancies.find(d => d.field === 'safetyTags');
        expect(safetyDiscrepancy).toBeDefined();
        expect(safetyDiscrepancy?.current).toContain('avoid_heavy_lower_body');
        expect(safetyDiscrepancy?.candidate).not.toContain('avoid_heavy_lower_body');
    });

    it('does not claim any selection authority', () => {
        expect(report.scope).toBe('eligibility-safety-tags-only');
        expect(report.limitations.some(limitation => limitation.includes('no selection authority'))).toBe(true);
    });
});
