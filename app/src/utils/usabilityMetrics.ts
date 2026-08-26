export interface UsabilitySessionEvent {
    id: string;
    timestamp: string;
    eventType: 'recommendation_view' | 'action_selected' | 'alternative_chosen' | 'override_attempt' | 'completion_reported';
    userId: string;
    date: string;
    durationMs?: number;
    actionType?: string;
    details?: Record<string, unknown>;
}

export interface UsabilitySummaryReport {
    totalViews: number;
    totalActions: number;
    averageTtrMs: number;
    medianTtrMs: number;
    overrideRate: number;
    errorRate: number;
    actionBreakdown: Record<string, number>;
}

class UsabilityMetricsTracker {
    private readonly storageKey = 'adaptive_training_usability_events_v1';
    private memoryEvents: UsabilitySessionEvent[] = [];
    private viewStartTimes: Map<string, number> = new Map();

    private readPersistedEvents(): UsabilitySessionEvent[] | null {
        if (typeof window === 'undefined') return null;
        try {
            const raw = window.localStorage?.getItem(this.storageKey);
            if (!raw) return [];
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed as UsabilitySessionEvent[] : [];
        } catch {
            return null;
        }
    }

    private getStoredEvents(): UsabilitySessionEvent[] {
        return this.readPersistedEvents() ?? this.memoryEvents;
    }

    private saveEvent(event: UsabilitySessionEvent): void {
        this.memoryEvents.push(event);
        if (typeof window === 'undefined') return;

        try {
            // Read storage directly instead of getStoredEvents(). getStoredEvents() falls
            // back to memory, which already contains `event` and would duplicate the first
            // browser event when localStorage is initially empty.
            const persisted = this.readPersistedEvents();
            if (persisted === null) return;
            const trimmed = [...persisted, event].slice(-200);
            window.localStorage?.setItem(this.storageKey, JSON.stringify(trimmed));
        } catch {
            // Non-critical local instrumentation failure.
        }
    }

    recordRecommendationView(userId: string, date: string): void {
        const key = `${userId}:${date}`;
        // A later render may emit another view event; keep the original clock so TTR means
        // time from first visible recommendation to first deliberate action.
        if (!this.viewStartTimes.has(key)) {
            this.viewStartTimes.set(key, performance.now());
        }
        this.saveEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            eventType: 'recommendation_view',
            userId,
            date,
        });
    }

    recordActionSelected(userId: string, date: string, actionType: string, details?: Record<string, unknown>): number | undefined {
        const key = `${userId}:${date}`;
        const startTime = this.viewStartTimes.get(key);
        const durationMs = startTime !== undefined ? Math.round(performance.now() - startTime) : undefined;
        // Time-to-recommendation is a first-action metric. Subsequent actions on the same
        // decision must not be timed from the original page view.
        if (startTime !== undefined) this.viewStartTimes.delete(key);

        this.saveEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            eventType: 'action_selected',
            userId,
            date,
            durationMs,
            actionType,
            details,
        });

        return durationMs;
    }

    recordAlternativeChosen(userId: string, date: string, alternativeType: string, targetWorkoutId?: string): void {
        this.saveEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            eventType: 'alternative_chosen',
            userId,
            date,
            actionType: alternativeType,
            details: { targetWorkoutId },
        });
    }

    recordOverrideAttempt(userId: string, date: string, reason: string, blockedByGate: boolean): void {
        this.saveEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            eventType: 'override_attempt',
            userId,
            date,
            details: { reason, blockedByGate },
        });
    }

    recordCompletionReport(userId: string, date: string, followed: boolean, actualModality?: string | null): void {
        this.saveEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            eventType: 'completion_reported',
            userId,
            date,
            details: { followed, actualModality },
        });
    }

    generateSummaryReport(): UsabilitySummaryReport {
        const events = this.getStoredEvents();
        const views = events.filter(e => e.eventType === 'recommendation_view');
        const actions = events.filter(e => e.eventType === 'action_selected');
        const overrides = events.filter(e => e.eventType === 'override_attempt');
        const blockedOverrides = overrides.filter(e => e.details?.blockedByGate === true);

        const ttrValues = actions
            .map(a => a.durationMs)
            .filter((t): t is number => typeof t === 'number' && t >= 0 && t < 300000)
            .sort((a, b) => a - b);
        const avgTtr = ttrValues.length > 0 ? ttrValues.reduce((sum, v) => sum + v, 0) / ttrValues.length : 0;
        let medianTtr = 0;
        if (ttrValues.length > 0) {
            const middle = Math.floor(ttrValues.length / 2);
            medianTtr = ttrValues.length % 2 === 0
                ? (ttrValues[middle - 1] + ttrValues[middle]) / 2
                : ttrValues[middle];
        }

        const actionBreakdown: Record<string, number> = {};
        for (const action of actions) {
            const key = action.actionType ?? 'unknown';
            actionBreakdown[key] = (actionBreakdown[key] ?? 0) + 1;
        }

        const overrideRate = actions.length > 0 ? overrides.length / actions.length : 0;
        const errorRate = overrides.length > 0 ? blockedOverrides.length / overrides.length : 0;

        return {
            totalViews: views.length,
            totalActions: actions.length,
            averageTtrMs: Math.round(avgTtr),
            medianTtrMs: Math.round(medianTtr),
            overrideRate: Math.round(overrideRate * 100) / 100,
            errorRate: Math.round(errorRate * 100) / 100,
            actionBreakdown,
        };
    }

    clear(): void {
        this.memoryEvents = [];
        if (typeof window !== 'undefined') {
            try {
                window.localStorage?.removeItem(this.storageKey);
            } catch {
                // ignore
            }
        }
        this.viewStartTimes.clear();
    }
}

export const usabilityMetrics = new UsabilityMetricsTracker();
