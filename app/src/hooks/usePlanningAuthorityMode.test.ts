import { describe, expect, it } from 'vitest';
import { resolvePlanningAuthorityMode } from '../ledger/planningAuthorityMode';
import { resolvePlanningAuthorityModeView } from './usePlanningAuthorityMode';

describe('resolvePlanningAuthorityModeView', () => {
    const fallback = resolvePlanningAuthorityMode(null);

    it('uses a caller-supplied mode immediately', () => {
        expect(resolvePlanningAuthorityModeView('ledger', null, 'u1')).toEqual({ mode: 'ledger', resolved: true });
        expect(resolvePlanningAuthorityModeView('engine', { userId: 'u1', mode: 'ledger' }, 'u1'))
            .toEqual({ mode: 'engine', resolved: true });
    });

    it('is unresolved with the resolver default until the stored mode is read', () => {
        expect(resolvePlanningAuthorityModeView(undefined, null, 'u1')).toEqual({ mode: fallback, resolved: false });
    });

    it('uses the stored mode read for the current user', () => {
        expect(resolvePlanningAuthorityModeView(undefined, { userId: 'u1', mode: 'ledger' }, 'u1'))
            .toEqual({ mode: 'ledger', resolved: true });
    });

    it('masks a mode read for a previous user', () => {
        expect(resolvePlanningAuthorityModeView(undefined, { userId: 'u1', mode: 'ledger' }, 'u2'))
            .toEqual({ mode: fallback, resolved: false });
    });
});
