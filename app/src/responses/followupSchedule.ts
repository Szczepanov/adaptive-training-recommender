/**
 * M5.2: which body regions a completed session's own catalog movements make worth asking
 * about, derived from M3.5's `ExerciseDefinition.facets.tissueDemand`/`safetyTags` -- coarse,
 * heuristic labels (M3.5's own framing), not a diagnosis. An exercise whose tags don't map to
 * a recognized `BodyRegion` contributes no region rather than guessing one; an unresolved
 * free-text movement (C8) has no catalog facets at all and likewise contributes nothing.
 *
 * Pure and Firestore-free, matching `sessions/`'s established convention: callers resolve
 * executions/entries/exercises themselves (`Home.tsx`, `DailyCheckin.tsx`) and pass in plain
 * data. Nothing here writes a tissue value, fabricates a response, or decides an outcome --
 * it only says which regions and windows are *worth asking about* for a given session; a
 * skipped or never-shown prompt simply produces no record (M5.1), which is `unknown` by
 * construction, not a status this module computes.
 */
import { deriveTissueSeverity } from '../engine/injuryPolicy';
import type { BodyRegion, RegionTissueResponse } from '../engine/models';

/** Keyword -> region, checked as a case-insensitive substring against every
 * `tissueDemand`/`safetyTags` label on a step's resolved exercise. Deliberately small and
 * literal (not a general NLP mapping): a tag the table doesn't recognize contributes no
 * region, which is the safe failure mode here -- asking about nothing is better than
 * guessing the wrong body part. */
const REGION_KEYWORDS: ReadonlyArray<readonly [BodyRegion, readonly string[]]> = [
    ['knee', ['knee']],
    ['achilles', ['achilles']],
    ['ankle', ['ankle']],
    ['calf', ['calf']],
    ['hamstring', ['hamstring']],
    ['quadriceps', ['quad']],
    ['adductor_groin', ['adductor', 'groin']],
    ['hip', ['hip']],
    ['lower_back', ['lower_back', 'lumbar', 'trunk']],
    ['shoulder', ['shoulder']],
    ['elbow', ['elbow']],
    ['wrist', ['wrist']],
];

export interface FacetTagSource {
    tissueDemand?: string[];
    safetyTags?: string[];
}

type FollowupSessionRef = NonNullable<RegionTissueResponse['sourceSessionRef']>;

export interface NextMorningFollowupCandidate {
    region: BodyRegion;
    /**
     * Every session whose movement metadata contributes to this region-level prompt.
     * A region is asked once even when several sessions touched it; linkage is preserved
     * separately rather than forcing an ambiguous singular tissue attribution.
     */
    sessionRefs: readonly FollowupSessionRef[];
}

export interface SessionFollowupRegions {
    sessionRef: FollowupSessionRef;
    regions: readonly BodyRegion[];
}

function sameSessionRef(a: FollowupSessionRef, b: FollowupSessionRef): boolean {
    return a.kind === b.kind && a.id === b.id && a.date === b.date;
}

function regionsForTags(source: FacetTagSource): BodyRegion[] {
    const tags = [...(source.tissueDemand ?? []), ...(source.safetyTags ?? [])].map(tag => tag.toLowerCase());
    if (tags.length === 0) return [];
    const regions: BodyRegion[] = [];
    for (const [region, keywords] of REGION_KEYWORDS) {
        if (keywords.some(keyword => tags.some(tag => tag.includes(keyword)))) regions.push(region);
    }
    return regions;
}

/** Every distinct region worth asking about across a session's resolved exercises. Empty
 * when nothing in the session carries recognized tissue-relevant metadata -- e.g. an easy
 * aerobic spin with no strength/field steps -- which is the signal M5.2's Done-when relies
 * on to *not* prompt for every ordinary session. */
export function relevantFollowupRegions(exercises: readonly FacetTagSource[]): BodyRegion[] {
    const regions = new Set<BodyRegion>();
    for (const exercise of exercises) for (const region of regionsForTags(exercise)) regions.add(region);
    return [...regions].sort();
}

/**
 * Canonical M5.2 next-morning due-state resolver shared by Today and Check-in.
 *
 * A previous-day manual tissue response is due only when it has real restriction semantics
 * according to the same `deriveTissueSeverity` authority used by the engine. Linkage alone
 * (`sourceSessionRef`) is not evidence that another follow-up is owed. Session-derived
 * candidates remain useful for completed executions whose catalog facets identify relevant
 * regions even when the athlete never manually flagged a tissue response.
 *
 * The current day's `nextMorningReaction` closes that region for this check-in date. The
 * queue is region-level: multiple relevant sessions for one region become one prompt with
 * multiple linkage refs, so one tissue observation cannot be overwritten repeatedly merely
 * because yesterday contained more than one session. Missing answers remain missing/unknown;
 * this function is pure and never fabricates persistence.
 */
export function resolvePendingNextMorningFollowups(
    previousDayTissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> | undefined,
    currentDayTissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> | undefined,
    sessionDerived: readonly SessionFollowupRegions[] = [],
): NextMorningFollowupCandidate[] {
    const neededByRegion = new Map<BodyRegion, { region: BodyRegion; sessionRefs: FollowupSessionRef[] }>();

    const candidateFor = (region: BodyRegion) => {
        if (currentDayTissueResponses?.[region]?.nextMorningReaction) return null;
        let candidate = neededByRegion.get(region);
        if (!candidate) {
            candidate = { region, sessionRefs: [] };
            neededByRegion.set(region, candidate);
        }
        return candidate;
    };

    const addSessionRef = (
        candidate: { region: BodyRegion; sessionRefs: FollowupSessionRef[] },
        sessionRef: FollowupSessionRef,
    ) => {
        if (!candidate.sessionRefs.some(existing => sameSessionRef(existing, sessionRef))) {
            candidate.sessionRefs.push(sessionRef);
        }
    };

    for (const [regionKey, response] of Object.entries(previousDayTissueResponses ?? {})) {
        const region = regionKey as BodyRegion;
        if (!response || deriveTissueSeverity(response) === null) continue;

        const candidate = candidateFor(region);
        if (!candidate) continue;
        if (response.sourceSessionRef) addSessionRef(candidate, response.sourceSessionRef);
    }

    for (const session of sessionDerived) {
        for (const region of session.regions) {
            const candidate = candidateFor(region);
            if (!candidate) continue;
            addSessionRef(candidate, session.sessionRef);
        }
    }

    return [...neededByRegion.values()];
}
