import { describe, expect, it } from 'vitest';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';
import type { UserEvent } from './models';
import { evaluatePeriodizationPhase } from './periodization';

const CYCLING_DEMAND = {
    aerobicEndurance: 0.9,
    thresholdPower: 0.8,
    vo2MaxPower: 0.6,
    repeatedSurges: 0.6,
    sprintPower: 0.3,
    fatigueResistance: 0.9,
    neuromuscular: 0.3,
};

const A_EVENT: UserEvent = {
    id: 'a-race',
    title: 'A race',
    date: '2026-09-14',
    priority: 'A',
    lifecycle: 'scheduled',
    category: 'cycling_event',
    demandProfile: CYCLING_DEMAND,
    taper: { startDate: '2026-09-01' },
};

describe('periodization ↔ sports-knowledge taper contract', () => {
    it('preserves intensity throughout taper and keeps the registered 0.6 volume endpoint', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.taperWindowsVolumePolicy);
        expect(claim.statement).toContain('intensityScale remains 1.0');
        expect(claim.statement).toContain('volumeScale falls linearly toward 0.6');

        const fiveDaysOut = evaluatePeriodizationPhase([A_EVENT], '2026-09-09');
        expect(fiveDaysOut.phase.phaseName).toBe('Peak/Taper');
        expect(fiveDaysOut.phase.taperActive).toBe(true);
        expect(fiveDaysOut.phase.intensityScale).toBe(1);
        expect(fiveDaysOut.phase.volumeScale).toBeLessThan(1);
        expect(fiveDaysOut.phase.volumeScale).toBeGreaterThan(0.6);

        const eventDay = evaluatePeriodizationPhase([A_EVENT], '2026-09-14');
        expect(eventDay.phase.phaseName).toBe('Peak/Taper');
        expect(eventDay.phase.intensityScale).toBe(1);
        expect(eventDay.phase.volumeScale).toBeCloseTo(0.6, 8);
    });
});
