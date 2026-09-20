import React, { useState, useEffect, useMemo } from 'react';
import type { NutritionDay, ReconciledNutritionDay } from '../../nutrition/models';
import type { DailyRecoverySnapshot } from '../../engine/models';
import { reconcileNutritionHistory } from '../../nutrition/reconciliation';
import { nutritionService } from '../../nutrition/nutritionService';
import { recoverySnapshotService } from '../../services/recoverySnapshotService';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate';
import './NutritionPanel.css';

export interface NutritionPanelProps {
    userId: string;
    asOfDate?: string;
    initialRecords?: NutritionDay[];
    initialSnapshots?: DailyRecoverySnapshot[];
}

type WindowSize = 7 | 14 | 28;

export const NutritionPanel: React.FC<NutritionPanelProps> = ({
    userId,
    asOfDate = getLocalDateString(),
    initialRecords,
    initialSnapshots,
}) => {
    const [windowSize, setWindowSize] = useState<WindowSize>(7);
    const [rawRecords, setRawRecords] = useState<NutritionDay[]>(initialRecords ?? []);
    const [snapshots, setSnapshots] = useState<DailyRecoverySnapshot[]>(initialSnapshots ?? []);
    const [loading, setLoading] = useState(initialRecords === undefined && initialSnapshots === undefined);
    const [error, setError] = useState<string | null>(null);

    const startDate = useMemo(() => {
        return addDaysToLocalDateString(asOfDate, -(windowSize - 1));
    }, [asOfDate, windowSize]);

    useEffect(() => {
        setLoading(true);
        setError(null);

        let isMounted = true;

        // 1. Fetch recovery snapshots to populate physical energy expenditure (BMR + active)
        const loadSnapshots = async () => {
            try {
                const snapshotState = await recoverySnapshotService.getRecoverySnapshotsInRangeState(
                    userId,
                    startDate,
                    addDaysToLocalDateString(asOfDate, 1),
                );
                if (isMounted && snapshotState.status === 'AVAILABLE') {
                    setSnapshots(snapshotState.data);
                } else if (isMounted) {
                    setSnapshots([]);
                }
            } catch (err) {
                console.warn('[NutritionPanel] Failed to load recovery snapshots for expenditure:', err);
            }
        };

        loadSnapshots();

        // 2. Subscribe to user-scoped nutrition documents
        const unsubscribe = nutritionService.subscribeToNutritionDays(
            userId,
            startDate,
            asOfDate,
            (days) => {
                if (isMounted) {
                    setRawRecords(days);
                    setLoading(false);
                }
            },
            (err) => {
                if (isMounted) {
                    setError(err.message || 'Failed to load nutrition data');
                    setLoading(false);
                }
            },
        );

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, [userId, startDate, asOfDate]);

    // Merge food intake records with wearable expenditure snapshots
    const reconciledDays = useMemo(() => {
        const snapshotsByDate = new Map<string, DailyRecoverySnapshot>();
        for (const snap of snapshots) {
            snapshotsByDate.set(snap.date, snap);
        }

        const augmentedRecords: NutritionDay[] = [];
        const seenDatesWithIntake = new Set<string>();

        // Augment existing food log records with expenditure from wearable snapshots
        for (const record of rawRecords) {
            seenDatesWithIntake.add(record.date);
            const snap = snapshotsByDate.get(record.date);
            const active = record.energyExpenditureKcal?.active ?? snap?.raw.activeEnergyKcal ?? null;
            const resting = record.energyExpenditureKcal?.resting ?? snap?.raw.restingEnergyKcal ?? null;
            let total = record.energyExpenditureKcal?.total ?? snap?.raw.totalEnergyExpenditureKcal ?? null;
            if (total === null && active != null && resting != null) {
                total = active + resting;
            }

            augmentedRecords.push({
                ...record,
                energyExpenditureKcal:
                    active != null || resting != null || total != null
                        ? {
                              active,
                              resting,
                              total,
                          }
                        : null,
            });
        }

        // For dates where wearable expenditure exists but no food was logged, add wearable entry
        for (const [date, snap] of snapshotsByDate) {
            if (!seenDatesWithIntake.has(date)) {
                const active = snap.raw.activeEnergyKcal ?? null;
                const resting = snap.raw.restingEnergyKcal ?? null;
                let total = snap.raw.totalEnergyExpenditureKcal ?? null;
                if (total === null && active != null && resting != null) {
                    total = active + resting;
                }

                if (active != null || resting != null || total != null) {
                    augmentedRecords.push({
                        schemaVersion: 1,
                        date,
                        source: {
                            provider: 'garmin',
                            transport: 'garmin_connect',
                            origin: 'garmin',
                        },
                        syncedAt: snap.source.garminSyncedAt || '',
                        energyExpenditureKcal: {
                            active,
                            resting,
                            total,
                        },
                        isPartialDay: date === getLocalDateString(),
                        confidenceScore: 1.0,
                    });
                }
            }
        }

        return reconcileNutritionHistory(augmentedRecords);
    }, [rawRecords, snapshots, asOfDate]);

    // Current or latest day to display in hero card
    const currentDay: ReconciledNutritionDay | null = useMemo(() => {
        if (reconciledDays.length === 0) return null;
        const matching = reconciledDays.find((d) => d.date === asOfDate);
        return matching ?? reconciledDays[reconciledDays.length - 1];
    }, [reconciledDays, asOfDate]);

    const formatKcal = (val: number | null | undefined): string => {
        if (val === null || val === undefined || !Number.isFinite(val)) return '—';
        return `${Math.round(val).toLocaleString()} kcal`;
    };

    const formatGrams = (val: number | null | undefined): string => {
        if (val === null || val === undefined || !Number.isFinite(val)) return 'N/A';
        return `${Math.round(val)} g`;
    };

    const formatSource = (day: ReconciledNutritionDay): string => {
        if (!day.primaryIntakeSource) return 'Wearable Expenditure Only';

        const { provider, transport } = day.primaryIntakeSource;
        const origin = day.primaryIntakeSource.origin?.trim() || null;
        if (!origin) {
            return transport === 'garmin_connect'
                ? 'Garmin Connect (upstream origin unverified)'
                : `${provider} via ${transport} (upstream origin unverified)`;
        }

        if (origin.toLowerCase() === 'myfitnesspal') {
            return transport === 'garmin_connect' ? 'Garmin Connect (MyFitnessPal sync)' : 'MyFitnessPal';
        }
        return `${origin} via ${transport}`;
    };

    if (loading && rawRecords.length === 0 && snapshots.length === 0) {
        return (
            <div className="nutrition-panel">
                <div className="nutrition-panel-header">
                    <div>
                        <h3 className="nutrition-panel-title">Nutrition & Energy Balance</h3>
                        <p className="nutrition-panel-subtitle">Loading nutrition and expenditure observations...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="nutrition-panel">
                <div className="nutrition-panel-header">
                    <div>
                        <h3 className="nutrition-panel-title">Nutrition & Energy Balance</h3>
                        <p className="nutrition-panel-subtitle" style={{ color: 'var(--error-color, #ef4444)' }}>
                            Error: {error}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="nutrition-panel">
            <div className="nutrition-panel-header">
                <div>
                    <h3 className="nutrition-panel-title">Nutrition & Energy Balance</h3>
                    <p className="nutrition-panel-subtitle">
                        Observational dietary intake from food logs & wearable energy expenditure.
                    </p>
                </div>
                <div className="nutrition-window-selector">
                    <button
                        type="button"
                        className={`nutrition-window-btn ${windowSize === 7 ? 'active' : ''}`}
                        onClick={() => setWindowSize(7)}
                    >
                        7 Days
                    </button>
                    <button
                        type="button"
                        className={`nutrition-window-btn ${windowSize === 14 ? 'active' : ''}`}
                        onClick={() => setWindowSize(14)}
                    >
                        14 Days
                    </button>
                    <button
                        type="button"
                        className={`nutrition-window-btn ${windowSize === 28 ? 'active' : ''}`}
                        onClick={() => setWindowSize(28)}
                    >
                        28 Days
                    </button>
                </div>
            </div>

            {currentDay ? (
                <>
                    {/* Hero Card for As-Of Date */}
                    <div className="nutrition-hero-card">
                        <div className="nutrition-hero-top">
                            <div className="nutrition-hero-date">
                                {currentDay.date === getLocalDateString()
                                    ? `Today (${currentDay.date})`
                                    : currentDay.date}
                            </div>
                            <div className="nutrition-badge-container">
                                {currentDay.hasIntakeData && (
                                    <span
                                        className={`nutrition-badge ${currentDay.isPartialDay ? 'partial' : 'complete'}`}
                                    >
                                        {currentDay.isPartialDay ? 'Partial Day / In Progress' : 'Logged'}
                                    </span>
                                )}
                                <span className="nutrition-badge provenance">
                                    {formatSource(currentDay)}
                                </span>
                            </div>
                        </div>

                        {/* Top-level energy grid */}
                        <div className="nutrition-metrics-grid">
                            <div className="nutrition-metric-card">
                                <span className="nutrition-metric-label">Dietary Energy Intake</span>
                                <span className="nutrition-metric-value">
                                    {currentDay.hasIntakeData ? formatKcal(currentDay.energyIntakeKcal) : 'No Log'}
                                </span>
                                <span className="nutrition-metric-subtext">
                                    {currentDay.hasIntakeData ? 'Food & drink logged' : 'Not recorded yet'}
                                </span>
                            </div>

                            <div className="nutrition-metric-card">
                                <span className="nutrition-metric-label">Active Expenditure</span>
                                <span className="nutrition-metric-value">
                                    {formatKcal(currentDay.energyExpenditureKcal?.active)}
                                </span>
                                <span className="nutrition-metric-subtext">Wearable active-energy estimate</span>
                            </div>

                            <div className="nutrition-metric-card">
                                <span className="nutrition-metric-label">Resting Expenditure (BMR)</span>
                                <span className="nutrition-metric-value">
                                    {formatKcal(currentDay.energyExpenditureKcal?.resting)}
                                </span>
                                <span className="nutrition-metric-subtext">Basal metabolic rate</span>
                            </div>

                            <div className="nutrition-metric-card">
                                <span className="nutrition-metric-label">Total Expenditure</span>
                                <span className="nutrition-metric-value">
                                    {formatKcal(currentDay.energyExpenditureKcal?.total)}
                                </span>
                                <span className="nutrition-metric-subtext">Resting + active total</span>
                            </div>
                        </div>

                        {/* Energy Balance banner */}
                        {currentDay.hasIntakeData &&
                            currentDay.energyIntakeKcal != null &&
                            currentDay.energyExpenditureKcal?.total != null && (
                            <div className="nutrition-balance-banner">
                                <span>⚖️</span>
                                <div>
                                    <strong>Observational Balance: </strong>
                                    {Math.round(
                                        currentDay.energyIntakeKcal! - currentDay.energyExpenditureKcal.total,
                                    ) > 0 ? '+' : ''}
                                    {Math.round(
                                        currentDay.energyIntakeKcal! - currentDay.energyExpenditureKcal.total,
                                    )}{' '}
                                    kcal (Intake {Math.round(currentDay.energyIntakeKcal!)} - Expenditure{' '}
                                    {Math.round(currentDay.energyExpenditureKcal.total)})
                                    {currentDay.isPartialDay && (
                                        <span style={{ marginLeft: '0.5rem', opacity: 0.8 }}>
                                            — Intraday values are provisional until day completion.
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Macronutrients Section */}
                        <div className="nutrition-macros-section">
                            <div className="nutrition-macros-title">
                                <span>🥗 Macronutrients</span>
                                {currentDay.macronutrients.proteinGrams === null && (
                                    <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                                        (Not provided by this sync source)
                                    </span>
                                )}
                            </div>
                            <div className="nutrition-macros-grid">
                                <div className="macro-box">
                                    <span className="macro-label">Protein</span>
                                    <span className="macro-value">
                                        {formatGrams(currentDay.macronutrients.proteinGrams)}
                                    </span>
                                    <span className="macro-status">
                                        {currentDay.macronutrients.proteinGrams === null ? 'Unavailable' : 'Logged'}
                                    </span>
                                </div>

                                <div className="macro-box">
                                    <span className="macro-label">Carbohydrates</span>
                                    <span className="macro-value">
                                        {formatGrams(currentDay.macronutrients.carbsGrams)}
                                    </span>
                                    <span className="macro-status">
                                        {currentDay.macronutrients.carbsGrams === null ? 'Unavailable' : 'Logged'}
                                    </span>
                                </div>

                                <div className="macro-box">
                                    <span className="macro-label">Fat</span>
                                    <span className="macro-value">
                                        {formatGrams(currentDay.macronutrients.fatGrams)}
                                    </span>
                                    <span className="macro-status">
                                        {currentDay.macronutrients.fatGrams === null ? 'Unavailable' : 'Logged'}
                                    </span>
                                </div>

                                <div className="macro-box">
                                    <span className="macro-label">Fiber</span>
                                    <span className="macro-value">
                                        {formatGrams(currentDay.macronutrients.fiberGrams)}
                                    </span>
                                    <span className="macro-status">
                                        {currentDay.macronutrients.fiberGrams === null ? 'Unavailable' : 'Logged'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Historical Table */}
                    <div className="nutrition-history-card">
                        <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-color)' }}>
                            Recent Nutrition History ({reconciledDays.length} days)
                        </h4>
                        <table className="nutrition-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Intake (kcal)</th>
                                    <th>Active (kcal)</th>
                                    <th>BMR (kcal)</th>
                                    <th>Total Exp (kcal)</th>
                                    <th>Balance</th>
                                    <th>Status</th>
                                    <th>Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...reconciledDays].reverse().map((day) => {
                                    const net =
                                        day.hasIntakeData &&
                                        day.energyIntakeKcal != null &&
                                        day.energyExpenditureKcal?.total != null
                                            ? Math.round(day.energyIntakeKcal - day.energyExpenditureKcal.total)
                                            : null;
                                    return (
                                        <tr key={day.date}>
                                            <td style={{ fontWeight: day.date === asOfDate ? 600 : 400 }}>
                                                {day.date}
                                            </td>
                                            <td>
                                                {day.energyIntakeKcal != null
                                                    ? Math.round(day.energyIntakeKcal)
                                                    : day.hasIntakeData
                                                      ? 'N/A'
                                                      : '—'}
                                            </td>
                                            <td>
                                                {day.energyExpenditureKcal?.active != null
                                                    ? Math.round(day.energyExpenditureKcal.active)
                                                    : '—'}
                                            </td>
                                            <td>
                                                {day.energyExpenditureKcal?.resting != null
                                                    ? Math.round(day.energyExpenditureKcal.resting)
                                                    : '—'}
                                            </td>
                                            <td>
                                                {day.energyExpenditureKcal?.total != null
                                                    ? Math.round(day.energyExpenditureKcal.total)
                                                    : '—'}
                                            </td>
                                            <td>
                                                {net != null ? (
                                                    <span
                                                        style={{
                                                            color:
                                                                net > 0
                                                                    ? 'var(--primary-color)'
                                                                    : 'var(--text-secondary)',
                                                        }}
                                                    >
                                                        {net > 0 ? `+${net}` : net}
                                                    </span>
                                                ) : (
                                                    '—'
                                                )}
                                            </td>
                                            <td>
                                                {day.hasIntakeData ? (
                                                    day.isPartialDay ? (
                                                        <span style={{ color: '#eab308', fontSize: '0.8rem' }}>
                                                            Partial
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: '#22c55e', fontSize: '0.8rem' }}>
                                                            Complete
                                                        </span>
                                                    )
                                                ) : (
                                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                                        No Intake
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                {formatSource(day)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : (
                <div className="nutrition-empty-state">
                    <h4>No Nutrition Observations Found</h4>
                    <p>
                        No dietary intake or energy expenditure data is recorded for the past {windowSize} days.
                    </p>
                    <p style={{ fontSize: '0.85rem' }}>
                        To sync MyFitnessPal data: ensure MyFitnessPal is linked in Garmin Connect, then run{' '}
                        <code>garmin_sync sync</code> on the backend.
                    </p>
                </div>
            )}

            {/* Architecture & Decision Authority Note */}
            <div className="nutrition-notice">
                ℹ️ <strong>System Constraint (ADR-0042):</strong> Nutrition data is observation-only and has zero
                recommendation authority. The adaptive training engine does not prescribe diets or diagnose energy
                deficits; recommendations remain strictly invariant to nutrition inputs.
            </div>
        </div>
    );
};
