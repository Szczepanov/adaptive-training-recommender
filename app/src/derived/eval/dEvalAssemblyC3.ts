/** C3 performed-session intensity resolution for the D-EVAL assembler. Pure. */

import type { LedgerState } from '../../ledger/export/schema.ts';
import { isProviderActivityRef, isStructuredExecutionRef } from '../../training-occurrence/models.ts';
import { getLocalDateString } from '../../utils/localDate.ts';
import { occurrenceLocalDate, revisionKey, type RevisionPlacementIndex } from './dEvalAssemblyC1.ts';
import type { DEvalC3PerformedSessionInput, DEvalSessionIntensity } from './dEvalC3.ts';
import { parseUtcTimestampMs } from './dEvalCriteria.ts';
import type { DEvalRawExecution, DEvalRawLedgerData, DEvalSourceReadState } from './dEvalRawLedger.ts';

const VALID_SESSION_INTENSITIES: ReadonlySet<string> = new Set(['recovery', 'easy', 'moderate', 'hard', 'max']);

function normalizeIntensity(raw: string | undefined | null): DEvalSessionIntensity | null {
    if (!raw) return null;
    const lower = raw.trim().toLowerCase();
    return VALID_SESSION_INTENSITIES.has(lower) ? (lower as DEvalSessionIntensity) : null;
}

function overrideTimestampRelation(
    iso: string | undefined,
    asOfDate: string,
    asOfMs: number | null,
): 'known' | 'after' | 'unknown' {
    const ms = parseUtcTimestampMs(iso);
    if (ms === null) return 'unknown';
    return (asOfMs !== null ? ms <= asOfMs : getLocalDateString(new Date(ms)) <= asOfDate) ? 'known' : 'after';
}

export function buildC3PerformedSessions(params: {
    raw: DEvalRawLedgerData;
    planIndex: RevisionPlacementIndex;
    execById: ReadonlyMap<string, DEvalRawExecution>;
    blockStartDate: string;
    effectiveEnd: string;
    asOfDate: string;
    asOfMs: number | null;
}): DEvalC3PerformedSessionInput[] {
    const { raw, planIndex, execById, blockStartDate, effectiveEnd, asOfDate, asOfMs } = params;
    const activitiesById = new Map((raw.activities ?? []).map(act => [act.activityId, act]));
    const overridesByActivityId = raw.activityOverrides ?? {};
    const overridesReadable = raw.activityOverridesState !== 'unavailable' && raw.activityOverridesState !== 'invalid';

    const result: DEvalC3PerformedSessionInput[] = [];
    for (const occ of raw.performedOccurrences) {
        if (occ.status !== 'active') continue;
        const occDate = occurrenceLocalDate(occ);
        if (!occDate || occDate < blockStartDate || occDate > effectiveEnd) continue;
        if (asOfMs !== null && occ.startedAt) {
            const startedMs = parseUtcTimestampMs(occ.startedAt);
            if (startedMs !== null && startedMs > asOfMs) continue;
        }

        const structRef = occ.sourceRefs.find(isStructuredExecutionRef);
        const exec = structRef ? execById.get(structRef.executionId) : undefined;
        const src = exec?.sessionSource;

        let authoredIntensity: DEvalSessionIntensity | null = null;
        let performedIntensity: DEvalSessionIntensity | null = null;
        const executedDefinition = exec?.executedDefinition ?? null;

        if (src?.kind === 'external_plan' && src.planId && src.revision !== undefined && src.sessionId) {
            const rev = planIndex.verifiedRevMap.get(revisionKey(src.planId, src.revision));
            if (rev && src.contentHash && rev.contentHash === src.contentHash) {
                const planSession = rev.sessions.find(item => item.id === src.sessionId);
                authoredIntensity = normalizeIntensity(planSession?.gating?.intensity);
            }
        } else if (exec || !structRef) {
            // Unplanned occurrence: check athlete override intensity, then Garmin activity tag. With a
            // structured ref whose execution is absent, the authored intensity is unknown instead.
            const providerRefs = occ.sourceRefs.filter(isProviderActivityRef);
            for (const pRef of providerRefs) {
                const override = overridesByActivityId[pRef.activityId];
                if (override) {
                    const createdRel = overrideTimestampRelation(override.createdAt, asOfDate, asOfMs);
                    const updatedRel = overrideTimestampRelation(override.updatedAt, asOfDate, asOfMs);
                    if (createdRel === 'known' && updatedRel === 'known') {
                        const overrideIntensity = normalizeIntensity(override.overriddenIntensity);
                        if (overrideIntensity) {
                            performedIntensity = overrideIntensity;
                            break;
                        }
                    } else if (createdRel !== 'after') {
                        // A pre-cutoff override edited after the cutoff (or with unparseable timestamps)
                        // cannot be reconstructed as of the cutoff, and Garmin tags cannot replace it.
                        break;
                    }
                }
                // An unreadable override may say `hard`, so the Garmin tag cannot stand in for it.
                if (!overridesReadable) continue;
                const activity = activitiesById.get(pRef.activityId);
                const activityIntensity = normalizeIntensity(activity?.intensityTag);
                if (activityIntensity) {
                    performedIntensity = activityIntensity;
                    break;
                }
            }
        }

        result.push({
            sessionId: occ.performedOccurrenceId,
            performedDate: occDate,
            performedAt: occ.startedAt ?? exec?.startedAt ?? null,
            executedDefinition,
            authoredIntensity,
            reducedIntensity: null,
            performedIntensity,
        });
    }

    return result.sort((a, b) =>
        a.performedDate.localeCompare(b.performedDate) || a.sessionId.localeCompare(b.sessionId));
}

export function toC3SourceState(readState: DEvalSourceReadState): LedgerState {
    if (readState === 'measured' || readState === 'missing') return 'measured';
    return readState;
}
