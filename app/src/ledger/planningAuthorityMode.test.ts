import { describe, expect, it } from 'vitest';
import {
    resolvePlanningAuthorityMode,
    UNSET_PLANNING_AUTHORITY_MODE,
} from './planningAuthorityMode';

describe('resolvePlanningAuthorityMode (ADR-0052 Phase 2, #1167 P2-8)', () => {
    it('defaults to ledger mode while the setting is unset (P2-8 flip)', () => {
        expect(UNSET_PLANNING_AUTHORITY_MODE).toBe('ledger');
        expect(resolvePlanningAuthorityMode(undefined)).toBe('ledger');
        expect(resolvePlanningAuthorityMode(null)).toBe('ledger');
        expect(resolvePlanningAuthorityMode({})).toBe('ledger');
    });

    it('honours an explicit athlete choice in both directions', () => {
        expect(resolvePlanningAuthorityMode({ engineRecommendationsEnabled: true })).toBe('engine');
        expect(resolvePlanningAuthorityMode({ engineRecommendationsEnabled: false })).toBe('ledger');
    });
});
