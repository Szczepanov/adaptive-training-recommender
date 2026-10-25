/**
 * Minimal JSON Schema subset validator for the contract tests (no validator dependency is
 * installed). Supports exactly the keywords `ledgerExport.schema.json` uses: $ref into
 * `#/$defs`, type (single or list), const, enum, required, properties, additionalProperties
 * (boolean or schema), items, pattern, minimum. An unknown keyword fails loudly so the schema
 * cannot silently outgrow this checker.
 */
type Json = unknown;
type Schema = { [key: string]: Json };

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs']);
const SUPPORTED = new Set([
    '$ref', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items',
    'pattern', 'minimum',
]);

function typeOf(value: Json): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
    return expected === actual || (expected === 'number' && actual === 'integer');
}

function resolveRef(root: Schema, ref: string): Schema {
    const prefix = '#/$defs/';
    if (!ref.startsWith(prefix)) throw new Error(`Unsupported $ref ${ref}`);
    const target = (root.$defs as Schema)[ref.slice(prefix.length)];
    if (!target) throw new Error(`Unresolvable $ref ${ref}`);
    return target as Schema;
}

function checkObject(root: Schema, schema: Schema, value: Schema, path: string): string[] {
    const errors: string[] = [];
    const properties = (schema.properties ?? {}) as Schema;
    for (const key of (schema.required ?? []) as string[]) {
        if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    }
    for (const [key, nested] of Object.entries(value)) {
        const own = properties[key];
        if (own) errors.push(...check(root, own as Schema, nested, `${path}.${key}`));
        else if (schema.additionalProperties === false) errors.push(`${path}: unexpected "${key}"`);
        else if (typeof schema.additionalProperties === 'object') {
            errors.push(...check(root, schema.additionalProperties as Schema, nested, `${path}.${key}`));
        }
    }
    return errors;
}

function checkScalarKeywords(schema: Schema, value: Json, path: string): string[] {
    const errors: string[] = [];
    if ('const' in schema && schema.const !== value) errors.push(`${path}: expected const ${String(schema.const)}`);
    if (schema.enum && !(schema.enum as Json[]).includes(value)) errors.push(`${path}: "${String(value)}" not in enum`);
    if (typeof schema.pattern === 'string' && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${path}: does not match ${schema.pattern}`);
    }
    if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
        errors.push(`${path}: below minimum ${schema.minimum}`);
    }
    return errors;
}

function check(root: Schema, schema: Schema, value: Json, path: string): string[] {
    for (const keyword of Object.keys(schema)) {
        if (!SUPPORTED.has(keyword) && !ANNOTATIONS.has(keyword)) throw new Error(`Unsupported keyword "${keyword}"`);
    }
    if (typeof schema.$ref === 'string') return check(root, resolveRef(root, schema.$ref), value, path);
    if (schema.type !== undefined) {
        const expected = ([] as string[]).concat(schema.type as string | string[]);
        const actual = typeOf(value);
        if (!expected.some(candidate => typeMatches(candidate, actual))) {
            return [`${path}: expected ${expected.join('|')}, got ${actual}`];
        }
    }
    const errors = checkScalarKeywords(schema, value, path);
    if (Array.isArray(value) && schema.items) {
        value.forEach((item, index) => errors.push(...check(root, schema.items as Schema, item, `${path}[${index}]`)));
    }
    if (typeOf(value) === 'object') errors.push(...checkObject(root, schema, value as Schema, path));
    return errors;
}

/** Returns validation errors; an empty array means the value conforms. */
export function validateAgainstSchema(schema: object, value: unknown): string[] {
    return check(schema as Schema, schema as Schema, value, '$');
}
