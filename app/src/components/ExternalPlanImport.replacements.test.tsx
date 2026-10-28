import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXTERNAL_PLAN_SCHEMA, type ExternalTrainingPlan } from '../engine/models';
import { PlanPreview } from './ExternalPlanImport';
import { describeImportRejection, describeReplacementIssue } from './externalPlanReplacementCopy';

function plan(): ExternalTrainingPlan {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'block', revision: 2, title: 'Block', startDate: '2026-08-17', weekCount: 1,
        sessions: [{
            id: 'new-ride', title: 'New ride', priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
            prescription: { summary: 'Easy ride.' },
        }],
    };
}

const previous = { ...plan(), revision: 1, sessions: [{ ...plan().sessions[0], id: 'old-ride', title: 'Old ride' }] };
const issue = (code: 'replacement-previous-revision-missing' | 'replaced-session-not-found' | 'replaced-session-completed' | 'replaced-session-before-effective-date' | 'replaced-placement-unreadable', replacesSessionId = 'old-ride') => ({
    code, field: 'sessions[0].replacesSessionId', sessionId: 'new-ride', replacesSessionId,
});

describe('session replacement copy (#1172)', () => {
    it('explains each preflight issue in athlete language with the fix', () => {
        expect(describeReplacementIssue(issue('replaced-session-not-found', 'ghost'), plan(), previous)).toBe(
            'New ride says it replaces session “ghost”, but revision 1 has no session with that id. Correct or remove replacesSessionId for New ride.');
        expect(describeReplacementIssue(issue('replacement-previous-revision-missing'), plan(), null)).toBe(
            'New ride says it replaces session “old-ride”, but this plan has no earlier revision to replace from. Remove replacesSessionId for New ride.');
        expect(describeReplacementIssue(issue('replaced-session-before-effective-date'), plan(), previous)).toBe(
            'New ride would replace Old ride before this revision takes effect. Choose an earlier effective date or remove replacesSessionId for New ride.');
        expect(describeReplacementIssue(issue('replaced-placement-unreadable'), plan(), previous)).toBe(
            'The saved moves for revision 1 could not be read, so its replaced sessions cannot be marked. Open the plan, use Reset moves on revision 1 first, then import this revision again.');
        expect(describeReplacementIssue(issue('replaced-session-completed'), plan(), previous)).toBe(
            'New ride would replace Old ride, which you have already started or completed. A performed session cannot be replaced. Remove replacesSessionId for New ride.');
    });

    it('maps import rejections to the same copy and leaves other codes to the generic message', () => {
        const documentPath = 'users/u1/external_plans/block/revisions/1/placement/current';
        const declaring = { ...plan().sessions[0], replacesSessionId: 'old-ride' };
        const next: ExternalTrainingPlan = { ...plan(), sessions: [declaring] };
        expect(describeImportRejection([{ code: 'replaced-session-before-effective-date', field: 'sessions[0].replacesSessionId', documentPath }], next, previous))
            .toEqual(['New ride would replace Old ride before this revision takes effect. Choose an earlier effective date or remove replacesSessionId for New ride.']);
        expect(describeImportRejection([{ code: 'replaced-session-completed', field: 'sessions[0].replacesSessionId', documentPath }], next, previous))
            .toEqual(['New ride would replace Old ride, which you have already started or completed. A performed session cannot be replaced. Remove replacesSessionId for New ride.']);
        expect(describeImportRejection([{ code: 'replaced-placement-owner-mismatch', documentPath }], next, previous))
            .toEqual(['The earlier revision’s saved moves belong to another account, so its replaced sessions cannot be marked. Nothing was stored.']);
        expect(describeImportRejection([{ code: 'replaced-placement-unreadable', documentPath }], next, previous))
            .toEqual(['The saved moves for revision 1 could not be read, so its replaced sessions cannot be marked. Nothing was stored. Open the plan, use Reset moves on revision 1 first, then import this revision again.']);
        expect(describeImportRejection([{ code: 'replaced-session-successor-conflict', field: 'sessions[0].replacesSessionId', documentPath }], next, previous))
            .toEqual(['Old ride is already marked as replaced by a different session. Nothing was stored.']);
        expect(describeImportRejection([{ code: 'revision-not-newer', field: 'revision', documentPath }], next, previous)).toEqual([]);
        // A field that does not resolve to a declaring session is left to the generic message.
        expect(describeImportRejection([{ code: 'replaced-session-completed', field: 'sessions[0].replacesSessionId', documentPath }], plan(), previous)).toEqual([]);
    });

    it('blocks the preview and lists invalid replacements', () => {
        const html = renderToStaticMarkup(
            <PlanPreview plan={plan()} previous={null} diff={null} previousPlan={previous} today="2026-08-16" effectiveFrom="2026-08-17"
                preflight={{ status: 'invalid_replacements', issues: [issue('replaced-session-not-found', 'ghost')] }}
                onConfirm={() => {}} onCancel={() => {}} />,
        );
        expect(html).toContain('This revision cannot be imported until its session replacements are fixed.');
        expect(html).toContain('revision 1 has no session with that id');
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Import this plan<\/button>/);
    });

    it('lists declared replacements as acknowledgement findings', () => {
        const html = renderToStaticMarkup(
            <PlanPreview plan={plan()} previous={null} diff={null} today="2026-08-16" effectiveFrom="2026-08-17"
                preflight={{ status: 'ready', findings: [{ kind: 'session_replacement', code: 'session_replacement_declared', date: '2026-08-18',
                    detail: 'New ride replaces Old ride from revision 1. Old ride stays on its date and is marked as replaced.' }] }}
                onConfirm={() => {}} onCancel={() => {}} />,
        );
        expect(html).toContain('2026-08-18 — New ride replaces Old ride from revision 1.');
        expect(html).toContain('I reviewed these placement, calendar, and authority impacts.');
    });
});
