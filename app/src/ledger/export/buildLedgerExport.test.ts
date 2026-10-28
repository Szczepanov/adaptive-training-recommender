import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import {
    anthropometryEntry,
    AS_OF,
    assessmentAttempt,
    checkin,
    constraint,
    FAKE_ACCOUNT_ID,
    FAKE_EMAIL,
    FAKE_USER_ID,
    fullInput,
    fullRecords,
    metricObservation,
    nutritionDay,
    occurrence,
    recoverySnapshot,
    sessionResponse,
    settings,
    unloggedNutritionDay,
    withExtra,
} from './ledgerExportFixtures.testSupport.ts';
import { ENVELOPE_SCALARS, resolvePath } from './ledgerExportPaths.testSupport.ts';
import { LEDGER_EXPORT_FIELDS, LEDGER_STATES, type LedgerFlag } from './schema.ts';

describe('buildLedgerExport completeness', () => {
    const output = buildLedgerExport(fullInput());

    it.each(LEDGER_EXPORT_FIELDS.map(path => [path]))('promised field %s is present with a state', path => {
        const nodes = resolvePath(output, path);
        expect(nodes.length, `no element at ${path}`).toBeGreaterThan(0);
        for (const node of nodes) {
            expect(node, path).not.toBeUndefined();
            if (ENVELOPE_SCALARS.has(path)) continue;
            // `flags[].state` resolves to the state itself; everything else to a state-bearing node.
            const state = typeof node === 'string' ? node : (node as { state: string }).state;
            expect(LEDGER_STATES, path).toContain(state);
        }
    });

    it('still promises every field when no records were read at all', () => {
        const empty = buildLedgerExport(fullInput({ records: {} }));
        for (const path of LEDGER_EXPORT_FIELDS.filter(p => !p.includes('[]') && !ENVELOPE_SCALARS.has(p))) {
            const [node] = resolvePath(empty, path);
            expect((node as { state: string }).state, path).toBeDefined();
        }
        expect(empty.facts.recovery).toMatchObject({ state: 'unavailable', items: [] });
        expect(empty.userContext.equipment.fields.free_weights.state).toBe('unavailable');
    });

    it('reports one SourceState per source read, unread ones unavailable', () => {
        const byName = new Map(output.sources.map(source => [source.source, source]));
        expect(byName.get('daily_recovery_snapshots')).toEqual({
            source: 'daily_recovery_snapshots',
            state: 'measured',
            readAt: '2026-11-20T06:12:00Z',
            newestObservedOn: '2026-11-20',
        });
        const empty = buildLedgerExport(fullInput({ records: {} }));
        expect(empty.sources.every(source => source.state === 'unavailable')).toBe(true);
    });
});

