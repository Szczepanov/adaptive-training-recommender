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

export interface NextMorningFollowupCandidate {
    region: BodyRegion;
    sessionRef?: RegionTissueResponse['sourceSessionRef'];
}

export interface SessionFollowupRegions {
    sessionRef: NonNullable<RegionTissueResponse['sourceSessionRef']>;
    regions: readonly BodyRegion[];
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
 * The current day's `nextMorningReaction` closes that region for this check-in date. Missing
 * answers remain missing/unknown; this function is pure and never fabricates persistence.
 */
export function resolvePendingNextMorningFollowups(
    previousDayTissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> | undefined,
    currentDayTissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> | undefined,
    sessionDerived: readonly SessionFollowupRegions[] = [],
): NextMorningFollowupCandidate[] {
    const needed: NextMorningFollowupCandidate[] = [];
    const coveredRegionSessionKeys = new Set<string>();

    for (const [regionKey, response] of Object.entries(previousDayTissueResponses ?? {})) {
        const region = regionKey as BodyRegion;
        if (!response || deriveTissueSeverity(response) === null) continue;

        const sessionKey = response.sourceSessionRef
            ? `${response.sourceSessionRef.kind}:${response.sourceSessionRef.id}`
            : 'checkin';
        coveredRegionSessionKeys.add(`${sessionKey}:${region}`);

        if (!currentDayTissueResponses?.[region]?.nextMorningReaction) {
            needed.push({
                region,
                ...(response.sourceSessionRef ? { sessionRef: response.sourceSessionRef } : {}),
            });
        }
    }

    for (const candidate of sessionDerived) {
        const sessionKey = `${candidate.sessionRef.kind}:${candidate.sessionRef.id}`;
        for (const region of candidate.regions) {
            const key = `${sessionKey}:${region}`;
            if (coveredRegionSessionKeys.has(key)) continue;
            coveredRegionSessionKeys.add(key);
            if (currentDayTissueResponses?.[region]?.nextMorningReaction) continue;
            needed.push({ region, sessionRef: candidate.sessionRef });
        }
    }

    return needed;
}
