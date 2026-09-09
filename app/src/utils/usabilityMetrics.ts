export interface UsabilitySessionEvent {
    id: string;
    timestamp: string;
    eventType: 'recommendation_view' | 'action_selected' | 'alternative_chosen' | 'override_attempt' | 'completion_reported' | 'wizard_completed';
    userId: string;
    date: string;
    durationMs?: number;
    actionType?: string;
    details?: Record<string, unknown>;
}

export type OnboardingWizardStage = 'welcome' | 'focus' | 'equipment';

export interface UsabilitySummaryReport {
    totalViews: number;
    totalActions: number;
    wizardCompletions: number;
    wizardSkips: number;
    wizardSkipsByStage: Record<string, number>;
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
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((e): e is UsabilitySessionEvent =>
                e !== null &&
                typeof e === 'object' &&
                typeof (e as UsabilitySessionEvent).id === 'string' &&
                typeof (e as UsabilitySessionEvent).eventType === 'string' &&
                typeof (e as UsabilitySessionEvent).userId === 'string' &&
                typeof (e as UsabilitySessionEvent).date === 'string'
            );
        } catch {
            return null;
        }
    }

    private getStoredEvents(): UsabilitySessionEvent[] {
        const persisted = this.readPersistedEvents();
        if (persisted === null) return this.memoryEvents;
        if (this.memoryEvents.length === 0) return persisted;

        // Session events are also kept in memory so telemetry still works when a
        // browser permits reads but rejects localStorage writes. Merge by id to avoid
        // double-counting events that were persisted successfully.
        const merged = new Map(persisted.map(event => [event.id, event]));
        for (const event of this.memoryEvents) merged.set(event.id, event);
        return [...merged.values()];
    }

    private saveEvent(event: UsabilitySessionEvent): void {
        this.memoryEvents = [...this.memoryEvents, event].slice(-200);
        if (typeof window === 'undefined') return;

        try {
            // Read storage directly instead of getStoredEvents(). getStoredEvents() merges
            // memory, which already contains `event` and would duplicate the first browser
            // event when localStorage is initially empty without the id de-duplication above.
            const persisted = this.readPersistedEvents();
            if (persisted === null) return;
            const trimmed = [...persisted, event].slice(-200);
            window.localStorage?.setItem(this.storageKey, JSON.stringify(trimmed));
        } catch {
            // Non-critical local instrumentation failure. The current session still retains
            // the event in memory and generateSummaryReport() will include it.
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

    recordAlternativeChosen(userId: string, date: string, alternativeType: string, targetWorkoutId?: string): number | undefined {
        const key = `${userId}:${date}`;
        const startTime = this.viewStartTimes.get(key);
        const durationMs = startTime !== undefined ? Math.round(performance.now() - startTime) : undefined;
        this.viewStartTimes.delete(key);

        this.saveEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            eventType: 'alternative_chosen',
            userId,
            date,
            durationMs,
            actionType: alternativeType,
            details: { targetWorkoutId },
        });

        return durationMs;
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

    recordWizardCompleted(
        userId: string,
        date: string,
        outcome: 'completed' | 'skipped',
        durationMs?: number,
        stage?: OnboardingWizardStage,
    ): void {
        this.saveEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            eventType: 'wizard_completed',
            userId,
            date,
            durationMs,
            details: { outcome, stage },
        });
    }

    generateSummaryReport(): UsabilitySummaryReport {
        const events = this.getStoredEvents();
        const views = events.filter(e => e.eventType === 'recommendation_view');
        const actions = events.filter(e => e.eventType === 'action_selected');
        const wizardOutcomes = events.filter(e => e.eventType === 'wizard_completed');
        const wizardSkips = wizardOutcomes.filter(e => e.details?.outcome === 'skipped');
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

        const wizardSkipsByStage: Record<string, number> = {};
        for (const event of wizardSkips) {
            const stage = event.details?.stage;
            const key = stage === 'welcome' || stage === 'focus' || stage === 'equipment'
                ? stage
                : 'unknown';
            wizardSkipsByStage[key] = (wizardSkipsByStage[key] ?? 0) + 1;
        }

        const overrideRate = actions.length > 0 ? overrides.length / actions.length : 0;
        const errorRate = overrides.length > 0 ? blockedOverrides.length / overrides.length : 0;

        return {
            totalViews: views.length,
            totalActions: actions.length,
            wizardCompletions: wizardOutcomes.filter(e => e.details?.outcome === 'completed').length,
            wizardSkips: wizardSkips.length,
            wizardSkipsByStage,
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
