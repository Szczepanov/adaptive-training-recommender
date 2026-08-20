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
import type { BodyRegion } from '../engine/models';

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
