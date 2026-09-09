import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SCREEN_LABELS } from '../types/navigation';
import { PlanAuthorityBanner } from './PlanAuthorityBanner';
import {
    shouldShowAuthorityBanner,
    type AuthorityBannerInput,
} from './planAuthorityBannerRule';

const base: AuthorityBannerInput = {
    hasImportedPlan: true,
    coachSessionTitleToday: 'Tempo Run 40min',
    coachHasExplicitRestToday: false,
    adaptiveModeToday: 'train',
    adaptiveTitleToday: 'Tempo Run 40min',
    coachFlaggedToday: false,
};

describe('shouldShowAuthorityBanner', () => {
    it('hides when no imported coach plan is active', () => {
        expect(shouldShowAuthorityBanner({ ...base, hasImportedPlan: false })).toBe(false);
    });

    it('hides an unplanned coach day instead of guessing that it means rest', () => {
        expect(shouldShowAuthorityBanner({
            ...base,
            coachSessionTitleToday: null,
            coachHasExplicitRestToday: false,
        })).toBe(false);
    });

    it('hides when the same-day adaptive recommendation is unavailable', () => {
        expect(shouldShowAuthorityBanner({ ...base, adaptiveModeToday: null })).toBe(false);
    });

    it('hides when an explicit coach rest agrees with adaptive recovery', () => {
        expect(shouldShowAuthorityBanner({
            ...base,
            coachSessionTitleToday: null,
            coachHasExplicitRestToday: true,
            adaptiveModeToday: 'recover',
            adaptiveTitleToday: 'Recovery Day',
        })).toBe(false);
    });

    it('shows when an explicit coach rest conflicts with adaptive training', () => {
        expect(shouldShowAuthorityBanner({
            ...base,
            coachSessionTitleToday: null,
            coachHasExplicitRestToday: true,
        })).toBe(true);
    });

    it('hides when both sides prescribe the same normal session today', () => {
        expect(shouldShowAuthorityBanner(base)).toBe(false);
    });

    it('treats titles as equal ignoring case and surrounding whitespace', () => {
        expect(
            shouldShowAuthorityBanner({ ...base, adaptiveTitleToday: '  tempo run 40MIN ' }),
        ).toBe(false);
    });

    it('shows when the adaptive path reduces load even if the title matches', () => {
        expect(shouldShowAuthorityBanner({ ...base, adaptiveModeToday: 'modify' })).toBe(true);
    });

    it('shows when the coach prescribes a session and adaptive guidance prescribes recovery', () => {
        expect(shouldShowAuthorityBanner({ ...base, adaptiveModeToday: 'recover' })).toBe(true);
    });

    it('shows when both prescribe normal work but name different sessions', () => {
        expect(
            shouldShowAuthorityBanner({ ...base, adaptiveTitleToday: 'Easy Strength 30min' }),
        ).toBe(true);
    });

    it('shows when the critique flags today even if the titles match', () => {
        expect(shouldShowAuthorityBanner({ ...base, coachFlaggedToday: true })).toBe(true);
    });

    it('fails closed when normal-work disagreement cannot be confirmed without an adaptive title', () => {
        expect(shouldShowAuthorityBanner({ ...base, adaptiveTitleToday: null })).toBe(false);
    });
});

describe('PlanAuthorityBanner', () => {
    it('renders nothing when the sides agree', () => {
        const html = renderToStaticMarkup(
            <PlanAuthorityBanner {...base} onViewHome={() => undefined} />,
        );
        expect(html).toBe('');
    });

    it('names the authoritative view and links to it on genuine disagreement', () => {
        const html = renderToStaticMarkup(
            <PlanAuthorityBanner
                {...base}
                adaptiveModeToday="recover"
                onViewHome={() => undefined}
            />,
        );
        expect(html).toContain('differ today');
        expect(html).toContain(`Follow the decision on ${SCREEN_LABELS.home}`);
        expect(html).toContain('safety limits still apply');
        expect(html).toContain(`View ${SCREEN_LABELS.home}`);
    });

    it('keeps verdict copy without a link when no navigation handler is provided', () => {
        const html = renderToStaticMarkup(
            <PlanAuthorityBanner {...base} adaptiveModeToday="recover" />,
        );
        expect(html).toContain('differ today');
        expect(html).not.toContain('<button');
    });
});
