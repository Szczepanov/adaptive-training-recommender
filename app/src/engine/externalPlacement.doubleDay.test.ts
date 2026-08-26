import { describe, expect, it } from 'vitest';
import { resolvePlacement } from './externalPlacement';
import { EXTERNAL_PLAN_SCHEMA } from './models';
import type {
    ExternalPlanPlacement,
    ExternalPlanSession,
    ExternalTrainingPlan,
    FixedActivity,
} from './models';

const MONDAY = '2026-08-17';

function session(
    id: string,
    overrides: Partial<ExternalPlanSession> = {},
): ExternalPlanSession {
    return {
        id,
        title: id,
        priority: 'supporting',
        placement: {
            week: 1,
            preferredDay: 'monday',
            flexibility: 'preferred',
            ifMissed: 'drop',
        },
        gating: {
            modality: 'cycling',
            intensity: 'easy',
            durationMin: 45,
            durationMax: 60,
            environment: 'either',
            equipment: [],
        },
        prescription: { summary: 'x' },
        ...overrides,
    };
}

function plan(sessions: ExternalPlanSession[]): ExternalTrainingPlan {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'double-day-block',
        revision: 1,
        title: 'Double-day block',
        startDate: MONDAY,
        weekCount: 1,
        sessions,
    };
}

function fixedActivity(date: string): FixedActivity {
    return {
        id: `fixed-${date}`,
        userId: 'u1',
        title: 'Booked match',
        date,
        durationMin: 90,
        fixed: true,
        environment: 'outdoor',
        equipment: [],
        isCompleted: false,
        createdAt: '',
        updatedAt: '',
    };
}

function overlay(
    assignments: ExternalPlanPlacement['assignments'],
): ExternalPlanPlacement {
    return {
        userId: 'u1',
        planId: 'double-day-block',
        revision: 1,
        assignments,
        updatedAt: '2026-08-17T06:00:00Z',
    };
}

describe('preferred-day bundle placement', () => {
    it('keeps authored double-day companions together on their preferred date', () => {
        const placed = resolvePlacement(plan([
            session('ride'),
            session('strength', {
                gating: {
                    modality: 'strength',
                    intensity: 'moderate',
                    durationMin: 30,
                    durationMax: 40,
                    environment: 'indoor',
                    equipment: ['free_weights'],
                },
            }),
        ]), null);

        expect(placed.map(item => `${item.session.id}:${item.date}:${item.moved}`)).toEqual([
            'ride:2026-08-17:false',
            'strength:2026-08-17:false',
        ]);
    });

    it('moves a preferred double-day bundle together when a booked activity owns the preferred date', () => {
        const placed = resolvePlacement(
            plan([session('ride'), session('strength')]),
            null,
            { fixedActivities: [fixedActivity(MONDAY)] },
        );

        expect(placed.map(item => `${item.session.id}:${item.date}:${item.moved}`)).toEqual([
            'ride:2026-08-18:true',
            'strength:2026-08-18:true',
        ]);
    });

    it('keeps a bundle anchored when one companion is fixed, surfacing the real collision', () => {
        const placed = resolvePlacement(
            plan([
                session('race', {
                    priority: 'key',
                    placement: {
                        week: 1,
                        preferredDay: 'monday',
                        flexibility: 'fixed',
                        ifMissed: 'drop',
                    },
                }),
                session('warmup'),
            ]),
            null,
            { fixedActivities: [fixedActivity(MONDAY)] },
        );

        expect(placed.every(item => item.date === MONDAY)).toBe(true);
        expect(placed.every(item => item.moved === false)).toBe(true);
    });

    it('does not let an unrelated overlay silently stack a movable preferred bundle', () => {
        const blocker = session('blocker', {
            placement: {
                week: 1,
                preferredDay: 'wednesday',
                flexibility: 'preferred',
                ifMissed: 'drop',
            },
        });
        const placed = resolvePlacement(
            plan([blocker, session('ride'), session('strength')]),
            overlay([{ sessionId: 'blocker', date: MONDAY, status: 'moved' }]),
        );

        expect(placed.find(item => item.session.id === 'blocker')).toMatchObject({
            date: MONDAY,
            moved: true,
        });
        expect(placed.filter(item => item.session.id !== 'blocker').map(item => item.date)).toEqual([
            '2026-08-18',
            '2026-08-18',
        ]);
    });

    it('allows an overlay that explicitly keeps one companion on the authored date without splitting siblings', () => {
        const placed = resolvePlacement(
            plan([session('ride'), session('strength')]),
            overlay([{ sessionId: 'ride', date: MONDAY, status: 'planned' }]),
        );

        expect(placed.map(item => `${item.session.id}:${item.date}`)).toEqual([
            'ride:2026-08-17',
            'strength:2026-08-17',
        ]);
    });
});
