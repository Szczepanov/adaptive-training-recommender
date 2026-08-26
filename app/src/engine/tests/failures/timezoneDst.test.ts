import { describe, it, expect } from 'vitest';
import { getPreviousLocalDateString, addDaysToLocalDateString } from '../../../utils/localDate';

describe('Europe/Warsaw calendar arithmetic across DST', () => {
    it('reliably maintains Europe/Warsaw local calendar date arithmetic across DST transitions', () => {
        const dstFallDate = '2026-10-25'; // Fall DST transition date
        const nextDay = addDaysToLocalDateString(dstFallDate, 1);
        const prevDay = getPreviousLocalDateString(dstFallDate);

        expect(nextDay).toBe('2026-10-26');
        expect(prevDay).toBe('2026-10-24');
    });

    it('ensures discrete day string mapping does not suffer from UTC offset drift', () => {
        const d1 = addDaysToLocalDateString('2026-08-26', -1);
        expect(d1).toBe('2026-08-25');
    });
});
