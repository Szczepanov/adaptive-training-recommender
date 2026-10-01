import { describe, expect, it } from 'vitest';
import { archivedSavedDefinitionError, canLaunchExternalPlanSession, isPreparedReducedExternalBinding } from './sessionLaunch';
import type { SessionDefinition, SessionReferenceBinding } from './models';
import type { AnyExternalPlanSession } from './externalPlanV2';

// M4.3 follow-up: SessionRunner's startCompanion resolves a saved definition by header the
// same way startSavedDefinition does, so both must reject the same archived headers -- see
// the shared guard's usage in both flows in SessionRunner.tsx.
describe('archivedSavedDefinitionError', () => {
    it('rejects an archived header', () => {
        expect(archivedSavedDefinitionError({ status: 'archived' }, 'This template'))
            .toBe('This template is archived -- restore it before starting.');
    });

    it('allows an active header', () => {
        expect(archivedSavedDefinitionError({ status: 'active' }, 'This template')).toBeNull();
    });

    it('allows a header with no status (pre-lifecycle headers default to active)', () => {
        expect(archivedSavedDefinitionError({}, 'This template')).toBeNull();
    });
});

// PR-B (#893 WP3.1): the composition-level pin that `skip`, `defer`, advisory events,
// authored rest, and v1 flat prescriptions never reach `prepareExternalPlanSessionLaunch`.
describe('canLaunchExternalPlanSession', () => {
    const definitionSession = {
        id: 'session-101', title: 'VO2 Max Intervals', priority: 'key',
        placement: { week: 1, preferredDay: 'tuesday', flexibility: 'fixed', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 60, environment: 'indoor', equipment: [] },
        definition: { id: 'session-101' },
    } as unknown as AnyExternalPlanSession;
    const prescriptionSession = {
        id: 'session-101', title: 'Coach note',
        placement: { week: 1, preferredDay: 'tuesday', flexibility: 'fixed', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 60, environment: 'indoor', equipment: [] },
        prescription: { summary: 'Flat v1 prescription' },
    } as unknown as AnyExternalPlanSession;

    it('launches definition-bearing sessions under proceed and scale verdicts', () => {
        expect(canLaunchExternalPlanSession(definitionSession, { verdictDecision: 'proceed' })).toBe(true);
        expect(canLaunchExternalPlanSession(definitionSession, { verdictDecision: 'scale' })).toBe(true);
    });

    it.each(['skip', 'defer', 'advisory', undefined] as const)('never launches under a %s verdict', verdictDecision => {
        expect(canLaunchExternalPlanSession(definitionSession, { verdictDecision })).toBe(false);
    });

    it('refuses v1 flat prescriptions even under proceed', () => {
        expect(canLaunchExternalPlanSession(prescriptionSession, { verdictDecision: 'proceed' })).toBe(false);
        expect(canLaunchExternalPlanSession(prescriptionSession, { verdictDecision: 'scale' })).toBe(false);
    });

    it('exposes no Start path for advisory events and authored rest', () => {
        expect(canLaunchExternalPlanSession(definitionSession, { verdictDecision: 'proceed', isEvent: true })).toBe(false);
        expect(canLaunchExternalPlanSession(definitionSession, { verdictDecision: 'scale', isEvent: true })).toBe(false);
        expect(canLaunchExternalPlanSession(definitionSession, { verdictDecision: 'proceed', templateId: 'rest_01' })).toBe(false);
    });

    it('fails closed on a missing session', () => {
        expect(canLaunchExternalPlanSession(null, { verdictDecision: 'proceed' })).toBe(false);
        expect(canLaunchExternalPlanSession(undefined, { verdictDecision: 'proceed' })).toBe(false);
    });
});

// #949: Home may start a scaled imported session only through the exact prepared reduced snapshot.
describe('isPreparedReducedExternalBinding', () => {
    const prescription = {
        planId: 'coach-block-a',
        revision: 3,
        sessionId: 'w2-tempo',
        scaling: { reducible: true, reducedDefinition: {} as SessionDefinition },
    };
    const binding: SessionReferenceBinding = {
        sessionSource: { kind: 'external_plan', planId: 'coach-block-a', revision: 3, sessionId: 'w2-tempo', contentHash: 'hash' },
        occurrenceId: 'occ-1',
        prescriptionHash: 'reduced-hash',
    };
    const prepared = { variant: 'reduced' as const, prescriptionHash: 'reduced-hash' };

    it('permits only the exact prepared reduced prescription for the same external source', () => {
        expect(isPreparedReducedExternalBinding(prescription, binding, prepared)).toBe(true);
    });

    it.each([
        ['legacy/no scaling', { ...prescription, scaling: undefined }],
        ['non-reducible', { ...prescription, scaling: { reducible: false, reducedDefinition: {} as SessionDefinition } }],
        ['missing structured reduced definition', { ...prescription, scaling: { reducible: true } }],
    ])('fails closed for %s even when runtime evidence claims reduced', (_label, candidate) => {
        expect(isPreparedReducedExternalBinding(candidate, binding, prepared)).toBe(false);
    });

    it('blocks the full prepared form even though full and reduced share the same source identity', () => {
        expect(isPreparedReducedExternalBinding(
            prescription,
            binding,
            { variant: 'full', prescriptionHash: binding.prescriptionHash },
        )).toBe(false);
    });

    it('blocks a reduced proof whose immutable prescription hash does not match the binding', () => {
        expect(isPreparedReducedExternalBinding(
            prescription,
            binding,
            { variant: 'reduced', prescriptionHash: 'different-reduced-hash' },
        )).toBe(false);
    });

    it.each([
        ['plan', { planId: 'other-plan' }],
        ['revision', { revision: 2 }],
        ['session', { sessionId: 'w3-tempo' }],
    ] as const)('blocks a binding to a different %s', (_label, change) => {
        const other = { ...binding, sessionSource: { ...binding.sessionSource, ...change } } as SessionReferenceBinding;
        expect(isPreparedReducedExternalBinding(prescription, other, prepared)).toBe(false);
    });

    it('blocks a non-external binding and missing evidence', () => {
        const catalog: SessionReferenceBinding = {
            sessionSource: { kind: 'catalog', workoutId: 'cyc_end_01', catalogVersion: '1' },
            prescriptionHash: 'catalog-hash',
        };
        expect(isPreparedReducedExternalBinding(prescription, catalog, prepared)).toBe(false);
        expect(isPreparedReducedExternalBinding(prescription, undefined, prepared)).toBe(false);
        expect(isPreparedReducedExternalBinding(null, binding, prepared)).toBe(false);
        expect(isPreparedReducedExternalBinding(prescription, binding, undefined)).toBe(false);
    });
});
