import { useState, useEffect, useCallback, memo } from 'react';
import {
    scheduleOverlayService,
    type ScheduleOverlayWithId,
} from '../../services/scheduleOverlayService';
import { ScheduleOverlayModal } from './ScheduleOverlayModal';
import { getLocalDateString } from '../../utils/localDate';
import './ScheduleOverlayCard.css';

interface ScheduleOverlayCardProps {
    userId: string;
    onChanged?: () => void;
}

function activeSportIcon(sport?: string): string {
    switch (sport) {
        case 'skiing': return '⛷️';
        case 'volleyball': return '🏐';
        case 'hiking': return '🥾';
        case 'court_sport': return '🎾';
        case 'field_sport': return '⚽';
        default: return '🏃';
    }
}

function categoryBadge(category: ScheduleOverlayWithId['category'], sport?: string) {
    if (category === 'active_sport') {
        return { icon: activeSportIcon(sport), label: sport ? `Active (${sport.replaceAll('_', ' ')})` : 'Active Sport', className: 'badge-active' };
    }
    if (category === 'sedentary_rest') {
        return { icon: '🎄', label: 'Sedentary Rest', className: 'badge-rest' };
    }
    if (category === 'limited_availability') {
        return { icon: '⏱️', label: 'Limited Time', className: 'badge-limited' };
    }
    return { icon: '🚶', label: 'High-Step Walking', className: 'badge-walking' };
}

export const ScheduleOverlayCard = memo(function ScheduleOverlayCard({
    userId,
    onChanged,
}: ScheduleOverlayCardProps) {
    const [overlays, setOverlays] = useState<ScheduleOverlayWithId[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedOverlay, setSelectedOverlay] = useState<ScheduleOverlayWithId | null>(null);

    const loadOverlays = useCallback(async () => {
        try {
            setLoading(true);
            setLoadError(null);
            const list = await scheduleOverlayService.listOverlays(userId);
            setOverlays(list);
        } catch (err) {
            console.error('Failed to load schedule overlays:', err);
            setLoadError('Schedule blocks could not be loaded. Retry before relying on this plan view.');
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        void loadOverlays();
    }, [loadOverlays]);

    const handleOpenCreate = () => {
        setSelectedOverlay(null);
        setIsModalOpen(true);
    };

    const handleOpenEdit = (item: ScheduleOverlayWithId) => {
        setSelectedOverlay(item);
        setIsModalOpen(true);
    };

    const handleSaved = () => {
        void loadOverlays();
        onChanged?.();
    };

    const today = getLocalDateString();
    const activeAndUpcoming = overlays.filter(o => o.endDate >= today);
    const past = overlays.filter(o => o.endDate < today);

    return (
        <section className="schedule-overlay-card">
            <div className="card-header">
                <div>
                    <h3 className="card-title">Planned Absences & Sport Blocks</h3>
                    <p className="card-description">
                        Inform the adaptive planner about upcoming trips, holidays, active sport blocks, or time-constrained days weeks or months ahead.
                    </p>
                </div>
                <button
                    type="button"
                    className="btn-add-overlay"
                    onClick={handleOpenCreate}
                >
                    + Plan Schedule Block
                </button>
            </div>

            {loading ? (
                <div className="overlay-loading">Loading schedule blocks...</div>
            ) : loadError ? (
                <div className="overlay-empty-state" role="alert">
                    <span className="empty-icon">⚠️</span>
                    <p>{loadError}</p>
                    <button
                        type="button"
                        className="btn-add-overlay"
                        onClick={() => void loadOverlays()}
                    >
                        Retry
                    </button>
                </div>
            ) : activeAndUpcoming.length === 0 ? (
                <div className="overlay-empty-state">
                    <span className="empty-icon">🗓️</span>
                    <p>No upcoming schedule blocks.</p>
                    <span className="empty-hint">
                        Add trips, rest days, sport blocks, or time-crunch periods so weekly anchors and training dose adapt around them.
                    </span>
                </div>
            ) : (
                <div className="overlay-list">
                    {activeAndUpcoming.map(item => {
                        const badge = categoryBadge(item.category, item.sport);
                        const isCurrent = item.startDate <= today && today <= item.endDate;
                        return (
                            <div
                                key={item.id}
                                className={`overlay-item ${isCurrent ? 'is-active' : ''}`}
                                onClick={() => handleOpenEdit(item)}
                            >
                                <div className="item-main">
                                    <div className="item-title-row">
                                        <span className={`category-badge ${badge.className}`}>
                                            {badge.icon} {badge.label}
                                        </span>
                                        {isCurrent && <span className="status-live-pill">Active Today</span>}
                                        <h4 className="item-title">{item.title}</h4>
                                    </div>
                                    <div className="item-meta-row">
                                        <span className="item-dates">
                                            📅 {item.startDate} &rarr; {item.endDate}
                                        </span>
                                        <span className="item-impact">
                                            {item.dailyAvailabilityMinutes === 0
                                                ? '• Quality anchors blocked (0 min)'
                                                : `• ${item.dailyAvailabilityMinutes} min/day`}
                                        </span>
                                        {item.expectedCost.lowerBody > 0.4 && (
                                            <span className="item-cost-tag">
                                                🦵 Leg cost {Math.round(item.expectedCost.lowerBody * 100)}%
                                            </span>
                                        )}
                                        {item.expectedCost.impactTissue > 0.4 && (
                                            <span className="item-cost-tag">
                                                👟 Impact / step shock {Math.round(item.expectedCost.impactTissue * 100)}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="btn-edit-item"
                                    onClick={e => {
                                        e.stopPropagation();
                                        handleOpenEdit(item);
                                    }}
                                >
                                    Edit
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {past.length > 0 && !loadError && (
                <details className="past-overlays-accordion">
                    <summary className="past-summary">Past Schedule Blocks ({past.length})</summary>
                    <div className="past-list">
                        {past.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                className="past-item"
                                onClick={() => handleOpenEdit(item)}
                            >
                                <span>{item.title}</span>
                                <span className="past-dates">{item.startDate} to {item.endDate}</span>
                            </button>
                        ))}
                    </div>
                </details>
            )}

            <ScheduleOverlayModal
                userId={userId}
                existingOverlay={selectedOverlay}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSaved={handleSaved}
            />
        </section>
    );
});
