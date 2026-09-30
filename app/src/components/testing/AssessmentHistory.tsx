import React, { useCallback, useEffect, useState } from 'react';
import type { AssessmentAttempt } from '../../observations/models';
import {
    assessmentHistoryService,
} from '../../services/assessmentHistoryService';
import {
    assessmentExportService,
    downloadCsvFile,
    downloadDiagnosticExportFile,
} from '../../services/assessmentExportService';
import { assessmentDiagnosticExportToJson } from '../../observations/assessmentExport';
import { buildAssessmentHistoryCsv } from '../../observations/assessmentCsvExport';
import type { AssessmentHistoryModel } from '../../observations/assessmentHistory';
import type { BodyMassRelativeContext } from '../../anthropometry/bodyMass';
import { AssessmentSeriesCard } from './AssessmentSeriesCard';
import { AssessmentAttemptDetail } from './AssessmentAttemptDetail';

const FAMILIES: readonly { id: 'cycling' | 'strength' | 'field'; label: string }[] = [
    { id: 'cycling', label: 'Cycling' },
    { id: 'strength', label: 'Strength' },
    { id: 'field', label: 'Field & power' },
];

export interface AssessmentHistoryProps {
    userId: string;
}

export const AssessmentHistory: React.FC<AssessmentHistoryProps> = ({ userId }) => {
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState<AssessmentHistoryModel | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [selectedAttempt, setSelectedAttempt] = useState<{
        attempt: AssessmentAttempt;
        relativeContextMap: Record<string, BodyMassRelativeContext>;
    } | null>(null);

    const loadHistory = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await assessmentHistoryService.loadAssessmentHistory(userId);
            setHistory(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    const handleExportCsv = () => {
        if (!history) return;
        try {
            const csv = buildAssessmentHistoryCsv(history);
            downloadCsvFile('assessment-history.csv', csv);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleExportJson = async () => {
        setExporting(true);
        try {
            const diagnosticData = await assessmentExportService.loadDiagnosticExport(userId);
            const json = assessmentDiagnosticExportToJson(diagnosticData);
            downloadDiagnosticExportFile('physical-capital-diagnostic-export.json', json);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setExporting(false);
        }
    };

    if (loading) {
        return (
            <div className="assessment-history-view">
                <p>Loading assessment history across all tests…</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="assessment-history-view">
                <p className="testing-error" role="alert">{error}</p>
                <button type="button" className="testing-primary" onClick={loadHistory}>Retry</button>
            </div>
        );
    }

    if (!history) return null;

    const hasAnyAttempts = history.tests.some(
        t => t.activeSeries !== null || t.otherSeries.length > 0 || t.completedWithoutBenchmarkCount > 0 || t.abandonedCount > 0,
    );

    return (
        <div className="assessment-history-view">
            <div className="history-toolbar">
                <div>
                    <h3>Assessment History</h3>
                    <p>Longitudinal physical-capital benchmark evidence and comparability tracking.</p>
                </div>
                <div className="history-actions">
                    <button
                        type="button"
                        className="testing-secondary export-csv-btn"
                        disabled={exporting}
                        onClick={handleExportCsv}
                    >
                        Export history (CSV)
                    </button>
                    <button
                        type="button"
                        className="testing-secondary export-diagnostic-btn"
                        disabled={exporting}
                        onClick={handleExportJson}
                    >
                        {exporting ? 'Exporting…' : 'Export physical-capital evidence (JSON)'}
                    </button>
                </div>
            </div>

            {history.totalUnreadableCount > 0 && (
                <div className="testing-card testing-warning-banner" role="alert">
                    <strong>Notice:</strong> {history.totalUnreadableCount} record{history.totalUnreadableCount > 1 ? 's' : ''} could not be read or failed validation and {history.totalUnreadableCount > 1 ? 'were' : 'was'} skipped.
                </div>
            )}

            {!hasAnyAttempts ? (
                <section className="testing-card history-empty-banner">
                    <h4>No assessment history recorded yet</h4>
                    <p>Run a standardized assessment from the Protocols tab to record your first baseline.</p>
                </section>
            ) : (
                <div className="history-family-sections">
                    {FAMILIES.map(family => {
                        const familyTests = history.tests.filter(t => t.family === family.id);
                        if (familyTests.length === 0) return null;

                        return (
                            <section key={family.id} className="history-family-group">
                                <h3 className="history-family-heading">{family.label}</h3>
                                <div className="history-cards-grid">
                                    {familyTests.map(test => (
                                        <AssessmentSeriesCard
                                            key={test.definitionId}
                                            test={test}
                                            onSelectAttempt={(att, relMap) => setSelectedAttempt({ attempt: att, relativeContextMap: relMap })}
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            {selectedAttempt && (
                <AssessmentAttemptDetail
                    userId={userId}
                    attempt={selectedAttempt.attempt}
                    relativeContextMap={selectedAttempt.relativeContextMap}
                    onClose={() => setSelectedAttempt(null)}
                />
            )}
        </div>
    );
};
