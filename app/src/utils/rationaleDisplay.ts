export interface SplitRationale {
    coachingNarrative: string;
    technicalDetail: string | null;
}

// optimizer.ts appends its scoring/coverage internals to a recommendation's rationale as a
// leading "Coverage tier: X. Benefit score: Y..." sentence plus zero or more parenthetical
// clauses ("(Sequence intent: ...)", "(Event-modality coverage: ...)", etc.) -- both are
// split out here so callers can render them in a collapsed detail rather than inline, since
// athletes think in sessions and how they feel, not coverage tiers or sequence-intent
// parameters. Matched by recognizable technical phrase rather than "strip every paren":
// rules.ts's own parenthetical clauses (e.g. explaining a Rest/Mobility default) are
// genuinely athlete-relevant and must stay visible.
const LEAD_SCORE_PATTERN = /Coverage tier:\s*\d+\.\s*Benefit score:\s*[\d.]+(?:,\s*Fatigue cost penalty:\s*[\d.]+)?\.?/i;
const TECHNICAL_CLAUSE_PATTERN = /\((?:Advances (?:mandatory|an explicit)|Eligible for proactive|Soft penalty applied|Event-modality coverage|Sequence intent|Sequence soft preference)[^)]*\)\.?/gi;

/** Separate a recommendation's plain-English coaching narrative from optimizer.ts's scoring
 * telemetry, so a component can show the narrative by default and the telemetry behind a
 * collapsed detail. Shared by every surface that renders a recommendation's `rationale`. */
export function splitCoachingRationale(rawRationale: string): SplitRationale {
    let coachingNarrative = rawRationale;
    const technicalParts: string[] = [];

    const leadMatch = coachingNarrative.match(LEAD_SCORE_PATTERN);
    if (leadMatch && leadMatch.index !== undefined) {
        technicalParts.push(leadMatch[0].trim());
        coachingNarrative = coachingNarrative.slice(0, leadMatch.index) + coachingNarrative.slice(leadMatch.index + leadMatch[0].length);
    }
    coachingNarrative = coachingNarrative.replace(TECHNICAL_CLAUSE_PATTERN, match => {
        technicalParts.push(match.trim());
        return '';
    });
    coachingNarrative = coachingNarrative.replace(/\s{2,}/g, ' ').trim();
    if (!coachingNarrative) {
        coachingNarrative = 'Optimized for current weekly phase and recovery balance.';
    }

    return {
        coachingNarrative,
        technicalDetail: technicalParts.length > 0 ? technicalParts.join(' ') : null,
    };
}
