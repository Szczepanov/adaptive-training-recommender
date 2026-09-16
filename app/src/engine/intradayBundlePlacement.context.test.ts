import { describe, expect, it } from 'vitest';
import type { ScheduleWindow } from './models';
import type { DailyLedgerResult } from './dailyLedger';
import { proposeBundlePlacement, type IntradayBundleMember } from './intradayBundlePlacement';

const DATE = '2026-09-10';

function ledger(): DailyLedgerResult {
    return { remainingMinutes: 120, remainingSystemicCost: 1, unresolvedEntries: [] };
}

function window(overrides: Partial<ScheduleWindow> = {}): ScheduleWindow {
    return {
        id: 'w1',
        userId: 'u1',
        date: DATE,
        startLocal: '06:00',
        endLocal: '07:30',
        revision: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    };
}

function member(overrides: Partial<IntradayBundleMember> = {}): IntradayBundleMember {
    return {
        sessionId: 's1',
        order: 0,
        priority: 'key',
        requestedWindow: { startLocal: '06:00', endLocal: '07:30' },
        estimatedMinutes: 45,
        estimatedSystemicCost: 0.2,
        started: false,
        ...overrides,
    };
}

describe('intraday window context intersection', () => {
    it('rejects an outdoor-required session when the matching real window is indoor-only', () => {
        const result = proposeBundlePlacement(
            'b1',
            DATE,
            [member({ requiredEnvironment: 'outdoor' })],
            [window({ environment: 'indoor' })],
            [],
            new Set(),
            ledger(),
        );

        expect(result.outcome).toBe('infeasible');
        expect(result.reason).toMatch(/equipment\/environment/i);
    });

    it('accepts an either-environment session in an indoor-only window', () => {
        const result = proposeBundlePlacement(
            'b1',
            DATE,
            [member({ requiredEnvironment: 'either' })],
            [window({ environment: 'indoor' })],
            [],
            new Set(),
            ledger(),
        );

        expect(result.outcome).toBe('placed');
        expect(result.bindings?.[0]?.windowId).toBe('w1');
    });

    it('rejects a session when the window-declared equipment set omits a required item', () => {
        const result = proposeBundlePlacement(
            'b1',
            DATE,
            [member({ requiredEquipment: ['free_weights'] })],
            [window({ equipment: ['indoor_bike'] })],
            [],
            new Set(),
            ledger(),
        );

        expect(result.outcome).toBe('infeasible');
        expect(result.reason).toMatch(/equipment\/environment/i);
    });

    it('accepts a session when every required equipment item is available in the window', () => {
        const result = proposeBundlePlacement(
            'b1',
            DATE,
            [member({ requiredEquipment: ['free_weights', 'indoor_bike'] })],
            [window({ equipment: ['free_weights', 'indoor_bike', 'pullup_bar'] })],
            [],
            new Set(),
            ledger(),
        );

        expect(result.outcome).toBe('placed');
        expect(result.bindings?.[0]?.windowId).toBe('w1');
    });
});
