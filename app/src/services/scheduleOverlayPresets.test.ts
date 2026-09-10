import { describe, expect, it } from 'vitest';
import { validateScheduleOverlay } from '../engine/validation';
import { SCHEDULE_OVERLAY_PRESETS } from './scheduleOverlayPresets';

describe('SCHEDULE_OVERLAY_PRESETS', () => {
    it('contains a non-empty collection of presets with unique IDs', () => {
        expect(SCHEDULE_OVERLAY_PRESETS.length).toBeGreaterThan(0);
        const ids = SCHEDULE_OVERLAY_PRESETS.map((preset) => preset.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    it('omits equipment field from all presets by design contract', () => {
        for (const preset of SCHEDULE_OVERLAY_PRESETS) {
            expect((preset as unknown as Record<string, unknown>).equipment).toBeUndefined();
        }
    });

    it('has valid structure and numerical boundaries on all presets', () => {
        const validEnvironments = ['indoor', 'outdoor', 'either'];
        const costAxes = ['systemic', 'cardiovascular', 'lowerBody', 'upperBody', 'impactTissue', 'neuromuscular'] as const;

        for (const preset of SCHEDULE_OVERLAY_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(preset.title).toBeTruthy();
            expect(preset.label).toBeTruthy();
            expect(preset.description).toBeTruthy();
            expect(preset.icon).toBeTruthy();
            expect(preset.category).toBeTruthy();

            expect(preset.dailyAvailabilityMinutes).toBeGreaterThanOrEqual(0);
            expect(preset.dailyAvailabilityMinutes).toBeLessThanOrEqual(1440);

            expect(preset.volumeScale).toBeGreaterThanOrEqual(0);
            expect(preset.volumeScale).toBeLessThanOrEqual(1);

            expect(preset.intensityScale).toBeGreaterThanOrEqual(0);
            expect(preset.intensityScale).toBeLessThanOrEqual(1);

            for (const axis of costAxes) {
                const val = preset.expectedCost[axis];
                expect(typeof val).toBe('number');
                expect(val).toBeGreaterThanOrEqual(0);
                expect(val).toBeLessThanOrEqual(1);
            }

            if (preset.environment !== undefined) {
                expect(validEnvironments).toContain(preset.environment);
            }

            if (preset.sport !== undefined) {
                expect(typeof preset.sport).toBe('string');
                expect(preset.sport.length).toBeGreaterThan(0);
            }
        }
    });

    it('passes schema validation for all presets when applied to a schedule overlay payload', () => {
        for (const preset of SCHEDULE_OVERLAY_PRESETS) {
            const overlayPayload = {
                ...preset,
                userId: 'test-user-123',
                startDate: '2026-06-01',
                endDate: '2026-06-07',
            };

            const result = validateScheduleOverlay(overlayPayload);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.data?.id).toBe(preset.id);
            expect(result.data?.category).toBe(preset.category);
        }
    });
});
