import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionHistoryTabs } from './SessionHistoryTabs';

const render = (sessionActive: boolean) => renderToStaticMarkup(
    <SessionHistoryTabs sessionActive={sessionActive} session={<p>RUNNER</p>} history={<p>HISTORY</p>} />,
);

describe('SessionHistoryTabs (#726)', () => {
    it('keeps history below the picker, with no tabs, when no session is in progress', () => {
        const html = render(false);
        expect(html).not.toContain('role="tablist"');
        expect(html).not.toContain('hidden');
        expect(html.indexOf('RUNNER')).toBeLessThan(html.indexOf('HISTORY'));
        expect(html).toContain('session-history-below');
    });

    it('defaults to the Session tab while a session is in progress and hides the history panel', () => {
        const html = render(true);
        expect(html).toContain('role="tablist"');
        expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"[^>]*>Session</);
        expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*tabindex="-1"[^>]*>History</);
        // Session panel visible; history panel rendered (stays mounted) but hidden.
        expect(html).toMatch(/role="tabpanel"[^>]*aria-labelledby="[^"]*-tab-session"[^>]*><p>RUNNER/);
        expect(html).toMatch(/role="tabpanel"[^>]*aria-labelledby="[^"]*-tab-history"[^>]*hidden=""[^>]*><p>HISTORY/);
    });

    it('wires each tab to its panel', () => {
        const html = render(true);
        const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
        expect(controls).toHaveLength(2);
        for (const id of controls) expect(html).toContain(`id="${id}"`);
    });
});
