import { describe, expect, it } from 'vitest';
import type { DailyRecommendation, DailySubjectiveCheckin, FixedActivity, RecommendationAudit, ShadowVerdict } from './models';
import {
    renderBriefPlanAuthority,
    resolveBriefPlanAuthority,
    type BriefPlanAuthorityInput,
} from './briefPlanAuthority';
import { enhanceContextBriefForPlanning, type ContextBriefPlanningHandoffInput, type UpcomingExternalPlanSession } from './contextBriefPlanningHandoff';

const AS_OF = '2026-08-20';

function session(overrides: Partial<UpcomingExternalPlanSession> = {}): UpcomingExternalPlanSession {
    return {
        date: AS_OF, planId: 'p1', planTitle: 'Race prep', revision: 2, sessionId: 'long-anchor',
        title: 'Long Aerobic Anchor', priority: 'key', modality: 'cycling', intensity: 'easy',
        durationMin: 150, durationMax: 180, flexibility: 'fixed', status: 'planned', moved: false,
        isEvent: false, prescription: { summary: 'Steady zone 2' },
        ...overrides,
    };
}

function audit(externalPlan?: RecommendationAudit['externalPlan'], extra: Partial<RecommendationAudit> = {}): RecommendationAudit {
    return {
        policyVersion: 'test', evaluatedAt: `${AS_OF}T06:00:00Z`, decisionContextRevision: 'r1', safetyStatus: 'complete',
        history: { completedEventCount: 0, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'AVAILABLE' } },
        envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'hard' },
        candidateScores: [], droppedContributorObjectives: [],
        ...(externalPlan ? { externalPlan } : {}),
        ...extra,
    } as RecommendationAudit;
}

function rec(overrides: Partial<DailyRecommendation> & { engineVerdict?: ShadowVerdict } = {}): DailyRecommendation {
    return {
        userId: 'u1', date: AS_OF, templateId: 'tempo', templateTitle: 'Tempo Ride', category: 'Tempo',
        modality: 'Cycling', mode: 'train', rationale: 'engine pick', schemaVersion: 3,
        createdAt: `${AS_OF}T06:00:00Z`, updatedAt: `${AS_OF}T06:00:00Z`,
        adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        ...overrides,
    } as DailyRecommendation;
}

const BOUND = { planId: 'p1', revision: 2, sessionId: 'long-anchor', contentHash: 'h' };

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1', date: AS_OF, readiness: 7, sleepQuality: 7, fatigue: 3, soreness: 3, mentalStress: 3, motivation: 7,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 180, preferredModalityToday: null, indoorOnly: false }, notes: null,
        submittedAt: `${AS_OF}T05:40:00Z`, dataQuality: { isComplete: true, missingFields: [] }, schemaVersion: 1,
        createdAt: `${AS_OF}T05:40:00Z`, updatedAt: `${AS_OF}T05:40:00Z`,
        ...overrides,
    } as DailySubjectiveCheckin;
}

function fixed(overrides: Partial<FixedActivity> = {}): FixedActivity {
    return {
        id: 'f1', userId: 'u1', title: 'Football', date: AS_OF, durationMin: 90, fixed: true, environment: 'outdoor',
        equipment: [], isCompleted: false, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
        ...overrides,
    } as FixedActivity;
}

function input(overrides: Partial<BriefPlanAuthorityInput> = {}): BriefPlanAuthorityInput {
    return {
        asOfDate: AS_OF, effectivePlanningMode: 'externally_planned', externalFallback: false, externalFallbackUncertain: false,
        importedSessionsToday: [session()], recommendationToday: null, checkinToday: null, fixedActivitiesToday: [],
        ...overrides,
    };
}

