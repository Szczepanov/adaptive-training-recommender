/**
 * D-EXPORT v1 pure builder (#1145, ADR-0052). Takes already-read records plus `asOfDate`,
 * `window` and `purpose` and returns a `LedgerExport`. No IO, no clock: `exportedAt` is
 * injected. Every promised field is present with a `state`; fields with no backing record
 * are `not_yet_supported`. Output is assembled field by field from an allow-list, so user
 * ids, e-mails and provider account ids in the inputs cannot reach it.
 */
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import { RECOVERY_BEYOND_BASELINE_FLAG_DEFINITION_VERSION } from '../../derived/flags/recoveryBeyondBaseline.ts';
import { ILLNESS_RISK_SYMPTOM_FLAG_DEFINITION_VERSION } from '../../derived/flags/illnessRiskSymptom.ts';
import { ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION } from '../../derived/flags/illnessAnomaly/illnessAnomalyFlag.ts';
import { INJURY_CONSTRAINT_TOUCHES_SESSION_FLAG_DEFINITION_VERSION } from '../../derived/flags/injuryConstraintTouchesSession.ts';
import { buildCoachingHistory } from './buildCoachingHistory.ts';
import type { BuildContext } from './buildContext.ts';
import { buildDerived } from './buildDerived.ts';
import { buildFacts } from './buildFacts.ts';
import { buildUserContext } from './buildUserContext.ts';
import { SOURCE_KEYS, type BuildLedgerExportInput, type LedgerExportRecords, type SourceKey } from './inputs.ts';
import {
    LEDGER_EXPORT_SCHEMA_VERSION,
    LEDGER_FLAG_IDS,
    LEDGER_PURPOSES,
    type LedgerExport,
    type LedgerFlag,
    type LedgerWindow,
    type LegacyEngineLayer,
    type SourceState,
} from './schema.ts';
import { collectIdentityValues, redactLeaves, stripIdentity } from './stripIdentity.ts';
import { assertLocalDate, PURPOSE_BOUNDS, resolveWindow } from './window.ts';

const RECORD_KEY_BY_SOURCE: Record<SourceKey, keyof LedgerExportRecords> = {
    daily_recovery_snapshots: 'recovery',
    flag_evaluations: 'flagEvaluations',
    daily_subjective_checkins: 'checkins',
    performed_training_occurrences: 'performedOccurrences',
    session_responses: 'sessionResponses',
    assessment_attempts: 'assessmentAttempts',
    metric_observations: 'metricObservations',
    anthropometry_entries: 'anthropometry',
    nutrition_days: 'nutritionDays',
    activities: 'activities',
    competition_outcomes: 'competitionOutcomes',
    training_settings: 'trainingSettings',
    plan_blocks: 'planBlocks',
    fixed_activities: 'fixedActivities',
    schedule_windows: 'scheduleWindows',
    preferences: 'preferences',
    goals: 'goals',
    intent_blocks: 'intentBlocks',
    constraints: 'constraints',
    external_plan_revisions: 'planRevisions',
    external_plan_placements: 'placements',
    planned_to_performed: 'plannedToPerformed',
};

function buildSources(input: BuildLedgerExportInput): SourceState[] {
    return SOURCE_KEYS.map(key => {
        const read = input.sources?.[key];
        const provided = input.records[RECORD_KEY_BY_SOURCE[key]] !== undefined || (key === 'flag_evaluations' && input.flagEvaluations !== undefined);
        return {
            source: key,
            state: provided ? (read?.state ?? 'measured') : 'unavailable',
            readAt: read?.readAt ?? null,
            newestObservedOn: read?.newestObservedOn ?? null,
            ...(read?.reason ? { reason: read.reason } : {}),
        };
    });
}

const FLAG_VERSIONS: Record<LedgerFlag['id'], string> = {
    illness_anomaly: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION,
    illness_risk_symptom: ILLNESS_RISK_SYMPTOM_FLAG_DEFINITION_VERSION,
    injury_constraint_touches_session: INJURY_CONSTRAINT_TOUCHES_SESSION_FLAG_DEFINITION_VERSION,
    recovery_beyond_baseline: RECOVERY_BEYOND_BASELINE_FLAG_DEFINITION_VERSION,
};

