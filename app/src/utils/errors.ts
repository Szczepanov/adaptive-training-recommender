/**
 * Type-safe helpers for narrowing `unknown` catch-clause errors (e.g. Firebase
 * SDK errors) without resorting to `any`.
 */

/** Extract a Firestore/Firebase error code (e.g. "permission-denied"), if present. */
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

/** True if the error looks like a Firestore "permission-denied" / insufficient-permissions failure. */
export function isPermissionDeniedError(error: unknown): boolean {
    return getErrorCode(error) === 'permission-denied' || getErrorMessage(error).includes('Missing or insufficient permissions');
}
