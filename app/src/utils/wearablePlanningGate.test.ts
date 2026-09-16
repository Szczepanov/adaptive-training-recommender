import { describe, expect, it } from 'vitest';
import { resolveWearablePlanningMode } from './wearablePlanningGate';

describe('resolveWearablePlanningMode', () => {
    it.each([
        ['connected', 'wearable'],
        ['disconnected', 'wearable'],
        ['unknown', 'wearable'],
    ] as const)(
        'prefers an available recovery snapshot when provider state is %s',
        (connectionState, expectedMode) => {
            expect(resolveWearablePlanningMode(true, connectionState)).toBe(expectedMode);
        },
    );

    it.each([
        ['connected', 'sync_required'],
        ['disconnected', 'subjective_only'],
        ['unknown', 'unavailable'],
    ] as const)(
        'maps no-snapshot provider state %s to %s without collapsing uncertainty',
        (connectionState, expectedMode) => {
            expect(resolveWearablePlanningMode(false, connectionState)).toBe(expectedMode);
        },
    );
});
