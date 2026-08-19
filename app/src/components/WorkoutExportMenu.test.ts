import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { WorkoutExportMenu } from './WorkoutExportMenu';
import type { WorkoutPrescription } from '../workouts/models';

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(),
    setDoc: vi.fn(),
    getDoc: vi.fn(),
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

describe('WorkoutExportMenu', () => {
    it('renders export trigger button', () => {
        const html = renderToStaticMarkup(
            React.createElement(WorkoutExportMenu, {
                userId: 'user-1',
                date: '2026-08-17',
                title: 'Threshold 3x12',
                modality: 'cycling',
            }),
        );

        expect(html).toContain('Export / Sync');
    });

    it('renders with prescription and custom title without crashing', () => {
        const prescription: WorkoutPrescription = {
            id: 'p1',
            userId: 'user-1',
            date: '2026-08-17',
            workoutId: 'full_body_strength_a',
            workoutVersion: 1,
            variantId: 'full',
            targetDurationMin: 60,
            adjustedBlocks: [],
            displayBlocks: [
                {
                    id: 'b1',
                    name: 'Main Strength',
                    role: 'main',
                    steps: [
                        {
                            id: 's1',
                            name: 'Barbell Back Squat',
                            dose: '4 x 6 @ RPE 8',
                            targets: ['RPE 8'],
                            cues: ['Chest tall'],
                        },
                    ],
                },
            ],
            rationale: [],
            adjustmentReasons: [],
            source: { recommendationEngineVersion: '1.0.0' },
            status: 'recommended',
        };

        const html = renderToStaticMarkup(
            React.createElement(WorkoutExportMenu, {
                userId: 'user-1',
                date: '2026-08-17',
                title: 'Full Body Strength A',
                modality: 'strength',
                prescription,
            }),
        );

        expect(html).toContain('workout-export-trigger-btn');
    });
});
