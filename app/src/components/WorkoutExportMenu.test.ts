import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { WorkoutExportMenu } from './WorkoutExportMenu';

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
});
