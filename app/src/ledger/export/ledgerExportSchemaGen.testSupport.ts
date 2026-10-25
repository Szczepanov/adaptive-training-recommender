/**
 * Derives the generated parts of `ledgerExport.schema.json` (per-collection definitions, the
 * vocabularies and the source-key pin) from the TypeScript field lists, so a field change
 * never needs hand-editing the JSON. The sync test compares the checked-in file against this
 * output; regenerate with `UPDATE_LEDGER_SCHEMA=1 npx vitest run src/ledger/export/ledgerExportContract`.
 */
import { SOURCE_KEYS } from './inputs.ts';
import {
    DERIVED_METRIC_IDS,
    LEDGER_FLAG_IDS,
    LEDGER_PURPOSES,
    LEDGER_RECORD_FIELD_KEYS,
    LEDGER_STATES,
} from './schema.ts';

type Json = Record<string, unknown>;

/** Context records that are single objects rather than collections. */
const SINGLETONS: ReadonlySet<string> = new Set([
    'userContext.equipment', 'userContext.environment', 'userContext.guardrails', 'userContext.preferences',
]);
/** Definitions written by hand in the base file; everything else is generated. */
const HAND_WRITTEN = ['date', 'state', 'ledgerValue', 'sourceState', 'derivedMetric', 'flag'];

const ref = (name: string): Json => ({ $ref: `#/$defs/${name}` });
export const defNameOf = (path: string): string => path.replaceAll('.', '_');

function itemDefinition(path: string): Json {
    const isContext = path.startsWith('userContext.');
    return {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'observedOn', 'fields', ...(isContext ? ['since', 'revisions'] : [])],
        properties: {
            id: { type: 'string' },
            observedOn: { type: ['string', 'null'] },
            fields: ref(`${defNameOf(path)}_fields`),
            ...(isContext ? { since: ref('ledgerValue'), revisions: ref('ledgerValue') } : {}),
        },
    };
}

function collectionDefinition(path: string): Json {
    const extra = path === 'facts.activities' ? ['truncated', 'totalInWindow'] : [];
    return {
        type: 'object',
        additionalProperties: false,
        required: ['state', 'source', 'items', 'droppedUndated', ...extra],
        properties: {
            state: ref('state'),
            source: { type: 'string' },
            items: { type: 'array', items: itemDefinition(path) },
            droppedUndated: { type: 'integer', minimum: 0 },
            ...(extra.length > 0 ? { truncated: { type: 'boolean' }, totalInWindow: { type: 'integer', minimum: 0 } } : {}),
        },
    };
}

function fieldsDefinition(keys: readonly string[]): Json {
    return {
        type: 'object',
        additionalProperties: false,
        required: [...keys],
        properties: Object.fromEntries(keys.map(key => [key, ref('ledgerValue')])),
    };
}

/** Returns `base` with every generated section rewritten from the TypeScript contract. */
export function applyGeneratedSchema(base: Json): Json {
    const doc = structuredClone(base) as Json & { $defs: Json; properties: Json };
    const defs: Json = Object.fromEntries(Object.entries(doc.$defs).filter(([name]) => HAND_WRITTEN.includes(name)));
    for (const [path, keys] of Object.entries(LEDGER_RECORD_FIELD_KEYS)) {
        defs[`${defNameOf(path)}_fields`] = fieldsDefinition(keys);
        defs[defNameOf(path)] = SINGLETONS.has(path) ? itemDefinition(path) : collectionDefinition(path);
    }
    for (const layer of ['facts', 'userContext', 'coachingHistory']) {
        const layerSchema = doc.properties[layer] as { properties: Json };
        for (const name of Object.keys(layerSchema.properties)) {
            const path = `${layer}.${name}`;
            if (LEDGER_RECORD_FIELD_KEYS[path]) layerSchema.properties[name] = ref(defNameOf(path));
        }
    }
    defs.state = { enum: [...LEDGER_STATES] };
    (defs.sourceState as { properties: Json }).properties.source = { enum: [...SOURCE_KEYS] };
    (defs.derivedMetric as { properties: Json }).properties.id = { enum: [...DERIVED_METRIC_IDS] };
    (defs.flag as { properties: Json }).properties.id = { enum: [...LEDGER_FLAG_IDS] };
    doc.properties.purpose = { enum: [...LEDGER_PURPOSES] };
    doc.properties.sources = {
        type: 'array',
        minItems: SOURCE_KEYS.length,
        maxItems: SOURCE_KEYS.length,
        items: ref('sourceState'),
    };
    (doc.properties.derived as Json).minItems = DERIVED_METRIC_IDS.length;
    (doc.properties.flags as Json).minItems = LEDGER_FLAG_IDS.length;
    doc.$defs = defs;
    return doc;
}
