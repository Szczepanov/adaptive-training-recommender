import { describe, expect, it } from 'vitest';
import { resolvePlacement } from '../engine/externalPlacement';
import { computeDailyLedger } from '../engine/dailyLedger';
import type { ScheduleWindow, ExternalPlanHeader } from '../engine/models';
import { EXTERNAL_PLAN_SCHEMA_V4 } from '../sessions/externalPlanV4';
import fixture01 from '../sessions/fixtures/01-full-body-maintenance.json';
import {
    buildIntradayMemberState,
    externalPlanContextForDate,
    placedSessionForDate,
    resolveIntradayBundlePlacement,
    type ActiveExternalPlan,
    type IntradayBundlePlacementContext,
} from './activeExternalPlanService';
import type { ExternalPlanSessionOccurrence } from '../sessions/models';

const DATE = '2026-08-17'; // the plan's Monday startDate

function intradaySession(overrides: Record<string, unknown> = {}) {
    return {
        id: 's-am', title: 'AM', priority: 'key',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
        definition: fixture01,
        intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 },
        ...overrides,
    };
}

function planV4(sessions: Record<string, unknown>[]) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V4,
        planId: 'v4-bundle-1', revision: 1, title: 'Bundle plan',
        startDate: DATE, weekCount: 1,
        sessions, restDays: [],
    } as const;
}

function header(): ExternalPlanHeader {
    return {
        userId: 'u1', planId: 'v4-bundle-1', revision: 1, title: 'Bundle plan',
        startDate: DATE, weekCount: 1, contentHash: 'hash-1',
        importedAt: '2026-08-16T10:00:00Z', supersededFrom: null, updatedAt: '2026-08-16T10:00:00Z',
    };
}

function activePlan(sessions: Record<string, unknown>[]): ActiveExternalPlan {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture, matches the untyped JSON import shape validateExternalTrainingPlanV4 already accepts
    const plan = planV4(sessions) as any;
    return { header: header(), plan, placement: null, placed: resolvePlacement(plan, null, {}) };
}

function scheduleWindow(overrides: Partial<ScheduleWindow> = {}): ScheduleWindow {
    return {
        id: 'w', userId: 'u1', date: DATE, startLocal: '06:00', endLocal: '07:00',
        revision: 1, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        ...overrides,
    };
}

function bundleContext(overrides: Partial<IntradayBundlePlacementContext> = {}): IntradayBundlePlacementContext {
    return {
        scheduleWindows: [],
        fixedActivities: [],
        ledger: computeDailyLedger({ dailyMinuteCeiling: 200, dailySystemicCostCeiling: 1 }, []),
        ...overrides,
    };
}

