import { describe, expect, it } from 'vitest';
import { sourceBadgeFor } from './completedWorkoutView';

describe('sourceBadgeFor', () => {
    it('reports structured-only', () => {
        const badge = sourceBadgeFor({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }] });
        expect(badge).toEqual({ hasStructured: true, hasProvider: false, providers: [] });
    });

    it('reports provider-only with a deduped provider list', () => {
        const badge = sourceBadgeFor({
            sourceRefs: [
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-2' },
            ],
        });
        expect(badge).toEqual({ hasStructured: false, hasProvider: true, providers: ['garmin'] });
    });

    it('reports matched (both) sources', () => {
        const badge = sourceBadgeFor({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
        });
        expect(badge).toEqual({ hasStructured: true, hasProvider: true, providers: ['garmin'] });
    });
});
