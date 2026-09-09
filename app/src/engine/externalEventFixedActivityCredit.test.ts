import { describe, expect, it } from 'vitest';
import { applyFixedActivityStimulusCredit } from './planner';
import type { FixedActivity, MicrocycleState, WeeklyObjective } from './models';

const DATE = '2026-08-20';

function objective(): WeeklyObjective {
    return {
        id: 'zone2-aerobic',
        key: 'zone2_aerobic',
        title: 'Aerobic endurance',
        targetExposures: 1,
        requiredCredit: 1,
        completedExposures: 0,
        completedCredit: 0,
        projectedCredit: 0,
        priority: 'must_have',
        targetStimulus: { aerobicEndurance: 1 },
        qualification: { allowedModalities: ['Cycling'] },
    };
}

function microcycle(): MicrocycleState {
    return { windowStartDate: '2026-08-17', objectives: [objective()] };
}

function baseActivity(overrides: Partial<FixedActivity>): FixedActivity {
    return {
        id: 'fixed',
        userId: 'u1',
        title: 'Cycling commitment',
        date: DATE,
        durationMin: 60,
        expectedStimulus: { aerobicEndurance: 0.8 },
        fixed: true,
        environment: 'either',
        equipment: [],
        isCompleted: false,
        createdAt: '',
        updatedAt: '',
        ...overrides,
    };
}

describe('external event fixed-activity objective credit', () => {
    it('keeps the same qualification semantics but discounts external-authored stimulus at inferred confidence', () => {
        const exact = applyFixedActivityStimulusCredit(microcycle(), [baseActivity({
            id: 'catalog',
            templateId: 'end_easy_01',
        })], DATE);
        const external = applyFixedActivityStimulusCredit(microcycle(), [baseActivity({
            id: 'external-event:block:1:race',
            externalAuthoredIdentity: {
                modality: 'Cycling',
                category: 'Hard Endurance',
                stimulusConfidence: 'inferred',
            },
        })], DATE);

        expect(exact.credits).toHaveLength(1);
        expect(external.credits).toHaveLength(1);
        expect(exact.credits[0].earnedCredit).toBeCloseTo(0.8, 6);
        expect(external.credits[0].earnedCredit).toBeCloseTo(0.6, 6);
        expect(external.credits[0].earnedCredit).toBeCloseTo(exact.credits[0].earnedCredit * 0.75, 6);
        expect(external.exposures[0].stimulusConfidence).toBe('inferred');
    });

    it('still refuses a modality-scoped objective when the external identity names the wrong modality', () => {
        const external = applyFixedActivityStimulusCredit(microcycle(), [baseActivity({
            externalAuthoredIdentity: {
                modality: 'Running',
                category: 'Hard Endurance',
                stimulusConfidence: 'inferred',
            },
        })], DATE);

        expect(external.credits).toEqual([]);
    });

    it('credits a same-day duplicate occurrence only once, through the shared ledger identity', () => {
        const activity = baseActivity({ id: 'catalog', templateId: 'end_easy_01' });
        // A genuine duplicate record for the same occurrence (e.g. two reads racing before
        // the caller's own array-level dedup runs) must not double-count its stimulus --
        // this now goes through `dedupeFixedActivitiesByLedgerIdentity`, the same
        // occurrenceId/revision identity `dailyLedger.ts` uses, instead of a local Set.
        const result = applyFixedActivityStimulusCredit(microcycle(), [activity, { ...activity }], DATE);

        expect(result.exposures).toHaveLength(1);
        expect(result.credits).toHaveLength(1);
        expect(result.credits[0].earnedCredit).toBeCloseTo(0.8, 6);
    });

    it('fails closed on two conflicting same-day records for the same occurrence identity', () => {
        const first = baseActivity({ id: 'catalog', templateId: 'end_easy_01', durationMin: 60 });
        const conflicting = baseActivity({ id: 'catalog', templateId: 'end_easy_01', durationMin: 90 });

        expect(() => applyFixedActivityStimulusCredit(microcycle(), [first, conflicting], DATE)).toThrow(
            /Conflicting fixed-activity revisions/,
        );
    });
});
