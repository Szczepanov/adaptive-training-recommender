import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    validateSessionDefinition,
    validateSessionOccurrence,
    validateSessionExecution,
    validateSessionEntry,
} from './validation';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const INVALID_CASES_PATH = join(FIXTURES_DIR, 'invalid', 'invalid-cases.json');

describe('Session Validation (M2.1 / ADR-0023)', () => {
    describe('Positive fixture corpus validation', () => {
        const fixtureFiles = readdirSync(FIXTURES_DIR)
            .filter(name => name.endsWith('.json'))
            .sort();

        it('finds at least 7 positive fixtures', () => {
            expect(fixtureFiles.length).toBeGreaterThanOrEqual(7);
        });

        for (const fileName of fixtureFiles) {
            it(`validates positive fixture ${fileName}`, () => {
                const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, fileName), 'utf8'));
                const result = validateSessionDefinition(raw);
                if (!result.ok) {
                    // Help debug issue if any
                    expect(result.issues).toEqual([]);
                }
                expect(result.ok).toBe(true);
                expect(result.value).toBeDefined();
            });
        }
    });

    describe('Invalid case rejection corpus', () => {
        const rawCases = JSON.parse(readFileSync(INVALID_CASES_PATH, 'utf8'));
        const cases = rawCases.cases as Array<{
            name: string;
            expectedIssuePath: string;
            definition: unknown;
        }>;

        it('has a non-empty suite of invalid cases', () => {
            expect(cases.length).toBeGreaterThanOrEqual(10);
        });

        for (const testCase of cases) {
            it(`rejects '${testCase.name}' at expected path '${testCase.expectedIssuePath}'`, () => {
                const result = validateSessionDefinition(testCase.definition);
                expect(result.ok).toBe(false);
                expect(result.issues).toBeDefined();
                const paths = result.issues!.map(i => i.path);
                expect(paths).toContain(testCase.expectedIssuePath);
            });
        }
    });

    describe('SessionOccurrence validation', () => {
        it('accepts a valid occurrence', () => {
            const valid = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'unplanned_log',
                definitionRef: {
                    definitionId: 'def-1',
                    revision: 1,
                    contentHash: 'hash123',
                },
                state: 'scheduled',
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            };
            const result = validateSessionOccurrence(valid);
            expect(result.ok).toBe(true);
        });

        it('rejects invalid authority or date', () => {
            const invalid = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18T10:00:00Z', // UTC ISO string instead of Warsaw date
                authority: 'invalid_authority',
                definitionRef: null,
                state: 'scheduled',
            };
            const result = validateSessionOccurrence(invalid);
            expect(result.ok).toBe(false);
        });

        it('rejects impossible calendar dates and incomplete definition references', () => {
            const result = validateSessionOccurrence({
                userId: 'user-1', occurrenceId: 'occ-1', date: '2026-02-30',
                authority: 'unplanned_log', state: 'scheduled',
                definitionRef: { definitionId: 'def-1', revision: 0, contentHash: '' },
            });
            expect(result.ok).toBe(false);
            if (result.ok) throw new Error('Expected invalid occurrence');
            expect(result.issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['date', 'definitionRef']));
        });
    });

    describe('SessionExecution & SessionEntry validation', () => {
        it('validates execution header', () => {
            const execution = {
                userId: 'user-1',
                executionId: 'exec-1',
                sessionSource: { kind: 'unplanned_fixture', fixtureId: '01' },
                date: '2026-08-18',
                startedAt: '2026-08-18T10:00:00Z',
                state: 'in_progress',
                schemaVersion: 1,
                updatedAt: '2026-08-18T10:00:00Z',
            };
            expect(validateSessionExecution(execution).ok).toBe(true);
        });

        it('validates discriminated entry payload', () => {
            const entry = {
                id: 'entry-1',
                executionId: 'exec-1',
                completedAt: '2026-08-18T10:05:00Z',
                createdAt: '2026-08-18T10:05:00Z',
                updatedAt: '2026-08-18T10:05:00Z',
                payload: {
                    kind: 'repetition',
                    setIndex: 1,
                    reps: 8,
                    weightKg: 60,
                    isWarmup: false,
                },
            };
            expect(validateSessionEntry(entry).ok).toBe(true);
        });

        it('rejects an incomplete source and malformed native payload', () => {
            const execution = validateSessionExecution({
                userId: 'user-1', executionId: 'exec-1', date: '2026-08-18',
                startedAt: '2026-08-18T10:00:00Z', updatedAt: '2026-08-18T10:00:00Z',
                state: 'in_progress', schemaVersion: 1,
                sessionSource: { kind: 'manual', definitionId: 'def-1' },
            });
            expect(execution.ok).toBe(false);

            const entry = validateSessionEntry({
                id: 'entry-1', executionId: 'exec-1', completedAt: '2026-08-18T10:05:00Z',
                createdAt: '2026-08-18T10:05:00Z', updatedAt: '2026-08-18T10:05:00Z',
                payload: { kind: 'repetition', setIndex: 0, reps: 0 },
            });
            expect(entry.ok).toBe(false);
            if (entry.ok) throw new Error('Expected invalid entry');
            expect(entry.issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['payload.setIndex', 'payload.reps']));
        });

        it('validates a recorded athlete choice (D-MCHOICE), with and without a reason', () => {
            const withoutReason = validateSessionEntry({
                id: 'entry-choice-1', executionId: 'exec-1', stepId: 'step-1',
                selectedOptionId: 'opt-1', completedAt: '2026-08-18T10:05:00Z',
                createdAt: '2026-08-18T10:05:00Z', updatedAt: '2026-08-18T10:05:00Z',
                payload: { kind: 'choice', choiceId: 'choice-1', optionId: 'opt-1' },
            });
            expect(withoutReason.ok).toBe(true);

            const withReason = validateSessionEntry({
                id: 'entry-choice-2', executionId: 'exec-1', completedAt: '2026-08-18T10:05:00Z',
                createdAt: '2026-08-18T10:05:00Z', updatedAt: '2026-08-18T10:05:00Z',
                payload: { kind: 'choice', choiceId: 'choice-1', optionId: 'opt-2', reason: 'Warm-up felt heavy' },
            });
            expect(withReason.ok).toBe(true);
        });

        it('rejects a choice payload missing choiceId/optionId or with a non-string reason', () => {
            const missingIds = validateSessionEntry({
                id: 'entry-choice-3', executionId: 'exec-1', completedAt: '2026-08-18T10:05:00Z',
                createdAt: '2026-08-18T10:05:00Z', updatedAt: '2026-08-18T10:05:00Z',
                payload: { kind: 'choice' },
            });
            expect(missingIds.ok).toBe(false);
            if (missingIds.ok) throw new Error('Expected invalid entry');
            expect(missingIds.issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['payload.choiceId', 'payload.optionId']));

            const badReason = validateSessionEntry({
                id: 'entry-choice-4', executionId: 'exec-1', completedAt: '2026-08-18T10:05:00Z',
                createdAt: '2026-08-18T10:05:00Z', updatedAt: '2026-08-18T10:05:00Z',
                payload: { kind: 'choice', choiceId: 'choice-1', optionId: 'opt-1', reason: 42 },
            });
            expect(badReason.ok).toBe(false);
        });
    });
});
