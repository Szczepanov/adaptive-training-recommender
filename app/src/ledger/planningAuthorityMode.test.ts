import { describe, expect, it } from 'vitest';
import {
    resolvePlanningAuthorityMode,
    UNSET_PLANNING_AUTHORITY_MODE,
} from './planningAuthorityMode';

describe('resolvePlanningAuthorityMode (ADR-0052 Phase 2, #1167 P2-1)', () => {
    it('keeps today\'s engine behaviour while the setting is unset (until the P2-8 flip)', () => {
        expect(UNSET_PLANNING_AUTHORITY_MODE).toBe('engine');
        expect(resolvePlanningAuthorityMode(undefined)).toBe('engine');
        expect(resolvePlanningAuthorityMode(null)).toBe('engine');
        expect(resolvePlanningAuthorityMode({})).toBe('engine');
    });

    it('honours an explicit athlete choice in both directions', () => {
        expect(resolvePlanningAuthorityMode({ engineRecommendationsEnabled: true })).toBe('engine');
        expect(resolvePlanningAuthorityMode({ engineRecommendationsEnabled: false })).toBe('ledger');
    });
});
