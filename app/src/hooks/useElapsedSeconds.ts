import { useEffect, useState } from 'react';
import { elapsedSeconds } from '../workouts/restTimer';

/** Live "time since X" display (S1.6, ADR-0021). The `setInterval` here exists only to
 *  trigger a re-render once a second -- it is never the source of the displayed value.
 *  Every tick recomputes `elapsedSeconds(sinceIso, now)` fresh from wall-clock time, so a
 *  throttled or suspended background tab (routine: phone in a pocket between sets) cannot
 *  make the display drift low. Whatever tick does eventually fire shows the true elapsed
 *  time, not an accumulated count of ticks that were missed. No test file, matching this
 *  repo's precedent for hooks with no `@testing-library/react` available
 *  (`useGarminSyncStatus` has none either); the value this hook displays,
 *  `elapsedSeconds`, is fully unit-tested in `restTimer.test.ts`. */
export function useElapsedSeconds(sinceIso: string | null): number {
    const [nowIso, setNowIso] = useState(() => new Date().toISOString());

    useEffect(() => {
        if (!sinceIso) return;
        const interval = setInterval(() => setNowIso(new Date().toISOString()), 1000);
        return () => clearInterval(interval);
    }, [sinceIso]);

    return sinceIso ? elapsedSeconds(sinceIso, nowIso) : 0;
}
