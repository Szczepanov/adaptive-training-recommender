import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from './event-plan';

/**
 * `docs/architecture/recommendation-engine.md` and ADR-0016 both describe
 * `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` as the **frozen** event-directed cycling
 * contract. Until this file existed that was a claim the suite did not back: the only
 * other references pass the constant as *input* to `buildPlanDefinition`, which exercises
 * the builder, not the contents. An edit to a coverage key, phase list or requirement
 * would have changed event-directed planning with no failing test and no POLICY_VERSION
 * signal — `check-policy-drift.mjs` watches decision logic, not this data.
 *
 * This does not contradict D-GATE's refusal to byte-gate the simulation baseline. That
 * argument is about decision *output*, where a frozen gate would entrench known-bad
 * behaviour. This is a frozen *input contract* the docs already declare immutable.
 *
 * A failure here is not a test to update reflexively. Changing this constant is a
 * deliberate contract change and needs an ADR amendment first.
 */

/** Field order and array order are normalised so a cosmetic reordering is not reported as
 * a contract change, while any semantic edit is. */
function canonicalise(coverage: typeof SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE): string {
    return JSON.stringify(
        coverage
            .map(item => ({
                key: item.key,
                requirement: item.requirement,
                phases: [...item.phases].sort(),
                workoutIds: [...item.workoutIds].sort(),
            }))
            .sort((left, right) => left.key.localeCompare(right.key)),
    );
}

const FROZEN_KEY_COUNT = 18;
const FROZEN_SHA256 = 'ff541fd231d16c35f164899952f2ee0fbb086018d649fc2bf9b78f79d790039e';

const CONTRACT_CHANGE_MESSAGE = [
    'SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE is the frozen event-directed cycling contract',
    '(ADR-0016). If this change is deliberate, amend the ADR and update the reference here in',
    'the same commit, stating what changed and why. Do not update the hash alone.',
].join(' ');

describe('frozen September cycling coverage contract', () => {
    it('matches its committed reference', () => {
        expect(createHash('sha256').update(canonicalise(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE)).digest('hex'), CONTRACT_CHANGE_MESSAGE)
            .toBe(FROZEN_SHA256);
    });

    it('still declares every coverage key the contract was frozen with', () => {
        expect(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE, CONTRACT_CHANGE_MESSAGE)
            .toHaveLength(FROZEN_KEY_COUNT);
        // Named explicitly so a diff shows which role was added or removed, rather than
        // only that a hash moved.
        expect(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE.map(item => item.key).sort()).toEqual([
            'aerobic_volume', 'compact_strength', 'field_maintenance', 'gap_closing',
            'outdoor_event_specific', 'pre_race_openers', 'primary_strength', 'race_day',
            'race_week_strength', 'recovery_or_rest', 'recovery_spin', 'short_surges',
            'sustained_quality', 'taper_sharpening', 'travel_aerobic', 'travel_strength',
            'upper_body_trunk', 'walk_run',
        ]);
    });

    it('detects a semantic edit but tolerates a cosmetic reordering', () => {
        const reordered = [...SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE].reverse();
        expect(canonicalise(reordered)).toBe(canonicalise(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE));

        const edited = SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE.map((item, index) =>
            index === 0 ? { ...item, requirement: 'optional' as const } : item);
        expect(canonicalise(edited)).not.toBe(canonicalise(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE));
    });
});
