import { describe, expect, it } from 'vitest';
import { parseSessionDefinitionRevisionDocument } from './sessionDefinition';

const expected = { userId: 'user-1', definitionId: 'custom-1', revision: 1 };
const path = 'users/user-1/session_definitions/custom-1/revisions/1';

function persistedRevision(overrides: Record<string, unknown> = {}) {
    return {
        userId: expected.userId,
        definitionId: expected.definitionId,
        id: expected.definitionId,
        revision: expected.revision,
        schemaVersion: 1,
        title: 'Upper-Body Strength Maintenance',
        intent: 'training',
        blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [] }],
        contentHash: 'a'.repeat(64),
        createdAt: '2026-08-28T10:00:00.000Z',
        ...overrides,
    };
}

describe('parseSessionDefinitionRevisionDocument', () => {
    it('round-trips the flat Firestore envelope without leaking metadata into executable content', () => {
        const result = parseSessionDefinitionRevisionDocument(persistedRevision(), expected, path);

        expect(result.status).toBe('AVAILABLE');
        if (result.status !== 'AVAILABLE') throw new Error('expected AVAILABLE');
        expect(result.data.definition).toMatchObject({
            id: 'custom-1', revision: 1, title: 'Upper-Body Strength Maintenance', intent: 'training',
        });
        expect(result.data.definition).not.toHaveProperty('userId');
        expect(result.data.definition).not.toHaveProperty('definitionId');
        expect(result.data.definition).not.toHaveProperty('contentHash');
        expect(result.data.definition).not.toHaveProperty('createdAt');
    });

    it('accepts supported companion content while retaining strict envelope validation', () => {
        const result = parseSessionDefinitionRevisionDocument(persistedRevision({
            companionSessions: [{ id: 'spin', definitionRef: 'recovery-spin', relation: 'later_same_day' }],
        }), expected, path);

        expect(result.status).toBe('AVAILABLE');
    });

    it.each([
        ['userId', 'other-user', 'session-definition-user-mismatch'],
        ['definitionId', 'other-definition', 'session-definition-id-mismatch'],
        ['id', 'other-definition', 'session-definition-id-mismatch'],
        ['revision', 2, 'session-definition-revision-mismatch'],
        ['contentHash', 'not-a-sha256', 'invalid-session-definition-hash'],
        ['createdAt', 'not-a-timestamp', 'invalid-session-definition-created-at'],
        ['inventedField', true, 'invalid-session-definition-revision'],
    ])('fails closed for invalid persisted %s', (field, value, code) => {
        const result = parseSessionDefinitionRevisionDocument(persistedRevision({ [field]: value }), expected, path);
        expect(result).toMatchObject({ status: 'INVALID', issues: [{ code }] });
    });

    it('still rejects an invented executable field after stripping transport metadata', () => {
        const result = parseSessionDefinitionRevisionDocument(persistedRevision({ systemicCost: 99 }), expected, path);
        expect(result).toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-session-definition-revision' }] });
    });
});
