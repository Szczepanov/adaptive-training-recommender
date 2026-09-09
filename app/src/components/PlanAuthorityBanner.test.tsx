import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SCREEN_LABELS } from '../types/navigation';
import {
    PlanAuthorityBanner,
} from './PlanAuthorityBanner';
import {
    shouldShowAuthorityBanner,
    type AuthorityBannerInput,
} from './planAuthorityBannerRule';

const base: AuthorityBannerInput = {
    hasImportedPlan: true,
    coachSessionTitleToday: 'Tempo Run 40min',
    forecastModeToday: 'train',
    forecastTitleToday: 'Tempo Run 40min',
    coachFlaggedToday: false,
};

describe('shouldShowAuthorityBanner', () => {
    it('hides when no imported coach plan is active', () => {
        expect(shouldShowAuthorityBanner({ ...base, hasImportedPlan: false })).toBe(false);
    });

    it('hides when the coach plan rests today', () => {
        expect(shouldShowAuthorityBanner({ ...base, coachSessionTitleToday: null })).toBe(false);
    });

    it('hides when the forecast has no day for today', () => {
        expect(shouldShowAuthorityBanner({ ...base, forecastModeToday: null })).toBe(false);
    });

    it('hides when both sides prescribe the same session today', () => {
        expect(shouldShowAuthorityBanner(base)).toBe(false);
    });

    it('treats titles as equal ignoring case and surrounding whitespace', () => {
        expect(
            shouldShowAuthorityBanner({ ...base, forecastTitleToday: '  tempo run 40MIN ' }),
        ).toBe(false);
    });

    it('shows when the coach prescribes work and the forecast prescribes recovery', () => {
        expect(shouldShowAuthorityBanner({ ...base, forecastModeToday: 'recover' })).toBe(true);
    });

    it('shows when both prescribe work but name different sessions', () => {
        expect(
            shouldShowAuthorityBanner({ ...base, forecastTitleToday: 'Easy Strength 30min' }),
        ).toBe(true);
    });

    it('shows when the critique flags today even if the titles match', () => {
        expect(shouldShowAuthorityBanner({ ...base, coachFlaggedToday: true })).toBe(true);
    });

    it('shows when agreement cannot be confirmed without a forecast title', () => {
        expect(shouldShowAuthorityBanner({ ...base, forecastTitleToday: null })).toBe(true);
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
                forecastModeToday="recover"
                onViewHome={() => undefined}
            />,
        );
        expect(html).toContain('differ today');
        expect(html).toContain(`follow ${SCREEN_LABELS.home} for today`);
        expect(html).toContain('safety limits still apply');
        expect(html).toContain(`View ${SCREEN_LABELS.home}`);
    });

    it('keeps verdict copy without a link when no navigation handler is provided', () => {
        const html = renderToStaticMarkup(
            <PlanAuthorityBanner {...base} forecastModeToday="recover" />,
        );
        expect(html).toContain('differ today');
        expect(html).not.toContain('<button');
    });
});
