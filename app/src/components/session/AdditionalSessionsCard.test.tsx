import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdditionalSessionsCard } from './AdditionalSessionsCard';
import { isMemberLaunchable } from './additionalSessionLaunchability';
import type { IntradayBundleMemberStatus } from '../../services/intradayBundleMemberAdjudication';
import type { SessionReferenceBinding } from '../../sessions/models';

const binding: SessionReferenceBinding = {
    sessionSource: { kind: 'external_plan', planId: 'plan-1', revision: 1, sessionId: 'pm-1', contentHash: 'a'.repeat(64) },
    occurrenceId: 'occ-pm-1',
    prescriptionHash: 'b'.repeat(64),
};

function member(overrides: Partial<IntradayBundleMemberStatus> = {}): IntradayBundleMemberStatus {
    return {
        sessionId: 'pm-1',
        status: 'proceed',
        reason: 'Capacity and predecessor confirmation verified.',
        occurrenceId: 'occ-pm-1',
        binding,
        title: 'Evening endurance ride',
        windowId: 'win-pm',
        boundStartLocal: '17:00',
        boundEndLocal: '18:30',
        orderInBundle: 1,
        ...overrides,
    };
}

describe('AdditionalSessionsCard (H4 plan step 10)', () => {
    it('renders a launchable member with its resolved window and order label', () => {
        const html = renderToStaticMarkup(
            <AdditionalSessionsCard members={[member()]} onStartMember={vi.fn()} />,
        );

        expect(html).toContain('Evening endurance ride');
        expect(html).toContain('17:00–18:30');
        expect(html).toContain('Session 1 today');
        expect(html).toContain('>Start</button>');
    });

    // The plan's explicit acceptance criterion for step 10, and the reason this component
    // exists: D-REASSESS's non-`proceed` verdicts must be unlaunchable through the UI, not
    // merely discouraged. A Start control here would route around the verdict itself.
    it.each([
        ['pending', 'Waiting on your post-session check-in.'],
        ['scale', 'Reduced to fit remaining capacity.'],
        ['reject', 'Sharp knee pain reported after the morning session.'],
    ] as const)('exposes no Start control for a %s member, and shows its reason instead', (status, reason) => {
        const target = member({ status, reason, binding: undefined });
        expect(isMemberLaunchable(target)).toBe(false);

        const html = renderToStaticMarkup(
            <AdditionalSessionsCard members={[target]} onStartMember={vi.fn()} />,
        );
        expect(html).not.toContain('<button');
        expect(html).toContain(reason);
    });

    // A `scale` verdict that somehow still carries a binding must stay unlaunchable. Guards
    // the rule itself rather than the one call path that happens to produce it today.
    it('never treats a non-proceed verdict as launchable even if a binding is attached', () => {
        expect(isMemberLaunchable(member({ status: 'scale' }))).toBe(false);
        expect(isMemberLaunchable(member({ status: 'pending' }))).toBe(false);
        expect(isMemberLaunchable(member({ status: 'reject' }))).toBe(false);
    });

    // A `proceed` without a binding is not a contradiction to paper over: the adjudication
    // loop emits exactly that for a member omitted by the 4-additional-session cap.
    it('exposes no Start control for a proceed member that received no binding', () => {
        const capped = member({ binding: undefined, reason: 'Maximum 4 additional sessions cap reached' });
        expect(isMemberLaunchable(capped)).toBe(false);

        const html = renderToStaticMarkup(<AdditionalSessionsCard members={[capped]} onStartMember={vi.fn()} />);
        expect(html).not.toContain('<button');
        expect(html).toContain('Maximum 4 additional sessions cap reached');
    });

    it('renders nothing when there are no adjudicated members', () => {
        expect(renderToStaticMarkup(<AdditionalSessionsCard members={[]} />)).toBe('');
    });

    it('omits window and order rather than inventing them when a member carries neither', () => {
        const html = renderToStaticMarkup(
            <AdditionalSessionsCard
                members={[member({
                    title: undefined,
                    boundStartLocal: undefined,
                    boundEndLocal: undefined,
                    orderInBundle: undefined,
                })]}
                onStartMember={vi.fn()}
            />,
        );

        expect(html).toContain('pm-1');
        expect(html).not.toMatch(/Session \d+ today/);
        expect(html).not.toContain('–');
    });

    it('renders every member of a multi-member bundle, mixing launchable and blocked', () => {
        const html = renderToStaticMarkup(
            <AdditionalSessionsCard
                members={[
                    member(),
                    member({ sessionId: 'pm-2', title: 'Evening mobility', status: 'pending', binding: undefined, reason: 'Waiting on your post-session check-in.', orderInBundle: 2 }),
                ]}
                onStartMember={vi.fn()}
            />,
        );

        expect(html).toContain('Evening endurance ride');
        expect(html).toContain('Evening mobility');
        // Exactly one Start control: the launchable member's.
        expect(html.match(/>Start<\/button>/g)).toHaveLength(1);
    });
});
