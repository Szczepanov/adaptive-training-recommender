import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const STRENGTH_CONCURRENT_CLAIM_IDS = {
    enduranceStrengthPerformanceSupport: 'performance.endurance.strength_training.performance_support',
    concurrentSequenceGoalPriority: 'performance.concurrent.sequence.goal_priority',
    cyclingBuildStrengthSupportPolicy: 'policy.event.cycling_build_strength_support_v1',
} as const;

const RAMOS_CAMPO_STRENGTH_UMBRELLA_SOURCE = 'RAMOS-CAMPO-2025-ENDURANCE-STRENGTH-UMBRELLA';
const LLANOS_LAGOS_RUNNING_STRENGTH_SOURCE = 'LLANOS-LAGOS-2024-RUNNING-STRENGTH-META';
const LLANOS_LAGOS_CYCLING_STRENGTH_SOURCE = 'LLANOS-LAGOS-2026-CYCLING-STRENGTH-META';
const HELD_CONCURRENT_UMBRELLA_SOURCE = 'HELD-2026-CONCURRENT-TRAINING-UMBRELLA';
const EDDENS_SEQUENCE_SOURCE = 'EDDENS-2018-CONCURRENT-SEQUENCE-META';
const BANGSBO_ELITE_CONSENSUS_SOURCE = 'BANGSBO-2025-ELITE-ATHLETE-CONSENSUS';
const CYCLING_BUILD_STRENGTH_SUPPORT_POLICY_SOURCE = 'PRODUCT-CYCLING-BUILD-STRENGTH-SUPPORT-V1';

