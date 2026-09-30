import { describe, expect, it } from 'vitest';
import { ASSESSMENT_REDUCER_VERSION_V1 } from './assessmentCapture';
import { buildTestingSessionDefinition } from './testingWorkflow';
import { getPerformanceTestDefinition } from './performanceTestingCatalog';
import {
    BACK_SQUAT_1RM_PROTOCOL,
    BENCH_PRESS_1RM_PROTOCOL,
    CYCLING_6S_SEATED_SPRINT_PROTOCOL,
    PHYSICAL_CAPITAL_PROTOCOLS,
    SEATED_MEDBALL_THROW_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
    WALL_TOUCH_CMJ_PROTOCOL,
} from './physicalCapitalProtocols';
import { assertValidMeasurementProtocol } from './protocols';
import { getMetricDefinition } from './registry';

describe('WP0.1 October physical-capital protocol contracts', () => {
    it('pins the six protocol identities as separate id + numeric revision', () => {
        expect(PHYSICAL_CAPITAL_PROTOCOLS.map(protocol => `${protocol.id}@${protocol.revision}`)).toEqual([
            'strength-bench-press-1rm@1',
            'strength-back-squat-1rm@1',
            'field-standing-broad-jump@1',
            'field-wall-touch-cmj@1',
            'field-seated-medball-chest-throw-3kg@1',
            'cycling-6s-seated-sprint@1',
        ]);
        // ADR-0046 D-AT-IDENTITY: no revision token embedded in the protocol id.
        for (const protocol of PHYSICAL_CAPITAL_PROTOCOLS) expect(protocol.id).not.toMatch(/@|-r\d+$/);
    });

    it('validates every protocol, including its capture schema and reducers', () => {
        for (const protocol of PHYSICAL_CAPITAL_PROTOCOLS) {
            expect(() => assertValidMeasurementProtocol(protocol)).not.toThrow();
            expect(protocol.capture?.reducerVersion).toBe(ASSESSMENT_REDUCER_VERSION_V1);
            expect(() => buildTestingSessionDefinition(protocol)).not.toThrow();
        }
    });

    it('pins canonical metrics and their units', () => {
        const metricUnits = Object.fromEntries(PHYSICAL_CAPITAL_PROTOCOLS.map(protocol => [
            protocol.id,
            protocol.metricIds.map(metricId => `${metricId}:${getMetricDefinition(metricId).unit}`),
        ]));
        expect(metricUnits).toEqual({
            'strength-bench-press-1rm': ['strength_1rm_kg:kg'],
            'strength-back-squat-1rm': ['strength_1rm_kg:kg'],
            'field-standing-broad-jump': ['standing_broad_jump_distance_cm:cm'],
            'field-wall-touch-cmj': ['wall_touch_cmj_height_cm:cm'],
            'field-seated-medball-chest-throw-3kg': ['seated_medball_throw_distance_m:m'],
            'cycling-6s-seated-sprint': ['cycling_sprint_1s_peak_power_w:W', 'cycling_sprint_5s_mean_power_w:W'],
        });
    });

    it('pins series-defining comparison dimensions', () => {
        expect(Object.fromEntries(PHYSICAL_CAPITAL_PROTOCOLS.map(protocol => [
            protocol.id,
            protocol.comparisonContext.seriesDefining,
        ]))).toEqual({
            'strength-bench-press-1rm': ['equipment_setup_id'],
            'strength-back-squat-1rm': ['equipment_setup_id'],
            'field-standing-broad-jump': ['test_environment'],
            'field-wall-touch-cmj': ['measurement_method_id'],
            'field-seated-medball-chest-throw-3kg': ['equipment_setup_id'],
            'cycling-6s-seated-sprint': ['power_source_id', 'bike_setup_id', 'test_environment', 'start_mode', 'warmup_revision'],
        });
    });

    it('pins the reducer semantics of each protocol', () => {
        expect(BENCH_PRESS_1RM_PROTOCOL.capture?.reducers).toEqual([
            { kind: 'highest_successful_load', metricId: 'strength_1rm_kg', loadFieldId: 'load_kg', successFieldId: 'successful' },
        ]);
        expect(BACK_SQUAT_1RM_PROTOCOL.capture?.reducers).toEqual(BENCH_PRESS_1RM_PROTOCOL.capture?.reducers);
        expect(STANDING_BROAD_JUMP_PROTOCOL.capture?.reducers).toEqual([
            { kind: 'max_valid', metricId: 'standing_broad_jump_distance_cm', fieldId: 'distance_cm' },
        ]);
        expect(WALL_TOUCH_CMJ_PROTOCOL.capture?.reducers).toEqual([
            { kind: 'max_valid_difference', metricId: 'wall_touch_cmj_height_cm', minuendFieldId: 'touch_height_cm', subtrahendFieldId: 'standing_reach_cm' },
        ]);
        expect(SEATED_MEDBALL_THROW_PROTOCOL.capture?.reducers).toEqual([
            { kind: 'max_valid', metricId: 'seated_medball_throw_distance_m', fieldId: 'distance_m' },
        ]);
        expect(CYCLING_6S_SEATED_SPRINT_PROTOCOL.capture?.reducers).toEqual([
            { kind: 'max_valid', metricId: 'cycling_sprint_1s_peak_power_w', fieldId: 'peak_power_1s_w' },
            { kind: 'max_valid', metricId: 'cycling_sprint_5s_mean_power_w', fieldId: 'mean_power_5s_w' },
        ]);
    });

    it('keeps supplementary raw fields out of the canonical metric registry', () => {
        const fieldIds = (protocol: typeof BENCH_PRESS_1RM_PROTOCOL) => protocol.capture?.fields.map(field => field.id);
        expect(fieldIds(BENCH_PRESS_1RM_PROTOCOL)).toEqual(['load_kg', 'successful', 'rpe', 'mean_concentric_velocity_mps', 'peak_velocity_mps']);
        expect(fieldIds(CYCLING_6S_SEATED_SPRINT_PROTOCOL)).toEqual([
            'peak_power_1s_w', 'mean_power_5s_w', 'start_cadence_rpm', 'peak_cadence_rpm', 'left_balance_pct',
        ]);
        for (const protocol of PHYSICAL_CAPITAL_PROTOCOLS) {
            for (const field of protocol.capture!.fields) {
                expect(() => getMetricDefinition(field.id)).toThrow(/Unsupported metric id/);
            }
        }
    });

    it('requires rack safeties or a spotter for maximal strength protocols and a raw-video reminder', () => {
        for (const protocol of [BENCH_PRESS_1RM_PROTOCOL, BACK_SQUAT_1RM_PROTOCOL]) {
            expect(protocol.instructions.find(instruction => instruction.id === 'safety')?.text).toMatch(/spotter/);
            expect(protocol.instructions.find(instruction => instruction.id === 'raw-video')?.text).toMatch(/not the video/);
            expect(protocol.invalidationRules.some(rule => /spotter/i.test(rule))).toBe(true);
        }
    });
});

