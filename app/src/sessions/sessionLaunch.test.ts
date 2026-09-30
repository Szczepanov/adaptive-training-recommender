import { describe, expect, it } from 'vitest';
import { archivedSavedDefinitionError, canLaunchExternalPlanSession } from './sessionLaunch';
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
