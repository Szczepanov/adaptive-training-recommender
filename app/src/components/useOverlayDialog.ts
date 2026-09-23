import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let activeScrollLocks = 0;
let previousBodyOverflow = '';
let previousRootOverflow = '';

/** Shared page scroll lock; a second open overlay cannot unlock the first one. */
export function useOverlayScrollLock(open: boolean): void {
    useEffect(() => {
        if (!open) return;
        if (activeScrollLocks++ === 0) {
            previousBodyOverflow = document.body.style.overflow;
            previousRootOverflow = document.documentElement.style.overflow;
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
        }
        return () => {
            if (--activeScrollLocks === 0) {
                document.body.style.overflow = previousBodyOverflow;
                document.documentElement.style.overflow = previousRootOverflow;
            }
        };
    }, [open]);
}

/** Keep a focused control in view when a mobile keyboard or browser chrome resizes the viewport. */
export function useOverlayFocusVisibility(open: boolean, panelRef: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        if (!open) return;
        let revealFrame = 0;
        const revealFocusedControl = () => {
            window.cancelAnimationFrame(revealFrame);
            revealFrame = window.requestAnimationFrame(() => {
                const panel = panelRef.current;
                const active = document.activeElement;
                if (!(active instanceof HTMLElement) || !panel?.contains(active)) return;
                const viewport = window.visualViewport;
                const top = viewport?.offsetTop ?? 0;
                const bottom = top + (viewport?.height ?? window.innerHeight);
                const rect = active.getBoundingClientRect();
                if (rect.top < top + 8 || rect.bottom > bottom - 8) {
                    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
            });
        };
        const handleFocusIn = (event: FocusEvent) => {
            if (event.target instanceof Node && panelRef.current?.contains(event.target)) {
                revealFocusedControl();
            }
        };
        document.addEventListener('focusin', handleFocusIn);
        window.addEventListener('resize', revealFocusedControl);
        window.visualViewport?.addEventListener('resize', revealFocusedControl);
        return () => {
            window.cancelAnimationFrame(revealFrame);
            document.removeEventListener('focusin', handleFocusIn);
            window.removeEventListener('resize', revealFocusedControl);
            window.visualViewport?.removeEventListener('resize', revealFocusedControl);
        };
    }, [open, panelRef]);
}

/** Focus behavior for overlays that do not already own a focus lifecycle. */
export function useOverlayDialog(
    open: boolean,
    panelRef: RefObject<HTMLElement | null>,
    onDismiss?: () => void,
    initialFocusSelector?: string,
): void {
    useOverlayScrollLock(open);
    useOverlayFocusVisibility(open, panelRef);
    const dismissRef = useRef(onDismiss);
    useEffect(() => {
        dismissRef.current = onDismiss;
    }, [onDismiss]);

    useEffect(() => {
        if (!open) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const frame = window.requestAnimationFrame(() => {
            const panel = panelRef.current;
            (initialFocusSelector ? panel?.querySelector<HTMLElement>(initialFocusSelector) : null)?.focus();
            if (!panel?.contains(document.activeElement)) {
                (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
            }
        });
        const handleKeyDown = (event: KeyboardEvent) => {
            const panel = panelRef.current;
            if (!panel) return;
            if (event.key === 'Escape' && !event.defaultPrevented && dismissRef.current) {
                event.preventDefault();
                dismissRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
                .filter(item => item.getClientRects().length > 0);
            if (!items.length) {
                event.preventDefault();
                panel.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKeyDown);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [open, panelRef, initialFocusSelector]);
}
