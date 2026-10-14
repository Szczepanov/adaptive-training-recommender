import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveFactsFromOccurrence, type HydratedOccurrenceContext } from '../performedTrainingFacts';
import { buildCoverageState, resolveCoverageHistory } from '../coverage';
import { buildContextBrief, type ContextBriefInput } from '../contextBrief';
import { deriveKeySessionSummaries } from '../contextBriefResponseSummary';
import { buildLedgerEntries } from '../intradayLedgerInputs';
import { computeDailyLedger } from '../dailyLedger';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../../workouts/event-plan';
import type { NormalizedGarminActivity } from '../models';
import type { PlanDefinition } from '../planSchedule';
import type { PerformedTrainingOccurrence } from '../../training-occurrence/models';
import type { TrainingResponseSessionEvidence } from '../../training-occurrence/trainingResponseEvidence';

/**
 * #895 WP6 — per-consumer double-count inventory.
 *
 * ONE physical workout (a structured full-body execution with a matched Garmin recording)
 * is pushed through every consumer that already reads canonical authority. Each must count
 * or render it once. Consumers that are NOT migrated are pinned by source guards so they
 * are labeled legacy rather than silently assumed canonical (TO-owned, #872-gated).
 *
 * Arrival-order, ambiguity and pending-reconciliation behavior per consumer is proven in
 * the suites named next to each section; this file adds the shared-fixture cross-check.
 */

const DATE = '2026-09-01';
const AS_OF = '2026-09-03';
const descriptor = EVERGREEN_GENERAL_COVERAGE_SET;

const planDef: PlanDefinition = {
    id: 'evergreen-general-plan',
    eventId: 'event-1',
    coverageSetId: 'evergreen_general',
    blocks: [{ id: 'block-general', phase: 'general', startDate: '2026-08-25', endDate: '2026-09-10', volumeScale: 1.0, intensityScale: 1.0 }],
    objectives: [{
        key: 'strength_maintenance',
        coverageKey: 'primary_strength',
        blockId: 'block-general',
        requiredCredit: 1,
        priority: 'must_have',
        role: 'primary_developmental',
        coverageMinimumSessions: 1,
        coverageTargetSessions: 1,
    }],
    sequencingRules: [],
};

function garmin(activityId: string, date = DATE): NormalizedGarminActivity {
    return {
        activityId, date, durationMin: 60, type: 'strength_training',
        trainingEffectAerobic: 0.2, trainingEffectAnaerobic: 0, averageHr: null,
        activityTrainingLoad: 2.9, intensityTag: 'easy',
    };
}

function occurrence(id: string, executionId: string, activityId: string, date = DATE): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: id,
        userId: 'user-1',
        status: 'active',
        reconciliation: { state: 'matched' },
        sourceRefs: [
            { kind: 'structured_execution', executionId },
            { kind: 'provider_activity', provider: 'garmin', activityId },
        ],
        modality: 'Strength',
        localDate: date,
        startedAt: `${date}T10:00:00.000Z`,
        createdAt: `${date}T11:00:00.000Z`,
        updatedAt: `${date}T11:00:00.000Z`,
    };
}

function hydrated(executionId: string, activityId: string, date = DATE): HydratedOccurrenceContext {
    return {
        structured: {
            executionId,
            workoutId: 'strength_full_body_maintenance_01',
            templateId: 'str_full_01',
            modality: 'Strength',
            category: 'Full-body Strength',
            startedAt: `${date}T10:00:00.000Z`,
            durationMin: 60,
            workoutVariantId: 'full',
            isLegacyStrength: false,
        },
        provider: {
            activityId,
            provider: 'garmin',
            modality: 'Strength',
            startedAt: `${date}T10:00:00.000Z`,
            durationMin: 60,
            garminActivity: garmin(activityId, date),
        },
    };
}

const shared = deriveFactsFromOccurrence(
    occurrence('occ-shared', 'exec-shared', 'garmin-shared'),
    hydrated('exec-shared', 'garmin-shared'),
    descriptor,
);

