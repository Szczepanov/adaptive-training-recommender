import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge.ts';

/** Issue #805: periodic multidirectional and skill exposure for hybrid athletes. */
export const ATHLETIC_CAPABILITY_CLAIM_IDS = {
    athleticCapabilityMaintenancePolicy: 'policy.evergreen.athletic_capability_maintenance_v1',
} as const;

const ATHLETIC_CAPABILITY_PRODUCT_POLICY_SOURCE = 'PRODUCT-ATHLETIC-CAPABILITY-MAINTENANCE-V1';
/** Registered by the #802 power-maintenance pack; referenced here, not duplicated. */
const SPIERING_MAINTENANCE_SOURCE = 'SPIERING-2021-MINIMAL-MAINTENANCE-DOSE-REVIEW';
const SKILL_DECAY_SOURCE = 'TATEL-ACKERMAN-2025-PROCEDURAL-SKILL-DECAY';
const SOCCER_DETRAINING_SOURCE = 'CLEMENTE-2021-SOCCER-OFF-SEASON';

export const ATHLETIC_CAPABILITY_SOURCES: readonly KnowledgeSource[] = [
    {
        id: ATHLETIC_CAPABILITY_PRODUCT_POLICY_SOURCE,
        title: 'Athletic capability maintenance policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: athletic-capability-maintenance-v1 (issue #805, approved plan decisions D-A to D-I).',
        notes: 'Explicit product policy for a default-off, sport-neutral broad-athleticism opt-in: a fixed 14-day target interval with date-aware not-before placement, exact per-capability/variant identity credit, narrow explicit-preference consent, #804-subordinate progression steering, evergreen-only recommendation authority and ADR-0044 D9 status semantics.',
    },
    {
        id: SKILL_DECAY_SOURCE,
        title: 'Procedural skill retention and decay: a meta-analytic review',
        sourceType: 'systematic_review',
        synthesisMethods: ['meta_analysis'],
        citation: 'Tatel CE, Ackerman PL. Psychol Bull. 2025;151(6):696-736. doi:10.1037/bul0000481.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/40455501/',
        publishedOn: '2025-06-01',
        externalIds: [
            { type: 'pmid', value: '40455501' },
            { type: 'doi', value: '10.1037/bul0000481' },
        ],
        notes: 'Meta-analysis of procedural-skill retention: decay increases with longer non-use, on a months scale and with strong task/moderator dependence. It does not establish a two-week sport-skill threshold and is not an athlete trial.',
    },
    {
        id: SOCCER_DETRAINING_SOURCE,
        title: 'Detrimental effects of the off-season in soccer players: a systematic review and meta-analysis',
        sourceType: 'systematic_review',
        synthesisMethods: ['meta_analysis'],
        citation: 'Clemente FM, Ramirez-Campillo R, Sarmento H. Sports Med. 2021;51(4):795-814. doi:10.1007/s40279-020-01407-4.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/33400214/',
        publishedOn: '2021-04-01',
        externalIds: [
            { type: 'pmid', value: '33400214' },
            { type: 'doi', value: '10.1007/s40279-020-01407-4' },
        ],
        notes: 'Off-season (>=2 weeks) training cessation can impair several physical qualities in soccer players, but the review does not establish a change-of-direction or skill maintenance threshold for trained hybrid adults.',
    },
];

