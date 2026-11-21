/** 32-bit FNV-1a over UTF-16 code units, 8 hex chars. Deterministic and browser-safe; not cryptographic. */
export function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
