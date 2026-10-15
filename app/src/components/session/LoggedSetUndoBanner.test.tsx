import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoggedSetUndoBanner } from './LoggedSetUndoBanner';

describe('LoggedSetUndoBanner', () => {
    it('names the set just logged and offers a specifically labelled Undo action', () => {
        const html = renderToStaticMarkup(<LoggedSetUndoBanner label="Set 3" onUndo={vi.fn()} />);
        expect(html).toContain('Set 3 logged');
        expect(html).toContain('Undo set 3');
        expect(html).toContain('role="status"');
    });

    it('names the exercise when the runner may already have advanced to another step', () => {
        const html = renderToStaticMarkup(<LoggedSetUndoBanner label="Set 2" context="Back Squat" onUndo={vi.fn()} />);
        expect(html).toContain('Set 2 logged');
        expect(html).toContain('Back Squat');
        expect(html).toContain('Undo set 2');
    });

    it('wires Undo to the supplied handler', () => {
        const onUndo = vi.fn();
        const element = LoggedSetUndoBanner({ label: 'Set 1', onUndo, children: undefined } as never) as unknown as {
            props: { children: Array<{ type: string; props: { onClick?: () => void } }> };
        };
        const button = element.props.children.find(child => child.type === 'button');
        button?.props.onClick?.();
        expect(onUndo).toHaveBeenCalledOnce();
    });
});
