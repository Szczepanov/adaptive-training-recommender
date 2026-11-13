import type { FlagEvaluation } from './flagEvaluation';
import type { PersistedFlagEvaluation } from '../../ledger/flagEvaluation';
import type { LedgerFlagId, LedgerState } from '../../ledger/export/schema';

export interface FlagStripItem {
    id: LedgerFlagId;
    active: boolean | null;
    state: LedgerState;
    reasonCode: string;
    threshold: string | null;
    inputs: FlagEvaluation['inputs'];
    sessionRef?: string;
    sessionTitle?: string;
}

export interface SessionFlagInput {
    sessionRef: string;
    sessionTitle: string;
    evaluation: FlagEvaluation;
}

const DEFAULT_HA7_WITHHELD_ITEM: FlagStripItem = {
    id: 'illness_anomaly',
    active: null,
    state: 'not_yet_supported',
    reasonCode: 'ha7_release_gate_unmet',
    threshold: 'Withheld until the HA7 release gate is met',
    inputs: [
        {
            name: 'ha7_release_gate',
            value: {
                value: 'unmet',
                source: 'health_anomaly_assessment',
                state: 'not_yet_supported',
            },
        },
    ],
};

function notRecordedItem(id: LedgerFlagId): FlagStripItem {
    return {
        id,
        active: null,
        state: 'not_recorded',
        reasonCode: 'flag_not_recorded',
        threshold: null,
        inputs: [],
    };
}

function toStripItem(
    evaluation: PersistedFlagEvaluation | FlagEvaluation,
    sessionTitle?: string,
    sessionRef?: string,
): FlagStripItem {
    const resolvedRef = sessionRef ?? ('sessionRef' in evaluation ? evaluation.sessionRef : undefined);
    // Internal capture digest is for idempotency auditing, not athlete display.
    const visibleInputs = evaluation.inputs.filter(input => input.name !== 'source_revision');
    if (evaluation.id === 'illness_anomaly') {
        return {
            ...DEFAULT_HA7_WITHHELD_ITEM,
            ...(resolvedRef ? { sessionRef: resolvedRef } : {}),
            ...(sessionTitle ? { sessionTitle } : {}),
        };
    }
    return {
        id: evaluation.id,
        active: evaluation.active,
        state: evaluation.state,
        reasonCode: evaluation.reasonCode,
        threshold: evaluation.threshold,
        inputs: visibleInputs,
        ...(resolvedRef ? { sessionRef: resolvedRef } : {}),
        ...(sessionTitle ? { sessionTitle } : {}),
    };
}

function latestByKey(
    capturedFlags: readonly PersistedFlagEvaluation[],
): Map<string, PersistedFlagEvaluation> {
    const map = new Map<string, PersistedFlagEvaluation>();
    for (const flag of capturedFlags) {
        const key = `${flag.id}::${flag.sessionRef ?? ''}`;
        const prev = map.get(key);
        if (!prev || flag.evaluatedAt >= prev.evaluatedAt) {
            map.set(key, flag);
        }
    }
    return map;
}

/**
 * Resolves the deterministic ordered list of D-FLAGS for `FlagStrip` on today's
 * ledger card or session launch screen.
 *
 * - Date-scoped flags (`recovery_beyond_baseline`, `illness_risk_symptom`) use the
 *   latest captured evaluation for today, or an explicit `not_recorded` entry.
 * - `illness_anomaly` is always rendered as `not_yet_supported` (HA7 withheld).
 * - `injury_constraint_touches_session`: when `sessionEvaluations` are provided
 *   (e.g. today's planned sessions on `LedgerTodayCard` or the previewed session on
 *   `SessionRunner`), emits one entry per session (preferring a matching captured
 *   evaluation if present, otherwise the live evaluation); when omitted, emits any
 *   captured `injury_constraint_touches_session` entries or a `not_recorded` entry.
 */
export function resolveTodayFlagStripItems(options: {
    capturedFlags?: readonly PersistedFlagEvaluation[];
    sessionEvaluations?: readonly SessionFlagInput[];
    fallbackIllnessRisk?: FlagEvaluation | null;
}): FlagStripItem[] {
    const latest = latestByKey(options.capturedFlags ?? []);
    const items: FlagStripItem[] = [];

    const recovery = latest.get('recovery_beyond_baseline::');
    items.push(recovery ? toStripItem(recovery) : notRecordedItem('recovery_beyond_baseline'));

    const illnessRisk = latest.get('illness_risk_symptom::');
    if (illnessRisk) {
        items.push(toStripItem(illnessRisk));
    } else if (options.fallbackIllnessRisk) {
        items.push(toStripItem(options.fallbackIllnessRisk));
    } else {
        items.push(notRecordedItem('illness_risk_symptom'));
    }

    items.push(DEFAULT_HA7_WITHHELD_ITEM);

    if (options.sessionEvaluations && options.sessionEvaluations.length > 0) {
        for (const session of options.sessionEvaluations) {
            const captured = latest.get(`injury_constraint_touches_session::${session.sessionRef}`);
            items.push(
                captured
                    ? toStripItem(captured, session.sessionTitle, session.sessionRef)
                    : toStripItem(session.evaluation, session.sessionTitle, session.sessionRef),
            );
        }
    } else {
        const capturedInjury = Array.from(latest.values()).filter(
            flag => flag.id === 'injury_constraint_touches_session',
        );
        if (capturedInjury.length > 0) {
            for (const injuryFlag of capturedInjury) {
                items.push(toStripItem(injuryFlag));
            }
        } else {
            items.push(notRecordedItem('injury_constraint_touches_session'));
        }
    }

    return items;
}