describe('resolveBriefPlanAuthority (#810)', () => {
    it('reports a proceed verdict bound to the placed occurrence as MATCH with the imported session authoritative', () => {
        const result = resolveBriefPlanAuthority(input({
            recommendationToday: rec({ engineVerdict: 'proceed', templateTitle: 'Long Aerobic Anchor', recommendationAudit: audit(BOUND) }),
        }));
        expect(result.outcome).toBe('MATCH');
        expect(result.authoritative).toEqual({ kind: 'imported_session', session: expect.objectContaining({ sessionId: 'long-anchor' }) });
        expect(result.conflictReason).toBeNull();
    });

    it('represents a readiness scale as a modification of the authored session, not a second recommendation', () => {
        const result = resolveBriefPlanAuthority(input({
            recommendationToday: rec({ engineVerdict: 'scale', mode: 'modify', rationale: 'HRV suppressed; scaled to 70%.', recommendationAudit: audit(BOUND) }),
        }));
        expect(result.outcome).toBe('DOSE_MODIFIED');
        expect(result.authoritative?.kind).toBe('imported_session');
        expect(result.override).toEqual({ source: 'engine_adjudication', reason: 'HRV suppressed; scaled to 70%.' });
    });

    it('records the reason and source when a safety gate displaces the authored session', () => {
        const recommendation = rec({ engineVerdict: 'defer', mode: 'recover', templateTitle: 'Rest', rationale: 'Illness reported: safety gate excluded the session.', recommendationAudit: audit(BOUND) });
        const result = resolveBriefPlanAuthority(input({ recommendationToday: recommendation, checkinToday: checkin({ illnessSymptoms: true }) }));
        expect(result.outcome).toBe('SESSION_REPLACED_BY_GATE');
        expect(result.authoritative).toEqual({ kind: 'app_recommendation', recommendation });
        expect(result.override?.reason).toContain('safety gate');
        expect(result.currentSymptomFlags).toEqual(['illness symptoms']);
        const text = renderBriefPlanAuthority(result, AS_OF, recommendation);
        expect(text).toContain('Displaced imported session: plan p1 revision 2, session long-anchor');
        expect(text).toContain('verdict `defer`');
    });

    it('fails closed to CONFLICT_UNRESOLVED when the app recommendation did not adjudicate the placed session', () => {
        const recommendation = rec({ engineVerdict: 'proceed' });
        const result = resolveBriefPlanAuthority(input({ recommendationToday: recommendation }));
        expect(result.outcome).toBe('CONFLICT_UNRESOLVED');
        expect(result.conflictReason).toBe('recommendation_not_bound_to_placed_session');
        expect(result.authoritative).toBeNull();
        const text = renderBriefPlanAuthority(result, AS_OF, recommendation);
        expect(text).toContain('**UNRESOLVED**');
        expect(text).toContain('Unreconciled app recommendation (NOT independently actionable): Tempo Ride');
    });

    it('distinguishes a decision made against another plan revision', () => {
        const result = resolveBriefPlanAuthority(input({
            recommendationToday: rec({ engineVerdict: 'proceed', recommendationAudit: audit({ ...BOUND, revision: 1 }) }),
        }));
        expect(result.outcome).toBe('CONFLICT_UNRESOLVED');
        expect(result.conflictReason).toBe('recommendation_bound_to_other_revision');
    });

    it('does not treat a placed session outside externally-planned mode as silently authoritative', () => {
        const result = resolveBriefPlanAuthority(input({ effectivePlanningMode: 'evergreen', recommendationToday: rec() }));
        expect(result.outcome).toBe('CONFLICT_UNRESOLVED');
        expect(result.conflictReason).toBe('imported_session_outside_externally_planned_mode');
    });

    it('labels a confirmed external fallback with the app recommendation standing in', () => {
        const recommendation = rec();
        const result = resolveBriefPlanAuthority(input({ externalFallback: true, effectivePlanningMode: 'evergreen', importedSessionsToday: [], recommendationToday: recommendation }));
        expect(result.outcome).toBe('EXTERNAL_PLAN_FALLBACK');
        expect(result.authoritative).toEqual({ kind: 'app_recommendation', recommendation });
    });

    it('keeps an unreadable external plan distinct from a confirmed absence', () => {
        const result = resolveBriefPlanAuthority(input({
            externalFallback: true, externalFallbackUncertain: true, effectivePlanningMode: 'evergreen',
            importedSessionsToday: [], recommendationToday: rec(),
        }));
        expect(result.outcome).toBe('EXTERNAL_PLAN_UNREADABLE');
        expect(result.authoritative).toBeNull();
        expect(renderBriefPlanAuthority(result, AS_OF, rec())).toContain('unknown, not as "no session"');
    });

    it('reports NO_AUTHORED_SESSION when no imported plan governs the day', () => {
        const result = resolveBriefPlanAuthority(input({ effectivePlanningMode: 'evergreen', importedSessionsToday: [], recommendationToday: rec() }));
        expect(result.outcome).toBe('NO_AUTHORED_SESSION');
        expect(result.authoritative?.kind).toBe('app_recommendation');
    });

    it('keeps fixed activities as constraints separate from the prescription', () => {
        const result = resolveBriefPlanAuthority(input({
            recommendationToday: rec({ engineVerdict: 'proceed', recommendationAudit: audit(BOUND) }),
            fixedActivitiesToday: [fixed(), fixed({ id: 'f2', date: '2026-08-21' }), fixed({ id: 'f3', isCompleted: true })],
        }));
        expect(result.outcome).toBe('MATCH');
        expect(result.fixedConstraintsToday.map(item => item.id)).toEqual(['f1']);
        expect(renderBriefPlanAuthority(result, AS_OF, null)).toContain('Constraint (not a prescription): fixed activity Football');
    });

    it('treats an imported event as a commitment adjudicated for advice only', () => {
        const result = resolveBriefPlanAuthority(input({
            importedSessionsToday: [session({ isEvent: true })],
            recommendationToday: rec({ engineVerdict: 'advisory', recommendationAudit: audit(BOUND) }),
        }));
        expect(result.outcome).toBe('EVENT_DAY');
        expect(result.authoritative?.kind).toBe('imported_session');
    });

    it('does not present an advisory verdict on a non-event session as clearance', () => {
        const result = resolveBriefPlanAuthority(input({ recommendationToday: rec({ engineVerdict: 'advisory', recommendationAudit: audit(BOUND) }) }));
        expect(result.outcome).toBe('CONFLICT_UNRESOLVED');
    });

    it('reports an authored rest directive as the authority', () => {
        const result = resolveBriefPlanAuthority(input({
            importedSessionsToday: [], effectivePlanningMode: 'evergreen', externalFallback: true,
            recommendationToday: rec({ recommendationAudit: audit(undefined, { externalRest: { planId: 'p1', revision: 2, contentHash: 'h', restDirectiveId: 'r1', date: AS_OF } }) }),
        }));
        expect(result.outcome).toBe('AUTHORED_REST');
    });

    it('keeps an unadjudicated placed session authored, and flags a decision older than the check-in', () => {
        expect(resolveBriefPlanAuthority(input()).outcome).toBe('AUTHORED_UNADJUDICATED');
        const stale = resolveBriefPlanAuthority(input({
            recommendationToday: rec({ engineVerdict: 'proceed', recommendationAudit: audit(BOUND), updatedAt: `${AS_OF}T05:00:00Z` }),
            checkinToday: checkin(),
        }));
        expect(stale.recommendationPredatesCheckin).toBe(true);
    });

    it('lists other same-day authored sessions the decision did not cover', () => {
        const result = resolveBriefPlanAuthority(input({
            importedSessionsToday: [session(), session({ sessionId: 'strength', title: 'Strength' })],
            recommendationToday: rec({ engineVerdict: 'proceed', recommendationAudit: audit(BOUND) }),
        }));
        expect(result.outcome).toBe('MATCH');
        expect(result.otherAuthoredSessionsToday.map(item => item.sessionId)).toEqual(['strength']);
    });

    it('is deterministic for identical input', () => {
        const value = input({ recommendationToday: rec({ engineVerdict: 'scale', recommendationAudit: audit(BOUND) }) });
        expect(resolveBriefPlanAuthority(value)).toEqual(resolveBriefPlanAuthority(value));
    });
});

