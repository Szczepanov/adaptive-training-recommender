/**
 * D-EXPORT v1 pure builder (#1145, ADR-0052). Takes already-read records plus `asOfDate`,
 * `window` and `purpose` and returns a `LedgerExport`. No IO, no clock: `exportedAt` is
 * injected. Every promised field is present with a `state`; fields with no backing record
 * are `not_yet_supported`. Output is assembled field by field from an allow-list, so user
 * ids, e-mails and provider account ids in the inputs cannot reach it.
 */
import { buildCoachingHistory } from './buildCoachingHistory.ts';
import type { BuildContext } from './buildContext.ts';
import { buildFacts } from './buildFacts.ts';
import { buildUserContext } from './buildUserContext.ts';
import { SOURCE_KEYS, type BuildLedgerExportInput, type LedgerExportRecords, type SourceKey } from './inputs.ts';
import { notYetSupported } from './ledgerValue.ts';
import {
    DERIVED_METRIC_IDS,
    LEDGER_EXPORT_SCHEMA_VERSION,
    LEDGER_FLAG_IDS,
    LEDGER_PURPOSES,
    type DerivedMetric,
    type DerivedMetricId,
    type LedgerExport,
    type LedgerFlag,
    type LegacyEngineLayer,
    type SourceState,
} from './schema.ts';
import { collectIdentityValues, redactFreeText, stripIdentity } from './stripIdentity.ts';
import { assertLocalDate, PURPOSE_BOUNDS, resolveWindow } from './window.ts';

const RECORD_KEY_BY_SOURCE: Record<SourceKey, keyof LedgerExportRecords> = {
    daily_recovery_snapshots: 'recovery',
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

const DERIVED_DEFINITIONS: Record<DerivedMetricId, { definition: string; window: string }> = {
    biometric_baselines: { definition: 'Rolling biometric baselines (ADR-0024)', window: '7d,28d' },
    d_minus_1_step_normalization: { definition: 'D-1 step normalization (I3, ADR-0003)', window: '7d,28d' },
    rolling_performed_training_load: { definition: 'Rolling performed-training load and exposure ledgers (#813)', window: '7d,28d' },
};

function buildSources(input: BuildLedgerExportInput): SourceState[] {
    return SOURCE_KEYS.map(key => {
        const read = input.sources?.[key];
        const provided = input.records[RECORD_KEY_BY_SOURCE[key]] !== undefined;
        return {
            source: key,
            state: provided ? (read?.state ?? 'measured') : 'unavailable',
            readAt: read?.readAt ?? null,
            newestObservedOn: read?.newestObservedOn ?? null,
        };
    });
}

/** Layer 2 stays `not_yet_supported` until #1144 extracts each derivation out of `engine/`. */
function buildDerived(): DerivedMetric[] {
    return DERIVED_METRIC_IDS.map(id => ({
        id,
        ...DERIVED_DEFINITIONS[id],
        value: notYetSupported<number>(),
        inputs: [],
    }));
}

function unevaluatedFlag(id: LedgerFlag['id'], asOfDate: string): LedgerFlag {
    return {
        id,
        observedOn: asOfDate,
        evaluatedAt: null,
        definitionVersion: null,
        active: null,
        state: 'not_yet_supported',
        inputs: [],
        threshold: null,
    };
}

/**
 * Layer 3: the closed set of four (D-FLAGS). Persisted evaluations pass through unchanged
 * (never recomputed); an id with none stays `not_yet_supported`.
 */
function buildFlags(asOfDate: string, evaluations: readonly LedgerFlag[] = []): LedgerFlag[] {
    return LEDGER_FLAG_IDS.flatMap(id => {
        const supplied = evaluations.filter(flag => flag.id === id);
        return supplied.length > 0 ? supplied.map(flag => structuredClone(flag)) : [unevaluatedFlag(id, asOfDate)];
    });
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
        window,
        bounds: PURPOSE_BOUNDS[input.purpose],
        sources: input.sources ?? {},
    };
    const assembled: LedgerExport = {
        schemaVersion: LEDGER_EXPORT_SCHEMA_VERSION,
        exportedAt: input.exportedAt,
        asOfDate: input.asOfDate,
        window,
        purpose: input.purpose,
        sources: buildSources(input),
        facts: buildFacts(input.records, context),
        derived: buildDerived(),
        flags: buildFlags(input.asOfDate, input.flagEvaluations),
        userContext: buildUserContext(input.records, context),
        coachingHistory: buildCoachingHistory(input.records, context),
        legacyEngine: input.legacyEngine ? (stripIdentity(input.legacyEngine) as LegacyEngineLayer) : null,
    };
    // Second line of defence: free-text leaves may quote an e-mail or the owner's own ids.
    return redactFreeText(assembled, collectIdentityValues([input.records, input.legacyEngine]));
}
