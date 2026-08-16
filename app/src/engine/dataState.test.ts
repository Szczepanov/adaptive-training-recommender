import { describe, it, expect } from 'vitest';
import { summarizeDataState, DataState } from './dataState';

describe('summarizeDataState', () => {
    it('should summarize an AVAILABLE state by returning only status and revision', () => {
        const state: DataState<string> = {
            status: 'AVAILABLE',
            data: 'test data',
            revision: '1',
            issues: [{ code: 'TEST', documentPath: 'doc/1' }]
        };
        const result = summarizeDataState(state);
        expect(result).toEqual({ status: 'AVAILABLE', revision: '1' });
    });

    it('should summarize an AVAILABLE state with null revision', () => {
        const state: DataState<number> = {
            status: 'AVAILABLE',
            data: 42,
            revision: null
        };
        const result = summarizeDataState(state);
        expect(result).toEqual({ status: 'AVAILABLE', revision: null });
    });

    it('should return MISSING state identically', () => {
        const state: DataState<string> = { status: 'MISSING' };
        const result = summarizeDataState(state);
        expect(result).toEqual({ status: 'MISSING' });
    });

    it('should return INVALID state identically with its issues', () => {
        const state: DataState<string> = {
            status: 'INVALID',
            issues: [
                { code: 'ERR1', documentPath: 'doc/1', field: 'fieldA' },
                { code: 'ERR2', documentPath: 'doc/2', schemaVersion: 2 }
            ]
        };
        const result = summarizeDataState(state);
        expect(result).toEqual({
            status: 'INVALID',
            issues: [
                { code: 'ERR1', documentPath: 'doc/1', field: 'fieldA' },
                { code: 'ERR2', documentPath: 'doc/2', schemaVersion: 2 }
            ]
        });
    });

    it('should return UNAVAILABLE state identically with operation and retryable flags', () => {
        const state: DataState<string> = {
            status: 'UNAVAILABLE',
            operation: 'fetchDoc',
            retryable: true
        };
        const result = summarizeDataState(state);
        expect(result).toEqual({
            status: 'UNAVAILABLE',
            operation: 'fetchDoc',
            retryable: true
        });
    });
});
