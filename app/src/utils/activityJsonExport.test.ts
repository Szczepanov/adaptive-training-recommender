import { describe, expect, it, vi } from 'vitest';
import type { NormalizedGarminActivity } from '../engine/models';
import {
    exportActivityToJson,
    exportActivitiesBundleToJson,
    formatActivityJson,
    formatActivitiesBundleJson,
    copyActivityJsonToClipboard,
    copyActivitiesBundleToClipboard,
    downloadActivitiesJsonFile,
} from './activityJsonExport';

const sampleActivity: NormalizedGarminActivity = {
    activityId: '12345',
    date: '2026-08-25',
    type: 'road_biking',
    durationMin: 75,
    intensityTag: 'hard',
    trainingEffectAerobic: 3.8,
    trainingEffectAnaerobic: 1.2,
    averageHr: 155,
    activityTrainingLoad: 160,
    primaryBenefit: 'TEMPO',
    trainingEffectLabel: 'AEROBIC_BASE',
    epoc: 95,
    recoveryTimeHours: 36,
    normalizedPower: 245,
    intensityFactor: 0.85,
    variabilityIndex: 1.08,
    powerInZones: [
        { zoneNumber: 1, secondsInZone: 600, lowBoundary: 0 },
        { zoneNumber: 2, secondsInZone: 2400, lowBoundary: 150 },
        { zoneNumber: 3, secondsInZone: 1500, lowBoundary: 210 },
    ],
    hrInZones: [
        { zoneNumber: 1, secondsInZone: 300, lowBoundary: 100 },
        { zoneNumber: 2, secondsInZone: 1800, lowBoundary: 130 },
        { zoneNumber: 3, secondsInZone: 2400, lowBoundary: 150 },
    ],
    laps: [
        { lapIndex: 1, durationSeconds: 1800, averagePowerWatts: 230, averageHrBpm: 150 },
        { lapIndex: 2, durationSeconds: 2700, averagePowerWatts: 255, averageHrBpm: 158 },
    ],
};

const sampleStrengthActivity: NormalizedGarminActivity = {
    activityId: '67890',
    date: '2026-08-26',
    type: 'strength_training',
    durationMin: 50,
    intensityTag: 'moderate',
    trainingEffectAerobic: 2.1,
    trainingEffectAnaerobic: 0.5,
    averageHr: 125,
    activityTrainingLoad: 75,
    exerciseSets: [
        {
            setOrder: 0,
            setType: 'warmup',
            repetitionCount: 12,
            weightKg: 20,
            exerciseName: 'bench_press',
            durationSeconds: 30,
            restDurationSeconds: 60,
        },
        {
            setOrder: 1,
            setType: 'active',
            repetitionCount: 6,
            weightKg: 85,
            exerciseName: 'bench_press',
            durationSeconds: 25,
            restDurationSeconds: 90,
        },
    ],
};

describe('activityJsonExport', () => {
    it('wraps a single activity into an activity_export_v1 envelope', () => {
        const result = exportActivityToJson(sampleActivity);
        expect(result.schemaVersion).toBe('activity_export_v1');
        expect(result.exportedAt).toBeDefined();
        expect(result.activity).toEqual(sampleActivity);
    });

    it('formats a single activity as formatted JSON string', () => {
        const json = formatActivityJson(sampleActivity);
        const parsed = JSON.parse(json);
        expect(parsed.schemaVersion).toBe('activity_export_v1');
        expect(parsed.activity.activityId).toBe('12345');
        expect(parsed.activity.normalizedPower).toBe(245);
        expect(parsed.activity.powerInZones).toHaveLength(3);
    });

    it('packages multiple activities into recent_activities_bundle_v1 with metadata', () => {
        const bundle = exportActivitiesBundleToJson(
            [sampleStrengthActivity, sampleActivity],
            {
                userId: 'user-42',
                startDateInclusive: '2026-08-20',
                throughDateExclusive: '2026-08-27',
            },
        );

        expect(bundle.schemaVersion).toBe('recent_activities_bundle_v1');
        expect(bundle.metadata.totalActivities).toBe(2);
        expect(bundle.metadata.userId).toBe('user-42');
        expect(bundle.metadata.dateRange).toEqual({
            startDateInclusive: '2026-08-20',
            throughDateExclusive: '2026-08-27',
        });
        // Sorts chronologically by date
        expect(bundle.activities[0].activityId).toBe('12345');
        expect(bundle.activities[1].activityId).toBe('67890');
    });

    it('formats activities bundle as formatted JSON string', () => {
        const json = formatActivitiesBundleJson([sampleActivity, sampleStrengthActivity]);
        const parsed = JSON.parse(json);
        expect(parsed.schemaVersion).toBe('recent_activities_bundle_v1');
        expect(parsed.activities).toHaveLength(2);
        expect(parsed.activities[1].exerciseSets).toHaveLength(2);
    });

    it('copies single activity JSON to clipboard', async () => {
        const writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: writeTextMock },
        });

        await copyActivityJsonToClipboard(sampleActivity);
        expect(writeTextMock).toHaveBeenCalledOnce();
        const writtenPayload = JSON.parse(writeTextMock.mock.calls[0][0]);
        expect(writtenPayload.schemaVersion).toBe('activity_export_v1');
        expect(writtenPayload.activity.activityId).toBe('12345');
    });

    it('copies activities bundle JSON to clipboard', async () => {
        const writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: writeTextMock },
        });

        await copyActivitiesBundleToClipboard([sampleActivity], { userId: 'u1' });
        expect(writeTextMock).toHaveBeenCalledOnce();
        const writtenPayload = JSON.parse(writeTextMock.mock.calls[0][0]);
        expect(writtenPayload.schemaVersion).toBe('recent_activities_bundle_v1');
        expect(writtenPayload.metadata.userId).toBe('u1');
    });

    it('downloads JSON file through DOM link click', () => {
        const createObjectURLMock = vi.fn().mockReturnValue('blob:test');
        const revokeObjectURLMock = vi.fn();
        const clickMock = vi.fn();
        const appendChildMock = vi.fn();
        const removeChildMock = vi.fn();

        const fakeAnchor: Record<string, unknown> = {
            href: '',
            download: '',
            click: clickMock,
        };

        const originalUrl = globalThis.URL;
        const originalDocument = globalThis.document;

        globalThis.URL.createObjectURL = createObjectURLMock;
        globalThis.URL.revokeObjectURL = revokeObjectURLMock;

        globalThis.document = {
            createElement: vi.fn().mockReturnValue(fakeAnchor),
            body: {
                appendChild: appendChildMock,
                removeChild: removeChildMock,
            },
        } as unknown as Document;

        try {
            downloadActivitiesJsonFile('recent-activities', { test: true });
            expect(createObjectURLMock).toHaveBeenCalledOnce();
            expect(fakeAnchor.download).toBe('recent-activities.json');
            expect(appendChildMock).toHaveBeenCalledWith(fakeAnchor);
            expect(clickMock).toHaveBeenCalledOnce();
            expect(removeChildMock).toHaveBeenCalledWith(fakeAnchor);
            expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test');
        } finally {
            globalThis.URL = originalUrl;
            globalThis.document = originalDocument;
        }
    });
});
