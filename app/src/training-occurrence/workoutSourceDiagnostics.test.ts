import { describe, expect, it } from 'vitest';
import {
    FAILURE_STATE_CODES,
    FAILURE_STATE_NUMBER,
    STATE_REASONS,
    observedReconciliationOutcome,
    projectWorkoutSourceDiagnostics,
    sourceCompletenessFor,
    type FailureStateCode,
} from './workoutSourceDiagnostics';
import type { ProviderSourceRead } from './completedWorkoutView';
import { garminActivity, garminActivityWithoutSets, garminOnlyView, structuredOnlyView, workoutView } from './workoutSourceDiagnostics.fixtures';

const states = (view: Parameters<typeof projectWorkoutSourceDiagnostics>[0]) => projectWorkoutSourceDiagnostics(view).states;

describe('failure-state catalogue', () => {
    it('names exactly the eight #895 section 10 states in issue order', () => {
        expect(FAILURE_STATE_CODES).toEqual([
            'session_execution_absent',
            'entry_write_unsettled',
            'garmin_activity_absent',
            'garmin_detail_unavailable',
            'garmin_detail_empty',
            'reconciliation_no_candidate',
            'reconciliation_ambiguous',
            'read_model_projection_failed',
        ]);
        expect(FAILURE_STATE_CODES.map(code => FAILURE_STATE_NUMBER[code])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('assesses every state for every workout, so no state silently goes missing', () => {
        expect(Object.keys(states(workoutView())).sort()).toEqual([...FAILURE_STATE_CODES].sort());
        expect(Object.keys(states(garminOnlyView())).sort()).toEqual([...FAILURE_STATE_CODES].sort());
    });

    it('registers a reason list for every state', () => {
        for (const code of FAILURE_STATE_CODES) {
            expect(STATE_REASONS[code]).toBeDefined();
        }
    });
});

describe('state 1 -- SessionExecution absent', () => {
    it('is clear when the linked execution was read', () => {
        expect(states(workoutView()).session_execution_absent).toEqual({ status: 'clear' });
    });

    it('holds with no_execution_linked for a Garmin-only occurrence', () => {
        expect(states(garminOnlyView()).session_execution_absent).toEqual({ status: 'holds', reasons: ['no_execution_linked'] });
    });

    it('holds with execution_document_missing when the linked execution document does not exist', () => {
        const result = states(structuredOnlyView({ sourceReads: { structured: { status: 'execution_missing' } } }));
        expect(result.session_execution_absent).toEqual({ status: 'holds', reasons: ['execution_document_missing'] });
    });

    it.each([
        { status: 'execution_unavailable' },
        { status: 'execution_invalid' },
    ] as const)('is not_observable (never "absent") when the execution read was $status', structured => {
        const result = states(structuredOnlyView({ sourceReads: { structured } }));
        expect(result.session_execution_absent).toEqual({ status: 'not_observable', reason: 'execution_unreadable' });
    });
});

describe('state 2 -- SessionEntry write pending/failed', () => {
    it('holds with queued_writes and reports the depth', () => {
        const view = workoutView({ sourceReads: { outbox: { status: 'read', queued: 2, failed: 0 } } });
        expect(states(view).entry_write_unsettled).toEqual({ status: 'holds', reasons: ['queued_writes'] });
        expect(projectWorkoutSourceDiagnostics(view).outbox).toEqual({ status: 'read', queued: 2, failed: 0 });
    });

    it('holds with failed_writes', () => {
        const view = workoutView({ sourceReads: { outbox: { status: 'read', queued: 0, failed: 1 } } });
        expect(states(view).entry_write_unsettled).toEqual({ status: 'holds', reasons: ['failed_writes'] });
    });

    it('reports both failed and queued writes rather than letting one mask the other', () => {
        const view = workoutView({ sourceReads: { outbox: { status: 'read', queued: 3, failed: 1 } } });
        expect(states(view).entry_write_unsettled).toEqual({ status: 'holds', reasons: ['failed_writes', 'queued_writes'] });
    });

    it('is NOT reported as synced/clear when this device holds no receipts -- receipts are device-local', () => {
        const result = states(workoutView({ sourceReads: { outbox: { status: 'read', queued: 0, failed: 0 } } }));
        expect(result.entry_write_unsettled).toEqual({ status: 'not_observable', reason: 'receipts_are_device_local' });
    });

    it('is not_observable when the receipt store could not be read', () => {
        const result = states(workoutView({ sourceReads: { outbox: { status: 'unreadable' } } }));
        expect(result.entry_write_unsettled).toEqual({ status: 'not_observable', reason: 'receipts_unreadable' });
    });

    it('is not_applicable without a structured execution', () => {
        expect(states(garminOnlyView()).entry_write_unsettled).toEqual({ status: 'not_applicable', reason: 'no_execution_linked' });
    });
});

describe('state 3 -- Garmin activity absent', () => {
    it('is clear when the Garmin activity record was hydrated', () => {
        expect(states(workoutView()).garmin_activity_absent).toEqual({ status: 'clear' });
    });

    it('holds with no_provider_linked for a structured-only occurrence', () => {
        expect(states(structuredOnlyView()).garmin_activity_absent).toEqual({ status: 'holds', reasons: ['no_provider_linked'] });
    });

    it('holds with activity_not_in_read_window when a linked Garmin ref has no record in a readable window', () => {
        const view = workoutView({ garmin: undefined, sourceReads: { provider: 'activity_not_in_read_window' } });
        expect(states(view).garmin_activity_absent).toEqual({ status: 'holds', reasons: ['activity_not_in_read_window'] });
    });

    it('is not_observable when the activities collection itself could not be read', () => {
        const view = workoutView({ garmin: undefined, sourceReads: { provider: 'activities_unreadable' } });
        expect(states(view).garmin_activity_absent).toEqual({ status: 'not_observable', reason: 'provider_activities_unreadable' });
    });

    it('is clear when several Garmin sources are attached and every one hydrated, and holds when one is missing', () => {
        expect(states(workoutView({ sourceReads: { provider: 'multiple_available' } })).garmin_activity_absent).toEqual({ status: 'clear' });
        expect(states(workoutView({ sourceReads: { provider: 'multiple_incomplete' } })).garmin_activity_absent)
            .toEqual({ status: 'holds', reasons: ['activity_not_in_read_window'] });
    });

    it('is not_applicable when only a non-Garmin provider is attached (the v1 DTO has a Garmin slot only)', () => {
        const view = workoutView({ garmin: undefined, sourceReads: { provider: 'non_garmin_only' } });
        expect(states(view).garmin_activity_absent).toEqual({ status: 'not_applicable', reason: 'non_garmin_provider_only' });
    });
});

describe('states 4 and 5 -- Garmin detail unavailable / valid-but-empty', () => {
    it('state 5 holds when Garmin reported an empty exerciseSets list (durable, written only on endpoint success)', () => {
        const view = workoutView({ garmin: garminActivity({ exerciseSets: [] }) });
        expect(states(view).garmin_detail_empty).toEqual({ status: 'holds', reasons: ['exercise_sets_reported_empty'] });
        // an empty list proves the detail fetch succeeded
        expect(states(view).garmin_detail_unavailable).toEqual({ status: 'clear' });
    });

    it('both states are clear when set detail is present', () => {
        const result = states(workoutView());
        expect(result.garmin_detail_empty).toEqual({ status: 'clear' });
        expect(result.garmin_detail_unavailable).toEqual({ status: 'clear' });
    });

    it('state 4 is not_observable when a strength activity has no stored set detail: failed vs never-attempted is not persisted', () => {
        const result = states(workoutView({ garmin: garminActivityWithoutSets() }));
        expect(result.garmin_detail_unavailable).toEqual({ status: 'not_observable', reason: 'detail_fetch_outcome_not_persisted' });
        // ... and absent detail can never be claimed "valid but empty"
        expect(result.garmin_detail_empty).toEqual({ status: 'not_observable', reason: 'detail_not_stored' });
    });

    it('treats fitness_equipment like strength_training for detail expectations', () => {
        expect(states(workoutView({ garmin: garminActivityWithoutSets({ type: 'fitness_equipment' }) })).garmin_detail_unavailable)
            .toEqual({ status: 'not_observable', reason: 'detail_fetch_outcome_not_persisted' });
    });

    it('both are not_applicable for activity types whose set detail is never requested', () => {
        const result = states(workoutView({ garmin: garminActivityWithoutSets({ type: 'cycling' }) }));
        expect(result.garmin_detail_unavailable).toEqual({ status: 'not_applicable', reason: 'detail_not_expected_for_activity_type' });
        expect(result.garmin_detail_empty).toEqual({ status: 'not_applicable', reason: 'detail_not_expected_for_activity_type' });
    });

    it('both are not_applicable without a hydrated Garmin activity', () => {
        const result = states(structuredOnlyView());
        expect(result.garmin_detail_unavailable).toEqual({ status: 'not_applicable', reason: 'no_garmin_activity' });
        expect(result.garmin_detail_empty).toEqual({ status: 'not_applicable', reason: 'no_garmin_activity' });
    });
});

describe('states 6 and 7 -- reconciliation no candidate vs ambiguous candidates', () => {
    it('state 6 holds for a single-source occurrence after a completed sweep', () => {
        const result = states(structuredOnlyView());
        expect(result.reconciliation_no_candidate).toEqual({ status: 'holds', reasons: ['no_candidate_after_sweep'] });
        expect(result.reconciliation_ambiguous).toEqual({ status: 'clear' });
    });

    it('state 7 holds for a persisted ambiguous decision and state 6 stays distinct (clear)', () => {
        const view = structuredOnlyView({ reconciliation: { state: 'ambiguous', matcherVersion: 'matcher-v2' } });
        const result = states(view);
        expect(result.reconciliation_ambiguous).toEqual({ status: 'holds', reasons: ['competing_or_weak_candidates'] });
        expect(result.reconciliation_no_candidate).toEqual({ status: 'clear' });
    });

    it('is clear for both when reconciliation matched the sources', () => {
        const result = states(workoutView());
        expect(result.reconciliation_no_candidate).toEqual({ status: 'clear' });
        expect(result.reconciliation_ambiguous).toEqual({ status: 'clear' });
    });

    it('state 6 reports manually_separated when the athlete excluded a pairing, regardless of sweep outcome', () => {
        const view = structuredOnlyView({
            reconciliation: { state: 'single_source', excludedSourceKeys: ['provider_activity:garmin:act-1'] },
            sourceReads: { reconciliationSweep: 'failed' },
        });
        expect(states(view).reconciliation_no_candidate).toEqual({ status: 'holds', reasons: ['manually_separated'] });
    });

    it.each([
        ['failed', 'sweep_failed'],
        ['not_run', 'sweep_not_run'],
    ] as const)('state 6 is not_observable when the reconciliation sweep %s -- an unevaluated source is not "no candidate"', (sweep, reason) => {
        const view = structuredOnlyView({ sourceReads: { reconciliationSweep: sweep } });
        expect(states(view).reconciliation_no_candidate).toEqual({ status: 'not_observable', reason });
    });

    it('state 6 is not_observable when an incomplete sweep skipped sources, even though it did not throw', () => {
        const view = structuredOnlyView({ sourceReads: { reconciliationSweep: 'incomplete' } });
        expect(states(view).reconciliation_no_candidate).toEqual({ status: 'not_observable', reason: 'sweep_incomplete' });
        expect(projectWorkoutSourceDiagnostics(view).attention).toContain('reconciliation_no_candidate');
    });

    it('state 6 is not_observable for the unmarked counterpart of a persisted ambiguity -- the two cards must not contradict', () => {
        const counterpart = structuredOnlyView({ sourceReads: { ambiguousCounterpart: true } });
        expect(states(counterpart).reconciliation_no_candidate).toEqual({ status: 'not_observable', reason: 'counterpart_ambiguous' });
        expect(projectWorkoutSourceDiagnostics(counterpart).attention).toContain('reconciliation_no_candidate');
    });

    it('a manual separation still wins over the ambiguous-counterpart caveat (a recorded athlete decision)', () => {
        const view = structuredOnlyView({
            reconciliation: { state: 'single_source', excludedSourceKeys: ['provider_activity:garmin:act-1'] },
            sourceReads: { ambiguousCounterpart: true },
        });
        expect(states(view).reconciliation_no_candidate).toEqual({ status: 'holds', reasons: ['manually_separated'] });
    });

    it('a persisted ambiguous decision stays reportable even when the sweep failed', () => {
        const view = structuredOnlyView({
            reconciliation: { state: 'ambiguous' },
            sourceReads: { reconciliationSweep: 'failed' },
        });
        expect(states(view).reconciliation_ambiguous.status).toBe('holds');
    });
});

describe('state 8 -- read-model projection failed', () => {
    it('is clear when every read succeeded', () => {
        expect(states(workoutView()).read_model_projection_failed).toEqual({ status: 'clear' });
    });

    it.each([
        [{ status: 'execution_unavailable' }, 'execution_unavailable'],
        [{ status: 'execution_invalid' }, 'execution_invalid'],
        [{ status: 'definition_unresolved', definition: 'MISSING' }, 'definition_unresolved'],
        [{ status: 'definition_unresolved', definition: 'INVALID' }, 'definition_unresolved'],
        [{ status: 'definition_unresolved', definition: 'UNAVAILABLE' }, 'definition_unresolved'],
        [{ status: 'entries_unavailable' }, 'entries_unavailable'],
    ] as const)('holds for structured read %j', (structured, reason) => {
        const view = structuredOnlyView({ sourceReads: { structured } });
        expect(states(view).read_model_projection_failed).toEqual({ status: 'holds', reasons: [reason] });
    });

    it('holds when provider activities were unreadable', () => {
        const view = workoutView({ garmin: undefined, sourceReads: { provider: 'activities_unreadable' } });
        expect(states(view).read_model_projection_failed).toEqual({ status: 'holds', reasons: ['provider_activities_unreadable'] });
    });

    it('reports a structured and a provider failure together', () => {
        const view = workoutView({
            garmin: undefined,
            sourceReads: { structured: { status: 'entries_unavailable' }, provider: 'activities_unreadable' },
        });
        expect(states(view).read_model_projection_failed).toEqual({
            status: 'holds',
            reasons: ['entries_unavailable', 'provider_activities_unreadable'],
        });
    });

    it('an absent execution document is state 1, not a projection failure', () => {
        const view = structuredOnlyView({ sourceReads: { structured: { status: 'execution_missing' } } });
        expect(states(view).read_model_projection_failed).toEqual({ status: 'clear' });
    });
});

describe('co-occurrence', () => {
    it('reports a failed entry write AND an absent Garmin activity together', () => {
        const view = structuredOnlyView({ sourceReads: { outbox: { status: 'read', queued: 0, failed: 2 } } });
        const diagnostics = projectWorkoutSourceDiagnostics(view);
        expect(diagnostics.states.entry_write_unsettled.status).toBe('holds');
        expect(diagnostics.states.garmin_activity_absent.status).toBe('holds');
        expect(diagnostics.attention).toEqual(expect.arrayContaining(['entry_write_unsettled']));
    });

    it('reports a missing execution and an ambiguous Garmin candidate together', () => {
        const view = garminOnlyView({ reconciliation: { state: 'ambiguous' } });
        const result = states(view);
        expect(result.session_execution_absent.status).toBe('holds');
        expect(result.reconciliation_ambiguous.status).toBe('holds');
    });
});

describe('attention list (what deserves a visible notice)', () => {
    it('is empty for a healthy matched workout', () => {
        expect(projectWorkoutSourceDiagnostics(workoutView()).attention).toEqual([]);
    });

    it('does not shout about expected single-source facts: structured-only without a watch, Garmin-only without a plan', () => {
        expect(projectWorkoutSourceDiagnostics(structuredOnlyView()).attention).toEqual([]);
        expect(projectWorkoutSourceDiagnostics(garminOnlyView({ garmin: garminActivity({ type: 'cycling' }) })).attention).toEqual([]);
    });

    it('surfaces ambiguity, failed reads, missing records and unsettled writes', () => {
        expect(projectWorkoutSourceDiagnostics(structuredOnlyView({ reconciliation: { state: 'ambiguous' } })).attention)
            .toContain('reconciliation_ambiguous');
        expect(projectWorkoutSourceDiagnostics(structuredOnlyView({ sourceReads: { structured: { status: 'entries_unavailable' } } })).attention)
            .toContain('read_model_projection_failed');
        expect(projectWorkoutSourceDiagnostics(structuredOnlyView({ sourceReads: { structured: { status: 'execution_missing' } } })).attention)
            .toContain('session_execution_absent');
        expect(projectWorkoutSourceDiagnostics(workoutView({ garmin: undefined, sourceReads: { provider: 'activity_not_in_read_window' } })).attention)
            .toContain('garmin_activity_absent');
    });

    it('surfaces an unreadable read as unknown rather than leaving the card silent', () => {
        const view = structuredOnlyView({ sourceReads: { structured: { status: 'execution_unavailable' } } });
        expect(projectWorkoutSourceDiagnostics(view).attention).toEqual(expect.arrayContaining(['session_execution_absent', 'read_model_projection_failed']));
    });

    it('surfaces Garmin set detail problems only when Garmin is the sole set authority', () => {
        const emptyGarminOnly = garminOnlyView({ garmin: garminActivity({ exerciseSets: [] }) });
        expect(projectWorkoutSourceDiagnostics(emptyGarminOnly).attention).toContain('garmin_detail_empty');
        const emptyMatched = workoutView({ garmin: garminActivity({ exerciseSets: [] }) });
        expect(projectWorkoutSourceDiagnostics(emptyMatched).attention).not.toContain('garmin_detail_empty');
    });
});

describe('observedReconciliationOutcome (ReconciliationOutcome vocabulary, derived from persisted provenance only)', () => {
    it('maps single_source, matched and ambiguous', () => {
        expect(observedReconciliationOutcome(structuredOnlyView())).toEqual({ status: 'observed', outcome: 'created_single_source' });
        expect(observedReconciliationOutcome(workoutView())).toEqual({ status: 'observed', outcome: 'attached_auto_link' });
        expect(observedReconciliationOutcome(structuredOnlyView({ reconciliation: { state: 'ambiguous' } })))
            .toEqual({ status: 'observed', outcome: 'ambiguous' });
    });

    it.each(['unlink', 'keep_separate'] as const)('does not report a manual %s as a matcher outcome', decision => {
        const view = structuredOnlyView({
            reconciliation: { state: 'single_source', manualDecision: { decision, actor: 'u', decidedAt: '2026-08-26T08:00:00.000Z' } },
        });
        expect(observedReconciliationOutcome(view)).toEqual({ status: 'not_observable', reason: 'manual_decision' });
    });

    it('does not call a manual link an auto-link', () => {
        const manual = workoutView({
            reconciliation: {
                state: 'matched',
                manualDecision: { decision: 'link', actor: 'u', decidedAt: '2026-08-26T08:00:00.000Z' },
            },
        });
        expect(observedReconciliationOutcome(manual)).toEqual({ status: 'not_observable', reason: 'manual_decision' });
    });
});

describe('sourceCompletenessFor (reuses the #914/#916 trainingResponseEvidence vocabulary)', () => {
    it('maps the structured read onto not_linked / available / unavailable', () => {
        expect(sourceCompletenessFor(garminOnlyView()).structuredExecution).toBe('not_linked');
        expect(sourceCompletenessFor(workoutView()).structuredExecution).toBe('available');
        for (const structured of [
            { status: 'execution_missing' },
            { status: 'execution_invalid' },
            { status: 'execution_unavailable' },
            { status: 'definition_unresolved', definition: 'MISSING' },
            { status: 'entries_unavailable' },
        ] as const) {
            expect(sourceCompletenessFor(structuredOnlyView({ sourceReads: { structured } })).structuredExecution).toBe('unavailable');
        }
    });

    it('maps the provider read, collapsing the two unavailable causes only in this shared vocabulary', () => {
        const provider = (read: ProviderSourceRead) =>
            sourceCompletenessFor(workoutView({ sourceReads: { provider: read } })).providerActivities;
        expect(provider('not_linked')).toBe('not_linked');
        expect(provider('available')).toBe('available');
        expect(provider('activity_not_in_read_window')).toBe('unavailable');
        expect(provider('activities_unreadable')).toBe('unavailable');
        expect(provider('non_garmin_only')).toBe('unavailable');
    });

    it('reports several attached provider sources as ambiguous, exactly as trainingResponseEvidence does', () => {
        expect(sourceCompletenessFor(workoutView({ sourceReads: { provider: 'multiple_available' } })).providerActivities).toBe('ambiguous');
        expect(sourceCompletenessFor(workoutView({ sourceReads: { provider: 'multiple_incomplete' } })).providerActivities).toBe('ambiguous');
    });

    it('always reports the occurrence read as available for a hydrated view', () => {
        expect(sourceCompletenessFor(workoutView()).occurrenceRead).toBe('available');
    });
});

describe('type-level closure', () => {
    it('every state code is a member of the closed union', () => {
        const codes: FailureStateCode[] = [...FAILURE_STATE_CODES];
        expect(new Set(codes).size).toBe(8);
    });
});
