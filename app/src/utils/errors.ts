/**
 * Type-safe helpers for narrowing `unknown` catch-clause errors (e.g. Firebase
 * SDK errors) without resorting to `any`.
 */

export interface ErrorDetails {
    message: string;
    code?: string;
    retryable?: boolean;
    requestId?: string;
    status?: number;
}

/** Extract a Firestore/Firebase/app error code (e.g. "permission-denied"), if present. */
export function getErrorCode(error: unknown): string | undefined {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : undefined;
    }
    return undefined;
}

/** Extract a human-readable message from any thrown value. */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') {
            return message;
        }
    }
    return String(error);
}

/**
 * Extract only boundary-safe diagnostic metadata. This deliberately excludes stack/cause
 * data so callers can log or render the result without dumping request payloads or SDK
 * internals into the browser console/UI.
 */
export function getErrorDetails(error: unknown): ErrorDetails {
    const details: ErrorDetails = {
        message: getErrorMessage(error),
        code: getErrorCode(error),
    };
    if (typeof error !== 'object' || error === null) return details;

    if ('retryable' in error && typeof (error as { retryable?: unknown }).retryable === 'boolean') {
        details.retryable = (error as { retryable: boolean }).retryable;
    }
    if ('requestId' in error && typeof (error as { requestId?: unknown }).requestId === 'string') {
        details.requestId = (error as { requestId: string }).requestId;
    }
    if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
        details.status = (error as { status: number }).status;
    }
    return details;
}

/** Friendly message plus stable support metadata when a boundary supplied it. */
export function getDetailedErrorMessage(error: unknown): string {
    const details = getErrorDetails(error);
    const references: string[] = [];
    if (details.code) references.push(`code: ${details.code}`);
    if (details.requestId) references.push(`reference: ${details.requestId}`);
    return references.length > 0
        ? `${details.message} (${references.join(', ')})`
        : details.message;
}

/** True if the error looks like a Firestore "permission-denied" / insufficient-permissions failure. */
export function isPermissionDeniedError(error: unknown): boolean {
    return getErrorCode(error) === 'permission-denied' || getErrorMessage(error).includes('Missing or insufficient permissions');
}
