import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluatePeriodizationPhase } from './periodization';
import { resolvePlanningContext } from './planningMode';
import type { TrainingIntentProfile, UserEvent } from './models';

/**
 * ADR-0017 D-MODE makes `planningMode.ts` `resolvePlanningContext` the single authority
 * for the **effective** planning mode. `TrainingIntentProfile.planningMode` records the
 * athlete's stated intent, which is a different thing: an `event_directed` profile whose
 * events have all passed resolves to `evergreen`.
 *
 * Until this file existed the rule was documented and followed by the decision path, but
 * unenforced — and two consumers had already drifted, branching on the persisted field
 * and so disagreeing with the engine for exactly the athletes the distinction exists for.
 */

const SRC_ROOT = join(import.meta.dirname, '..');

/**
 * Branching on a **profile's** `planningMode` is the violation — that is where a second,
 * disagreeing answer is born. Setting, persisting, validating and type-declaring the
 * field are all fine, and so is comparing an already-resolved mode
 * (`planningContext.mode`, `plan.planningMode`), which is what callers should do instead.
 *
 * Matching on a `…profile…` receiver rather than on the property name alone is what keeps
 * this rule from forbidding the correct pattern along with the incorrect one.
 */
const PROFILE_MODE_COMPARISON = /\w*[Pp]rofile\??\.\s*planningMode\s*(===|!==)/;

const ALLOWED = new Set([
    // The authority itself.
    'engine/planningMode.ts',
    // This test, which necessarily contains the pattern it forbids.
    'engine/planningModeAuthority.test.ts',
]);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

describe('planning-mode derivation authority (ADR-0017 D-MODE)', () => {
    it('is the only module that branches on a planning-mode literal', () => {
        const offenders = sourceFiles(SRC_ROOT)
            .filter(file => PROFILE_MODE_COMPARISON.test(readFileSync(file, 'utf8')))
            .map(file => relative(SRC_ROOT, file).replace(/\\/g, '/'))
            .filter(file => !ALLOWED.has(file));

        expect(offenders, [
            'These modules compare a planning mode against a literal instead of consuming',
            'the mode `resolvePlanningContext` resolved. The persisted profile field is the',
            'athlete\'s stated intent, not the outcome — an event_directed profile with no',
            'eligible event is planned as evergreen. Consume the resolved mode',
            '(`PlanningContext.mode`, or `WeekAheadPlan.planningMode`) instead.',
        ].join(' ')).toEqual([]);
    });

    it('resolves an event_directed profile with no eligible event to evergreen', () => {
        // The concrete divergence the scan above prevents: reading the persisted field
        // here would answer 'event_directed' where the engine plans evergreen.
        const profile = { planningMode: 'event_directed' } as TrainingIntentProfile;
        const context = resolvePlanningContext(profile, evaluatePeriodizationPhase([], '2026-08-15'), '2026-08-15');

        expect(profile.planningMode).toBe('event_directed');
        expect(context.mode).toBe('evergreen');
        expect(context.focusEvent).toBeNull();
    });

    it('resolves an event_directed profile with an eligible event to event_directed', () => {
        const event: UserEvent = {
            id: 'e1', title: 'Road race', date: '2026-09-12', category: 'cycling_event',
            priority: 'A', lifecycle: 'scheduled',
            demandProfile: {
                aerobicEndurance: 0.9, thresholdPower: 0.7, vo2MaxPower: 0.5,
                repeatedSurges: 0.6, sprintPower: 0.4, fatigueResistance: 0.8,
            },
        } as UserEvent;
        const profile = { planningMode: 'event_directed' } as TrainingIntentProfile;
        const context = resolvePlanningContext(profile, evaluatePeriodizationPhase([event], '2026-08-15'), '2026-08-15');

        expect(context.mode).toBe('event_directed');
    });
});
