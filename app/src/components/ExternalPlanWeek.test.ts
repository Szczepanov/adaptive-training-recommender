import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ExternalPlanWeek } from './ExternalPlanWeek';
import type { PlacedSession } from '../engine/externalPlacement';
import type { FixedActivity } from '../engine/models';

describe('ExternalPlanWeek occupancy and scheduling contracts', () => {
    const placed: PlacedSession[] = [
        {
            session: {
                id: 's1', title: 'Threshold', priority: 'key',
                placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
                gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: ['indoor_bike'] },
                prescription: {
                    summary: '3x12 at threshold.',
                    steps: [
                        { name: 'Warm-up', durationMin: 15, target: 'Zone 2' },
                        { name: 'Interval', durationMin: 12, sets: 3, setRecoveryMin: 4, target: '95-100% FTP' },
                    ],
                },
                scaling: { reducible: true, reducedSummary: '2x12 at threshold.', fallback: 'Steady 60 min outdoors' },
            },
            date: '2026-08-18',
            status: 'planned',
            moved: false,
        },
    ];

    it('unions plan-placed days and active fixed activity commitments for occupancy', () => {
        const fixed: FixedActivity[] = [
            {
                id: 'match-1',
                userId: 'user-1',
                title: 'Football match',
                date: '2026-08-20',
                durationMin: 90,
                fixed: true,
                environment: 'outdoor',
                equipment: [],
                isCompleted: false,
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'completed-run',
                userId: 'user-1',
                title: 'Morning jog',
                date: '2026-08-17',
                durationMin: 30,
                fixed: true,
                environment: 'outdoor',
                equipment: [],
                isCompleted: true,
                createdAt: '',
                updatedAt: '',
            },
        ];

        const days = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
        const inWeekOccupied = placed.filter(item => item.status !== 'dropped' && item.status !== 'superseded').map(item => item.date);
        const fixedOccupied = fixed.filter(activity => !activity.isCompleted && activity.date >= days[0] && activity.date <= days[6]).map(activity => activity.date);
        const occupied = new Set([...inWeekOccupied, ...fixedOccupied]);

        expect(occupied.has('2026-08-18')).toBe(true); // Placed session
        expect(occupied.has('2026-08-20')).toBe(true); // Active fixed activity
        expect(occupied.has('2026-08-17')).toBe(false); // Completed activity does not block
        expect(occupied.has('2026-08-19')).toBe(false); // Free day
    });

    it('renders View workout button for scheduled sessions', () => {
        const html = renderToStaticMarkup(
            React.createElement(ExternalPlanWeek, {
                userId: 'user-1',
                planTitle: 'Adaptive Peak Plan',
                weekStartDate: '2026-08-17',
                placed,
                critique: null,
                today: '2026-08-17',
                onProposeReplacement: () => ({ sessionId: 's1', missedDate: '2026-08-17', outcome: 'unresolved' as const, rationale: '' }),
                onConfirmReplacement: () => {},
                onChooseDate: () => {},
            }),
        );

        expect(html).toContain('View workout');
        expect(html).toContain('Threshold');
        expect(html).toContain('hard · 60–75 min');
    });
});
