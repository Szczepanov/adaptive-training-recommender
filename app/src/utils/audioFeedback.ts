/**
 * Web Audio API synthesizer for countdown and rest completion sound cues.
 * No external audio files needed; runs purely in-memory with zero latency.
 */

const STORAGE_KEY = 'workout_sound_enabled';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtx) {
        audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}

export function isSoundEnabled(): boolean {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
}

export function setSoundEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, String(enabled));
}

/**
 * Plays a countdown beep.
 * @param isFinal True for 'GO' (higher pitch), false for standard tick (3..2..1)
 */
export function playCountdownBeep(isFinal: boolean = false): void {
    if (!isSoundEnabled()) return;

    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        const now = ctx.currentTime;
        const freq = isFinal ? 880 : 520;
        const duration = isFinal ? 0.3 : 0.12;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + duration);

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate(isFinal ? [100, 50, 150] : 40);
        }
    } catch {
        // AudioContext autoplay restriction or environment error safely ignored
    }
}

/**
 * Plays a 2-tone melodic chime for rest timer completion.
 */
export function playRestCompleteSound(): void {
    if (!isSoundEnabled()) return;

    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;

        // Tone 1: 587.33 Hz (D5)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(587.33, now);
        gain1.gain.setValueAtTime(0.2, now);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.18);

        // Tone 2: 880.00 Hz (A5)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880.00, now + 0.16);
        gain2.gain.setValueAtTime(0.25, now + 0.16);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.16);
        osc2.stop(now + 0.5);

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([150, 80, 200]);
        }
    } catch {
        // Safely ignore
    }
}
