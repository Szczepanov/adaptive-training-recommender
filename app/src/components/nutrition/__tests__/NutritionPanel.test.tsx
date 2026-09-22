import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NutritionPanel } from '../NutritionPanel';
import { nutritionService } from '../../../nutrition/nutritionService';
import { recoverySnapshotService } from '../../../services/recoverySnapshotService';
import type { NutritionDay } from '../../../nutrition/models';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../../engine/models';

describe('NutritionPanel Component', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders empty state when no nutrition or recovery data exists', () => {
        vi.spyOn(nutritionService, 'subscribeToNutritionDays').mockImplementation(
            (_uid, _start, _end, onUpdate) => {
                onUpdate([]);
                return () => {};
            },
        );
        vi.spyOn(recoverySnapshotService, 'getRecoverySnapshotsInRangeState').mockResolvedValue({
            status: 'MISSING',
        });

        const html = renderToStaticMarkup(
            <NutritionPanel userId="test-user" asOfDate="2026-09-20" initialRecords={[]} initialSnapshots={[]} />,
        );

        expect(html).toContain('Nutrition &amp; Energy Observations');
        expect(html).toContain('No Nutrition Observations Found');
        expect(html).toContain('ADR-0042');
        expect(html).toContain('zero recommendation authority');
    });

    it('renders logged nutrition with explicit N/A for missing macros and expenditure', () => {
        const sampleDay: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: 'myfitnesspal',
            },
            syncedAt: '2026-09-20T10:00:00Z',
            energyIntakeKcal: 2150,
            energyExpenditureKcal: {
                resting: 1850,
                active: 550,
                total: 2400,
            },
            macronutrients: null,
            micronutrients: null,
            isPartialDay: true,
            confidenceScore: 1.0,
        };

        const sampleSnapshot = {
            date: '2026-09-20',
            source: {
                userId: 'test-user',
                garminSyncedAt: '2026-09-20T10:00:00Z',
                metricDates: {},
            },
            raw: {
                sleepScore: 80,
                sleepDurationSec: 28000,
                restingHr: 50,
                hrvOvernightAvg: 55,
                hrvStatus: 'balanced',
                respirationAvg: 14,
                bodyBatteryWake: 80,
                bodyBatteryChange: 0,
                totalSteps: 8000,
                last3DaysHardSessionsCount: 0,
                yesterdayTraining: null,
                activeEnergyKcal: 550,
                restingEnergyKcal: 1850,
                totalEnergyExpenditureKcal: 2400,
            },
            derived: {
                baselineComputationVersion: 4,
                sleepScore7dAvg: 80,
                sleepScore28dAvg: 80,
                restingHr7dAvg: 50,
                restingHr28dAvg: 50,
                hrv7dAvg: 55,
                hrv28dAvg: 55,
                respiration7dAvg: 14,
                respiration28dAvg: 14,
            },
        } as unknown as DailyRecoverySnapshot;

        vi.spyOn(nutritionService, 'subscribeToNutritionDays').mockImplementation(
            (_uid, _start, _end, onUpdate) => {
                onUpdate([sampleDay]);
                return () => {};
            },
        );
        vi.spyOn(recoverySnapshotService, 'getRecoverySnapshotsInRangeState').mockResolvedValue({
            status: 'AVAILABLE',
            data: [sampleSnapshot],
            revision: 'rev-1',
        });

        const html = renderToStaticMarkup(
            <NutritionPanel
                userId="test-user"
                asOfDate="2026-09-20"
                initialRecords={[sampleDay]}
                initialSnapshots={[sampleSnapshot]}
            />,
        );

        // Header and cards
        expect(html).toContain('Nutrition &amp; Energy Observations');
        expect(html).toContain('2,150 kcal');
        expect(html).toContain('Dietary Energy Intake');
        expect(html).toContain('Active Expenditure');
        expect(html).toContain('Resting Expenditure (BMR)');
        expect(html).toContain('Total Expenditure');

        // Partial day badge
        expect(html).toContain('Partial Day / In Progress');

        // Missing macros explicitly labeled N/A and explained
        expect(html).toContain('Not provided by this sync source');
        expect(html).toContain('N/A');
        expect(html).toContain('Unavailable');

        // Observational balance banner
        expect(html).toContain('Observed Intake − Estimated Expenditure:');
        expect(html).toContain('-250 kcal');

        // History table
        expect(html).toContain('Recent Nutrition History');
        expect(html).toContain('2026-09-20');

        // System invariant notice
        expect(html).toContain('ADR-0042');
        expect(html).toContain('strictly invariant to nutrition inputs');
    });

    it('renders subjective adherence badge when checkin rated yesterday tracking', () => {
        const sampleDay: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: null,
            },
            syncedAt: '2026-09-20T10:00:00Z',
            energyIntakeKcal: 0,
            hasIntakeData: true,
            isPartialDay: false,
            confidenceScore: 1.0,
        };

        const sampleCheckin = {
            userId: 'test-user',
            date: '2026-09-21', // Checkin on Sep 21 rates Sep 20 (D-1)
            nutritionAdherenceYesterday: 'fasted' as const,
        } as unknown as DailySubjectiveCheckin;

        const html = renderToStaticMarkup(
            <NutritionPanel
                userId="test-user"
                asOfDate="2026-09-20"
                initialRecords={[sampleDay]}
                initialSnapshots={[]}
                initialCheckins={[sampleCheckin]}
            />,
        );

        // Should render Deliberate Fast badge instead of regular Logged/Complete badge
        expect(html).toContain('Marked Full-Day Fast (0 kcal)');
        expect(html).toContain('adherence-fasted');
    });

    it('flags a full-day-fast self-report that conflicts with positive synced intake', () => {
        const sampleDay: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: null,
            },
            syncedAt: '2026-09-20T10:00:00Z',
            energyIntakeKcal: 2200,
            hasIntakeData: true,
            isPartialDay: false,
            confidenceScore: 1.0,
        };
        const sampleCheckin = {
            userId: 'test-user',
            date: '2026-09-21',
            nutritionAdherenceYesterday: 'fasted' as const,
        } as unknown as DailySubjectiveCheckin;

        const html = renderToStaticMarkup(
            <NutritionPanel
                userId="test-user"
                asOfDate="2026-09-20"
                initialRecords={[sampleDay]}
                initialSnapshots={[]}
                initialCheckins={[sampleCheckin]}
            />,
        );

        expect(html).toContain('Marked Full-Day Fast — conflicts with synced intake');
        expect(html).toContain('adherence-conflict');
        expect(html).toContain('2,200 kcal');
    });

    it('renders correct labels and classes for all tracking adherence levels', () => {
        const sampleDay: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: null,
            },
            syncedAt: '2026-09-20T10:00:00Z',
            energyIntakeKcal: 2200,
            hasIntakeData: true,
            isPartialDay: false,
            confidenceScore: 1.0,
        };

        const testCases = [
            { adherence: 'fully_tracked' as const, expectedLabel: 'Fully Tracked', expectedClass: 'adherence-fully_tracked' },
            { adherence: 'mostly_tracked' as const, expectedLabel: 'Mostly Tracked', expectedClass: 'adherence-mostly_tracked' },
            { adherence: 'minimal' as const, expectedLabel: 'Minimally Tracked', expectedClass: 'adherence-minimal' },
            { adherence: 'untracked' as const, expectedLabel: 'Untracked', expectedClass: 'adherence-untracked' },
        ];

        for (const { adherence, expectedLabel, expectedClass } of testCases) {
            const checkin = {
                userId: 'test-user',
                date: '2026-09-21',
                nutritionAdherenceYesterday: adherence,
            } as unknown as DailySubjectiveCheckin;

            const html = renderToStaticMarkup(
                <NutritionPanel
                    userId="test-user"
                    asOfDate="2026-09-20"
                    initialRecords={[sampleDay]}
                    initialSnapshots={[]}
                    initialCheckins={[checkin]}
                />,
            );

            expect(html).toContain(expectedLabel);
            expect(html).toContain(expectedClass);
        }
    });
});
