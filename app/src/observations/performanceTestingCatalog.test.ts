import { describe, expect, it } from 'vitest';
import { assertValidMeasurementProtocol } from './protocols';
import {
    PERFORMANCE_TEST_DEFINITIONS,
    getPerformanceTestDefinition,
    getPerformanceTestFamily,
} from './performanceTestingCatalog';
import { validateSessionDefinition } from '../sessions/validation';
import {
    BACK_SQUAT_1RM_PROTOCOL,
    BENCH_PRESS_1RM_PROTOCOL,
    CYCLING_6S_SEATED_SPRINT_PROTOCOL,
    SEATED_MEDBALL_THROW_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
    WALL_TOUCH_CMJ_PROTOCOL,
} from './physicalCapitalProtocols';

describe('performance testing catalog', () => {
    it('contains the pinned catalog test set including bundled physical-capital protocols', () => {
        expect(PERFORMANCE_TEST_DEFINITIONS.map(definition => definition.id)).toEqual([
            'cycling-20m-tt-r1',
            'cycling-4m-tt-r1',
            'sprint_10m_standing-r1',
            'cycling_5s_peak_power-r1',
            'strength-bench-press-1rm-r1',
            'strength-back-squat-1rm-r1',
            'field-standing-broad-jump-r1',
            'field-wall-touch-cmj-r1',
            'field-seated-medball-chest-throw-3kg-r1',
            'cycling_6s_seated_sprint-r1',
        ]);
    });

    it.each(PERFORMANCE_TEST_DEFINITIONS)('validates $id protocol and session contracts', definition => {
        expect(() => assertValidMeasurementProtocol(definition.protocol)).not.toThrow();
        expect(validateSessionDefinition(definition.sessionDefinition).ok).toBe(true);
        expect(definition.sessionDefinition.intent).toBe('testing');
        expect(definition.protocol.intent).toBe('testing');
    });

    it('groups tests into explicit cycling, strength, and field families', () => {
        const families = PERFORMANCE_TEST_DEFINITIONS.map(definition => ({
            id: definition.id,
            family: getPerformanceTestFamily(definition),
        }));
        expect(families).toEqual([
            { id: 'cycling-20m-tt-r1', family: 'cycling' },
            { id: 'cycling-4m-tt-r1', family: 'cycling' },
            { id: 'sprint_10m_standing-r1', family: 'field' },
            { id: 'cycling_5s_peak_power-r1', family: 'cycling' },
            { id: 'strength-bench-press-1rm-r1', family: 'strength' },
            { id: 'strength-back-squat-1rm-r1', family: 'strength' },
            { id: 'field-standing-broad-jump-r1', family: 'field' },
            { id: 'field-wall-touch-cmj-r1', family: 'field' },
            { id: 'field-seated-medball-chest-throw-3kg-r1', family: 'field' },
            { id: 'cycling_6s_seated_sprint-r1', family: 'cycling' },
        ]);
    });

    it('pins the six October physical-capital protocols to the imported PR A protocol objects', () => {
        expect(getPerformanceTestDefinition('strength-bench-press-1rm-r1').protocol).toBe(BENCH_PRESS_1RM_PROTOCOL);
        expect(getPerformanceTestDefinition('strength-back-squat-1rm-r1').protocol).toBe(BACK_SQUAT_1RM_PROTOCOL);
        expect(getPerformanceTestDefinition('field-standing-broad-jump-r1').protocol).toBe(STANDING_BROAD_JUMP_PROTOCOL);
        expect(getPerformanceTestDefinition('field-wall-touch-cmj-r1').protocol).toBe(WALL_TOUCH_CMJ_PROTOCOL);
        expect(getPerformanceTestDefinition('field-seated-medball-chest-throw-3kg-r1').protocol).toBe(SEATED_MEDBALL_THROW_PROTOCOL);
        expect(getPerformanceTestDefinition('cycling_6s_seated_sprint-r1').protocol).toBe(CYCLING_6S_SEATED_SPRINT_PROTOCOL);
    });

    it('ensures strength sessions do not prescribe fixed attempt loads', () => {
        for (const testId of ['strength-bench-press-1rm-r1', 'strength-back-squat-1rm-r1']) {
            const def = getPerformanceTestDefinition(testId);
            const testBlock = def.sessionDefinition.blocks.find(b => b.role === 'test');
            expect(testBlock).toBeDefined();
            for (const step of testBlock!.steps) {
                // Steps must not have a prescribed mass load (athlete controlled)
                expect(step.load).toBeUndefined();
            }
        }
    });

    it('provides presentation hints for wall-touch CMJ standing reach carry-forward', () => {
        const cmj = getPerformanceTestDefinition('field-wall-touch-cmj-r1');
        expect(cmj.presentationHints?.carryForwardFieldIds).toEqual(['standing_reach_cm']);
    });

    it('defines cycling 6s sprint with 3 x 6s efforts and >= 4 min recovery', () => {
        const sprint = getPerformanceTestDefinition('cycling_6s_seated_sprint-r1');
        const testBlock = sprint.sessionDefinition.blocks.find(b => b.role === 'test');
        expect(testBlock).toBeDefined();
        const sprintStep = testBlock!.steps.find(s => s.id === 'sprint-efforts');
        expect(sprintStep?.dose).toEqual({ kind: 'duration', sets: 3, seconds: 6 });
        expect(sprintStep?.rest).toBeGreaterThanOrEqual(240);
    });

    it('keeps raw 20-minute power raw rather than naming or deriving FTP', () => {
        const definition = getPerformanceTestDefinition('cycling-20m-tt-r1');
        expect(definition.protocol.metricIds).toEqual(['cycling_tt_20m_mean_power_w']);
        expect(definition.sessionDefinition.summary.toLowerCase()).toContain('does not estimate ftp');
    });

    it('fails closed for unknown catalog ids', () => {
        expect(() => getPerformanceTestDefinition('unknown-test')).toThrow(/Unknown performance test definition/);
    });

    it('keeps standing and flying 10 m sprints as distinct series-defining subjects', () => {
        const standing = getPerformanceTestDefinition('sprint_10m_standing-r1');
        expect(standing.protocol.metricIds).toEqual(['sprint_elapsed_time_s']);
        expect(standing.protocol.comparisonContext.seriesDefining).toEqual(
            expect.arrayContaining(['start_mode', 'timing_method']),
        );
        expect(standing.defaultContext.start_mode).toBe('standing');
    });

    it('keeps the 5-second peak-power test distinct from the mean-power TT tests', () => {
        const definition = getPerformanceTestDefinition('cycling_5s_peak_power-r1');
        expect(definition.protocol.metricIds).toEqual(['cycling_5s_peak_power_w']);
        expect(definition.defaultContext.duration_seconds).toBe(5);
    });
});
