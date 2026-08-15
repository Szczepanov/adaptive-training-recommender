import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from './event-plan';

/**
 * Frozen serialization of the ADR-0016 / macrocycle-v5 September cycling coverage
 * contract as it existed when the generic coverage registry was introduced.
 *
 * Do not update this digest as routine snapshot maintenance. A deliberate change to the
 * authored event-directed contract requires an explicit ADR/contract amendment and review.
 */
const SEPTEMBER_CYCLING_EVENT_COVERAGE_SHA256 = 'cf5d082175c20ae831db0f753a911b2e70661cbc0a5950cac90597e571be8852';

describe('September cycling event coverage contract', () => {
    it('remains byte-for-byte frozen unless the governing ADR/contract is deliberately amended', () => {
        const serialized = JSON.stringify(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE);
        const digest = createHash('sha256').update(serialized, 'utf8').digest('hex');

        expect(
            digest,
            'SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE is a frozen event-directed contract. A deliberate change requires an ADR/macrocycle contract amendment; do not refresh this digest as routine snapshot maintenance.',
        ).toBe(SEPTEMBER_CYCLING_EVENT_COVERAGE_SHA256);
        expect(SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE).toHaveLength(18);
    });
});
