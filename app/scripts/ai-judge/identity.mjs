import { createHash } from 'node:crypto';

function normalizeForCanonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : normalizeForCanonicalJson(item));
  }

  if (value && typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) normalized[key] = normalizeForCanonicalJson(item);
    }
    return normalized;
  }

  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

/** Stable JSON for plain judge artifacts. Object keys are recursively sorted while array
 * order remains semantic; undefined/non-finite values follow JSON.stringify-compatible
 * object/array/null behavior. */
export function canonicalJsonStringify(value) {
  const serialized = JSON.stringify(normalizeForCanonicalJson(value));
  if (serialized === undefined) {
    throw new Error('Cannot compute a canonical JSON identity for an undefined root value.');
  }
  return serialized;
}

export function sha256CanonicalJson(value) {
  return createHash('sha256').update(canonicalJsonStringify(value)).digest('hex');
}
