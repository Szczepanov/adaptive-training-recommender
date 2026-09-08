import { describe, expect, it } from 'vitest';
import { resolveWearablePlanningMode } from './wearablePlanningGate';

describe('resolveWearablePlanningMode', () => {
    it('uses an available recovery snapshot regardless of provider-status availability', () => {
        expect(resolveWearablePlanningMode(true, 'unknown')).toBe('wearable');
    });

    it('allows subjective-only planning only after confirmed disconnection', () => {
        expect(resolveWearablePlanningMode(false, 'disconnected')).toBe('subjective_only');
        expect(resolveWearablePlanningMode(false, 'connected')).toBe('sync_required');
        expect(resolveWearablePlanningMode(false, 'unknown')).toBe('unavailable');
    });
});