export const STRENGTH_CONCURRENT_SOURCES: readonly KnowledgeSource[] = [
    {
        id: CYCLING_BUILD_STRENGTH_SUPPORT_POLICY_SOURCE,
        title: 'Cycling build strength-support policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: cycling-build-strength-support-v1 (issue #801).',
        notes: 'Explicit product policy translating the evergreen strength floor into event-directed cycling build roles and subordinating them to primary required roles. It is not represented as external scientific evidence.',
    },
    {
        id: RAMOS_CAMPO_STRENGTH_UMBRELLA_SOURCE,
        title: 'The Effect of Strength Training on Endurance Performance Determinants in Middle- and Long-Distance Endurance Athletes: An Umbrella Review of Systematic Reviews and Meta-Analysis',
        sourceType: 'umbrella_review',
        citation: 'Ramos-Campo DJ, Andreu-Caravaca L, Clemente-Suárez VJ, Rubio-Arias JÁ. J Strength Cond Res. 2025;39(4):492-506. doi:10.1519/JSC.0000000000005056.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/40153564/',
        publishedOn: '2025-04-01',
        externalIds: [
            { type: 'pmid', value: '40153564' },
            { type: 'doi', value: '10.1519/JSC.0000000000005056' },
        ],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'Umbrella review of 17 systematic reviews, 12 with meta-analysis. It supports supplemental strength training for endurance performance and running economy while finding no consistent VO2max improvement. Confidence in most included reviews was low or critically low, limiting claims about one optimal strength method or dose.',
    },
    {
        id: LLANOS_LAGOS_RUNNING_STRENGTH_SOURCE,
        title: "The Effect of Strength Training Methods on Middle-Distance and Long-Distance Runners' Athletic Performance: A Systematic Review with Meta-analysis",
        sourceType: 'systematic_review',
        citation: 'Llanos-Lagos C, Ramirez-Campillo R, Moran J, Sáez de Villarreal E. Sports Med. 2024;54(7):1801-1833. doi:10.1007/s40279-024-02018-z.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38627351/',
        publishedOn: '2024-04-17',
        externalIds: [
            { type: 'pmid', value: '38627351' },
            { type: 'pmcid', value: 'PMC11258194' },
            { type: 'doi', value: '10.1007/s40279-024-02018-z' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Running-specific review found high-load and combined strength methods improved performance, while VO2max, vVO2max and maximum metabolic steady state were not significantly improved. Evidence certainty ranged from very low to moderate; studied programs ranged from one to four strength sessions per week over 6-40 weeks.',
    },
    {
        id: LLANOS_LAGOS_CYCLING_STRENGTH_SOURCE,
        title: 'Heavy strength training effects on physiological determinants of endurance cyclist performance: a systematic review with meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Llanos-Lagos C, Ramirez-Campillo R, Sáez de Villarreal E. Eur J Appl Physiol. 2026;126(1):193-222. doi:10.1007/s00421-025-05883-2.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/40632222/',
        publishedOn: '2025-07-09',
        externalIds: [
            { type: 'pmid', value: '40632222' },
            { type: 'pmcid', value: 'PMC12881108' },
            { type: 'doi', value: '10.1007/s00421-025-05883-2' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Seventeen studies / 262 endurance cyclists. Heavy strength training improved cycling efficiency, anaerobic power and pooled cycling performance, with no significant VO2max, pVO2max or MMSS effect. GRADE certainty was low, so the review explicitly does not support robust prescriptions for one optimal implementation.',
    },
    {
        id: HELD_CONCURRENT_UMBRELLA_SOURCE,
        title: 'Maximizing Adaptations in Concurrent Training: An Umbrella Review of Meta-analyses',
        sourceType: 'umbrella_review',
        citation: 'Held S, Wolf L, Rappelt L, et al. Sports Med. 2026;56(6):1489-1512. doi:10.1007/s40279-026-02401-y.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/41762427/',
        publishedOn: '2026-02-28',
        externalIds: [
            { type: 'pmid', value: '41762427' },
            { type: 'doi', value: '10.1007/s40279-026-02401-y' },
            { type: 'prospero', value: 'CRD42025646460' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Umbrella review of 17 meta-analyses / 144 studies / 1,492 healthy participants. Concurrent training developed aerobic and strength-related qualities with broadly comparable strength, power and hypertrophy outcomes to resistance training alone. Training modality (simultaneous, same day or different day) did not significantly moderate pooled outcomes. Overall sequence effects were not significant, but resistance-before-endurance was favored when strength or hypertrophy was the priority; sequence appeared negligible for aerobic development. Evidence in highly trained and elite athletes remained sparse.',
    },
];

export const STRENGTH_CONCURRENT_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: STRENGTH_CONCURRENT_CLAIM_IDS.cyclingBuildStrengthSupportPolicy,
        statement: 'Cycling build strength-support policy v1: when an athlete whose durable training intent explicitly includes strength_muscle is in an event-directed cycling plan, the build block keeps the rest of the evergreen weekly strength floor (the WHO-backed two-session floor minus the one authored primary-strength role, i.e. one) as exact compact_strength support roles. Support roles earn no second physiological strength objective credit and do not inflate primary_strength coverage. The weekly allocator reserves them only when they fit without reducing the number of primary required roles and never on a date already nominated to a primary role (quality, event-specific, aerobic or primary strength); otherwise it reports a typed miss. Peak, taper and race blocks do not carry them. Readiness, fatigue, spacing, tissue, rolling-load and time gates remain authoritative.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['event_directed', 'cycling_build', 'concurrent_training', 'weekly_planning'],
            sports: ['cycling', 'strength'],
            populations: ['cycling_primary_hybrid_athletes_with_durable_strength_priority'],
            outcomes: ['weekly_resistance_exposure_preservation'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: CYCLING_BUILD_STRENGTH_SUPPORT_POLICY_SOURCE, directness: 'direct', note: 'Issue #801 product policy; the role count is derived from the registered strength floor, not a new constant.' },
            { sourceId: LLANOS_LAGOS_CYCLING_STRENGTH_SOURCE, directness: 'indirect', note: 'Supports continued strength training alongside cycling without prescribing a frequency.' },
            { sourceId: HELD_CONCURRENT_UMBRELLA_SOURCE, directness: 'indirect', note: 'Concurrent training preserves strength-related qualities; no universal frequency or separation.' },
        ],
        limitations: [
            'The support count is the evergreen WHO-backed floor minus one authored primary role; the WHO guideline is a general adult-health recommendation, not a validated frequency for cycling performance.',
            'Subordinating support roles to every primary required role is a product priority rule, not evidence that strength is less valuable than cycling quality for a given athlete.',
            'Restricting support to the build block is a conservative product choice; peak-block strength frequency is not separately evidenced here.',
            'The exact compact_strength identity set (compact power, reactive power, travel and bodyweight maintenance) is authored product policy, not a claim of physiological equivalence between them.',
        ],
        reviewedOn: '2026-09-26',
        version: 1,
    },
    {
        id: STRENGTH_CONCURRENT_CLAIM_IDS.enduranceStrengthPerformanceSupport,
        statement: 'Supplemental strength training can improve endurance performance and economy or efficiency in trained runners and cyclists without reliably increasing VO2max; high-load and combined strength methods are supported options, but current evidence does not establish one universal frequency, loading scheme or strength dose for every endurance athlete.',
        claimType: 'intervention',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'low',
        recommendationStrength: 'conditional',
        safetyImpact: 'low',
        applicability: {
            contexts: ['endurance_training', 'strength_training', 'performance_development'],
            sports: ['running', 'cycling', 'endurance_multisport'],
            populations: ['healthy_adult_endurance_athletes'],
            outcomes: ['endurance_performance', 'running_economy', 'cycling_efficiency', 'anaerobic_power'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: RAMOS_CAMPO_STRENGTH_UMBRELLA_SOURCE, directness: 'direct' },
            { sourceId: LLANOS_LAGOS_RUNNING_STRENGTH_SOURCE, directness: 'direct', note: 'Running-specific performance evidence.' },
            { sourceId: LLANOS_LAGOS_CYCLING_STRENGTH_SOURCE, directness: 'direct', note: 'Cycling-specific performance and efficiency evidence.' },
        ],
        limitations: [
            'The umbrella review judged confidence in most included reviews as low or critically low, the cycling meta-analysis rated outcome certainty as low, and the running review ranged from very low to moderate; the cross-sport claim is therefore intentionally low-certainty despite consistent direction of effect.',
            'Benefits are more consistent for economy/efficiency and performance than for VO2max; a strength session should not be modeled as a direct VO2max intervention.',
            'The reviewed interventions used heterogeneous methods, frequencies and durations; they do not scientifically validate the product default of two or three strength sessions per week, a particular percentage of 1RM, or a universal progression rate.',
            'Athlete training history, competition demands, injury status, recovery capacity and concurrent endurance load should shape the implementation.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: STRENGTH_CONCURRENT_CLAIM_IDS.concurrentSequenceGoalPriority,
        statement: 'Concurrent resistance and endurance training can develop both aerobic and strength-related qualities. When modalities share a session or day, resistance-before-endurance is the better-supported order when lower-body strength or hypertrophy is the primary target, while sequence appears less important for aerobic development; current evidence does not establish one universal order or a requirement to separate the modalities by a full calendar day.',
        claimType: 'intervention',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['concurrent_training', 'session_sequencing', 'weekly_planning'],
            sports: ['cycling', 'running', 'endurance_multisport', 'team_sports'],
            populations: ['healthy_adults_and_athletes'],
            outcomes: ['strength_adaptation', 'power', 'hypertrophy', 'aerobic_capacity'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: HELD_CONCURRENT_UMBRELLA_SOURCE, directness: 'direct' },
            { sourceId: EDDENS_SEQUENCE_SOURCE, directness: 'direct', note: 'Earlier sequence meta-analysis found lower-body dynamic-strength benefit from resistance-before-endurance without establishing a universal separation interval.' },
            { sourceId: BANGSBO_ELITE_CONSENSUS_SOURCE, directness: 'partially_direct', note: 'Elite-athlete consensus permits same-day multimodal training and recommends athlete-by-athlete concurrent prescription, while acknowledging limited elite-specific evidence.' },
        ],
        limitations: [
            'The 2026 umbrella review found no significant overall sequence effect, but its practical interpretation favors resistance-before-endurance when strength or hypertrophy is the primary target; this nuance should not be flattened into either a universal order or a claim that order never matters.',
            'Highly trained and elite athletes were underrepresented in the umbrella evidence, so competition-level scheduling may need to be more conservative than population-average chronic adaptation data imply.',
            'These sources primarily address chronic adaptation. Acute residual fatigue and the quality of a subsequent key sport-specific session are separate questions and are not directly quantified by this claim.',
            'This evidence does not validate the product 0-1-day heavy-strength/key-cycling exclusion, the systemic-cost thresholds that define those sessions, or workout-specific recovery-hour metadata.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
];
