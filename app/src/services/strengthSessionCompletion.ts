import type { StrengthSession, StrengthSessionState } from '../engine/models';
import { isValidStrengthInstant } from '../engine/strengthSessionValidation';
import { preferencesService } from './preferencesService';
import { strengthSessionService } from './strengthSessionService';

interface StrengthSessionCompletionDependencies {
    applyOneRepMaxDerivations: typeof preferencesService.applyOneRepMaxDerivations;
    transitionState: typeof strengthSessionService.transitionState;
}

const productionDependencies: StrengthSessionCompletionDependencies = {
    applyOneRepMaxDerivations: preferencesService.applyOneRepMaxDerivations.bind(preferencesService),
    transitionState: strengthSessionService.transitionState.bind(strengthSessionService),
};

/** Completion orchestration for S2.2/S1.4. Derivation runs before the terminal transition:
 * if the preferences write fails, the session remains resumable and Finish can be retried.
 * Repeating a successful derivation is safe because only the `derived` ownership rung is
 * writable and the same logged sets deterministically produce the same estimate. */
export async function finalizeStrengthSession(
    userId: string,
    session: StrengthSession,
    next: Exclude<StrengthSessionState, 'in_progress'>,
    nowIso: string = new Date().toISOString(),
    dependencies: StrengthSessionCompletionDependencies = productionDependencies,
): Promise<StrengthSession> {
    if (!isValidStrengthInstant(nowIso) || Date.parse(nowIso) < Date.parse(session.updatedAt)) {
        throw new Error('Strength session completion time must not precede the last saved update');
    }
    if (next === 'completed') {
        await dependencies.applyOneRepMaxDerivations(
            userId,
            { ...session, state: 'completed', completedAt: nowIso, updatedAt: nowIso },
            nowIso,
        );
    }
    return dependencies.transitionState(userId, session.sessionId, next, nowIso);
}
