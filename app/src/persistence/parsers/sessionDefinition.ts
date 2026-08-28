import type { DataIssue, DataState } from '../../engine/dataState';
import type { SessionDefinition, SessionOccurrence } from '../../sessions/models';
import {
    SESSION_DEFINITION_KEYS,
    validateSessionDefinition,
    validateSessionOccurrence,
} from '../../sessions/validation';

export interface ParsedSessionDefinitionRevision {
    definition: SessionDefinition;
    contentHash: string;
    createdAt: string;
}

export interface ExpectedSessionDefinitionRevision {
    userId: string;
    definitionId: string;
    revision: number;
}

const SESSION_DEFINITION_REVISION_KEYS = [
    ...SESSION_DEFINITION_KEYS,
    'userId',
    'definitionId',
    'contentHash',
    'createdAt',
];

const SHA256_HEX = /^[a-f0-9]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(documentPath: string, code: string, field?: string, message?: string): DataState<never> {
    const issue: DataIssue = {
        code,
        documentPath,
        ...(field ? { field } : {}),
        ...(message ? { message } : {}),
    };
    return { status: 'INVALID', issues: [issue] };
}

/**
 * Decodes the flat Firestore revision envelope without allowing its transport metadata to
 * become part of `SessionDefinition`. The strict executable validator remains the authority
 * for the bytes that can later be previewed, started, or hashed.
 */
export function parseSessionDefinitionRevisionDocument(
    raw: unknown,
    expected: ExpectedSessionDefinitionRevision,
    documentPath: string,
): DataState<ParsedSessionDefinitionRevision> {
    if (raw === undefined || raw === null) {
        return { status: 'MISSING' };
    }

    if (!isObject(raw)) {
        return invalid(documentPath, 'invalid-session-definition-revision', '', 'Expected object');
    }

    const unknownFields = Object.keys(raw).filter(key => !SESSION_DEFINITION_REVISION_KEYS.includes(key));
    if (unknownFields.length > 0) {
        return invalid(
            documentPath,
            'invalid-session-definition-revision',
            '',
            `Unrecognized session definition revision field(s): ${unknownFields.join(', ')}`,
        );
    }

    if (raw.userId !== expected.userId) {
        return invalid(documentPath, 'session-definition-user-mismatch', 'userId');
    }
    if (raw.definitionId !== expected.definitionId) {
        return invalid(documentPath, 'session-definition-id-mismatch', 'definitionId');
    }
    if (raw.id !== expected.definitionId) {
        return invalid(documentPath, 'session-definition-id-mismatch', 'id');
    }
    if (raw.revision !== expected.revision) {
        return invalid(documentPath, 'session-definition-revision-mismatch', 'revision');
    }
    if (typeof raw.contentHash !== 'string' || !SHA256_HEX.test(raw.contentHash)) {
        return invalid(documentPath, 'invalid-session-definition-hash', 'contentHash');
    }
    if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) {
        return invalid(documentPath, 'invalid-session-definition-created-at', 'createdAt');
    }

    const definition = Object.fromEntries(
        SESSION_DEFINITION_KEYS
            .filter(key => raw[key] !== undefined)
            .map(key => [key, raw[key]]),
    );
    const validation = validateSessionDefinition(definition);
    if (!validation.ok) {
        const first = validation.issues[0];
        return invalid(documentPath, 'invalid-session-definition', first?.path, first?.message);
    }

    return {
        status: 'AVAILABLE',
        data: {
            definition: validation.value,
            contentHash: raw.contentHash,
            createdAt: raw.createdAt,
        },
        revision: null,
    };
}

export function parseSessionOccurrenceDocument(
    raw: unknown,
    documentPath: string,
): DataState<SessionOccurrence> {
    if (raw === undefined || raw === null) {
        return { status: 'MISSING' };
    }

    const validation = validateSessionOccurrence(raw);
    if (!validation.ok) {
        const first = validation.issues[0];
        return invalid(documentPath, 'invalid-session-occurrence', first?.path, first?.message);
    }

    return {
        status: 'AVAILABLE',
        data: validation.value,
        revision: null,
    };
}
