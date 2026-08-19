/**
 * M5.1: session response linkage and non-tissue session facts (ADR-0023 D-MRESP).
 *
 * `DailySubjectiveCheckin.tissueResponses` remains the SOLE tissue authority --
 * `RegionTissueResponse.morningState`/`painDuringTraining`/`afterTrainingState`/
 * `nextMorningReaction` never move or get duplicated here. A `SessionResponse` is the
 * complementary direction of linkage (session -> check-in, generalizing what M1.7/M2.6
 * already write the other way via `RegionTissueResponse.sourceSessionRef`) plus the
 * non-tissue facts a check-in has no field for: sRPE, completed fraction, unexpected
 * fatigue, a technique note, a free note.
 *
 * Distinct record, distinct lifecycle (D-MRECORDS): a `SessionResponse` is never fabricated
 * for a prompt the athlete never answered (M5.2 surfaces the prompt; this module only
 * persists an actual answer), so a missing window is legible as "never asked/answered",
 * not silently indistinguishable from "answered normally".
 */

export type ResponseWindow = 'immediate' | 'later_day' | 'next_morning';

/** The same `{kind, id, date}` identity `RegionTissueResponse.sourceSessionRef` already
 * uses (M1.7/M2.6) -- reused rather than reinvented, so a `SessionResponse` and the
 * check-in's own tissue-side linkage can be joined on identical fields for the same
 * session. `date` here is the SOURCE session's own date, not this response's `date`. */
export interface SessionResponseSourceRef {
    kind: 'strength' | 'execution';
    id: string;
    date: string;
}

export interface SessionResponse {
    userId: string;
    responseId: string;
    sourceSession: SessionResponseSourceRef;
    /** Present only when the source execution carried selection authority (D-MAUTH); a
     * companion or otherwise unplanned execution has none. */
    occurrenceId?: string;
    window: ResponseWindow;
    /** Warsaw-local date this response was recorded for -- equal to `sourceSession.date`
     * for `immediate`, later for `later_day`/`next_morning`. */
    date: string;
    /** Points at the canonical daily check-in that holds this window's tissue values.
     * Never duplicated here -- see the module doc comment. */
    checkinRef: { date: string };
    /** 0-10. Session RPE is a session-level fact the check-in has no field for. */
    sessionRpe?: number;
    /** 0-1 fraction of the prescribed session actually completed. */
    completedFraction?: number;
    unexpectedFatigue?: boolean;
    techniqueNote?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
}