const BASE = '# Training context brief\n\n## 1. Constraints\n\n- x\n\n## 2. Objective recovery (wearable)\n\n- HRV: 60\n\n## 3. Completed training (recorded by the wearable)\n\nNone.\n';

function briefInput(overrides: Partial<ContextBriefPlanningHandoffInput> = {}): ContextBriefPlanningHandoffInput {
    return {
        asOfDate: AS_OF, snapshots: [], checkins: [], activities: [], recommendations: [rec({ engineVerdict: 'proceed' })],
        trainingSettings: null, preferences: null, effectivePlanningMode: 'externally_planned', externalFallback: false,
        externalFallbackUncertain: false, eventStrategy: null, goals: [], upcomingFixedActivities: [], upcomingPlanBlocks: [],
        upcomingExternalSessions: [session(), session({ date: '2026-08-23', sessionId: 'later', title: 'Later Key' })],
        unavailableSources: [],
        ...overrides,
    };
}

describe('context brief resolved authority block (#810)', () => {
    it('places the resolved authority block before descriptive telemetry and never exports the conflict as two actionable sessions', () => {
        const text = enhanceContextBriefForPlanning(BASE, briefInput());
        const block = text.indexOf('### Resolved planning authority for 2026-08-20');
        expect(block).toBeGreaterThan(-1);
        expect(block).toBeLessThan(text.indexOf('## 1. Constraints'));
        expect(block).toBeLessThan(text.indexOf('## 2. Objective recovery'));
        expect(text).toContain('CONFLICT_UNRESOLVED');
        expect(text).not.toContain('App recommendation for 2026-08-20');
        expect(text).toContain('today: see resolved planning authority (CONFLICT_UNRESOLVED)');
    });

    it('reports matching app and imported sessions as aligned and keeps later imported sessions authored', () => {
        const text = enhanceContextBriefForPlanning(BASE, briefInput({
            recommendations: [rec({ engineVerdict: 'proceed', templateTitle: 'Long Aerobic Anchor', recommendationAudit: audit(BOUND) })],
        }));
        expect(text).toContain('MATCH —');
        expect(text).toContain('revision 2 · authored authority on its date');
    });

    it('puts the authority block ahead of the morning-brief sections', () => {
        const text = enhanceContextBriefForPlanning(BASE, briefInput({ preset: 'daily' }));
        const block = text.indexOf('### Resolved planning authority');
        expect(block).toBeGreaterThan(-1);
        expect(block).toBeLessThan(text.indexOf('## 1. Today'));
        expect(text).toContain('Not independently actionable');
    });
});
