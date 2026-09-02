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

    it('renders a rolling 7-day window showing today and the next 6 days (7 days overall)', () => {
        const today = '2026-08-19';
        const html = renderToStaticMarkup(
            React.createElement(ExternalPlanWeek, {
                userId: 'user-1',
                planTitle: '13 September Road Race Adaptive Peak Plan',
                weekStartDate: today,
                placed: [
                    ...placed,
                    {
                        session: {
                            id: 's2', title: 'Endurance Ride', priority: 'supporting',
                            placement: { week: 1, preferredDay: 'sunday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
                            gating: { modality: 'cycling', intensity: 'easy', durationMin: 90, durationMax: 120, environment: 'outdoor', equipment: [] },
                            prescription: { summary: 'Zone 2 endurance.', steps: [] },
                        },
                        date: '2026-08-25', // today + 6
                        status: 'planned',
                        moved: false,
                    },
                ],
                critique: null,
                today,
                onProposeReplacement: () => ({ sessionId: 's1', missedDate: today, outcome: 'unresolved' as const, rationale: '' }),
                onConfirmReplacement: () => {},
                onChooseDate: () => {},
            }),
        );

        // Verify the 7 days from today (2026-08-19) to today+6 (2026-08-25) are rendered
        expect(html).toContain('2026-08-19');
        expect(html).toContain('2026-08-20');
        expect(html).toContain('2026-08-21');
        expect(html).toContain('2026-08-22');
        expect(html).toContain('2026-08-23');
        expect(html).toContain('2026-08-24');
        expect(html).toContain('2026-08-25');
        // Past day should not be in the rolling window
        expect(html).not.toContain('2026-08-18');
        expect(html).not.toContain('2026-08-26');
        expect(html).toContain('Endurance Ride');
    });

    it('renders multiple training sessions on a single day (double day)', () => {
        const doubleDayPlaced: PlacedSession[] = [
            {
                session: {
                    id: 'w1-thu-easy-aerobic', title: 'Easy Aerobic Volume', priority: 'supporting',
                    placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                    gating: { modality: 'cycling', intensity: 'easy', durationMin: 35, durationMax: 50, environment: 'either', equipment: [] },
                    prescription: { summary: 'Low-cost aerobic volume before the race rehearsal.' },
                },
                date: '2026-08-27',
                status: 'planned',
                moved: false,
            },
            {
                session: {
                    id: 'w1-thu-upper-maintenance', title: 'Upper-Body Strength Maintenance', priority: 'optional',
                    placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                    gating: { modality: 'strength', intensity: 'moderate', durationMin: 25, durationMax: 35, environment: 'indoor', equipment: ['free_weights', 'pullup_bar'] },
                    prescription: { summary: 'Low-fatigue upper-body maintenance.' },
                },
                date: '2026-08-27',
                status: 'planned',
                moved: false,
            },
        ];

        const html = renderToStaticMarkup(
            React.createElement(ExternalPlanWeek, {
                userId: 'user-1',
                planTitle: 'Adaptive Peak Plan',
                weekStartDate: '2026-08-24',
                placed: doubleDayPlaced,
                critique: null,
                today: '2026-08-24',
                onProposeReplacement: () => ({ sessionId: 's1', missedDate: '2026-08-24', outcome: 'unresolved' as const, rationale: '' }),
                onConfirmReplacement: () => {},
                onChooseDate: () => {},
            }),
        );

        expect(html).toContain('2026-08-27');
        expect(html).toContain('Easy Aerobic Volume');
        expect(html).toContain('Upper-Body Strength Maintenance');
        expect(html).toContain('easy · 35–50 min');
        expect(html).toContain('moderate · 25–35 min');
    });

    it('renders three training sessions on a single day (triple day)', () => {
        const tripleDayPlaced: PlacedSession[] = [
            {
                session: {
                    id: 'w1-thu-easy-aerobic', title: 'Easy Aerobic Volume', priority: 'supporting',
                    placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                    gating: { modality: 'cycling', intensity: 'easy', durationMin: 35, durationMax: 50, environment: 'either', equipment: [] },
                    prescription: { summary: 'Low-cost aerobic volume.' },
                },
                date: '2026-08-27',
                status: 'planned',
                moved: false,
            },
            {
                session: {
                    id: 'w1-thu-upper-maintenance', title: 'Upper-Body Strength Maintenance', priority: 'optional',
                    placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                    gating: { modality: 'strength', intensity: 'moderate', durationMin: 25, durationMax: 35, environment: 'indoor', equipment: ['free_weights', 'pullup_bar'] },
                    prescription: { summary: 'Upper-body maintenance.' },
                },
                date: '2026-08-27',
                status: 'planned',
                moved: false,
            },
            {
                session: {
                    id: 'w1-thu-mobility', title: 'Evening Mobility Routine', priority: 'optional',
                    placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                    gating: { modality: 'mobility', intensity: 'recovery', durationMin: 15, durationMax: 20, environment: 'indoor', equipment: [] },
                    prescription: { summary: 'Hip and spine mobility.' },
                },
                date: '2026-08-27',
                status: 'planned',
                moved: false,
            },
        ];

        const html = renderToStaticMarkup(
            React.createElement(ExternalPlanWeek, {
                userId: 'user-1',
                planTitle: 'Adaptive Peak Plan',
                weekStartDate: '2026-08-24',
                placed: tripleDayPlaced,
                critique: null,
                today: '2026-08-24',
                onProposeReplacement: () => ({ sessionId: 's1', missedDate: '2026-08-24', outcome: 'unresolved' as const, rationale: '' }),
                onConfirmReplacement: () => {},
                onChooseDate: () => {},
            }),
        );

        expect(html).toContain('2026-08-27');
        expect(html).toContain('Easy Aerobic Volume');
        expect(html).toContain('Upper-Body Strength Maintenance');
        expect(html).toContain('Evening Mobility Routine');
        expect(html).toContain('easy · 35–50 min');
        expect(html).toContain('moderate · 25–35 min');
        expect(html).toContain('recovery · 15–20 min');
    });

    describe('clinical escalation (SEP-C4 fail-closed)', () => {
        const buildProps = (clinicalEscalationRequired: boolean) => ({
            userId: 'user-1',
            planTitle: 'Adaptive Peak Plan',
            weekStartDate: '2026-08-17',
            placed,
            critique: null,
            today: '2026-08-17',
            onProposeReplacement: () => ({ sessionId: 's1', missedDate: '2026-08-17', outcome: 'unresolved' as const, rationale: '' }),
            onConfirmReplacement: () => {},
            onChooseDate: () => {},
            clinicalEscalationRequired,
        });

        it('suppresses view/export/reschedule controls and workout-step detail while active', () => {
            const html = renderToStaticMarkup(React.createElement(ExternalPlanWeek, buildProps(true)));

            expect(html).toContain('Clinical Evaluation Recommended');
            expect(html).not.toContain('View workout');
            expect(html).not.toContain('Missed it');
            expect(html).not.toContain('Reschedule');
            // Session identity/status can still be shown (it is not executable content by
            // itself), but the structured steps from the fixture prescription must not leak.
            expect(html).not.toContain('95-100% FTP');
        });

        it('renders the normal actionable controls when escalation is not active', () => {
            const html = renderToStaticMarkup(React.createElement(ExternalPlanWeek, buildProps(false)));

            expect(html).not.toContain('Clinical Evaluation Recommended');
            expect(html).toContain('View workout');
        });
    });
});