describe('buildLedgerExport real-model mapping (H1)', () => {
    const output = buildLedgerExport(fullInput());

    it('reads nutrition from NutritionDay with the provider as source', () => {
        const day = output.facts.nutrition.items.find(item => item.observedOn === nutritionDay.date)!;
        expect(day.fields.energyIntakeKcal).toMatchObject({ value: 2800, state: 'measured', source: 'garmin', unit: 'kcal' });
        expect(day.fields.proteinGrams).toMatchObject({ value: 0, state: 'measured' });
        expect(day.fields.carbsGrams.value).toBe(350);
    });

    it('treats a day with no intake logged as not_recorded, never zero', () => {
        const day = output.facts.nutrition.items.find(item => item.observedOn === unloggedNutritionDay.date)!;
        expect(day.fields.energyIntakeKcal).toMatchObject({ value: null, state: 'not_recorded' });
        expect(day.fields.proteinGrams).toMatchObject({ value: null, state: 'not_recorded' });
        expect(day.fields.hasIntakeData).toMatchObject({ value: false, state: 'measured' });
    });

    it('takes adherence from the next day check-in nutritionAdherenceYesterday', () => {
        const logged = output.facts.nutrition.items.find(item => item.observedOn === unloggedNutritionDay.date)!;
        expect(logged.fields.adherence).toMatchObject({ value: 'mostly_tracked', state: 'measured' });
        const other = output.facts.nutrition.items.find(item => item.observedOn === nutritionDay.date)!;
        expect(other.fields.adherence.state).toBe('not_recorded');
    });

    it('reads body mass from the anthropometry entry id and protocol, with no invented body-fat', () => {
        const [entry] = output.facts.bodyComposition.items;
        expect(entry.id).toBe(anthropometryEntry.id);
        expect(entry.fields.weightKg).toMatchObject({ value: 78.2, state: 'measured', source: 'home_anthropometry@1', unit: 'kg' });
        expect(Object.keys(entry.fields)).toEqual(['weightKg']);
    });

    it('marks an entry without a body-mass measurement not_recorded', () => {
        const circumferenceOnly = { ...anthropometryEntry, measurements: [] };
        const result = buildLedgerExport(fullInput({ records: { anthropometry: [circumferenceOnly] } }));
        expect(result.facts.bodyComposition.items[0].fields.weightKg).toMatchObject({ value: null, state: 'not_recorded' });
    });

    it('uses each record real source rather than a hard-coded athlete', () => {
        const [obs] = output.facts.assessments.items;
        expect(obs.fields.value.source).toBe(metricObservation.source);
        expect(output.facts.events.items[0].fields.placing.source).toBe('manual');
    });

    it('exports recorded placement history and reconstructs the as-of assignment', () => {
        const input = fullRecords();
        input.placementHistory = [{ userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-19', recordedAt: '2026-11-19T10:00:00Z', previous: [],
            assignments: [{ sessionId: 's1', date: '2026-11-20', status: 'planned' }], successors: {} },
        { userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-22', recordedAt: '2026-11-22T10:00:00Z', previous: [{ sessionId: 's1', date: '2026-11-20', status: 'planned' }],
            assignments: [{ sessionId: 's1', date: '2026-11-23', status: 'moved' }], successors: {} }];
        const result = buildLedgerExport({ records: input, asOfDate: AS_OF, purpose: 'planning', exportedAt: '2026-11-21T12:00:00Z' });
        const row = result.coachingHistory.placements.items.find(item => item.id === 'plan-1@2:s1');
        expect(row?.fields.date.value).toBe('2026-11-20');
        expect(row?.fields.statusHistory.state).toBe('measured');
        expect((row?.fields.statusHistory.value as unknown[]).length).toBe(1);
        expect(JSON.stringify(result)).not.toContain('owner');
    });

    it('keeps the pre-history snapshot when the as-of date precedes the first recorded change', () => {
        const input = fullRecords();
        const before = [{ sessionId: 's1', date: '2026-11-19', status: 'completed' as const },
            { sessionId: 's2', date: '2026-11-18', status: 'dropped' as const }];
        input.placementHistory = [{ userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-25', recordedAt: '2026-11-25T10:00:00.000Z', previous: before,
            assignments: [{ sessionId: 's1', date: '2026-11-26', status: 'moved' }], successors: {} }];
        const result = buildLedgerExport({ records: input, asOfDate: AS_OF, purpose: 'planning', exportedAt: '2026-11-21T12:00:00Z' });
        const ids = result.coachingHistory.placements.items.map(item => item.id);
        expect(ids).toEqual(expect.arrayContaining(['plan-1@2:s1', 'plan-1@2:s2']));
        const row = result.coachingHistory.placements.items.find(item => item.id === 'plan-1@2:s1');
        expect(row?.fields.date.value).toBe('2026-11-19');
        expect(row?.fields.statusHistory.state).toBe('not_yet_supported');
    });

    it('retains history for a removed assignment without presenting it as current', () => {
        const input = fullRecords();
        const assignment = { sessionId: 's1', date: '2026-11-20', status: 'planned' as const };
        input.placementHistory = [{ userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-19', recordedAt: '2026-11-19T10:00:00Z', previous: [], assignments: [assignment], successors: {} },
        { userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-20', recordedAt: '2026-11-20T10:00:00Z', previous: [assignment], assignments: [], successors: {} }];
        const result = buildLedgerExport({ records: input, asOfDate: AS_OF, purpose: 'planning', exportedAt: '2026-11-21T12:00:00Z' });
        const row = result.coachingHistory.placements.items.find(item => item.id === 'plan-1@2:s1');
        expect(row?.fields.status.value).toBeNull();
        expect(row?.fields.date.value).toBeNull();
        expect((row?.fields.statusHistory.value as unknown[]).length).toBe(2);
    });

    it('marks a change over a corrupt overlay as an unknown prior state, not an empty one (#1172)', () => {
        const input = fullRecords();
        const s1 = { sessionId: 's1', date: '2026-11-19', status: 'planned' as const };
        const s2 = { sessionId: 's2', date: '2026-11-18', status: 'planned' as const };
        input.placementHistory = [{ userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-17', recordedAt: '2026-11-17T10:00:00.000Z', previous: [], assignments: [s1, s2], successors: {} },
        { userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-19', recordedAt: '2026-11-19T10:00:00.000Z', previous: [],
            previousState: 'invalid', previousStateReason: 'current-schema-invalid',
            assignments: [{ ...s1, date: '2026-11-20', status: 'moved' }], successors: {} }];
        const result = buildLedgerExport({ records: input, asOfDate: AS_OF, purpose: 'planning', exportedAt: '2026-11-21T12:00:00Z' });
        const s1Row = result.coachingHistory.placements.items.find(item => item.id === 'plan-1@2:s1');
        expect(s1Row?.fields.date.value).toBe('2026-11-20');
        expect(s1Row?.fields.statusHistory.value).toEqual([
            { changedOn: '2026-11-17', recordedAt: '2026-11-17T10:00:00.000Z', previousState: 'recorded', previousStateReason: null,
                previous: null, assignment: s1, successor: null },
            { changedOn: '2026-11-19', recordedAt: '2026-11-19T10:00:00.000Z', previousState: 'invalid', previousStateReason: 'current-schema-invalid',
                previous: null, assignment: { ...s1, date: '2026-11-20', status: 'moved' }, successor: null },
        ]);
        // s2 was last recorded before the corrupt overlay and is absent after the repair save.
        const s2Row = result.coachingHistory.placements.items.find(item => item.id === 'plan-1@2:s2');
        expect(s2Row?.fields.status.value).toBeNull();
        expect(s2Row?.fields.statusHistory.value).toMatchObject([{ assignment: s2 }, { previousState: 'invalid', previous: null, assignment: null }]);
        expect(result.coachingHistory.placements.state).toBe('measured');
    });

    it('reports placements before a first change over a corrupt overlay as invalid, never empty (#1172)', () => {
        const input = fullRecords();
        input.placementHistory = [{ userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-25', recordedAt: '2026-11-25T10:00:00.000Z', previous: [],
            previousState: 'invalid', previousStateReason: 'legacy-schema-invalid',
            assignments: [{ sessionId: 's1', date: '2026-11-26', status: 'moved' }], successors: {} }];
        const result = buildLedgerExport({ records: input, asOfDate: AS_OF, purpose: 'planning', exportedAt: '2026-11-21T12:00:00Z' });
        expect(result.coachingHistory.placements.items.filter(item => item.id.startsWith('plan-1@2:'))).toEqual([]);
        expect(result.coachingHistory.placements.state).toBe('invalid');
        expect(result.coachingHistory.overrides.state).toBe('invalid');
    });

    it('marks only a revision with truncated history as having unavailable statusHistory (#1172)', () => {
        const input = fullRecords();
        // The truncated revision's overlay was last written before the as-of date, so it is current.
        input.placements = [{ ...input.placements![0], updatedAt: '2026-11-19T08:00:00.000Z' }, { planId: 'plan-2', revision: 1,
            assignments: [{ sessionId: 'x1', date: '2026-11-19', status: 'moved' }] }];
        input.placementHistoryUnavailable = [{ planId: 'plan-1', revision: 2 }];
        const result = buildLedgerExport({ records: input, asOfDate: AS_OF, purpose: 'planning', exportedAt: '2026-11-21T12:00:00Z' });
        const truncated = result.coachingHistory.placements.items.find(item => item.id === 'plan-1@2:s1');
        expect(truncated?.fields.date.value).toBe('2026-11-19');
        expect(truncated?.fields.statusHistory).toMatchObject({ value: null, state: 'unavailable' });
        const other = result.coachingHistory.placements.items.find(item => item.id === 'plan-2@1:x1');
        expect(other?.fields.statusHistory.state).toBe('not_yet_supported');
        expect(result.coachingHistory.placements.state).toBe('measured');
    });

    it('omits a truncated revision whose current overlay postdates the as-of date (#1172)', () => {
        const input = fullRecords();
        const assignments = input.placements![0].assignments;
        const build = (updatedAt?: string) => {
            input.placements = [{ planId: 'plan-1', revision: 2, assignments, ...(updatedAt ? { updatedAt } : {}) }];
            input.placementHistoryUnavailable = [{ planId: 'plan-1', revision: 2 }];
            return buildLedgerExport({ records: input, asOfDate: AS_OF, purpose: 'planning', exportedAt: '2026-11-21T12:00:00Z' }).coachingHistory;
        };
        const later = build('2026-11-21T08:00:00.000Z');
        expect(later.placements.items.filter(item => item.id.startsWith('plan-1@2:'))).toEqual([]);
        expect(later.placements.state).toBe('unavailable');
        expect(later.overrides.state).toBe('unavailable');
        // Warsaw date (UTC+1 in November): 23:30Z on the 20th is already the 21st, after the as-of date.
        expect(build('2026-11-20T23:30:00.000Z').placements.state).toBe('unavailable');
        expect(build('2026-11-20T22:30:00.000Z').placements.state).toBe('measured');
        const current = build('2026-11-20T20:00:00.000Z');
        expect(current.placements.state).toBe('measured');
        expect(current.placements.items.some(item => item.id === 'plan-1@2:s1')).toBe(true);
        // Without a readable instant the overlay cannot be dated, so it fails closed.
        expect(build().placements.state).toBe('unavailable');
    });

    it('exports an unknown legacy successor without inventing a link', () => {
        const input = fullRecords();
        const old = { sessionId: 's1', date: '2026-11-20', status: 'superseded' as const };
        input.placementHistory = [{ userId: 'owner', planId: 'plan-1', revision: 2,
            changedOn: '2026-11-20', recordedAt: '2026-11-20T10:00:00.000Z',
            previous: [old], assignments: [old, { sessionId: 'other', date: '2026-11-21', status: 'moved' }], successors: {} }];
        const result = buildLedgerExport({ records: input, asOfDate: AS_OF, purpose: 'planning', exportedAt: '2026-11-21T12:00:00Z' });
        const row = result.coachingHistory.placements.items.find(item => item.id === 'plan-1@2:s1');
        expect(row?.fields.status.value).toBe('superseded');
        expect(row?.fields.statusHistory.value).toMatchObject([{ successor: null }]);
    });

    it('carries session response linkage and the placement revision', () => {
        const [response] = output.facts.sessionResponses.items;
        expect(response.fields.sourceSession.value).toEqual(sessionResponse.sourceSession);
        expect(response.fields.occurrenceId.value).toBe('occ-1');
        const placement = output.coachingHistory.placements.items.find(item => item.id === 'plan-1@2:s1')!;
        expect(placement.fields.revision.value).toBe(2);
        expect(placement.fields.sessionId.value).toBe('s1');
    });

    it('joins assessment attempts and carries validity', () => {
        const [obs] = output.facts.assessments.items;
        expect(obs.id).toBe('obs-1@1');
        expect(obs.fields.validity.value).toBe('valid');
        expect(obs.fields.attemptState.value).toBe(assessmentAttempt.state);
        expect(obs.fields.attemptPurpose.value).toBe(assessmentAttempt.purpose);
    });

    it('exports the athlete check-in detail fields (M8)', () => {
        const fields = output.facts.checkins.items[0].fields;
        expect(fields.timeAvailableMin).toMatchObject({ value: 60, state: 'measured', unit: 'min' });
        expect(fields.indoorOnly).toMatchObject({ value: false, state: 'measured' });
        expect(fields.preferredModalityToday.state).toBe('not_recorded');
        expect(fields.redFlags.state).toBe('not_recorded');
        const withTissue = buildLedgerExport(fullInput({
            records: {
                checkins: [checkin('2026-11-20', {
                    tissueResponses: { knee: { region: 'knee', morningState: 'mild' } },
                    redFlags: { present: false },
                })],
            },
        }));
        const detail = withTissue.facts.checkins.items[0].fields;
        expect(detail.tissueResponses.value).toEqual({ knee: { region: 'knee', morningState: 'mild' } });
        expect(detail.redFlags).toMatchObject({ value: { present: false }, state: 'measured' });
    });

    it('exports goal detail and the fixed-activity override on availability (M8)', () => {
        const [goal] = output.userContext.goals.items;
        expect(goal.fields.timing.value).toMatchObject({ planningDate: '2027-04-18' });
        for (const key of ['performanceTarget', 'description', 'targetMetric', 'targetValue', 'targetUnit'] as const) {
            expect(goal.fields[key].state, key).toBe('not_recorded');
        }
        const fixed = output.userContext.availability.items.find(item => item.id === 'fixed-fx-1')!;
        expect(fixed.fields.availabilityContextOverride.value).toEqual({ environment: 'indoor', equipment: ['free_weights'] });
    });
});

describe('buildLedgerExport states', () => {
    const output = buildLedgerExport(fullInput());

    it('marks fields with no backing record not_yet_supported, never null with measured', () => {
        expect(output.userContext.trainingDislikes).toMatchObject({ value: null, state: 'not_yet_supported' });
        expect(output.coachingHistory.placements.items[0].fields.statusHistory.state).toBe('not_yet_supported');
        expect(output.coachingHistory.overrides.items[0].fields.reason.state).toBe('not_yet_supported');
        expect(output.userContext.injuries.items[0].since.state).toBe('not_recorded');
        expect(output.userContext.injuries.items[0].revisions.state).toBe('not_yet_supported');
    });

    it('reports absent structured entries as not_yet_supported, present ones as measured (L4)', () => {
        expect(output.facts.performedTraining.items[0].fields.structuredEntries.state).toBe('not_yet_supported');
        const withEntries = { ...occurrence, structuredEntries: { exerciseCount: 0, setCount: 0 } };
        const result = buildLedgerExport(fullInput({ records: { performedOccurrences: [withEntries] } }));
        expect(result.facts.performedTraining.items[0].fields.structuredEntries)
            .toMatchObject({ value: { exerciseCount: 0, setCount: 0 }, state: 'measured' });
    });

    it('never emits a measured value that is null, anywhere in the export', () => {
        const offenders: string[] = [];
        const walk = (node: unknown, path: string): void => {
            if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`));
            else if (node && typeof node === 'object') {
                const candidate = node as Record<string, unknown>;
                if (candidate.state === 'measured' && 'value' in candidate && candidate.value === null) offenders.push(path);
                Object.entries(candidate).forEach(([key, nested]) => walk(nested, `${path}.${key}`));
            }
        };
        walk(output, '$');
        expect(offenders).toEqual([]);
    });

    it('keeps genuine measured zeros measured with value 0', () => {
        expect(output.facts.recovery.items[0].fields.totalSteps).toMatchObject({ value: 0, state: 'measured' });
        const day = output.facts.nutrition.items.find(item => item.observedOn === nutritionDay.date)!;
        expect(day.fields.proteinGrams).toMatchObject({ value: 0, state: 'measured' });
        const zeroSleep = buildLedgerExport(fullInput({ records: { recovery: [recoverySnapshot('2026-11-20', { sleepScore: 0 })] } }));
        expect(zeroSleep.facts.recovery.items[0].fields.sleepScore).toMatchObject({ value: 0, state: 'measured' });
    });

    it('marks out-of-range scored values invalid with no value (M3)', () => {
        const result = buildLedgerExport(fullInput({
            records: {
                recovery: [recoverySnapshot('2026-11-20', { restingHr: 0, sleepScore: 140 })],
                checkins: [checkin('2026-11-20', { fatigue: 0, readiness: 11 })],
                sessionResponses: [{ ...sessionResponse, sessionRpe: 11 }],
            },
        }));
        const recovery = result.facts.recovery.items[0].fields;
        expect(recovery.restingHr).toMatchObject({ value: null, state: 'invalid' });
        expect(recovery.sleepScore).toMatchObject({ value: null, state: 'invalid' });
        const fields = result.facts.checkins.items[0].fields;
        expect(fields.fatigue).toMatchObject({ value: null, state: 'invalid' });
        expect(fields.readiness).toMatchObject({ value: null, state: 'invalid' });
        expect(fields.motivation).toMatchObject({ value: 8, state: 'measured' });
        expect(result.facts.sessionResponses.items[0].fields.sessionRpe.state).toBe('invalid');
    });

    it('carries assessment validity and withholds the value of an invalid observation (M3)', () => {
        const invalid = { ...metricObservation, validity: 'invalid' as const, invalidReason: 'sensor dropout' };
        const practice = { ...metricObservation, observationKey: 'obs-2', validity: 'practice' as const };
        const result = buildLedgerExport(fullInput({ records: { metricObservations: [invalid, practice] } }));
        const [first, second] = result.facts.assessments.items;
        expect(first.fields.value).toMatchObject({ value: null, state: 'invalid' });
        expect(first.fields.invalidReason.value).toBe('sensor dropout');
        expect(second.fields.value).toMatchObject({ value: 250, state: 'measured' });
        expect(second.fields.validity.value).toBe('practice');
    });

    it('marks an absent value missing or not_recorded, not measured', () => {
        expect(output.facts.recovery.items[0].fields.weightKg).toMatchObject({ value: null, state: 'missing' });
        expect(output.facts.checkins.items[0].fields.soreness).toMatchObject({ value: null, state: 'not_recorded' });
        expect(output.userContext.environment.fields.weekendMaxMinutes.state).toBe('not_recorded');
    });

    it('retains the dated value of a stale metric and its semantic date', () => {
        const stale = recoverySnapshot('2026-11-20', {}, { sleep: '2026-11-18', steps: '2026-11-19' });
        const result = buildLedgerExport(fullInput({ records: { recovery: [stale] } }));
        const fields = result.facts.recovery.items[0].fields;
        expect(fields.sleepScore).toMatchObject({ value: 81, state: 'stale', observedOn: '2026-11-18' });
        expect(fields.totalSteps).toMatchObject({ value: 0, state: 'measured', observedOn: '2026-11-19' });
        expect(fields.restingHr.observedOn).toBe('2026-11-20');
    });

    it('dates totalSteps to D-1 when the snapshot reports no metric date (I3)', () => {
        expect(output.facts.recovery.items[1].fields.totalSteps.observedOn).toBe('2026-11-19');
    });

    it('does not infer duration for an occurrence without both instants', () => {
        const open = { ...occurrence, endedAt: undefined };
        const result = buildLedgerExport(fullInput({ records: { performedOccurrences: [open] } }));
        expect(result.facts.performedTraining.items[0].fields.durationMin).toMatchObject({ value: null, state: 'missing' });
        expect(output.facts.performedTraining.items[0].fields.durationMin).toMatchObject({ value: 60, state: 'measured' });
    });

    it('renders a merged occurrence zero times without counting it as undated', () => {
        const result = buildLedgerExport(fullInput({ records: { performedOccurrences: [{ ...occurrence, status: 'merged' }] } }));
        expect(result.facts.performedTraining).toMatchObject({ items: [], state: 'measured', droppedUndated: 0 });
    });

    it('keeps travel and venue restrictions in the user context with the block start as since', () => {
        const [travel] = output.userContext.travel.items;
        expect(travel.fields.startDate.value).toBe('2026-11-25');
        expect(travel.since).toMatchObject({ value: '2026-11-25', state: 'measured' });
        expect(output.userContext.venueRestrictions.items[0].fields.environment.value).toBe('indoor');
    });

    it('exports dropped placements as overrides without a reason', () => {
        expect(output.coachingHistory.overrides.items.map(item => item.fields.kind.value)).toEqual(['dropped']);
        expect(output.coachingHistory.planRevisions.items.at(-1)!.fields.authorRationale.value).toBe('Build aerobic base first.');
    });
});

describe('buildLedgerExport absence is not "none" (M4)', () => {
    it('exports a resolved injury period even when no injury remains active', () => {
        const result = buildLedgerExport(fullInput({ records: { trainingSettings: { ...settings, injuries: [],
            injuryHistory: [{ severity: 'limit', createdAt: '2026-11-15', resolvedAt: '2026-11-17' }] } } }));
        expect(result.userContext.injuries.items[0].since).toMatchObject({ value: '2026-11-15', state: 'measured' });
        expect(result.userContext.injuries.items[0].fields.resolvedAt).toMatchObject({ value: '2026-11-17', state: 'measured' });
    });

    it('exports the recorded injury start date', () => {
        const result = buildLedgerExport(fullInput({ records: { trainingSettings: { ...settings, injuries: [{ severity: 'limit', createdAt: '2026-10-27' }] } } }));
        expect(result.userContext.injuries.items[0].since).toMatchObject({ value: '2026-10-27', state: 'measured' });
    });

    it('reports injuries not_recorded without a settings document or an injuries field', () => {
        const noDocument = buildLedgerExport(fullInput({ records: { trainingSettings: null } }));
        expect(noDocument.userContext.injuries).toMatchObject({ state: 'not_recorded', items: [] });
        const withoutInjuries = { ...settings, injuries: undefined };
        const noField = buildLedgerExport(fullInput({ records: { trainingSettings: withoutInjuries } }));
        expect(noField.userContext.injuries.state).toBe('not_recorded');
        const none = buildLedgerExport(fullInput({ records: { trainingSettings: { ...settings, injuries: [] } } }));
        expect(none.userContext.injuries).toMatchObject({ state: 'measured', items: [] });
        const unread = buildLedgerExport(fullInput({ records: {} }));
        expect(unread.userContext.injuries.state).toBe('unavailable');
    });

    it('honours the source read state on singleton fields', () => {
        const result = buildLedgerExport(fullInput({
            sources: { training_settings: { state: 'invalid', readAt: null } },
        }));
        expect(result.userContext.equipment.fields.free_weights).toMatchObject({ value: null, state: 'invalid' });
        expect(result.userContext.guardrails.fields.avoid_overhead_pressing).toMatchObject({ value: null, state: 'invalid' });
        expect(result.userContext.injuries.state).toBe('invalid');
        expect(result.userContext.preferences.fields.preferredTimeOfDay.value).toBe('morning');
    });

    it('keeps the stale value of a singleton read as stale', () => {
        const result = buildLedgerExport(fullInput({ sources: { preferences: { state: 'stale', readAt: null } } }));
        expect(result.userContext.preferences.fields.preferredTimeOfDay).toMatchObject({ value: 'morning', state: 'stale' });
    });
});

describe('windowed flags and derived baselines', () => {
    it('covers each date, withholding an injected illness anomaly', () => {
        const flag: LedgerFlag = { id: 'illness_anomaly', observedOn: '2026-11-20', evaluatedAt: '2026-11-20T05:00:00Z', definitionVersion: 'v1', active: true, state: 'measured', inputs: [], threshold: 'secret' };
        const output = buildLedgerExport(fullInput({ purpose: 'morning', flagEvaluations: [flag] }));
        expect(output.flags).toHaveLength(8);
        expect(output.flags.find(f => f.id === 'illness_anomaly' && f.observedOn === '2026-11-20')).toMatchObject({ active: null, state: 'not_yet_supported', reasonCode: 'ha7_release_gate_unmet', threshold: null });
        expect(output.flags.find(f => f.id === 'illness_anomaly' && f.observedOn === '2026-11-20')?.inputs).toEqual([
            { name: 'ha7_release_gate', value: { value: 'unmet', source: 'health_anomaly_assessment', state: 'not_yet_supported' } },
        ]);
        expect(output.flags.find(f => f.id === 'recovery_beyond_baseline')).toMatchObject({ state: 'not_recorded' });
    });

    it('sorts and deduplicates stored revisions without exporting persistence fields', () => {
        const base = { schemaVersion: 1 as const, userId: 'private-owner', idempotencyKey: 'private-key', observedOn: '2026-11-20', id: 'illness_risk_symptom' as const, definitionVersion: 'v1', active: false, state: 'measured' as const, reasonCode: 'none', inputs: [], threshold: null };
        const early = { ...base, revisionId: 'b', evaluatedAt: '2026-11-20T06:00:00Z' };
        const late = { ...base, revisionId: 'a', evaluatedAt: '2026-11-20T07:00:00Z' };
        const output = buildLedgerExport(fullInput({ purpose: 'morning', records: { flagEvaluations: [late, early, early] } }));
        const present = output.flags.filter(f => f.id === base.id && f.observedOn === base.observedOn);
        expect(present.map(f => f.evaluatedAt)).toEqual([early.evaluatedAt, late.evaluatedAt]);
        expect(JSON.stringify(output.flags)).not.toMatch(/private-owner|private-key|revisionId/);
    });
    it('orders equal-session revisions by their actual instants across UTC offsets', () => {
        const base: LedgerFlag = { id: 'illness_risk_symptom', observedOn: AS_OF, evaluatedAt: null,
            definitionVersion: 'v1', active: false, state: 'measured', inputs: [], threshold: null };
        const earlier = { ...base, evaluatedAt: '2026-11-20T09:00:00+02:00' };
        const later = { ...base, evaluatedAt: '2026-11-20T08:00:00Z' };
        const output = buildLedgerExport(fullInput({ purpose: 'morning', flagEvaluations: [later, earlier] }));
        expect(output.flags.filter(f => f.id === base.id && f.observedOn === AS_OF).map(f => f.evaluatedAt))
            .toEqual([earlier.evaluatedAt, later.evaluatedAt]);
    });

    it('respects biometric readiness and preserves incomplete subjective counts', () => {
        const snapshot = recoverySnapshot('2026-11-20');
        snapshot.dataQuality.baseline7dReady = true;
        snapshot.derived.hrv7dAvg = 55;
        snapshot.derived.hrv28dAvg = 60;
        const output = buildLedgerExport(fullInput({ records: { recovery: [snapshot], checkins: [checkin('2026-11-19', { readiness: 6, sleepQuality: 6, fatigue: 6, soreness: 6, mentalStress: 6, motivation: 6 })] } }));
        const biometric = output.derived.find(d => d.id === 'biometric_baselines')!;
        expect(biometric.metrics?.hrv7dAvg).toMatchObject({ value: 55, unit: 'ms', state: 'measured' });
        expect(biometric.metrics?.hrv28dAvg).toMatchObject({ value: null, state: 'missing' });
        const subjective = output.derived.find(d => d.id === 'subjective_baselines')!;
        expect(subjective.metrics?.readiness_recentAvg).toMatchObject({ value: null, state: 'missing' });
        expect(subjective.metrics?.longRecordedDays).toMatchObject({ value: 1, state: 'measured' });
    });

    it('marks non-finite ready biometric values invalid', () => {
        const snapshot = recoverySnapshot('2026-11-20');
        snapshot.dataQuality.baseline7dReady = true;
        snapshot.derived.hrv7dAvg = Number.NaN;
        snapshot.derived.restingHr7dAvg = Number.POSITIVE_INFINITY;
        const output = buildLedgerExport(fullInput({ records: { recovery: [snapshot] } }));
        const metrics = output.derived.find(d => d.id === 'biometric_baselines')!.metrics!;
        expect(metrics.hrv7dAvg).toMatchObject({ value: null, state: 'invalid' });
        expect(metrics.restingHr7dAvg).toMatchObject({ value: null, state: 'invalid' });
    });

    it('reports a readable empty snapshot history as missing', () => {
        const output = buildLedgerExport(fullInput({ records: { recovery: [] } }));
        const biometric = output.derived.find(d => d.id === 'biometric_baselines')!;
        expect(biometric.value).toMatchObject({ value: null, state: 'missing' });
        expect(Object.values(biometric.metrics!).every(metric => metric.state === 'missing')).toBe(true);
    });

    it.each(['invalid', 'unavailable'] as const)('withholds history counts when checkins are %s', state => {
        const output = buildLedgerExport(fullInput({
            records: { checkins: [] }, sources: { daily_subjective_checkins: { state, readAt: null } },
        }));
        const metrics = output.derived.find(d => d.id === 'subjective_baselines')!.metrics!;
        expect(metrics.longRecordedDays).toMatchObject({ value: null, state });
        expect(metrics.recentRecordedDays).toMatchObject({ value: null, state });
    });

    it('propagates a failed flag source and computes subjective baseline from prior checkins', () => {
        const rows = Array.from({ length: 12 }, (_, i) => checkin(`2026-11-${String(i + 8).padStart(2, '0')}`, { readiness: 6, sleepQuality: 6, fatigue: 6, soreness: 6, mentalStress: 6, motivation: 6 }));
        const output = buildLedgerExport(fullInput({ purpose: 'morning', records: { checkins: rows, flagEvaluations: [] }, sources: { flag_evaluations: { state: 'invalid', readAt: null } } }));
        expect(output.flags.every(f => f.state === 'invalid')).toBe(true);
        expect(output.derived.find(d => d.id === 'subjective_baselines')?.metrics?.readiness_recentAvg).toMatchObject({ value: 6, state: 'measured' });
        expect(output.facts.checkins.items).toHaveLength(1);
    });
});

describe('buildLedgerExport legacyEngine (OD4)', () => {
    it('is null unless requested', () => {
        expect(buildLedgerExport(fullInput()).legacyEngine).toBeNull();
    });

    it('carries the opaque layer when requested, stripped of identity-bearing keys (M2)', () => {
        const result = buildLedgerExport(fullInput({
            legacyEngine: {
                policyVersion: '1.2.3',
                plan: { appUserId: 'a', ownerUid: 'b', userEmail: 'c@d.pl', garminProfileId: 'e', athleteId: 'f', phase: 'build' },
            },
        }));
        expect(result.legacyEngine).toEqual({ policyVersion: '1.2.3', plan: { phase: 'build' } });
    });
});

describe('buildLedgerExport privacy and determinism', () => {
    it('never serializes a user id, e-mail or provider account id', () => {
        const serialized = JSON.stringify(buildLedgerExport(fullInput({
            legacyEngine: { owner: { email: FAKE_EMAIL, userId: FAKE_USER_ID, accountId: FAKE_ACCOUNT_ID } },
        })));
        for (const secret of [FAKE_USER_ID, FAKE_ACCOUNT_ID, FAKE_EMAIL]) expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('"email"');
        expect(serialized).toContain('Contact me at [redacted]');
    });

    it('redacts an identity quoted in free text, whole tokens only (M1)', () => {
        const probes = ['garmin', 'measured', '2026-11', 'tempo1'];
        const records = {
            ...fullRecords(),
            recovery: [withExtra(recoverySnapshot('2026-11-20'), { userId: probes[0] })],
            checkins: [checkin('2026-11-20', { userId: probes[1], notes: 'measured by garmin: tempo10 and tempo1, 2026-11-20' })],
            sessionResponses: [{ ...sessionResponse, userId: probes[2] }],
            constraints: [{ ...constraint, userId: probes[3], description: 'tempo10 bike' }],
        };
        const result = buildLedgerExport(fullInput({ records }));
        // Structure is never rewritten.
        expect(result.asOfDate).toBe(AS_OF);
        expect(result.window).toMatchObject({ startDate: '2026-11-07', endDate: AS_OF });
        expect(result.facts.recovery.items[0].fields.sleepScore).toMatchObject({ source: 'garmin', state: 'measured', unit: 'score' });
        expect(result.facts.checkins.items[0].fields.readiness.state).toBe('measured');
        expect(result.facts.sessionResponses.items[0].observedOn).toBe('2026-11-19');
        // Free text loses the whole-token identities only.
        const note = result.facts.checkins.items[0].fields.notes.value;
        expect(note).toBe('[redacted] by [redacted]: tempo10 and [redacted], 2026-11-20');
        expect(result.userContext.constraints.items[0].fields.description.value).toBe('tempo10 bike');
    });

    it('gives identical output for identical inputs apart from exportedAt', () => {
        const first = buildLedgerExport(fullInput());
        const second = buildLedgerExport(fullInput({ exportedAt: '2030-01-01T00:00:00Z' }));
        expect({ ...second, exportedAt: first.exportedAt }).toEqual(first);
        expect(JSON.stringify(buildLedgerExport(fullInput()))).toBe(JSON.stringify(first));
    });

    it('does not mutate its inputs', () => {
        const input = fullInput();
        const before = JSON.stringify(input);
        buildLedgerExport(input);
        expect(JSON.stringify(input)).toBe(before);
    });
});
