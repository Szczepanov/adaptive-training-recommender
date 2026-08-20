import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { WorkoutPrescription } from '../workouts/models';
import { generateZwiftFromPrescription, generateZwiftFromExternalSession, generateZwiftFromExternalSessionV2, downloadZwiftFile } from '../utils/zwiftExport';
import {
    exportWorkoutPrescriptionToJson,
    exportExternalSessionToJson,
    exportExternalSessionV2ToJson,
    downloadJsonFile,
    copyJsonToClipboard,
    validateGarminExportFidelity,
    type CanonicalWorkoutExport,
} from '../utils/workoutJsonExport';
import { garminWorkoutQueueService } from '../services/garminWorkoutQueueService';
import { isV2Session, type AnyExternalPlanSession } from '../sessions/externalPlanV2';
import './WorkoutExportMenu.css';

export interface WorkoutExportMenuProps {
    userId: string;
    date: string;
    title: string;
    modality: string;
    prescription?: WorkoutPrescription;
    externalSession?: AnyExternalPlanSession;
    onSyncQueued?: () => void;
}

export function WorkoutExportMenu({
    userId,
    date,
    title,
    modality,
    prescription,
    externalSession,
    onSyncQueued,
}: WorkoutExportMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [syncState, setSyncState] = useState<'idle' | 'queuing' | 'queued' | 'error'>('idle');
    const [copied, setCopied] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const isCycling = modality.toLowerCase() === 'cycling' || modality.toLowerCase() === 'bike';

    const getCanonicalExport = useCallback((): CanonicalWorkoutExport => {
        if (prescription) {
            return exportWorkoutPrescriptionToJson(prescription, modality);
        }
        if (externalSession) {
            return isV2Session(externalSession) ? exportExternalSessionV2ToJson(externalSession) : exportExternalSessionToJson(externalSession);
        }
        return {
            schemaVersion: 'canonical_workout_v1',
            title,
            workoutId: title.toLowerCase().replace(/\s+/g, '_'),
            modality,
            targetDurationMin: 60,
            blocks: [],
            exportedAt: new Date().toISOString(),
        };
    }, [prescription, externalSession, title, modality]);

    // Pre-sync fidelity preview: surfaces lossy/ambiguous prescriptions (e.g. a
    // compound "2 x 3-5 ... plus 2 x 4-6 ..." step, or strength sets with no
    // usable rep target) before they're silently flattened by Garmin sync.
    // Only computed while the menu is open, since it re-derives the full
    // canonical export.
    const fidelityIssues = useMemo(
        () => (isOpen ? validateGarminExportFidelity(getCanonicalExport()) : []),
        [isOpen, getCanonicalExport],
    );
    const fidelityErrors = fidelityIssues.filter(issue => issue.level === 'error');
    const fidelityWarnings = fidelityIssues.filter(issue => issue.level === 'warning');

    const handleDownloadZwift = () => {
        let xml = '';
        if (prescription) {
            xml = generateZwiftFromPrescription(prescription);
        } else if (externalSession) {
            xml = isV2Session(externalSession) ? generateZwiftFromExternalSessionV2(externalSession) : generateZwiftFromExternalSession(externalSession);
        }
        if (xml) {
            const cleanName = title.replace(/[^a-zA-Z0-9_-]/g, '_');
            downloadZwiftFile(`${cleanName}_${date}`, xml);
        }
        setIsOpen(false);
    };

    const handleDownloadJson = () => {
        const payload = getCanonicalExport();
        const cleanName = title.replace(/[^a-zA-Z0-9_-]/g, '_');
        downloadJsonFile(`${cleanName}_${date}`, payload);
        setIsOpen(false);
    };

    const handleCopyJson = async () => {
        const payload = getCanonicalExport();
        await copyJsonToClipboard(payload);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleQueueGarminSync = async () => {
        const payload = getCanonicalExport();
        const blockingIssues = validateGarminExportFidelity(payload).filter(issue => issue.level === 'error');
        if (blockingIssues.length > 0) {
            // Refuse to queue a workout that would silently lose or
            // misrepresent a prescription (e.g. a compound sets/reps step,
            // or strength sets with no usable rep target). JSON download and
            // copy remain available for debugging.
            setSyncState('error');
            setTimeout(() => setSyncState('idle'), 3000);
            return;
        }
        setSyncState('queuing');
        try {
            await garminWorkoutQueueService.queueWorkout(userId, date, payload);
            setSyncState('queued');
            onSyncQueued?.();
            setTimeout(() => {
                setSyncState('idle');
                setIsOpen(false);
            }, 2500);
        } catch (err) {
            console.error('Failed to queue Garmin workout sync:', err);
            setSyncState('error');
            setTimeout(() => setSyncState('idle'), 3000);
        }
    };

    // Close dropdown on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handleOutsideClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isOpen]);

    return (
        <div className="workout-export-container" ref={menuRef}>
            <button
                type="button"
                className="workout-export-trigger-btn"
                onClick={() => setIsOpen(prev => !prev)}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                title="Export or sync structured workout"
            >
                ⬇️ Export / Sync ▾
            </button>

            {isOpen && (
                <div className="workout-export-dropdown" role="menu">
                    {fidelityErrors.length > 0 && (
                        <div className="workout-export-fidelity workout-export-fidelity-error" role="alert">
                            {fidelityErrors.map((issue, i) => (
                                <p key={i}>⛔ {issue.message}</p>
                            ))}
                        </div>
                    )}
                    {fidelityErrors.length === 0 && fidelityWarnings.length > 0 && (
                        <div className="workout-export-fidelity workout-export-fidelity-warning">
                            {fidelityWarnings.map((issue, i) => (
                                <p key={i}>⚠️ {issue.message}</p>
                            ))}
                        </div>
                    )}

                    <button
                        type="button"
                        className="workout-export-item primary-action"
                        role="menuitem"
                        onClick={handleQueueGarminSync}
                        disabled={syncState === 'queuing' || fidelityErrors.length > 0}
                        title={fidelityErrors.length > 0 ? 'Fix the fidelity issue(s) above before syncing' : undefined}
                    >
                        <span className="export-icon">⚡</span>
                        <div className="export-text">
                            <strong>Sync to Garmin Connect</strong>
                            <span>
                                {syncState === 'queuing' ? 'Queuing sync...' :
                                 syncState === 'queued' ? '✓ Queued for Garmin push!' :
                                 syncState === 'error' && fidelityErrors.length > 0 ? 'Blocked: fix fidelity issue(s) above' :
                                 syncState === 'error' ? 'Failed to queue sync' :
                                 fidelityErrors.length > 0 ? 'Cannot sync until fidelity issue(s) are resolved' :
                                 'Upload & schedule to your Garmin calendar'}
                            </span>
                        </div>
                    </button>

                    {isCycling && (
                        <button
                            type="button"
                            className="workout-export-item"
                            role="menuitem"
                            onClick={handleDownloadZwift}
                        >
                            <span className="export-icon">🚴</span>
                            <div className="export-text">
                                <strong>Download Zwift (.zwo)</strong>
                                <span>For Zwift, TrainerRoad, & Edge head units</span>
                            </div>
                        </button>
                    )}

                    <button
                        type="button"
                        className="workout-export-item"
                        role="menuitem"
                        onClick={handleDownloadJson}
                    >
                        <span className="export-icon">📦</span>
                        <div className="export-text">
                            <strong>Download Workout Data (.json)</strong>
                            <span>Full sets, reps, weight, RPE, & targets</span>
                        </div>
                    </button>

                    <button
                        type="button"
                        className="workout-export-item"
                        role="menuitem"
                        onClick={handleCopyJson}
                    >
                        <span className="export-icon">📋</span>
                        <div className="export-text">
                            <strong>{copied ? '✓ Copied JSON!' : 'Copy Workout JSON'}</strong>
                            <span>Copy raw schema to clipboard</span>
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
}
