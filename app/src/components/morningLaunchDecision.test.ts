import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../engine/models';
import type { SessionDefinition, SessionReferenceBinding } from '../sessions/models';
import type { WorkoutPrescription } from '../workouts';
import { resolveWorkoutPrescription } from '../workouts';
import { createAuthoredSessionTemplate } from '../engine/authoredSessionGates';
import { resolveMorningLaunch, withheldLaunchExplanation, type MorningLaunchInputs } from './morningLaunchDecision';

const authoredBinding = {
    sessionSource: { kind: 'manual', definitionId: 'my-tempo', revision: 2, contentHash: 'sha256:authored' },
    prescriptionHash: 'hash-authored',
    occurrenceId: 'occ-1',
} as unknown as SessionReferenceBinding;

const externalBinding = {
    sessionSource: { kind: 'external_plan', planId: 'coach-block-a', revision: 3, sessionId: 'w2-tempo', contentHash: 'sha256:ext' },
    prescriptionHash: 'hash-external',
} as unknown as SessionReferenceBinding;

const catalogBinding = {
    sessionSource: { kind: 'catalog', workoutId: 'running_threshold', catalogVersion: '1' },
    prescriptionHash: 'hash-catalog',
} as unknown as SessionReferenceBinding;

const displayedPrescription = { targetDurationMin: 30, displayBlocks: [] } as unknown as WorkoutPrescription;

const base: MorningLaunchInputs = {
    canLaunch: true,
    hasAthleteAdjustment: false,
    prescription: undefined,
    primarySession: authoredBinding,
    isExternalExcluded: false,
    isExternalPrimaryBindingUnavailable: false,
};

describe('resolveMorningLaunch (morning-decision-ux.md §4)', () => {
    it('launches the stored binding when no adjustment is applied', () => {
        expect(resolveMorningLaunch(base)).toEqual({ kind: 'primary', binding: authoredBinding });
    });

    it('withholds an authored binding under an adjustment with no displayable prescription', () => {
        expect(resolveMorningLaunch({ ...base, hasAthleteAdjustment: true }))
            .toEqual({ kind: 'withheld', binding: authoredBinding });
    });

    it('offers nothing for an adjusted imported binding because the verdict banner owns recovery', () => {
        expect(resolveMorningLaunch({
            ...base,
            primarySession: externalBinding,
            hasAthleteAdjustment: true,
            isExternalPrimaryBindingUnavailable: true,
        })).toEqual({ kind: 'none' });
    });

    it('withholds a catalog binding when the adjustment resolved no catalog prescription', () => {
        expect(resolveMorningLaunch({ ...base, primarySession: catalogBinding, hasAthleteAdjustment: true }))
            .toEqual({ kind: 'withheld', binding: catalogBinding });
    });

    it('launches the displayed prescription when an adjustment has one and launch authority allows it', () => {
        expect(resolveMorningLaunch({ ...base, hasAthleteAdjustment: true, prescription: displayedPrescription }))
            .toEqual({ kind: 'adjusted', prescription: displayedPrescription });
    });

    it('fails closed when an imported binding is unavailable even if a catalog prescription appears', () => {
        expect(resolveMorningLaunch({
            ...base,
            primarySession: externalBinding,
            hasAthleteAdjustment: true,
            prescription: displayedPrescription,
            isExternalPrimaryBindingUnavailable: true,
        })).toEqual({ kind: 'none' });
    });

    it('offers nothing when the external verdict excludes the day even if other flags are inconsistent', () => {
        // isExternalExcluded is authoritative on its own: the helper must not depend on
        // callers also setting the derived primary-binding-unavailable flag.
        expect(resolveMorningLaunch({
            ...base,
            primarySession: externalBinding,
            hasAthleteAdjustment: true,
            isExternalExcluded: true,
            isExternalPrimaryBindingUnavailable: false,
        })).toEqual({ kind: 'none' });
        expect(resolveMorningLaunch({
            ...base,
            hasAthleteAdjustment: true,
            prescription: displayedPrescription,
            isExternalExcluded: true,
            isExternalPrimaryBindingUnavailable: false,
        })).toEqual({ kind: 'none' });
    });

    it('offers nothing when launching is not possible at all', () => {
        expect(resolveMorningLaunch({ ...base, canLaunch: false })).toEqual({ kind: 'none' });
        expect(resolveMorningLaunch({ ...base, canLaunch: false, hasAthleteAdjustment: true })).toEqual({ kind: 'none' });
        expect(resolveMorningLaunch({ ...base, primarySession: undefined, hasAthleteAdjustment: true })).toEqual({ kind: 'none' });
    });
});

describe('withheldLaunchExplanation', () => {
    it('names the source of the withheld session in athlete language', () => {
        expect(withheldLaunchExplanation(authoredBinding, 'start').text).toMatch(/^Your own session can only run exactly as written/);
        // Unreachable from the card (the verdict path withholds an adjusted imported binding
        // first), but the copy stays source-neutral rather than claiming authorship.
        expect(withheldLaunchExplanation(externalBinding, 'start').text).toMatch(/^This adjustment did not produce a version/);
        expect(withheldLaunchExplanation(catalogBinding, 'start').text).toMatch(/^This adjustment did not produce a version of today’s session/);
    });

    it('matches the title and reset instruction to the withheld affordance', () => {
        expect(withheldLaunchExplanation(authoredBinding, 'start')).toMatchObject({
            title: 'Start is unavailable while this adjustment is applied',
            text: expect.stringMatching(/Reset to the original session to start it\.$/),
        });
        expect(withheldLaunchExplanation(authoredBinding, 'resume').title).toBe('Resume is unavailable while this adjustment is applied');
        expect(withheldLaunchExplanation(authoredBinding, 'redo')).toMatchObject({
            title: 'Redo is unavailable while this adjustment is applied',
            text: expect.stringMatching(/Reset to the original session to redo it\.$/),
        });
    });
});

describe('authored replacement precondition (M3.3)', () => {
    // Reproduction anchor: Home's time-crunch keeps the authored primarySession and re-resolves
    // a catalog prescription for the authored template. That resolution can never succeed,
    // so without the withheld rule the card fell through to the full authored binding.
    it('an authored template never resolves a catalog prescription, even time-crunched', () => {
        const definition: SessionDefinition = {
            schemaVersion: 1,
            id: 'my-tempo',
            revision: 2,
            title: 'My Tempo Run',
            intent: 'training',
            dominantModality: 'Running',
            duration: { min: 60, max: 70 },
            blocks: [{
                id: 'b1',
                role: 'main',
                executionMode: 'sequential',
                steps: [{
                    id: 's1',
                    kind: 'exercise',
                    exerciseRef: { kind: 'catalog', exerciseId: 'interval_run' },
                    dose: { kind: 'duration', seconds: 3600 },
                }],
            }],
        };
        const template = createAuthoredSessionTemplate(definition);
        const timeCrunched = {
            mode: 'train',
            rationale: 'Authored replacement (Time-crunch adjusted to 30 min).',
            template: { ...template, durationMin: 30, durationMax: 35 },
            executionDose: { volume: 0.5, intensity: 1 },
            primarySession: authoredBinding,
        } as unknown as Recommendation;

        expect(template.id).toBe('authored:my-tempo:2');
        expect(resolveWorkoutPrescription(timeCrunched, 'athlete-1', '2026-10-01', undefined, timeCrunched.executionDose)).toBeNull();
    });
});
