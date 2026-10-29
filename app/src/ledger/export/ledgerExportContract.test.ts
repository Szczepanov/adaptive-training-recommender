import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { SOURCE_KEYS } from './inputs.ts';
import { fullInput } from './ledgerExportFixtures.testSupport.ts';
import { applyGeneratedSchema, defNameOf } from './ledgerExportSchemaGen.testSupport.ts';
import { validateAgainstSchema } from './miniJsonSchema.testSupport.ts';
import {
    DERIVED_METRIC_IDS,
    ENGINE_OPINION_KEYS,
    LEDGER_FLAG_IDS,
    LEDGER_PURPOSES,
    LEDGER_RECORD_FIELD_KEYS,
    LEDGER_STATES,
    type LedgerFlag,
} from './schema.ts';

interface JsonSchema {
    properties: Record<string, unknown>;
    $defs: Record<string, Record<string, unknown>>;
}

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), 'ledgerExport.schema.json');
const readSchema = (): JsonSchema => JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchema;
if (process.env.UPDATE_LEDGER_SCHEMA === '1') {
    writeFileSync(SCHEMA_PATH, `${JSON.stringify(applyGeneratedSchema(readSchema() as never), null, 2)}
`);
}
const SCHEMA = readSchema();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const nameOf = defNameOf;

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

describe('JSON Schema stays in sync with the TypeScript contract (M10)', () => {
    it('equals the schema generated from the field lists (regenerate with UPDATE_LEDGER_SCHEMA=1)', () => {
        expect(SCHEMA).toEqual(applyGeneratedSchema(clone(SCHEMA) as never));
    });

    it('shares the state, purpose, flag, derived and source vocabularies', () => {
        const defs = SCHEMA.$defs;
        expect(defs.state.enum).toEqual([...LEDGER_STATES]);
        expect(SCHEMA.properties.purpose).toEqual({ enum: [...LEDGER_PURPOSES] });
        expect((defs.flag.properties as Record<string, unknown>).id).toEqual({ enum: [...LEDGER_FLAG_IDS] });
        expect((defs.derivedMetric.properties as Record<string, unknown>).id).toEqual({ enum: [...DERIVED_METRIC_IDS] });
        expect((defs.sourceState.properties as Record<string, unknown>).source).toEqual({ enum: [...SOURCE_KEYS] });
        expect(SCHEMA.properties.sources).toMatchObject({ minItems: SOURCE_KEYS.length, maxItems: SOURCE_KEYS.length });
    });

    it.each(Object.entries(LEDGER_RECORD_FIELD_KEYS))('requires exactly the %s field list', (path, keys) => {
        const fields = SCHEMA.$defs[`${nameOf(path)}_fields`];
        expect(fields.required).toEqual([...keys]);
        expect(Object.keys(fields.properties as object)).toEqual([...keys]);
        expect(fields.additionalProperties).toBe(false);
    });

    it('makes every record-bearing layer entry reference its own definition', () => {
        for (const path of Object.keys(LEDGER_RECORD_FIELD_KEYS)) {
            const [layer, name] = path.split('.');
            const entry = (SCHEMA.properties[layer] as { properties: Record<string, unknown> }).properties[name];
            expect(entry, path).toEqual({ $ref: `#/$defs/${nameOf(path)}` });
        }
    });

    it('rejects an export that drops one promised field', () => {
        for (const path of Object.keys(LEDGER_RECORD_FIELD_KEYS)) {
            const broken = clone(buildLedgerExport(fullInput())) as unknown as Record<string, Record<string, unknown>>;
            const [layer, name] = path.split('.');
            const target = broken[layer][name] as { items?: { fields: Record<string, unknown> }[]; fields?: Record<string, unknown> };
            const fields = target.items ? target.items[0].fields : target.fields!;
            delete fields[Object.keys(fields)[0]];
            expect(validateAgainstSchema(SCHEMA, broken).join('\n'), path).toContain('missing required');
        }
    });

    it('rejects a measured value that is null and a missing source key', () => {
        const output = clone(buildLedgerExport(fullInput()));
        output.facts.recovery.items[0].fields.sleepScore = { value: null, source: 'garmin', state: 'measured' };
        expect(validateAgainstSchema(SCHEMA, output).join('\n')).toContain('matches a forbidden schema');
        const fewer = clone(buildLedgerExport(fullInput()));
        fewer.sources.pop();
        expect(validateAgainstSchema(SCHEMA, fewer).join('\n')).toContain('fewer than');
    });

    it('requires activity truncation accounting and droppedUndated', () => {
        const output = clone(buildLedgerExport(fullInput())) as unknown as Record<string, Record<string, Record<string, unknown>>>;
        delete output.facts.activities.truncated;
        delete output.facts.recovery.droppedUndated;
        const errors = validateAgainstSchema(SCHEMA, output).join('\n');
        expect(errors).toContain('missing required "truncated"');
        expect(errors).toContain('missing required "droppedUndated"');
    });
});

describe('ledger export contract', () => {
    const output = buildLedgerExport(fullInput());

    it.each(LEDGER_PURPOSES.map(purpose => [purpose]))('validates against the JSON Schema (%s)', purpose => {
        const result = buildLedgerExport(fullInput({ purpose }));
        expect(validateAgainstSchema(SCHEMA, clone(result))).toEqual([]);
    });

    it('validates an export built from no records and one with the legacy layer', () => {
        for (const input of [fullInput({ records: {} }), fullInput({ legacyEngine: { policyVersion: '9' } })]) {
            expect(validateAgainstSchema(SCHEMA, clone(buildLedgerExport(input)))).toEqual([]);
        }
    });

    it('reports exactly the declared source keys, once each', () => {
        expect(output.sources.map(source => source.source)).toEqual([...SOURCE_KEYS]);
    });

    it('rejects documents that break the contract (the validator is not vacuous)', () => {
        const broken = clone(output) as unknown as Record<string, unknown>;
        (broken.facts as { recovery: { items: { fields: { sleepScore: { state: string } } }[] } }).recovery.items[0].fields.sleepScore.state = 'fine';
        delete (broken.userContext as Record<string, unknown>).travel;
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
            if (value.state === 'not_yet_supported' || value.state === 'invalid') expect(value.value, path).toBeNull();
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
        expect(injury.since).toEqual({ value: null, source: 'athlete', state: 'not_recorded' });
        for (const item of output.userContext.goals.items) {
            expect(item.since.state).toBe('not_yet_supported');
            expect(item.revisions.state).toBe('not_yet_supported');
        }
        expect(output.coachingHistory.placements.items.every(item => item.fields.statusHistory.state === 'not_yet_supported')).toBe(true);
        // A record-level updatedAt must never surface as an effective date.
        expect(JSON.stringify(output.userContext)).not.toContain('2026-11-10T00:00:00Z');
    });

    it('lets persisted flag dates, session refs, versions and unevaluable states survive unchanged', () => {
        const flag: LedgerFlag = {
            id: 'illness_risk_symptom',
            observedOn: '2026-11-17',
            evaluatedAt: '2026-11-17T04:30:00Z',
            definitionVersion: 'symptom-screen@2',
            sessionRef: 'session-3',
            active: null,
            state: 'unavailable',
            inputs: [],
            threshold: 'any red-flag symptom',
        };
        const result = buildLedgerExport(fullInput({ flagEvaluations: [flag] }));
        expect(validateAgainstSchema(SCHEMA, clone(result))).toEqual([]);
        expect(result.flags.find(candidate => candidate.id === flag.id && candidate.observedOn === flag.observedOn)).toEqual(flag);
    });
});
