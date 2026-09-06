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

function categoryBadge(category: ScheduleOverlayWithId['category'], sport?: string) {
    if (category === 'active_sport') {
        return { icon: '⛷️', label: sport ? `Active (${sport})` : 'Active Sport', className: 'badge-active' };
    }
    if (category === 'sedentary_rest') {
        return { icon: '🎄', label: 'Sedentary Rest', className: 'badge-rest' };
    }
    return { icon: '🚶', label: 'High-Step Walking', className: 'badge-walking' };
}

export const ScheduleOverlayCard = memo(function ScheduleOverlayCard({
    userId,
    onChanged,
}: ScheduleOverlayCardProps) {
    const [overlays, setOverlays] = useState<ScheduleOverlayWithId[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedOverlay, setSelectedOverlay] = useState<ScheduleOverlayWithId | null>(null);

    const loadOverlays = useCallback(async () => {
        try {
            setLoading(true);
            const list = await scheduleOverlayService.listOverlays(userId);
            setOverlays(list);
        } catch (err) {
            console.error('Failed to load schedule overlays:', err);
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
    // Filter out past overlays that ended before today, but show them in collapsible or just show active & future
    const activeAndUpcoming = overlays.filter(o => o.endDate >= today);
    const past = overlays.filter(o => o.endDate < today);

    return (
        <section className="schedule-overlay-card">
            <div className="card-header">
                <div>
                    <h3 className="card-title">Planned Absences & Sport Blocks</h3>
                    <p className="card-description">
                        Inform the adaptive planner about upcoming trips, holidays, and active sport blocks (skiing, volleyball, city walks) weeks or months ahead.
                    </p>
                </div>
                <button
                    type="button"
                    className="btn-add-overlay"
                    onClick={handleOpenCreate}
                >
                    + Plan Absence
                </button>
            </div>

            {loading ? (
                <div className="overlay-loading">Loading schedule blocks...</div>
            ) : activeAndUpcoming.length === 0 ? (
                <div className="overlay-empty-state">
                    <span className="empty-icon">🗓️</span>
                    <p>No upcoming planned absences.</p>
                    <span className="empty-hint">
                        Add trips or rest days (like Christmas or skiing) so macro cycles and weekly anchors avoid them.
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

            {past.length > 0 && (
                <details className="past-overlays-accordion">
                    <summary className="past-summary">Past Absences ({past.length})</summary>
                    <div className="past-list">
                        {past.map(item => (
                            <div key={item.id} className="past-item" onClick={() => handleOpenEdit(item)}>
                                <span>{item.title}</span>
                                <span className="past-dates">{item.startDate} to {item.endDate}</span>
                            </div>
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
