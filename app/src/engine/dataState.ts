/**
 * A read boundary must distinguish no document from malformed data and from a failed
 * operation. Engine callers may treat only AVAILABLE data as a neutral input.
 */
export interface DataIssue {
    code: string;
    field?: string;
    documentPath: string;
    schemaVersion?: number;
}

export type DataState<T> =
    | { status: 'AVAILABLE'; data: T; revision: string | null; issues?: DataIssue[] }
    | { status: 'MISSING' }
    | { status: 'INVALID'; issues: DataIssue[] }
    | { status: 'UNAVAILABLE'; operation: string; retryable: boolean; message?: string };

export type DataStateSummary =
    | { status: 'AVAILABLE'; revision: string | null }
    | { status: 'MISSING' }
    | { status: 'INVALID'; issues: DataIssue[] }
    | { status: 'UNAVAILABLE'; operation: string; retryable: boolean; message?: string };

export function summarizeDataState<T>(state: DataState<T>): DataStateSummary {
    if (state.status === 'AVAILABLE') return { status: state.status, revision: state.revision };
    return state;
}
