import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

/** Issue #802: neuromuscular power maintenance as a first-class weekly adaptation. */
export const POWER_MAINTENANCE_CLAIM_IDS = {
    lowFrequencyStrengthPowerMaintenance: 'performance.power.low_frequency_maintenance',
    powerMaintenanceExposurePolicy: 'policy.evergreen.power_maintenance_exposure_v1',
} as const;

const RONNESTAD_IN_SEASON_MAINTENANCE_SOURCE = 'RONNESTAD-2010-IN-SEASON-STRENGTH-MAINTENANCE-CYCLISTS';
const SPIERING_MINIMAL_DOSE_SOURCE = 'SPIERING-2021-MINIMAL-MAINTENANCE-DOSE-REVIEW';
const POWER_MAINTENANCE_PRODUCT_POLICY_SOURCE = 'PRODUCT-POWER-MAINTENANCE-EXPOSURE-V1';

export const POWER_MAINTENANCE_SOURCES: readonly KnowledgeSource[] = [
    {
        id: RONNESTAD_IN_SEASON_MAINTENANCE_SOURCE,
        title: "In-season strength maintenance training increases well-trained cyclists' performance",
        sourceType: 'randomized_trial',
        citation: 'Rønnestad BR, Hansen EA, Raastad T. Eur J Appl Physiol. 2010;110(6):1269-1282. doi:10.1007/s00421-010-1622-4.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/20799042/',
        publishedOn: '2010-08-27',
        externalIds: [
            { type: 'pmid', value: '20799042' },
            { type: 'doi', value: '10.1007/s00421-010-1622-4' },
        ],
        notes: 'Well-trained cyclists (n=6 per group) added heavy strength training twice weekly for a 12-week preparatory period and then one strength maintenance session per week for the first 13 weeks of the competition period. Versus endurance training alone, the strength group increased Wingate peak power, power at 2 mmol/L lactate, Wmax and 40-min mean power. Very small sample; the maintenance sessions were heavy strength, not isolated ballistic/plyometric power work.',
    },
    {
        id: SPIERING_MINIMAL_DOSE_SOURCE,
        title: 'Maintaining Physical Performance: The Minimal Dose of Exercise Needed to Preserve Endurance and Strength Over Time',
        sourceType: 'narrative_review',
        citation: 'Spiering BA, Mujika I, Sharp MA, Foulis SA. J Strength Cond Res. 2021;35(5):1449-1458. doi:10.1519/JSC.0000000000003964.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/33629972/',
        publishedOn: '2021-05-01',
        externalIds: [
            { type: 'pmid', value: '33629972' },
            { type: 'doi', value: '10.1519/JSC.0000000000003964' },
        ],
        notes: 'Brief review concluding that, at least in younger populations, strength and muscle size can be maintained for up to 32 weeks with as little as one strength session per week and one set per exercise when relative load (intensity) is maintained; older adults may need up to two sessions per week. Intensity appears to be the key maintenance variable. Explosive/neuromuscular power maintenance is not separately dosed.',
    },
    {
        id: POWER_MAINTENANCE_PRODUCT_POLICY_SOURCE,
        title: 'Power maintenance exposure policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: power-maintenance-exposure-v1 (issue #802).',
        notes: 'Explicit product policy for the default weekly power-exposure target, embedded delivery and exact qualifying identities. External evidence informs the low-frequency direction but does not validate these exact product values.',
    },
];