function buildFlags(input: BuildLedgerExportInput, window: LedgerWindow): LedgerFlag[] {
    const supplied = input.flagEvaluations ?? input.records.flagEvaluations ?? [];
    const state = input.sources?.flag_evaluations?.state
        ?? (input.flagEvaluations || input.records.flagEvaluations ? 'measured' : 'unavailable');
    const result: LedgerFlag[] = [];
    for (let date = window.startDate; date <= window.endDate; date = addDaysToLocalDateString(date, 1)) {
        for (const id of LEDGER_FLAG_IDS) {
            const matching = state === 'measured' ? supplied.filter(flag => flag.id === id && flag.observedOn === date) : [];
            if (!matching.length) {
                const failed = state === 'invalid' || state === 'unavailable';
                result.push({
                    id, observedOn: date, evaluatedAt: null, definitionVersion: FLAG_VERSIONS[id], active: null,
                    state: failed ? state : 'not_recorded',
                    reasonCode: failed ? `flag_evaluations_source_${state}` : 'flag_not_recorded',
                    inputs: [], threshold: null,
                });
                continue;
            }
            const sorted = [...matching].sort((a, b) =>
                (a.sessionRef ?? '').localeCompare(b.sessionRef ?? '')
                || (a.evaluatedAt ? Date.parse(a.evaluatedAt) : 0) - (b.evaluatedAt ? Date.parse(b.evaluatedAt) : 0)
                || ('revisionId' in a && 'revisionId' in b ? String(a.revisionId).localeCompare(String(b.revisionId)) : 0),
            );
            const seen = new Set<string>();
            for (const flag of sorted) {
                if ('revisionId' in flag && typeof flag.revisionId === 'string') {
                    if (seen.has(flag.revisionId)) continue;
                    seen.add(flag.revisionId);
                }
                const withheld = id === 'illness_anomaly';
                result.push({
                    id, observedOn: date, evaluatedAt: flag.evaluatedAt,
                    definitionVersion: flag.definitionVersion,
                    ...(flag.sessionRef ? { sessionRef: flag.sessionRef } : {}),
                    active: withheld ? null : flag.active,
                    state: withheld ? 'not_yet_supported' : flag.state,
                    ...(withheld ? { reasonCode: 'ha7_release_gate_unmet' }
                        : flag.reasonCode ? { reasonCode: flag.reasonCode } : {}),
                    inputs: withheld ? [{
                        name: 'ha7_release_gate',
                        value: { value: 'unmet', source: 'health_anomaly_assessment', state: 'not_yet_supported' },
                    }] : structuredClone(flag.inputs),
                    threshold: withheld ? null : flag.threshold,
                    ...(!withheld && flag.baselineWindow ? { baselineWindow: flag.baselineWindow } : {}),
                });
            }
        }
    }
    return result;
}

function assertInput(input: BuildLedgerExportInput): void {
    if (!(LEDGER_PURPOSES as readonly string[]).includes(input.purpose)) {
        throw new Error(`Unknown ledger export purpose "${input.purpose}"`);
    }
    assertLocalDate(input.asOfDate, 'asOfDate');
}

export function buildLedgerExport(input: BuildLedgerExportInput): LedgerExport {
    assertInput(input);
    const window = resolveWindow(input.purpose, input.asOfDate, input.window);
    const context: BuildContext = {
        asOfDate: input.asOfDate,
        purpose: input.purpose,
        window,
        bounds: PURPOSE_BOUNDS[input.purpose],
        sources: input.sources ?? {},
    };
    const facts = buildFacts(input.records, context);
    const assembled: LedgerExport = {
        schemaVersion: LEDGER_EXPORT_SCHEMA_VERSION,
        exportedAt: input.exportedAt,
        asOfDate: input.asOfDate,
        window,
        purpose: input.purpose,
        sources: buildSources(input),
        facts,
        derived: buildDerived(input, facts),
        flags: buildFlags(input, window),
        userContext: buildUserContext(input.records, context),
        coachingHistory: buildCoachingHistory(input.records, context),
        legacyEngine: input.legacyEngine ? (stripIdentity(input.legacyEngine) as LegacyEngineLayer) : null,
    };
    // Second line of defence: string leaves may quote an e-mail or the owner's own ids.
    return redactLeaves(assembled, collectIdentityValues([input.records, input.legacyEngine]));
}
