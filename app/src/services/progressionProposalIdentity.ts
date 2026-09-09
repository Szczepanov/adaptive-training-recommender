import type { ProposedProgressionChange } from '../engine/progressionReview';

const SHA256_INITIAL = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

/**
 * Small synchronous SHA-256 used only for bounded content identity. Keeping proposal-id
 * derivation synchronous avoids an easy-to-miss Promise/string mismatch at both the UI and
 * mutation boundary while retaining the repository's 64-hex SHA-256 identity convention.
 */
function sha256Hex(value: string): string {
    const source = new TextEncoder().encode(value);
    const totalLength = Math.ceil((source.length + 9) / 64) * 64;
    const padded = new Uint8Array(totalLength);
    padded.set(source);
    padded[source.length] = 0x80;

    const bitLength = source.length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(totalLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
    view.setUint32(totalLength - 4, bitLength >>> 0, false);

    const hash: number[] = [...SHA256_INITIAL];
    const words = new Uint32Array(64);

    for (let offset = 0; offset < totalLength; offset += 64) {
        for (let index = 0; index < 16; index += 1) {
            words[index] = view.getUint32(offset + index * 4, false);
        }
        for (let index = 16; index < 64; index += 1) {
            const w15 = words[index - 15];
            const w2 = words[index - 2];
            const sigma0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
            const sigma1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
            words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index += 1) {
            const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 = (h + bigSigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
            const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (bigSigma0 + majority) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    return hash.map(word => word.toString(16).padStart(8, '0')).join('');
}

/**
 * Content-addressed logical identity for one reviewed bounded progression change.
 *
 * The canonical payload includes every semantic field in `ProposedProgressionChange`, plus
 * the source block revision and review evidence-as-of date. That prevents two different
 * target bindings or before/after payloads from aliasing the same idempotency key while
 * keeping the Firestore id bounded to 64 hex characters.
 *
 * It is intentionally NOT a full review-evidence hash: a same-day review rerun against the
 * same source revision that produces the same proposed change still has the same id. The
 * remaining immutable D-REPLAY evidence-snapshot gap is documented in
 * `docs/plans/h5c-pr517-review-hardening.md`.
 */
export function deriveProgressionProposalId(
    sourceBlockRevision: number,
    reviewAsOfDate: string,
    change: ProposedProgressionChange,
): string {
    const canonical = JSON.stringify({
        sourceBlockRevision,
        reviewAsOfDate,
        targetBinding: {
            objectiveId: change.targetBinding.objectiveId,
            sessionId: change.targetBinding.sessionId ?? null,
            stepId: change.targetBinding.stepId ?? null,
        },
        variable: change.variable,
        unit: change.unit,
        previousValue: change.previousValue,
        proposedValue: change.proposedValue,
        derivedDoseEffects: { delta: change.derivedDoseEffects.delta },
    });
    return sha256Hex(canonical);
}
