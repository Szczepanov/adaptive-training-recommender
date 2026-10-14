/**
 * #895 WP5 -- athlete-readable wording for every failure state, status and reason. Typed as
 * `Record`s over the closed reason unions in `workoutSourceDiagnostics.ts`, so adding a reason
 * without its sentence is a compile error. Unknown (`not_observable`) wording must always say
 * what cannot be determined; it never reads as "none", "zero", "empty" or "healthy".
 */
import {
    FAILURE_STATE_NUMBER,
    type FailureStateCode,
    type StateAssessment,
    type StateReason,
} from '../training-occurrence/workoutSourceDiagnostics';

interface StateCopy<C extends FailureStateCode> {
    /** Names the failure state the way #895 section 10 does. */
    name: string;
    clear: string;
    holds: Record<StateReason<C, 'holds'>, string>;
    not_applicable: Record<StateReason<C, 'not_applicable'>, string>;
    not_observable: Record<StateReason<C, 'not_observable'>, string>;
}

type CopyTable = { [C in FailureStateCode]: StateCopy<C> };

export const STATE_COPY: CopyTable = {
    session_execution_absent: {
        name: 'Session record absent',
        clear: 'The linked Adaptive session record was found.',
        holds: {
            no_execution_linked: 'No Adaptive session record is linked to this workout.',
            execution_document_missing: 'This workout points to an Adaptive session record that could not be found.',
        },
        not_applicable: {},
        not_observable: {
            execution_unreadable: 'The linked Adaptive session record could not be read, so it is unknown whether it exists.',
        },
    },
    entry_write_unsettled: {
        name: 'Diary writes pending or failed',
        clear: 'No pending or failed diary writes were found on this device.',
        holds: {
            failed_writes: 'Some logged sets or rest on this device were rejected and are not saved.',
            queued_writes: 'Some logged sets or rest on this device are still waiting to sync.',
        },
        not_applicable: {
            no_execution_linked: 'No Adaptive session is linked, so there is no diary to sync.',
        },
        not_observable: {
            receipts_are_device_local: 'This device has no unsent-write records for the session, but other devices cannot be checked from here, so it is unknown whether every write has synced.',
            receipts_unreadable: 'This device\'s unsent-write records could not be read, so pending or failed writes are unknown.',
        },
    },
    garmin_activity_absent: {
        name: 'Garmin activity absent',
        clear: 'The linked Garmin activity was found.',
        holds: {
            no_provider_linked: 'No Garmin activity is linked to this workout.',
            activity_not_in_read_window: 'A Garmin activity is linked, but its record was not found in the data loaded for this window.',
        },
        not_applicable: {
            non_garmin_provider_only: 'Only a non-Garmin recording is linked, so Garmin does not apply.',
        },
        not_observable: {
            provider_activities_unreadable: 'Garmin activities could not be loaded, so it is unknown whether the linked recording exists.',
        },
    },
    garmin_detail_unavailable: {
        name: 'Garmin detail unavailable',
        clear: 'Garmin set detail is stored for this activity.',
        holds: {
            detail_fetch_failed: 'The last sync could not download Garmin set detail for this activity, so no sets are stored.',
            detail_fetch_rate_limited: 'Garmin limited requests during the last sync, so set detail was not downloaded for this activity.',
        },
        not_applicable: {
            no_garmin_activity: 'There is no Garmin activity, so there is no detail to check.',
            detail_not_expected_for_activity_type: 'Set detail is only collected for strength activities.',
            detail_fetch_not_attempted: 'The last sync did not try to download Garmin set detail for this activity.',
        },
        not_observable: {
            detail_fetch_outcome_not_persisted: 'No Garmin set detail or fetch status is stored for this activity, so whether the download failed or never ran is unknown.',
        },
    },
    garmin_detail_empty: {
        name: 'Garmin detail empty',
        clear: 'Garmin\'s set list contains sets.',
        holds: {
            exercise_sets_reported_empty: 'Garmin returned its set detail successfully, and it lists no sets.',
        },
        not_applicable: {
            no_garmin_activity: 'There is no Garmin activity, so there is no detail to check.',
            detail_not_expected_for_activity_type: 'Set detail is only collected for strength activities.',
        },
        not_observable: {
            detail_not_stored: 'No Garmin set detail is stored, so it is unknown whether Garmin\'s set list is empty.',
        },
    },
    reconciliation_no_candidate: {
        name: 'No matching candidate found',
        clear: 'Not applicable here: the sources are linked, or candidates were found.',
        holds: {
            no_candidate_after_sweep: 'No matching counterpart was found for this workout in the latest check.',
            manually_separated: 'You separated this workout from a counterpart earlier; it stays separate.',
        },
        not_applicable: {},
        not_observable: {
            sweep_failed: 'The latest matching check failed, so it is unknown whether a counterpart exists.',
            sweep_incomplete: 'The latest matching check could not evaluate every recording, so it is unknown whether a counterpart exists.',
            counterpart_ambiguous: 'A workout on a nearby day is recorded as an ambiguous match and this one may be its counterpart, so it is unknown whether a counterpart exists.',
            sweep_not_run: 'Matching was not re-checked when this was loaded, so it is unknown whether a counterpart exists.',
        },
    },
    reconciliation_ambiguous: {
        name: 'Ambiguous matching candidates',
        clear: 'No ambiguous candidates are recorded for this workout.',
        holds: {
            competing_or_weak_candidates: 'More than one possible counterpart, or weak evidence, so the sources were kept separate instead of guessed.',
        },
        not_applicable: {},
        not_observable: {},
    },
    read_model_projection_failed: {
        name: 'Read-model projection failed',
        clear: 'The sources linked to this workout were read without a read error. Individual malformed records are not counted here.',
        holds: {
            execution_unavailable: 'The Adaptive session record could not be loaded.',
            execution_invalid: 'The Adaptive session record is malformed and could not be used.',
            definition_unresolved: 'The session\'s prescription could not be loaded, so planned-versus-performed detail is unavailable.',
            entries_unavailable: 'The logged sets could not be loaded.',
            provider_activities_unreadable: 'Garmin activities could not be loaded.',
        },
        not_applicable: {},
        not_observable: {},
    },
};

export const WINDOW_PROJECTION_FAILED_COPY = {
    name: STATE_COPY.read_model_projection_failed.name,
    explanation: 'Recent workouts could not be loaded, so nothing can be said about them. This is not an empty list or a week without training. Retry the dashboard refresh.',
} as const;

export const STATUS_LABEL: Record<StateAssessment<FailureStateCode>['status'], string> = {
    holds: 'Detected',
    clear: 'Not detected',
    not_applicable: 'Not applicable',
    not_observable: 'Unknown',
};

export function stateNumber(code: FailureStateCode): number {
    return FAILURE_STATE_NUMBER[code];
}

/** The sentences for one assessment; `holds` can carry several co-occurring reasons. */
export function describeAssessment<C extends FailureStateCode>(code: C, assessment: StateAssessment<C>): string[] {
    // The generic reason tables cannot be indexed by a union of codes without widening, so the
    // widening is confined to this lookup; the tables themselves stay fully typed above.
    const copy = STATE_COPY[code] as unknown as {
        clear: string;
        holds: Record<string, string>;
        not_applicable: Record<string, string>;
        not_observable: Record<string, string>;
    };
    switch (assessment.status) {
        case 'holds': return assessment.reasons.map(reason => copy.holds[reason as string]);
        case 'clear': return [copy.clear];
        case 'not_applicable': return [copy.not_applicable[assessment.reason as string]];
        case 'not_observable': return [copy.not_observable[assessment.reason as string]];
    }
}
