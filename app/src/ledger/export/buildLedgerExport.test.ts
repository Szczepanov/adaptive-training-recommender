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
import { LEDGER_EXPORT_FIELDS, LEDGER_FLAG_IDS, LEDGER_STATES, type LedgerFlag } from './schema.ts';

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
        expect(output.userContext.injuries.items[0].since.state).toBe('not_yet_supported');
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

describe('buildLedgerExport flags (D-FLAGS, M9)', () => {
    it('lists all four flags unevaluated and the derived layer unsupported by default', () => {
        const output = buildLedgerExport(fullInput());
        expect(output.flags.map(flag => flag.id)).toEqual([...LEDGER_FLAG_IDS]);
        for (const flag of output.flags) {
            expect(flag).toMatchObject({ active: null, state: 'not_yet_supported', evaluatedAt: null });
        }
        expect(output.derived.every(metric => metric.value.state === 'not_yet_supported')).toBe(true);
    });

    it('passes persisted evaluations through unchanged and leaves the rest unsupported', () => {
        const injuryFlag: LedgerFlag = {
            id: 'injury_constraint_touches_session',
            observedOn: '2026-11-18',
            evaluatedAt: '2026-11-18T05:00:00Z',
            definitionVersion: 'injury-touch@3',
            sessionRef: 'session-7',
            active: true,
            state: 'measured',
            inputs: [{ name: 'region', value: { value: 'knee', source: 'athlete', state: 'measured' } }],
            threshold: 'limit severity on a loaded knee session',
        };
        const unevaluable: LedgerFlag = {
            id: 'illness_anomaly',
            observedOn: '2026-11-19',
            evaluatedAt: '2026-11-19T05:00:00Z',
            definitionVersion: 'anomaly@1',
            active: null,
            state: 'missing',
            inputs: [],
            threshold: 'hrv below baseline band',
            baselineWindow: '28d',
        };
        const output = buildLedgerExport(fullInput({ flagEvaluations: [injuryFlag, unevaluable] }));
        expect(output.flags.filter(flag => flag.id === 'injury_constraint_touches_session')).toEqual([injuryFlag]);
        expect(output.flags.filter(flag => flag.id === 'illness_anomaly')).toEqual([unevaluable]);
        expect(output.flags.find(flag => flag.id === 'recovery_beyond_baseline'))
            .toMatchObject({ state: 'not_yet_supported', active: null });
        expect(output.flags.map(flag => flag.id)).toEqual([
            'illness_anomaly', 'illness_risk_symptom', 'injury_constraint_touches_session', 'recovery_beyond_baseline',
        ]);
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
