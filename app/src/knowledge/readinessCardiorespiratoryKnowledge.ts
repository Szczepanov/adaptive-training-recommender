import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const READINESS_CARDIORESPIRATORY_CLAIM_IDS = {
    rhrContextualMonitoring: 'readiness.rhr.contextual_individualized_monitoring',
    respirationLongitudinalContext: 'readiness.respiration.longitudinal_contextual_signal',
} as const;

const BOSQUET_RHR_OVERREACH_SOURCE = 'BOSQUET-2008-RHR-OVERREACH-META';
const QUER_RHR_LONGITUDINAL_SOURCE = 'QUER-2020-RHR-LONGITUDINAL-COHORT';
const NATARAJAN_RESPIRATION_SOURCE = 'NATARAJAN-2021-NOCTURNAL-RESPIRATION-COHORT';
const MITRATZA_WEARABLE_INFECTION_SOURCE = 'MITRATZA-2022-WEARABLE-INFECTION-REVIEW';
const RENTERIA_ATHLETE_COVID_SOURCE = 'RENTERIA-2024-ATHLETE-COVID-WEARABLE';
const BLOOMFIELD_RR_STRESS_SOURCE = 'BLOOMFIELD-2024-NOCTURNAL-RR-STRESS-COHORT';
const ESMAEILPOUR_INFECTION_SOURCE = 'ESMAEILPOUR-2024-WEARABLE-INFECTION-VALIDATION';
const NUUTTILA_NIGHTLY_RECOVERY_SOURCE = 'NUUTTILA-2025-NIGHTLY-RECOVERY-OVERLOAD';

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
        id: MITRATZA_WEARABLE_INFECTION_SOURCE,
        title: 'The performance of wearable sensors in the detection of SARS-CoV-2 infection: a systematic review',
        sourceType: 'systematic_review',
        citation: 'Mitratza M, Goodale BM, Shagadatova A, et al. Lancet Digit Health. 2022;4(5):e370-e383. doi:10.1016/S2589-7500(22)00019-X.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/35461692/',
        publishedOn: '2022-04-21',
        externalIds: [
            { type: 'pmid', value: '35461692' },
            { type: 'pmcid', value: 'PMC9020803' },
            { type: 'doi', value: '10.1016/S2589-7500(22)00019-X' },
        ],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'Systematic review of 12 published wearable-detection studies found respiratory-rate elevation among recurring early infection signals, but algorithm performance and presymptomatic sensitivity varied widely and most studies had moderate risk of bias. Supports early anomaly detection, not a universal RR threshold or training prescription.',
    },
    {
        id: RENTERIA_ATHLETE_COVID_SOURCE,
        title: 'Early Detection of COVID-19 in Female Athletes Using Wearable Technology',
        sourceType: 'cohort',
        citation: 'Rentería LI, Greenwalt CE, Johnson S, et al. Sports Health. 2024;16(4):512-517. doi:10.1177/19417381231183709.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37401442/',
        publishedOn: '2023-07-04',
        externalIds: [
            { type: 'pmid', value: '37401442' },
            { type: 'pmcid', value: 'PMC10333556' },
            { type: 'doi', value: '10.1177/19417381231183709' },
        ],
        notes: 'Direct athlete evidence but small and narrow: among 14 analyzable NCAA Division I female athletes with COVID-19, nocturnal RR was significantly elevated three days before a positive test; RHR rose and HRV fell later. Supports RR as an early contextual anomaly signal, not infection specificity or an RR-only training rule.',
    },
    {
        id: BLOOMFIELD_RR_STRESS_SOURCE,
        title: 'Predicting stress in first-year college students using sleep data from wearable devices',
        sourceType: 'cohort',
        citation: 'Bloomfield LSP, Fudolig MI, Kim J, et al. PLOS Digit Health. 2024;3(4):e0000473. doi:10.1371/journal.pdig.0000473.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38602898/',
        publishedOn: '2024-04-11',
        externalIds: [
            { type: 'pmid', value: '38602898' },
            { type: 'pmcid', value: 'PMC11008774' },
            { type: 'doi', value: '10.1371/journal.pdig.0000473' },
        ],
        notes: 'In 525 first-year college students, each 1 breath/min higher average nightly respiratory rate was associated with approximately 23% higher odds of moderate-to-high perceived stress after adjustment for gender and semester week. This supports respiratory rate as a sensitive stress/anomaly signal while reinforcing that elevation is not infection-specific.',
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
    {
        id: NUUTTILA_NIGHTLY_RECOVERY_SOURCE,
        title: 'Monitoring Sleep and Nightly Recovery with Wrist-Worn Wearables: Links to Training Load and Performance Adaptations',
        sourceType: 'cohort',
        citation: 'Nuuttila OP, Schäfer Olstad D, Martinmäki K, Uusitalo A, Kyröläinen H. Sensors (Basel). 2025;25(2):533. doi:10.3390/s25020533.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/39860902/',
        publishedOn: '2025-01-17',
        externalIds: [
            { type: 'pmid', value: '39860902' },
            { type: 'pmcid', value: 'PMC11768492' },
            { type: 'doi', value: '10.3390/s25020533' },
        ],
        notes: 'Twenty-four recreational runners completed baseline, overload and recovery periods. Nightly recovery metrics showed no consistent group-level changes despite increased perceived strain; a proprietary individualized ANS-charge composite combining HR, HRV and breathing rate was associated with performance adaptation. This supports multivariate individualized monitoring but does not isolate respiratory rate or validate an RR-triggered training rule.',
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
        statement: 'Nocturnal or resting respiratory rate is a relatively stable within-person signal; a meaningful rise from personal baseline can precede respiratory infection in some athletes and is also associated with non-infectious physiological or psychological stress, making it useful as an early but nonspecific anomaly signal rather than a standalone illness diagnosis or sport-readiness veto.',
        claimType: 'prognostic',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'informational',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['daily_readiness', 'wearable_health_context', 'recovery', 'illness_anomaly_detection'],
            sports: ['all_supported_sports'],
            populations: ['athletes_and_active_adults_with_repeated_resting_or_nocturnal_respiratory_rate_measurements'],
            outcomes: ['physiological_anomaly_context', 'illness_context', 'readiness_input_interpretation'],
            horizon: 'acute',
        },
        evidence: [
            { sourceId: NATARAJAN_RESPIRATION_SOURCE, directness: 'partially_direct', note: 'Supports wearable measurement and within-person stability; indirect for training decisions.' },
            { sourceId: MITRATZA_WEARABLE_INFECTION_SOURCE, directness: 'partially_direct', note: 'Systematic review supports respiratory-rate change as one recurring presymptomatic infection signal while documenting heterogeneous performance and bias.' },
            { sourceId: RENTERIA_ATHLETE_COVID_SOURCE, directness: 'direct', note: 'Direct athlete cohort in which RR rose three days before a positive COVID-19 test, with important sample/pathogen limitations.' },
            { sourceId: BLOOMFIELD_RR_STRESS_SOURCE, directness: 'partially_direct', note: 'Large longitudinal wearable cohort supports sensitivity to non-infectious perceived stress and therefore the signal\'s non-specificity.' },
            { sourceId: ESMAEILPOUR_INFECTION_SOURCE, directness: 'partially_direct', note: 'Prospective multivariate infection-alert validation shows useful early physiological signal and substantial non-specificity.' },
            { sourceId: NUUTTILA_NIGHTLY_RECOVERY_SOURCE, directness: 'partially_direct', note: 'Athlete overload study supports individualized multivariate nightly monitoring but does not isolate RR or validate RR-guided training actions.' },
        ],
        limitations: [
            'The most direct athlete infection study had only 14 analyzable COVID-positive NCAA Division I female athletes; its three-day lead time must not be generalized to all athletes, pathogens or devices.',
            'The broader wearable-infection literature is heterogeneous, largely observational and dominated by COVID-era studies; it does not establish that respiratory-rate-guided training changes improve health or performance outcomes.',
            'Respiratory-rate changes are not specific to infection: intense exercise, poor sleep, emotional stress, alcohol, altitude, environment and other physiological factors can alter the signal or multivariate alerts.',
            'The athlete overload study used breathing rate only inside a proprietary multivariate recovery score and found no consistent group-level change in nightly recovery metrics, so it cannot validate respiratory rate as an isolated training-readiness marker.',
            'Device algorithms, sleep-state selection, sensor quality and measurement context affect validity; results do not transfer automatically across wearable generations or vendors.',
            'No reviewed evidence establishes a 1 br/min variability floor, a 0.3 readiness weight, the shared z cap, the chronic multiplier, or any standalone respiratory-rate action threshold as a universal sports-readiness boundary.',
            'Using an RR anomaly to make training more conservative is therefore a conditional product-policy inference that should require persistence and/or corroborating signals, not be presented as a direct evidence-derived prescription.',
        ],
        reviewedOn: '2026-08-30',
        version: 2,
    },
];
