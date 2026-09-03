import { describe, it, expect } from 'vitest';
import {
    initialTrackedConnectionState,
    resolveGarminConnectionViewState,
    type TrackedConnectionState,
} from './useGarminConnectionState';

// Regression coverage for the stale-`connected`-after-user-change bug: on the render
// where `userId`/`enabled` change, React hasn't run the subscription effect yet, so the
// tracked state object still reflects the *previous* inputs. Consumers must see
// 'checking'/'disconnected' on that render, never a stale 'connected' misattributed to
// the new user.
describe('resolveGarminConnectionViewState', () => {
    it('returns the tracked value when inputs match the current render', () => {
        const state: TrackedConnectionState = { userId: 'user-a', enabled: true, value: 'connected' };
        expect(resolveGarminConnectionViewState(state, 'user-a', true)).toBe('connected');
    });

    it('masks a stale connected value on the render where userId switches from A to B', () => {
        const staleConnectedForA: TrackedConnectionState = { userId: 'user-a', enabled: true, value: 'connected' };
        expect(resolveGarminConnectionViewState(staleConnectedForA, 'user-b', true)).toBe('checking');
    });

    it('masks a stale connected value on the render where userId is cleared', () => {
        const staleConnectedForA: TrackedConnectionState = { userId: 'user-a', enabled: true, value: 'connected' };
        expect(resolveGarminConnectionViewState(staleConnectedForA, null, true)).toBe('disconnected');
    });

    it('masks a stale connected value on the render where enabled flips to false', () => {
        const staleConnectedForA: TrackedConnectionState = { userId: 'user-a', enabled: true, value: 'connected' };
        expect(resolveGarminConnectionViewState(staleConnectedForA, 'user-a', false)).toBe('disconnected');
    });

    it('masks a stale value on the render where enabled flips to true', () => {
        const staleDisabled: TrackedConnectionState = { userId: 'user-a', enabled: false, value: 'disconnected' };
        expect(resolveGarminConnectionViewState(staleDisabled, 'user-a', true)).toBe('checking');
    });
});

describe('initialTrackedConnectionState', () => {
    it('starts checking when a user is present and enabled', () => {
        expect(initialTrackedConnectionState('user-a', true)).toEqual({
            userId: 'user-a',
            enabled: true,
            value: 'checking',
        });
    });

    it('starts disconnected when disabled', () => {
        expect(initialTrackedConnectionState('user-a', false)).toEqual({
            userId: 'user-a',
            enabled: false,
            value: 'disconnected',
        });
    });

    it('starts disconnected when there is no user', () => {
        expect(initialTrackedConnectionState(null, true)).toEqual({
            userId: null,
            enabled: true,
            value: 'disconnected',
        });
    });
});
