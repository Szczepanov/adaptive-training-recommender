import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const READINESS_CARDIORESPIRATORY_CLAIM_IDS = {
    rhrContextualMonitoring: 'readiness.rhr.contextual_individualized_monitoring',
    respirationLongitudinalContext: 'readiness.respiration.longitudinal_contextual_signal',
} as const;

const BOSQUET_RHR_OVERREACH_SOURCE = 'BOSQUET-2008-RHR-OVERREACH-META';
const QUER_RHR_LONGITUDINAL_SOURCE = 'QUER-2020-RHR-LONGITUDINAL-COHORT';
const NATARAJAN_RESPIRATION_SOURCE = 'NATARAJAN-2021-NOCTURNAL-RESPIRATION-COHORT';
const ESMAEILPOUR_INFECTION_SOURCE = 'ESMAEILPOUR-2024-WEARABLE-INFECTION-VALIDATION';

export const READINESS_CARDIORESPIRATORY_SOURCES: readonly KnowledgeSource[] = [
    {
        id: BOSQUET_RHR_OVERREACH_SOURCE,
        title: 'Is heart rate a convenient tool to monitor over-reaching? A systematic review of the literature',
        sourceType: 'systematic_review',
        citation: 'Bosquet L, Merkari S, Arvisais D, Aubert AE. Br J Sports Med. 2008;42(9):709-714. doi:10.1136/bjsm.2007.042200.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/18308872/',
        publishedOn: '2008-02-28',
        externalIds: [
            { type: 'pmid', value: '18308872' },
            { type: 'doi', value: '10.1136/bjsm.2007.042200' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Competitive-athlete overload studies showed a moderate short-term increase in resting HR, but effect sizes were small-to-moderate relative to day-to-day variability; authors concluded HR/HRV fluctuations require comparison with other overreaching signs and symptoms.',
    },
    {
        id: QUER_RHR_LONGITUDINAL_SOURCE,
        title: 'Inter- and intraindividual variability in daily resting heart rate and its associations with age, sex, sleep, BMI, and time of year: Retrospective, longitudinal cohort study of 92,457 adults',
        sourceType: 'cohort',
        citation: 'Quer G, Gouda P, Galarnyk M, Topol EJ, Steinhubl SR. PLoS One. 2020;15(2):e0227709. doi:10.1371/journal.pone.0227709.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/32023264/',
        publishedOn: '2020-02-05',
        externalIds: [
            { type: 'pmid', value: '32023264' },
            { type: 'pmcid', value: 'PMC7001906' },
            { type: 'doi', value: '10.1371/journal.pone.0227709' },
        ],
        notes: 'Large wearable cohort: resting HR differed widely between people but was substantially more stable within-person over time, supporting personal baselines rather than population-normal action thresholds. Population was not athlete-specific.',
    },
    {
        id: NATARAJAN_RESPIRATION_SOURCE,
        title: 'Measurement of respiratory rate using wearable devices and applications to COVID-19 detection',
        sourceType: 'cohort',
        citation: 'Natarajan A, Su HW, Heneghan C, et al. NPJ Digit Med. 2021;4(1):136. doi:10.1038/s41746-021-00493-6.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/34526602/',
        publishedOn: '2021-09-15',
        externalIds: [
            { type: 'pmid', value: '34526602' },
            { type: 'pmcid', value: 'PMC8443549' },
            { type: 'doi', value: '10.1038/s41746-021-00493-6' },
        ],
        notes: 'Wearable nocturnal respiratory-rate estimates agreed well with sleep-study reference data in a small validation set; a 10,000-person cohort showed relatively low short-term within-person variation, while a separate COVID-19 cohort showed longitudinal elevations in some infected participants. Fitbit-affiliated study and not a sport-readiness validation.',
    },
    {
        id: ESMAEILPOUR_INFECTION_SOURCE,
        title: 'Detection of Common Respiratory Infections, Including COVID-19, Using Consumer Wearable Devices in Health Care Workers: Prospective Model Validation Study',
        sourceType: 'cohort',
        citation: 'Esmaeilpour Z, Natarajan A, Su HW, et al. JMIR Form Res. 2024;8:e53716. doi:10.2196/53716.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/39018555/',
        publishedOn: '2024-07-17',
        externalIds: [
            { type: 'pmid', value: '39018555' },
            { type: 'pmcid', value: 'PMC11292157' },
            { type: 'doi', value: '10.2196/53716' },
        ],
        notes: 'Prospective validation used sleeping resting HR, respiratory rate and HRV together. Alerts could precede respiratory infections, but positive predictive value was low in the study population and false-positive alerts were associated with intense exercise, poor sleep, stress and alcohol, demonstrating important non-specificity.',
    },
];

export const READINESS_CARDIORESPIRATORY_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: READINESS_CARDIORESPIRATORY_CLAIM_IDS.rhrContextualMonitoring,
        statement: 'Resting heart rate can contribute to monitoring training response and physiological strain when interpreted longitudinally against the individual athlete baseline and alongside symptoms, training load and other context; a short-term rise is not a standalone diagnosis of poor readiness or overreaching.',
        claimType: 'prognostic',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['daily_readiness', 'training_monitoring', 'recovery'],
            sports: ['all_supported_sports'],
            populations: ['athletes_and_active_adults_with_repeated_rhr_measurements'],
            outcomes: ['training_tolerance_context', 'physiological_strain_context'],
            horizon: 'both',
        },
        evidence: [
            { sourceId: BOSQUET_RHR_OVERREACH_SOURCE, directness: 'direct' },
            { sourceId: QUER_RHR_LONGITUDINAL_SOURCE, directness: 'partially_direct', note: 'Supports individualized baseline interpretation in a large general-population wearable cohort rather than athlete-specific action thresholds.' },
        ],
        limitations: [
            'The athlete meta-analysis found only small-to-moderate changes relative to day-to-day variability and explicitly required comparison with other signs and symptoms.',
            'Resting HR is affected by non-training factors including illness, hydration, heat, sleep, medication, alcohol and emotional stress; direction is therefore nonspecific.',
            'The general-population wearable cohort supports within-person baselines but does not validate a sports-readiness action rule.',
            'No reviewed evidence establishes the product +6 bpm hard-modify threshold, 1.5 bpm variability floor, 0.3 readiness weight, 10 bpm internal-response saturation, or a population-normal RHR cutoff as a universal readiness boundary.',
            'Resting HR should not act as a standalone readiness veto or diagnosis of overreaching.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: READINESS_CARDIORESPIRATORY_CLAIM_IDS.respirationLongitudinalContext,
        statement: 'Nocturnal or resting respiratory rate can provide a relatively stable within-person longitudinal signal, and deviations may accompany respiratory infection or other physiological stress; it is best treated as contextual multivariate evidence rather than a specific illness diagnosis or standalone sport-readiness marker.',
        claimType: 'prognostic',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'low',
        recommendationStrength: 'informational',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['daily_readiness', 'wearable_health_context', 'recovery'],
            sports: ['all_supported_sports'],
            populations: ['adults_with_repeated_resting_or_nocturnal_respiratory_rate_measurements'],
            outcomes: ['physiological_anomaly_context', 'illness_context', 'readiness_input_interpretation'],
            horizon: 'acute',
        },
        evidence: [
            { sourceId: NATARAJAN_RESPIRATION_SOURCE, directness: 'partially_direct', note: 'Direct for wearable measurement and longitudinal infection-related change, indirect for sport-readiness decisions.' },
            { sourceId: ESMAEILPOUR_INFECTION_SOURCE, directness: 'partially_direct', note: 'Prospective multivariate infection-alert validation shows useful signal and substantial non-specificity, but does not validate respiratory rate as a standalone readiness input.' },
        ],
        limitations: [
            'The evidence base reviewed here is primarily wearable measurement and respiratory-infection detection, not randomized or prospective sport-readiness intervention evidence.',
            'Respiratory-rate changes are not specific to infection: intense exercise, poor sleep, emotional stress, alcohol and other physiological factors can alter multivariate wearable alerts.',
            'Device algorithms, sleep-state selection, sensor quality and measurement context affect validity; results do not transfer automatically across wearable generations or vendors.',
            'No reviewed evidence establishes a 1 br/min variability floor, a 0.3 readiness weight, the shared z cap, the chronic multiplier, or any standalone respiratory-rate action threshold as a universal sports-readiness boundary.',
            'Respiratory rate should not act as a standalone readiness veto or illness diagnosis.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
];