export const ATHLETIC_CAPABILITY_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: ATHLETIC_CAPABILITY_CLAIM_IDS.athleticCapabilityMaintenancePolicy,
        statement: 'Evergreen athletic capability maintenance policy v1: an athlete may explicitly opt in (default off, independent of the sport_readiness priority) to periodic maintenance of four sport-neutral capabilities -- linear_speed_skill, acceleration_deceleration, multidirectional_change_of_direction and sport_skill -- with a fixed 14-day maximum gap between qualifying touches, equal to the #804 mechanical continuity window. A capability is due when its next due date (last qualifying exposure + 13 days, so the gap never reaches the #804 re-entry threshold) falls inside the planning horizon, with a not-before and target date equal to that due date so a horizon forecast never pulls it earlier; it is overdue when the planning date is past its due date (a gap of 14 days or more) or a complete observed 14-day interval contains no qualifying exposure; fewer than 14 observed days is insufficient_history and never due. Observation span must be proven by snapshot/provider metadata: a reconstruct-only history source may return older exposures for progression, but without span proof cadence retains only the conservative operational observed window and cannot become due/overdue from fabricated coverage. Credit is exact per capability x workout x authored variant x retained steps: field_sprint_mechanics_foundation_01 (linear_speed_skill; full, reduced, return_to_training), field_acceleration_braking_01 (linear_speed_skill in all three variants; acceleration_deceleration only full/reduced because return_to_training omits braking) and field_controlled_maintenance_01 (acceleration_deceleration and multidirectional_change_of_direction full/reduced; sport_skill also return_to_training); readiness-modified doses fail closed and generic running, walk-run and reactive plyometric work never satisfy change of direction or sport skill. The opt-in guarantees an optional #804 mechanical requirement when #804 has not deliberately suspended it, passes the highest owed capability stage to #804 as its progression target (#804 still caps advancement at one stage and requires its own normal follow-up evidence), and reuses the single mechanical support occurrence: while a capability is owed, the existing mechanical support requirement carries a support-tier minimum of one. Before any placement is active, allocator-visible candidates are the union of open placement identities and each exact workout carries its earliest not-before date; weekly reservation and current-date coverage urgency both enforce that date even when the athlete already prefers Field. Once a placement is active, current-date coverage narrows to the stage-eligible identities that settle the most active placements, or to the highest currently eligible #804 identities to continue safe progression. Any qualifying touch from the placement planning date on closes it. It creates no distinct capability requirement or objective and never increases the athlete’s configured weekly session commitment. The opt-in satisfies requiresExplicitModalityPreference only for those exact consented identities of enabled capabilities on those dates (a progression-only touch may consent an identity of an enabled capability that is not itself due, because it is the only path to the owed higher stage) and never promotes the modality into preferred modalities; unavailable modalities always win, avoided modalities block the optional injection, deprioritized modalities stay a soft preference, and existing injury, guardrail, equipment and environment gates keep their authority. Recommendation authority is evergreen-only: event-directed mode reports deliberately_suspended/event_directed_mode and unlocks no field work. Cadence status (disabled, insufficient_history, satisfied, due, overdue) is separate from fulfilment (plannable, blocked, deliberately_suspended, unknown) per ADR-0044 D9; owed-but-blocked or unknown capabilities raise capability_maintenance_unfulfilled, while deliberate suspension (adverse recovery, clinical symptoms, peak/taper or post-event phase, #804 withholding) stays visible without creating catch-up debt.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'high',
        applicability: {
            contexts: ['evergreen', 'capability_maintenance', 'multidirectional', 'sport_skill', 'maintenance'],
            sports: ['field', 'cycling', 'running', 'endurance_multisport'],
            populations: ['hybrid_athletes', 'trained_adults'],
            outcomes: ['athletic_optionality', 'change_of_direction_maintenance', 'sport_skill_maintenance'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: ATHLETIC_CAPABILITY_PRODUCT_POLICY_SOURCE, directness: 'direct', note: 'Issue #805 product policy owning the opt-in, interval, placement, identity mapping, consent precedence, progression steering and status semantics.' },
            { sourceId: SPIERING_MAINTENANCE_SOURCE, directness: 'indirect', note: 'Supports low-frequency maintenance as a concept but explicitly reports insufficient athlete-specific minimum-dose data; it does not validate the 14-day interval.' },
            { sourceId: SKILL_DECAY_SOURCE, directness: 'indirect', note: 'Procedural skill decays with longer non-use on a months scale, strongly task dependent; no two-week sport-skill threshold is established.' },
            { sourceId: SOCCER_DETRAINING_SOURCE, directness: 'indirect', note: 'Two or more weeks of cessation can impair several physical qualities in soccer players; no COD/skill maintenance threshold is established.' },
        ],
        limitations: [
            'The 14-day interval is a product guardrail aligned with the 7-14-day physical-optionality architecture, not a validated physiological cliff: no reviewed trained-adult evidence validates a 14-day (or 28-day) minimum for change-of-direction or ball-skill maintenance.',
            'This general evergreen cadence is deliberately distinct from, and less frequent than, the legacy 7-10-day football/event-block note on field_controlled_maintenance_01; that workout note is not global policy.',
            'Planning history carries no authored variant, so an unknown historical variant follows #804 backward-compatible credit and can over-credit a capability whose defining steps were omitted until performed facts record exact variant/step completion.',
            'A cold start needs roughly six qualifying mechanical exposures with explicit normal next-day tissue follow-ups before stage-4 identities are eligible, so mechanical_stage_insufficient is the common early state.',
            'Capability diagnostics are not persisted in the recommendation audit in v1 (D-F); they are surfaced through the resolved evergreen plan and typed warnings.',
        ],
        reviewedOn: '2026-09-27',
        version: 2,
    },
];
