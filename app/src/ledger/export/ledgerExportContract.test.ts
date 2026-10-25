import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { fullInput, fullRecords } from './ledgerExportFixtures.testSupport.ts';
import { validateAgainstSchema } from './miniJsonSchema.testSupport.ts';
import { ENGINE_OPINION_KEYS, LEDGER_FLAG_IDS, LEDGER_PURPOSES, LEDGER_STATES } from './schema.ts';

const SCHEMA = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ledgerExport.schema.json'), 'utf8'),
) as { $defs: { state: { enum: string[] }; flag: { properties: { id: { enum: string[] } } } } };

/** Every LedgerValue-shaped object (has value, source and state) anywhere under `node`. */
function ledgerValues(node: unknown, path = '$'): { path: string; value: Record<string, unknown> }[] {
    if (Array.isArray(node)) return node.flatMap((item, i) => ledgerValues(item, `${path}[${i}]`));
    if (node === null || typeof node !== 'object') return [];
    const candidate = node as Record<string, unknown>;
    const self = 'state' in candidate && 'source' in candidate && 'value' in candidate ? [{ path, value: candidate }] : [];
    return [...self, ...Object.entries(candidate).flatMap(([key, nested]) => ledgerValues(nested, `${path}.${key}`))];
}

function keysOutsideLegacy(node: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(node)) node.forEach(item => keysOutsideLegacy(item, found));
    else if (node && typeof node === 'object') {
        for (const [key, nested] of Object.entries(node)) {
            found.add(key);
            if (key !== 'legacyEngine') keysOutsideLegacy(nested, found);
        }
    }
    return found;
}

describe('ledger export contract', () => {
    const output = buildLedgerExport(fullInput());

    it('keeps the checked-in schema vocabularies equal to the TypeScript ones', () => {
        expect(SCHEMA.$defs.state.enum).toEqual([...LEDGER_STATES]);
        expect(SCHEMA.$defs.flag.properties.id.enum).toEqual([...LEDGER_FLAG_IDS]);
    });

    it.each(LEDGER_PURPOSES.map(purpose => [purpose]))('validates against the JSON Schema (%s)', purpose => {
        const result = buildLedgerExport(fullInput({ purpose }));
        expect(validateAgainstSchema(SCHEMA, JSON.parse(JSON.stringify(result)))).toEqual([]);
    });

    it('validates an export built from no records and one with the legacy layer', () => {
        for (const input of [fullInput({ records: {} }), fullInput({ legacyEngine: { policyVersion: '9' } })]) {
            expect(validateAgainstSchema(SCHEMA, JSON.parse(JSON.stringify(buildLedgerExport(input))))).toEqual([]);
        }
    });

    it('rejects documents that break the contract (the validator is not vacuous)', () => {
        const broken = JSON.parse(JSON.stringify(output));
        broken.facts.recovery.items[0].fields.sleepScore.state = 'fine';
        delete broken.userContext.travel;
        broken.userId = 'x';
        const errors = validateAgainstSchema(SCHEMA, broken).join('\n');
        expect(errors).toContain('not in enum');
        expect(errors).toContain('missing required "travel"');
        expect(errors).toContain('unexpected "userId"');
    });

    it('gives every fact a source and a state, and a value whenever it is measured', () => {
        const values = ledgerValues(output);
        expect(values.length).toBeGreaterThan(100);
        for (const { path, value } of values) {
            expect(typeof value.source, path).toBe('string');
            expect((value.source as string).length, path).toBeGreaterThan(0);
            expect(LEDGER_STATES, path).toContain(value.state);
            if (value.state === 'measured') expect(value.value, path).not.toBeNull();
            if (value.state === 'not_yet_supported') expect(value.value, path).toBeNull();
        }
    });

    it('keeps engine-opinion keys out of everything except legacyEngine', () => {
        const withLegacy = buildLedgerExport(fullInput({
            legacyEngine: { policyVersion: '1', planAuthority: { phase: 'build' }, recommendation: 'rest' },
        }));
        const keys = keysOutsideLegacy(withLegacy);
        expect(ENGINE_OPINION_KEYS.filter(key => keys.has(key))).toEqual([]);
        expect(withLegacy.legacyEngine).toHaveProperty('policyVersion', '1');
        expect(output.legacyEngine).toBeNull();
    });

    it('keeps unsupported effective dates and placement histories explicit, not inferred', () => {
        const [injury] = output.userContext.injuries.items;
        expect(injury.since).toEqual({ value: null, source: 'ledger', state: 'not_yet_supported' });
        for (const item of output.userContext.goals.items) {
            expect(item.since.state).toBe('not_yet_supported');
            expect(item.revisions.state).toBe('not_yet_supported');
        }
        expect(output.coachingHistory.placements.items.every(item => item.fields.statusHistory.state === 'not_yet_supported')).toBe(true);
        // A record-level updatedAt must never surface as an effective date.
        expect(JSON.stringify(output.userContext)).not.toContain('2026-11-10T00:00:00Z');
    });

    it('lists the four closed-set flags exactly once each, unevaluated, with their evaluation date', () => {
        expect(output.flags.map(flag => flag.id)).toEqual([...LEDGER_FLAG_IDS]);
        for (const flag of output.flags) {
            expect(flag).toMatchObject({
                observedOn: '2026-11-20',
                evaluatedAt: null,
                definitionVersion: null,
                active: null,
                state: 'not_yet_supported',
                inputs: [],
            });
        }
    });

    it('keeps the planning export bounded to the information it promises', () => {
        const records = fullRecords();
        const result = buildLedgerExport(fullInput({ records }));
        expect(result.window.days).toBe(14);
        expect(result.facts.activities.items.length).toBeLessThanOrEqual(12);
    });
});