describe('#895 WP6 per-consumer double-count inventory', () => {
    it('fixture sanity: one occurrence carries both source kinds', () => {
        expect(shared.exposure.sourceKinds).toEqual(['structured_execution', 'provider_activity']);
    });

    describe('weekly coverage credit (resolveCoverageHistory)', () => {
        // Arrival order and canonical-[]-over-legacy: canonicalCoverageCreditCutover.test.ts.
        const history = (facts: typeof shared[]) => resolveCoverageHistory({
            asOfDate: AS_OF,
            windowDays: 7,
            revision: 'rev-1',
            exposures: facts.map(f => f.exposure),
            coverageCredits: facts.flatMap(f => f.coverageCredits),
        });

        it('structured + Garmin for one occurrence earns one primary_strength credit', () => {
            const state = buildCoverageState(planDef, AS_OF, history([shared]), descriptor);
            const req = state.requirements.find(r => r.key === 'primary_strength');
            expect(req?.completedSessions).toBe(1);
            expect(req?.credits).toHaveLength(1);
        });

        it('recomputing coverage before and after provider enrichment gives one credit per snapshot', () => {
            // rev-1: the structured execution alone was credited. rev-2: the Garmin recording
            // arrives and is reconciled into the SAME performed occurrence. These are
            // independent snapshots, not an incremental update to retained credit state.
            const structuredOnly = deriveFactsFromOccurrence(
                { ...occurrence('occ-shared', 'exec-shared', 'garmin-shared'), sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-shared' }] },
                { structured: hydrated('exec-shared', 'garmin-shared').structured },
                descriptor,
            );
            const snapshot = (revision: string, facts: typeof shared) => resolveCoverageHistory({
                asOfDate: AS_OF, windowDays: 7, revision,
                exposures: [facts.exposure], coverageCredits: facts.coverageCredits,
            });
            const credits = (revision: string, facts: typeof shared) => buildCoverageState(planDef, AS_OF, snapshot(revision, facts), descriptor)
                .requirements.find(r => r.key === 'primary_strength');

            const before = credits('rev-1', structuredOnly);
            const after = credits('rev-2', shared);
            expect(before?.completedSessions).toBe(1);
            expect(after?.completedSessions).toBe(1);
            expect(after?.credits).toHaveLength(1);
            expect(after?.credits[0]).toMatchObject({ workoutId: 'strength_full_body_maintenance_01' });
            expect(structuredOnly.exposure.performedOccurrenceId).toBe(shared.exposure.performedOccurrenceId);
        });

        it('two genuine same-day sessions stay two credited occurrences', () => {
            const second = deriveFactsFromOccurrence(
                occurrence('occ-second', 'exec-second', 'garmin-second'),
                hydrated('exec-second', 'garmin-second'),
                descriptor,
            );
            const state = buildCoverageState(planDef, AS_OF, history([shared, second]), descriptor);
            const req = state.requirements.find(r => r.key === 'primary_strength');
            expect(req?.credits).toHaveLength(2);
            expect(req?.completedSessions).toBe(2);
        });
    });

    describe('planning / diagnostic brief table (renderCanonicalTrainingTable)', () => {
        // Pending reconciliation, partial rows and raw fallback: contextBriefTrainingDedupe.test.ts.
        const briefInput = (facts: typeof shared.exposure[], activities: NormalizedGarminActivity[]): ContextBriefInput => ({
            asOfDate: AS_OF, windowDays: 7,
            snapshots: [], checkins: [], activities, recommendations: [],
            recommendationsReadable: true,
            trainingSettings: null, preferences: null, intentProfile: null,
            purpose: 'planning',
            exposureLedger: {
                activitiesReadable: true,
                recommendationsReadable: true,
                activityOverrides: null,
                performedFacts: facts,
                plannedSessions: null,
            },
        });

        it('renders the matched pair as one row and does not add the raw Garmin row to totals', () => {
            const text = buildContextBrief(briefInput([shared.exposure], [garmin('garmin-shared')]));
            expect(text.match(new RegExp(`^\\| ${DATE} \\| Strength `, 'gm'))).toHaveLength(1);
            expect(text).toContain('Totals: 1 sessions · 60 min (canonical, deduped across structured and provider sources; 1 raw provider activity row in window).');
        });

        it('keeps two genuine same-day sessions as two rows', () => {
            const second = deriveFactsFromOccurrence(
                occurrence('occ-second', 'exec-second', 'garmin-second'),
                hydrated('exec-second', 'garmin-second'),
                descriptor,
            );
            const text = buildContextBrief(briefInput(
                [shared.exposure, second.exposure],
                [garmin('garmin-shared'), garmin('garmin-second')],
            ));
            expect(text.match(new RegExp(`^\\| ${DATE} \\| Strength `, 'gm'))).toHaveLength(2);
            expect(text).toContain('Totals: 2 sessions');
        });
    });

    describe('response summary path (deriveKeySessionSummaries, #814/#914)', () => {
        const evidence: TrainingResponseSessionEvidence = {
            performedOccurrenceId: 'occ-shared',
            localDate: DATE,
            modality: 'Strength',
            identity: { level: 'canonical_occurrence', reconciliationStatus: 'matched', sourceKinds: ['structured_execution', 'provider_activity'] },
            structured: {
                sourceRef: { kind: 'structured_execution', executionId: 'exec-shared' },
                executionId: 'exec-shared',
                sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: 'v1' },
                steps: [],
            },
            measuredSources: [{
                sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-shared' },
                provider: 'garmin',
                activityId: 'garmin-shared',
            }],
            sourceCompleteness: { occurrenceRead: 'available', structuredExecution: 'available', providerActivities: 'available' },
        };
        const context = (windowActivities: NormalizedGarminActivity[]) => ({
            history: windowActivities,
            historyStart: DATE,
            checkins: null,
            asOfDate: AS_OF,
            windowStart: DATE,
            windowEnd: AS_OF,
            evidence: [evidence],
        });

        it('yields exactly one summary for the occurrence whether or not the Garmin row is loaded', () => {
            const withActivity = deriveKeySessionSummaries([garmin('garmin-shared')], context([garmin('garmin-shared')]));
            const structuredOnly = deriveKeySessionSummaries([], context([]));
            const ids = (list: typeof withActivity) => list.map(s => [s.activity?.activityId, s.evidence?.performedOccurrenceId]);
            // Loaded Garmin row: one activity-keyed summary, NOT also a structured-only duplicate.
            expect(ids(withActivity)).toEqual([['garmin-shared', 'occ-shared']]);
            // Row not loaded: the occurrence still appears once, from structured evidence.
            expect(ids(structuredOnly)).toEqual([[undefined, 'occ-shared']]);
        });
    });

    describe('daily ledger (dedupeByOccurrence via computeDailyLedger)', () => {
        // Keyed by the authored session occurrence; the input mapper takes session occurrences
        // plus optional linked execution facts and no provider activity, so structured+Garmin
        // cannot double-spend through this path. Replay/dedupe depth: dailyLedger.test.ts.
        const ceilings = { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 1 };

        it('a reservation replayed with its completed execution counts the occurrence once', () => {
            const entries = buildLedgerEntries([
                { occurrenceId: 'slot-1', occurrenceState: 'active', estimatedMinutes: 60, estimatedSystemicCost: 0.3, revision: 1 },
                {
                    occurrenceId: 'slot-1', occurrenceState: 'active', estimatedMinutes: 60, estimatedSystemicCost: 0.3, revision: 2,
                    execution: { state: 'completed', startedAt: `${DATE}T10:00:00.000Z`, completedAt: `${DATE}T11:00:00.000Z` },
                },
            ]);
            const result = computeDailyLedger(ceilings, entries);
            expect(result.remainingMinutes).toBe(60);
            expect(result.remainingSystemicCost).toBeCloseTo(0.7, 10);
        });

        it('two distinct same-day occurrences each consume capacity', () => {
            const entries = buildLedgerEntries(['slot-1', 'slot-2'].map(id => ({
                occurrenceId: id, occurrenceState: 'active' as const, estimatedMinutes: 40, estimatedSystemicCost: 0.2, revision: 1,
            })));
            expect(computeDailyLedger(ceilings, entries).remainingMinutes).toBe(40);
        });
    });

    describe('unmigrated consumers are labeled legacy, not asserted canonical', () => {
        // These read the legacy completed-training pipeline; dual authority is monitored by
        // training-occurrence/historyShadowDiff and cut over only under TO / #872.
        // Every static or dynamic module specifier in the file, regardless of how
        // Prettier wrapped the import (multi-line, type-only, single or double quotes).
        const importedModules = (relative: string): string[] => {
            const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
            return [...source.matchAll(/(?:\bfrom|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
        };
        const CANONICAL = /training-occurrence|performedTrainingFacts/;

        it('the module scanner sees multi-line and dynamic-style imports', () => {
            const modules = importedModules('./perConsumerDoubleCountInventory.test.ts');
            expect(modules).toContain('../performedTrainingFacts');
            expect(modules).toContain('../../training-occurrence/trainingResponseEvidence');
        });

        it.each(['../completedTraining.ts', '../fatigue.ts'])('%s does not import canonical occurrence authority', (file) => {
            expect(importedModules(file).length).toBeGreaterThan(0);
            const offending = importedModules(file).filter(module => CANONICAL.test(module));
            expect(offending).toEqual([]);
        });

        it('the daily-ledger input mapper takes no provider or canonical-occurrence imports', () => {
            const modules = importedModules('../intradayLedgerInputs.ts');
            expect(modules.length).toBeGreaterThan(0);
            const offending = modules.filter(module => CANONICAL.test(module) || module === './models');
            expect(offending).toEqual([]);
        });
    });
});
