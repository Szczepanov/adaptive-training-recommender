import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    validateSessionDefinition,
    validateSessionOccurrence,
    validateSessionExecution,
    validateSessionEntry,
    validateSessionRestEvent,
} from './validation';
import { isManualOccurrence, isExternalPlanOccurrence, type SessionOccurrence } from './models';

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

        it('accepts valid external_plan occurrence with externalPlanRef and authority', () => {
            const valid = {
                userId: 'user-1',
                occurrenceId: 'occ-ext-1',
                date: '2026-08-18',
                authority: 'external_plan',
                externalPlanRef: {
                    planId: 'plan-1',
                    revision: 1,
                    sessionId: 'session-1',
                    contentHash: 'a'.repeat(64),
                },
                state: 'scheduled',
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            };
            const result = validateSessionOccurrence(valid);
            expect(result.ok).toBe(true);
        });

        it('accepts occurrence with skipped state', () => {
            const valid = {
                userId: 'user-1',
                occurrenceId: 'occ-ext-1',
                date: '2026-08-18',
                authority: 'external_plan',
                externalPlanRef: {
                    planId: 'plan-1',
                    revision: 1,
                    sessionId: 'session-1',
                    contentHash: 'a'.repeat(64),
                },
                state: 'skipped',
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            };
            const result = validateSessionOccurrence(valid);
            expect(result.ok).toBe(true);
        });

        it('rejects occurrence when neither or both definitionRef and externalPlanRef are provided', () => {
            const neither = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'schedule',
                state: 'scheduled',
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            };
            expect(validateSessionOccurrence(neither).ok).toBe(false);

            const both = {
                ...neither,
                definitionRef: { definitionId: 'def-1', revision: 1, contentHash: 'a'.repeat(64) },
                externalPlanRef: { planId: 'plan-1', revision: 1, sessionId: 's-1', contentHash: 'b'.repeat(64) },
            };
            expect(validateSessionOccurrence(both).ok).toBe(false);
        });

        it('rejects invalid externalPlanRef fields', () => {
            const result = validateSessionOccurrence({
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'external_plan',
                state: 'scheduled',
                externalPlanRef: { planId: '', revision: 0, sessionId: '', contentHash: '' },
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            });
            expect(result.ok).toBe(false);
            if (result.ok) throw new Error('Expected invalid occurrence');
            expect(result.issues.map(issue => issue.path)).toContain('externalPlanRef');
        });

        it('rejects null definitionRef or externalPlanRef', () => {
            const nullDef = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'schedule',
                state: 'scheduled',
                definitionRef: null,
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            };
            expect(validateSessionOccurrence(nullDef).ok).toBe(false);

            const nullExt = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'external_plan',
                state: 'scheduled',
                externalPlanRef: null,
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            };
            expect(validateSessionOccurrence(nullExt).ok).toBe(false);
        });

        it('enforces authority and reference pairing', () => {
            // externalPlanRef with non-external_plan authority is rejected
            const extWithReplace = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'replace_recommendation',
                state: 'scheduled',
                externalPlanRef: { planId: 'p-1', revision: 1, sessionId: 's-1', contentHash: 'c'.repeat(64) },
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            };
            const res1 = validateSessionOccurrence(extWithReplace);
            expect(res1.ok).toBe(false);
            if (!res1.ok) {
                expect(res1.issues.map(i => i.path)).toContain('authority');
            }

            // definitionRef with external_plan authority is rejected
            const defWithExtPlan = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'external_plan',
                state: 'scheduled',
                definitionRef: { definitionId: 'def-1', revision: 1, contentHash: 'c'.repeat(64) },
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            };
            const res2 = validateSessionOccurrence(defWithExtPlan);
            expect(res2.ok).toBe(false);
            if (!res2.ok) {
                expect(res2.issues.map(i => i.path)).toContain('authority');
            }
        });

        it('isManualOccurrence and isExternalPlanOccurrence type guards reject null references', () => {
            const malformedDef = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'schedule' as const,
                state: 'scheduled' as const,
                definitionRef: null,
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            } as unknown as SessionOccurrence;
            expect(isManualOccurrence(malformedDef)).toBe(false);

            const malformedExt = {
                userId: 'user-1',
                occurrenceId: 'occ-1',
                date: '2026-08-18',
                authority: 'external_plan' as const,
                state: 'scheduled' as const,
                externalPlanRef: null,
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
            } as unknown as SessionOccurrence;
            expect(isExternalPlanOccurrence(malformedExt)).toBe(false);
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

describe('validateSessionRestEvent (PR 3, training-occurrence plan)', () => {
    function validRestEvent(overrides: Record<string, unknown> = {}) {
        return {
            id: 'rest-1',
            executionId: 'exec-1',
            afterEntryId: 'entry-1',
            prescribedSeconds: 90,
            startedAt: '2026-08-18T10:05:00Z',
            endedAt: '2026-08-18T10:06:30Z',
            actualSeconds: 90,
            endReason: 'timer_elapsed',
            createdAt: '2026-08-18T10:06:30Z',
            updatedAt: '2026-08-18T10:06:30Z',
            ...overrides,
        };
    }

    it('accepts a valid rest event, with or without optional prescribedSeconds/adjustmentSeconds', () => {
        expect(validateSessionRestEvent(validRestEvent()).ok).toBe(true);
        expect(validateSessionRestEvent({
            id: 'rest-1', executionId: 'exec-1', afterEntryId: 'entry-1',
            startedAt: '2026-08-18T10:05:00Z', endedAt: '2026-08-18T10:06:30Z',
            actualSeconds: 90, endReason: 'timer_elapsed',
            createdAt: '2026-08-18T10:06:30Z', updatedAt: '2026-08-18T10:06:30Z',
        }).ok).toBe(true);
        expect(validateSessionRestEvent(validRestEvent({ adjustmentSeconds: 30 })).ok).toBe(true);
    });

    it.each(['timer_elapsed', 'skipped', 'next_set_started', 'session_ended'])('accepts endReason %s', (endReason) => {
        expect(validateSessionRestEvent(validRestEvent({ endReason })).ok).toBe(true);
    });

    it('rejects an unknown endReason', () => {
        expect(validateSessionRestEvent(validRestEvent({ endReason: 'made_up' })).ok).toBe(false);
    });

    it('rejects a negative actualSeconds', () => {
        expect(validateSessionRestEvent(validRestEvent({ actualSeconds: -1 })).ok).toBe(false);
    });

    it('rejects a missing afterEntryId', () => {
        expect(validateSessionRestEvent({
            id: 'rest-1', executionId: 'exec-1',
            startedAt: '2026-08-18T10:05:00Z', endedAt: '2026-08-18T10:06:30Z',
            actualSeconds: 90, endReason: 'timer_elapsed',
            createdAt: '2026-08-18T10:06:30Z', updatedAt: '2026-08-18T10:06:30Z',
        }).ok).toBe(false);
    });

    it('rejects a non-finite adjustmentSeconds', () => {
        expect(validateSessionRestEvent(validRestEvent({ adjustmentSeconds: Number.NaN })).ok).toBe(false);
    });
});
