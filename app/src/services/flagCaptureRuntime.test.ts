import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLAG_INPUTS_CHANGED, notifyFlagInputsChanged } from './flagCaptureRuntime';

describe('flag capture mutation notification', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('notifies the mounted account after inputs change without importing persistence', () => {
        const target = new EventTarget();
        vi.stubGlobal('window', target);
        const listener = vi.fn();
        target.addEventListener(FLAG_INPUTS_CHANGED, listener);
        notifyFlagInputsChanged('alice');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0][0].detail).toEqual({ userId: 'alice' });
    });
    it('has no side effect without an app window', () => {
        vi.stubGlobal('window', undefined);
        expect(() => notifyFlagInputsChanged('alice')).not.toThrow();
    });
});
