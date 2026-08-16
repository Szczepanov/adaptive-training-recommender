import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHADOW_VERDICTS, type ShadowVerdict } from './models';
import { validateDecisionJournalEntry } from './validation';
import { parseDecisionJournalEntry } from '../persistence/parsers/decisionInputs';

const USER_ID = 'athlete-1';
const DATE = '2026-08-16';

function validEntry() {
    return {
        userId: USER_ID,
        date: DATE,
        externalVerdict: 'proceed' as ShadowVerdict,
        sawEngineVerdictFirst: false,
        createdAt: '2026-08-16T06:00:00Z',
        updatedAt: '2026-08-16T06:00:00Z',
        schemaVersion: 1,
    };
}

describe('SHADOW_VERDICTS mirrors ExternalSessionDecision (Phase 9.0.2)', () => {
    it('is deliberately the same five values, read from externalSession.ts rather than imported', () => {
        // 9.0.2: "ShadowVerdict deliberately reuses ExternalSessionDecision's exact five
        // values." Duplicated rather than imported so the journal's evidence-only types
        // carry no dependency on the adjudication path -- read from source instead, so the
        // two cannot silently diverge.
        const source = readFileSync(join(import.meta.dirname, 'externalSession.ts'), 'utf8');
        const match = source.match(/ExternalSessionDecision\s*=\s*(('[^']+'\s*\|?\s*)+);/);
        expect(match, 'ExternalSessionDecision union not found in externalSession.ts').not.toBeNull();
        const values = [...match![1].matchAll(/'([^']+)'/g)].map(m => m[1]);
        expect(values).toEqual([...SHADOW_VERDICTS]);
    });
});

describe('validateDecisionJournalEntry', () => {
    it('accepts a well-formed morning-only entry', () => {
        const result = validateDecisionJournalEntry(validEntry());
        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validEntry());
    });

    it('accepts an entry with an optional externalNote and actualVerdict', () => {
        const result = validateDecisionJournalEntry({
            ...validEntry(), externalNote: 'AI said take it easy', actualVerdict: 'scale',
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.externalNote).toBe('AI said take it easy');
        expect(result.data?.actualVerdict).toBe('scale');
    });

    it('rejects a missing userId or date', () => {
        const withoutUserId: Record<string, unknown> = validEntry();
        delete withoutUserId.userId;
        expect(validateDecisionJournalEntry(withoutUserId).isValid).toBe(false);

        expect(validateDecisionJournalEntry({ ...validEntry(), date: '08/16/2026' }).isValid).toBe(false);
    });

    it.each(SHADOW_VERDICTS)('accepts every ShadowVerdict value (%s) for externalVerdict', verdict => {
        expect(validateDecisionJournalEntry({ ...validEntry(), externalVerdict: verdict }).isValid).toBe(true);
    });

    it('rejects an unrecognized externalVerdict or actualVerdict', () => {
        expect(validateDecisionJournalEntry({ ...validEntry(), externalVerdict: 'maybe' }).isValid).toBe(false);
        expect(validateDecisionJournalEntry({ ...validEntry(), actualVerdict: 'maybe' }).isValid).toBe(false);
    });

    it('rejects a missing sawEngineVerdictFirst', () => {
        const withoutFlag: Record<string, unknown> = validEntry();
        delete withoutFlag.sawEngineVerdictFirst;
        expect(validateDecisionJournalEntry(withoutFlag).isValid).toBe(false);
    });

    it('rejects an unrecognized field -- closed key set, this is evidence not a free-form document', () => {
        const result = validateDecisionJournalEntry({ ...validEntry(), surprise: true });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('surprise'))).toBe(true);
    });

    it('rejects a non-object input', () => {
        expect(validateDecisionJournalEntry(null).isValid).toBe(false);
        expect(validateDecisionJournalEntry('not-an-object').isValid).toBe(false);
    });
});

describe('parseDecisionJournalEntry', () => {
    const documentPath = `users/${USER_ID}/decision_journal/${DATE}`;

    it('accepts a well-formed persisted record', () => {
        const state = parseDecisionJournalEntry(validEntry(), documentPath, USER_ID, DATE);
        expect(state.status).toBe('AVAILABLE');
    });

    it('flags a userId that disagrees with the read path rather than trusting the document body', () => {
        const state = parseDecisionJournalEntry({ ...validEntry(), userId: 'someone-else' }, documentPath, USER_ID, DATE);
        expect(state.status).toBe('INVALID');
    });

    it('flags a date that disagrees with the read path', () => {
        const state = parseDecisionJournalEntry(validEntry(), documentPath, USER_ID, '2026-08-17');
        expect(state.status).toBe('INVALID');
    });

    it('flags an unrecognized externalVerdict rather than coercing it', () => {
        const state = parseDecisionJournalEntry({ ...validEntry(), externalVerdict: 'maybe' }, documentPath, USER_ID, DATE);
        expect(state.status).toBe('INVALID');
    });

    it('flags a non-object payload', () => {
        expect(parseDecisionJournalEntry(null, documentPath, USER_ID, DATE).status).toBe('INVALID');
    });
});