describe('resolveIntradayBundlePlacement', () => {
    it('returns null when no placed session for the date carries intraday', () => {
        const active = activePlan([{
            id: 'plain', title: 'Plain', priority: 'key',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
            definition: fixture01,
        }]);
        expect(resolveIntradayBundlePlacement(active, DATE, bundleContext())).toBeNull();
    });

    it('resolves a feasible two-member bundle against real schedule windows', () => {
        const active = activePlan([
            intradaySession({ id: 's-am', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 } }),
            intradaySession({ id: 's-pm', title: 'PM', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        const result = resolveIntradayBundlePlacement(active, DATE, bundleContext({
            scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' }), scheduleWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
        }));
        expect(result?.outcome).toBe('placed');
        expect(result?.bindings?.map(b => b.sessionId)).toEqual(['s-am', 's-pm']);
    });

    it('preserves a started member\'s history via memberState instead of hardcoding started: false (H4 #434 PR 3 step 7)', () => {
        const active = activePlan([
            intradaySession({ id: 's-am', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 } }),
            intradaySession({ id: 's-pm', title: 'PM', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        const existingBinding = {
            sessionId: 's-am', windowId: 'am',
            boundStartLocal: '06:00', boundEndLocal: '07:00',
            startInstant: '2026-08-17T04:00:00Z', endInstant: '2026-08-17T05:00:00Z',
        };
        const result = resolveIntradayBundlePlacement(active, DATE, bundleContext({
            scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' }), scheduleWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
            memberState: new Map([['s-am', { started: true, existingBinding }]]),
        }));
        expect(result?.outcome).toBe('placed');
        // The started member's binding is carried through unchanged, not re-derived --
        // without memberState wired through, toMembers would hardcode started: false and
        // this exact instant pair could silently move on a later dashboard load.
        expect(result?.bindings?.find(b => b.sessionId === 's-am')).toEqual(existingBinding);
    });

    it('does not merge two distinct bundle instances that land on the same date, and lets the first feasible one win', () => {
        // An athlete's explicit per-session overlay can move any single session --
        // including one bundle member independently of its siblings -- to an arbitrary
        // date, so two unrelated bundle instances (different bundleId, same week) can end
        // up with intraday-bearing sessions placed on the same date. This constructs that
        // state directly (bypassing resolvePlacement, which would not itself produce this
        // from one revision's authored data) to exercise the grouping boundary.
        const groupA = [
            intradaySession({ id: 'a1', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'bundle-a', order: 0 } }),
            intradaySession({ id: 'a2', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'bundle-a', order: 1 } }),
        ];
        const groupB = [
            intradaySession({ id: 'b1', intraday: { window: { startLocal: '20:00', endLocal: '21:00' }, bundleId: 'bundle-b', order: 0 } }),
        ];
        const active: ActiveExternalPlan = {
            header: header(),
            plan: planV4([...groupA, ...groupB]) as unknown as ActiveExternalPlan['plan'],
            placement: null,
            placed: [...groupA, ...groupB].map(session => ({
                session: session as unknown as ActiveExternalPlan['placed'][number]['session'],
                date: DATE, status: 'planned' as const, moved: false,
            })),
        };
        const context = bundleContext({
            scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' }), scheduleWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
        });

        // 'bundle-a' < 'bundle-b' alphabetically and resolves feasibly against the real
        // windows; it must win without group B's unfitting session ever being merged in.
        const result = resolveIntradayBundlePlacement(active, DATE, context);
        expect(result?.outcome).toBe('placed');
        expect(result?.bindings?.map(b => b.sessionId)).toEqual(['a1', 'a2']);
        expect(placedSessionForDate(active, DATE, context)?.session.id).toBe('a1');
    });

    it('lets a later-ordered feasible bundle instance win over an earlier infeasible one, deterministically', () => {
        const infeasibleFirst = [
            // 'bundle-a' sorts first but requests a window with no matching real availability.
            intradaySession({ id: 'a1', intraday: { window: { startLocal: '20:00', endLocal: '21:00' }, bundleId: 'bundle-a', order: 0 } }),
        ];
        const feasibleSecond = [
            intradaySession({ id: 'b1', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'bundle-b', order: 0 } }),
        ];
        const active: ActiveExternalPlan = {
            header: header(),
            plan: planV4([...infeasibleFirst, ...feasibleSecond]) as unknown as ActiveExternalPlan['plan'],
            placement: null,
            placed: [...infeasibleFirst, ...feasibleSecond].map(session => ({
                session: session as unknown as ActiveExternalPlan['placed'][number]['session'],
                date: DATE, status: 'planned' as const, moved: false,
            })),
        };
        const context = bundleContext({ scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' })] });

        const result = resolveIntradayBundlePlacement(active, DATE, context);
        expect(result?.outcome).toBe('placed');
        expect(result?.bindings?.map(b => b.sessionId)).toEqual(['b1']);
    });

    it('reports infeasible when the date is authored rest', () => {
        // D-SCHEMA import validation would reject an intraday session sharing a date with
        // an authored rest directive, but resolveIntradayBundlePlacement itself must still
        // fail closed if it ever sees that combination (e.g. an older revision's overlay),
        // so this constructs that state directly rather than through resolvePlacement.
        const plan = { ...planV4([intradaySession()]), restDays: [{ id: 'r1', week: 1, day: 'monday' }] };
        const active: ActiveExternalPlan = {
            header: header(),
            plan: plan as unknown as ActiveExternalPlan['plan'],
            placement: null,
            placed: [{ session: intradaySession() as unknown as ActiveExternalPlan['placed'][number]['session'], date: DATE, status: 'planned', moved: false }],
        };
        const result = resolveIntradayBundlePlacement(active, DATE, bundleContext());
        expect(result?.outcome).toBe('infeasible');
    });
});

describe('placedSessionForDate with bundleContext', () => {
    it('picks the bundle\'s earliest-order member as primary even when priority tie-break would pick the other', () => {
        // s-pm has higher priority ('key') than s-am ('supporting'); pure priority
        // tie-break would pick s-pm, but the bundle's order (s-am is order 0) must win
        // once the bundle resolves feasibly.
        const active = activePlan([
            intradaySession({ id: 's-am', priority: 'supporting', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 } }),
            intradaySession({ id: 's-pm', title: 'PM', priority: 'key', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        const context = bundleContext({
            scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' }), scheduleWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
        });
        expect(placedSessionForDate(active, DATE, context)?.session.id).toBe('s-am');
        // Omitting bundleContext keeps the exact pre-D-PLACEMENT priority-based pick.
        expect(placedSessionForDate(active, DATE)?.session.id).toBe('s-pm');
    });

    it('falls back to priority tie-break when the bundle is infeasible', () => {
        const active = activePlan([
            intradaySession({ id: 's-am', priority: 'supporting', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 }, definition: { ...fixture01, duration: { min: 500, max: 500 } } }),
            intradaySession({ id: 's-pm', title: 'PM', priority: 'key', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        // No real windows and a 500-minute member forces the legacy single-slot bundle infeasible.
        const context = bundleContext();
        expect(placedSessionForDate(active, DATE, context)?.session.id).toBe('s-pm');
    });
});

describe('externalPlanContextForDate with bundleContext', () => {
    it('resolves to the bundle\'s earliest-order primary session when bundleContext makes the bundle feasible', () => {
        const active = activePlan([
            intradaySession({ id: 's-am', priority: 'supporting', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 } }),
            intradaySession({ id: 's-pm', title: 'PM', priority: 'key', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        const context = bundleContext({
            scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' }), scheduleWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
        });
        expect(externalPlanContextForDate(active, DATE, context)?.session.id).toBe('s-am');
        // Omitting bundleContext keeps the exact pre-D-PLACEMENT priority-based pick.
        expect(externalPlanContextForDate(active, DATE)?.session.id).toBe('s-pm');
    });
});

describe('buildIntradayMemberState (H4 #434 PR 3 step 7)', () => {
    function externalOccurrence(overrides: Partial<ExternalPlanSessionOccurrence> = {}): ExternalPlanSessionOccurrence {
        return {
            userId: 'u1', occurrenceId: 'occ-1', date: DATE, authority: 'external_plan',
            externalPlanRef: { planId: 'v4-bundle-1', revision: 1, sessionId: 's-am', contentHash: 'a'.repeat(64) },
            state: 'scheduled',
            createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z',
            ...overrides,
        };
    }

    it('marks a scheduled occurrence as not started', () => {
        const result = buildIntradayMemberState([externalOccurrence({ state: 'scheduled' })]);
        expect(result.get('s-am')).toEqual({ started: false });
    });

    it.each(['active', 'completed', 'abandoned'] as const)('marks a %s occurrence as started', state => {
        const result = buildIntradayMemberState([externalOccurrence({ state })]);
        expect(result.get('s-am')?.started).toBe(true);
    });

    it.each(['missed', 'superseded', 'skipped'] as const)('never marks a %s occurrence as started', state => {
        const result = buildIntradayMemberState([externalOccurrence({ state })]);
        expect(result.get('s-am')?.started).toBe(false);
    });

    it('carries a started member\'s windowBinding through as existingBinding', () => {
        const windowBinding = {
            windowId: 'window-1', bundleId: 'double-monday', order: 0,
            boundStartLocal: '06:00', boundEndLocal: '07:00',
            startInstant: '2026-08-17T04:00:00Z', endInstant: '2026-08-17T05:00:00Z',
        };
        const result = buildIntradayMemberState([externalOccurrence({ state: 'active', windowBinding })]);
        expect(result.get('s-am')).toEqual({
            started: true,
            existingBinding: {
                sessionId: 's-am', windowId: 'window-1',
                boundStartLocal: '06:00', boundEndLocal: '07:00',
                startInstant: '2026-08-17T04:00:00Z', endInstant: '2026-08-17T05:00:00Z',
            },
        });
    });

    it('never carries a windowBinding for an unstarted member, even if one is somehow present', () => {
        const windowBinding = {
            windowId: 'window-1', bundleId: 'double-monday', order: 0,
            boundStartLocal: '06:00', boundEndLocal: '07:00',
            startInstant: '2026-08-17T04:00:00Z', endInstant: '2026-08-17T05:00:00Z',
        };
        const result = buildIntradayMemberState([externalOccurrence({ state: 'scheduled', windowBinding })]);
        expect(result.get('s-am')).toEqual({ started: false });
    });

    it('keys by externalPlanRef.sessionId across multiple occurrences', () => {
        const result = buildIntradayMemberState([
            externalOccurrence({ occurrenceId: 'occ-am', externalPlanRef: { planId: 'p', revision: 1, sessionId: 's-am', contentHash: 'a'.repeat(64) }, state: 'active' }),
            externalOccurrence({ occurrenceId: 'occ-pm', externalPlanRef: { planId: 'p', revision: 1, sessionId: 's-pm', contentHash: 'b'.repeat(64) }, state: 'scheduled' }),
        ]);
        expect([...result.keys()].sort()).toEqual(['s-am', 's-pm']);
        expect(result.get('s-am')?.started).toBe(true);
        expect(result.get('s-pm')?.started).toBe(false);
    });

    it('ignores manual (non-external-plan) occurrences', () => {
        const manual = {
            userId: 'u1', occurrenceId: 'occ-manual', date: DATE, authority: 'schedule' as const,
            definitionRef: { definitionId: 'def-1', revision: 1, contentHash: 'a'.repeat(64) },
            state: 'active' as const, createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z',
        };
        const result = buildIntradayMemberState([manual]);
        expect(result.size).toBe(0);
    });
});