export const POWER_MAINTENANCE_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: POWER_MAINTENANCE_CLAIM_IDS.lowFrequencyStrengthPowerMaintenance,
        statement: 'Previously developed strength, and in trained cyclists strength-related peak power, can be largely maintained by low-frequency resistance exposure (about one session per week) when relative load/intensity is preserved; the evidence does not establish a validated minimum dose specifically for explosive or reactive neuromuscular power.',
        claimType: 'intervention',
        maturity: 'emerging',
        status: 'active',
        evidenceCertainty: 'low',
        recommendationStrength: 'conditional',
        safetyImpact: 'low',
        applicability: {
            contexts: ['strength_training', 'concurrent_training', 'maintenance'],
            sports: ['cycling', 'endurance_multisport'],
            populations: ['trained_adults', 'well_trained_cyclists'],
            outcomes: ['maximal_strength_maintenance', 'peak_power_maintenance'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: RONNESTAD_IN_SEASON_MAINTENANCE_SOURCE, directness: 'partially_direct', note: 'One weekly heavy-strength session preserved and extended strength-training gains, including Wingate peak power, in well-trained cyclists; the session was not isolated power work.' },
            { sourceId: SPIERING_MINIMAL_DOSE_SOURCE, directness: 'indirect', note: 'Maintenance of strength and muscle size with about one session per week while intensity is preserved; power is not separately dosed.' },
        ],
        limitations: [
            'Power-specific maintenance evidence is indirect: the cycling trial maintained heavy strength rather than ballistic, Olympic-derivative or plyometric work, and had six athletes per group.',
            'The review addresses strength and muscle size; it does not establish a maintenance frequency, contact count or maximum gap for reactive or explosive power.',
            'Maintenance depends on preserving intensity and movement quality; fatigued or readiness-reduced execution is not evidence of the same exposure.',
            'Older athletes may need more frequent exposure than younger athletes to maintain muscle size; age-specific power dosing is not established.',
        ],
        reviewedOn: '2026-09-26',
        version: 1,
    },
    {
        id: POWER_MAINTENANCE_CLAIM_IDS.powerMaintenanceExposurePolicy,
        statement: 'Evergreen power maintenance v1: an established hybrid athlete whose plan already requires strength and whose priorities include endurance, speed/power, sport readiness or balanced performance (balanced performance is also the in-memory default when no priorities are saved) receives a neuromuscular-power requirement targeting one small power exposure per week, with at most two credited. It is a target for speed/power priority and optional otherwise, and is delivered embedded in an already-packed strength occurrence rather than as an extra session; it is credited and reported but never raises the coverage-need ranking tier of any candidate, so an unmet target cannot promote catch-up power or lower-body sessions. Only exact authored identities with power content (Olympic-lift derivatives, ballistic throws/slams, reactive plyometrics) at their full or reduced dose earn power coverage; readiness-modified doses, threshold/VO2 work and generic strength do not. The requirement is withheld during acute adverse recovery, current pain/injury/illness/red-flag symptoms, Peak/Taper and Post-Event Recovery, and without sufficient consistent recent training history. Impact (plyometric) identities never become eligible because power is unmet; non-impact identities are explicitly authored as qualifying alternatives.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['evergreen', 'concurrent_training', 'maintenance'],
            sports: ['cycling', 'running', 'endurance_multisport', 'strength'],
            populations: ['established_hybrid_athletes_with_sufficient_consistent_recent_training_evidence'],
            outcomes: ['neuromuscular_power_exposure_coverage'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: POWER_MAINTENANCE_PRODUCT_POLICY_SOURCE, directness: 'direct', note: 'Issue #802 product policy; exact values are not externally validated.' },
            { sourceId: RONNESTAD_IN_SEASON_MAINTENANCE_SOURCE, directness: 'indirect', note: 'Supports the direction that about one weekly session can maintain strength-related power in cyclists.' },
            { sourceId: SPIERING_MINIMAL_DOSE_SOURCE, directness: 'indirect', note: 'Supports low-frequency, intensity-preserving maintenance generally.' },
        ],
        limitations: [
            'The one-exposure target and two-exposure credit ceiling are product values, not an evidence-derived minimum or optimum for power.',
            'Embedded delivery is a capacity-preserving product rule; it does not guarantee a power-capable workout is selected on the strength day when equipment, readiness or safety gates choose a different strength identity. The unmet requirement is reported instead.',
            'Readiness-modified doses are denied power credit conservatively because the dose variant that removes power content cannot be distinguished from one that keeps it at planning time.',
            'The qualifying-identity list is an exact authored mapping; it is not a claim that throws, Olympic derivatives and plyometrics are physiologically interchangeable.',
        ],
        reviewedOn: '2026-09-26',
        version: 1,
    },
];