describe('WP0.3 existing 5-second sprint protocol is preserved', () => {
    it('keeps cycling-5s-peak-power@1 byte-for-byte and summary-only', () => {
        const protocol = getPerformanceTestDefinition('cycling_5s_peak_power-r1').protocol;
        expect(protocol).toMatchObject({
            id: 'cycling-5s-peak-power',
            revision: 1,
            metricIds: ['cycling_5s_peak_power_w'],
            createdAt: '2026-08-21T00:00:00.000Z',
        });
        expect(protocol.capture).toBeUndefined();
        expect(protocol.comparisonContext.seriesDefining).toEqual([
            'power_source_id', 'bike_setup_id', 'test_environment', 'duration_seconds', 'start_mode', 'warmup_revision',
        ]);
        expect(() => assertValidMeasurementProtocol(protocol)).not.toThrow();
    });

    it('adds the 6-second seated sprint as a different protocol and different metrics', () => {
        const legacy = getPerformanceTestDefinition('cycling_5s_peak_power-r1').protocol;
        expect(CYCLING_6S_SEATED_SPRINT_PROTOCOL.id).not.toBe(legacy.id);
        expect(CYCLING_6S_SEATED_SPRINT_PROTOCOL.metricIds).not.toContain('cycling_5s_peak_power_w');
    });

    it('still accepts a persisted summary-only revision with no capture field', () => {
        const persisted = JSON.parse(JSON.stringify(getPerformanceTestDefinition('cycling_5s_peak_power-r1').protocol));
        expect('capture' in persisted).toBe(false);
        expect(() => assertValidMeasurementProtocol(persisted)).not.toThrow();
    });
});
