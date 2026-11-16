import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const READINESS_CARDIORESPIRATORY_CLAIM_IDS = {
    rhrContextualMonitoring: 'readiness.rhr.contextual_individualized_monitoring',
    respirationLongitudinalContext: 'readiness.respiration.longitudinal_contextual_signal',
    cardiorespiratoryIllnessEscalation: 'cardiorespiratory-illness-escalation',
} as const;

const BOSQUET_RHR_OVERREACH_SOURCE = 'BOSQUET-2008-RHR-OVERREACH-META';
const QUER_RHR_LONGITUDINAL_SOURCE = 'QUER-2020-RHR-LONGITUDINAL-COHORT';
const NATARAJAN_RESPIRATION_SOURCE = 'NATARAJAN-2021-NOCTURNAL-RESPIRATION-COHORT';
const MITRATZA_WEARABLE_INFECTION_SOURCE = 'MITRATZA-2022-WEARABLE-INFECTION-REVIEW';
const RENTERIA_ATHLETE_COVID_SOURCE = 'RENTERIA-2024-ATHLETE-COVID-WEARABLE';
const BLOOMFIELD_RR_STRESS_SOURCE = 'BLOOMFIELD-2024-NOCTURNAL-RR-STRESS-COHORT';
const ESMAEILPOUR_INFECTION_SOURCE = 'ESMAEILPOUR-2024-WEARABLE-INFECTION-VALIDATION';
const NUUTTILA_NIGHTLY_RECOVERY_SOURCE = 'NUUTTILA-2025-NIGHTLY-RECOVERY-OVERLOAD';
const MISHRA_SMARTWATCH_COVID_SOURCE = 'MISHRA-2020-SMARTWATCH-PRESYMPTOMATIC-COVID';
const ALAVI_NIGHTSIGNAL_ALERT_SOURCE = 'ALAVI-2021-NIGHTSIGNAL-WEARABLE-ALERTING';
const GRZESIAK_VIRAL_CHALLENGE_SOURCE = 'GRZESIAK-2021-VIRAL-CHALLENGE-WEARABLES';
const GAUR_GARMIN_ACTIVITY_MATCHED_SOURCE = 'GAUR-2024-GARMIN-ACTIVITY-MATCHED-HRV';
const ZWIERS_COVID_RED_TRIAL_SOURCE = 'ZWIERS-2025-COVID-RED-RANDOMIZED-TRIAL';
const SCHWELLNUS_IOC_RESPIRATORY_PART1_SOURCE = 'SCHWELLNUS-2022-IOC-RESPIRATORY-PART1';
const SCHWELLNUS_IOC_RESPIRATORY_PART2_SOURCE = 'SCHWELLNUS-2022-IOC-RESPIRATORY-PART2';

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
    {
        id: MISHRA_SMARTWATCH_COVID_SOURCE,
        title: 'Pre-symptomatic detection of COVID-19 from smartwatch data',
        sourceType: 'cohort',
        citation: 'Mishra T, Wang M, Metwally AA, et al. Nat Biomed Eng. 2020. doi:10.1038/s41551-020-00640-6.',
        url: 'https://www.nature.com/articles/s41551-020-00640-6',
        externalIds: [
            { type: 'pmid', value: '33208926' },
            { type: 'pmcid', value: 'PMC9020268' },
            { type: 'doi', value: '10.1038/s41551-020-00640-6' },
        ],
        notes: 'Retrospective smartwatch telemetry analysis (5,262 enrolled; 32 confirmed COVID-19 positive cases): 81% (26/32) showed altered resting heart rate, steps, or sleep metrics before or at symptom onset (median ~4 days lead time), with travel, alcohol, and stress noted as non-infectious excursions.',
    },
    {
        id: ALAVI_NIGHTSIGNAL_ALERT_SOURCE,
        title: 'Real-time alerting system for COVID-19 and other stress events using wearable data',
        sourceType: 'cohort',
        citation: 'Alavi A, Bogu GK, Wang M, et al. Nat Med. 2021. PMID:34845388.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/34845388/',
        externalIds: [
            { type: 'pmid', value: '34845388' },
            { type: 'pmcid', value: 'PMC8799466' },
        ],
        notes: 'Prospective NightSignal finite-state machine comparing overnight resting HR and daily steps against personal baselines across 3,318 primary participants: 80% sensitivity (67/84) and median 3-day pre-symptomatic lead time, alongside shorter 1.15-day average alert streaks from intense exercise, alcohol, travel, poor sleep, and stress.',
    },
    {
        id: GRZESIAK_VIRAL_CHALLENGE_SOURCE,
        title: 'Assessment of the Feasibility of Using Noninvasive Wearable Biometric Monitoring Sensors to Detect Influenza and the Common Cold Before Symptom Onset',
        sourceType: 'cohort',
        citation: 'Grzesiak E, Bent B, McClain MT, et al. JAMA Netw Open. 2021;4(9):e2128534. doi:10.1001/jamanetworkopen.2021.28534.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/34586364/',
        externalIds: [
            { type: 'pmid', value: '34586364' },
            { type: 'pmcid', value: 'PMC8482058' },
            { type: 'doi', value: '10.1001/jamanetworkopen.2021.28534' },
        ],
        notes: 'Controlled human viral-challenge study (H1N1 n=31, rhinovirus n=18) demonstrating pre-symptomatic physiological deviation 12-36h post-inoculation prior to symptom onset; small inpatient cohorts without athletic training load do not establish real-world positive predictive value.',
    },
    {
        id: GAUR_GARMIN_ACTIVITY_MATCHED_SOURCE,
        title: 'Continuous Monitoring of Heart Rate Variability in Free-Living Conditions Using Wearable Sensors: Exploratory Observational Study',
        sourceType: 'cohort',
        citation: 'Gaur P, Temple DS, Hegarty-Craver M, et al. JMIR Form Res. 2024;8:e53977. doi:10.2196/53977.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/39110968/',
        externalIds: [
            { type: 'pmid', value: '39110968' },
            { type: 'pmcid', value: 'PMC11339560' },
            { type: 'doi', value: '10.2196/53977' },
        ],
        notes: 'Eight-month free-living prospective monitoring of 59 Garmin Fenix 6/6s wearers evaluating HR/HRV deviations relative to individual activity-matched baselines rather than unconditional averages.',
    },
    {
        id: ZWIERS_COVID_RED_TRIAL_SOURCE,
        title: 'Remote early detection of SARS-CoV-2 infections using a wearable-based algorithm: Results from the COVID-RED study, a prospective randomised single-blinded crossover trial',
        sourceType: 'randomized_trial',
        citation: 'Zwiers LC, Brakenhoff TB, Grobbee DE, et al. PLoS One. 2025;20(6):e0325116. doi:10.1371/journal.pone.0325116.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/40471995/',
        publishedOn: '2025-06-05',
        externalIds: [
            { type: 'pmid', value: '40471995' },
            { type: 'doi', value: '10.1371/journal.pone.0325116' },
        ],
        notes: 'Large prospective randomised single-blinded crossover trial (n=17,825): experimental multi-parameter wearable algorithm increased sensitivity (93.8-99.2%) and moved alerts earlier (median 0 vs 7 days prior to PCR test) at the cost of very low period specificity (0.8-4.2%) and no demonstrated clinical severity reduction from alerting alone.',
    },
    {
        id: SCHWELLNUS_IOC_RESPIRATORY_PART1_SOURCE,
        title: 'International Olympic Committee (IOC) consensus statement on acute respiratory illness in athletes part 1: acute respiratory infections',
        sourceType: 'consensus',
        citation: 'Schwellnus M, Adami PE, Bougault V, et al. Br J Sports Med. 2022;56(19):1066-1088. doi:10.1136/bjsports-2022-105759.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/35863871/',
        externalIds: [
            { type: 'pmid', value: '35863871' },
            { type: 'doi', value: '10.1136/bjsports-2022-105759' },
        ],
        notes: 'IOC clinical consensus rejecting the traditional anatomical "neck check", defining systemic red-flag contraindications to intense exercise (fever, chest pain/tightness, shortness of breath, tachycardia/palpitations, dizziness, widespread myalgia), and outlining symptom-led staged return-to-sport.',
    },
    {
        id: SCHWELLNUS_IOC_RESPIRATORY_PART2_SOURCE,
        title: 'International Olympic Committee (IOC) consensus statement on acute respiratory illness in athletes part 2: non-infective acute respiratory illness',
        sourceType: 'consensus',
        citation: 'Schwellnus M, Adami PE, Bougault V, et al. Br J Sports Med. 2022;56(11):630-640. doi:10.1136/bjsports-2022-105567.',
        url: 'https://doi.org/10.1136/bjsports-2022-105567',
        externalIds: [
            { type: 'doi', value: '10.1136/bjsports-2022-105567' },
        ],
        notes: 'Companion IOC consensus distinguishing infective vs non-infective respiratory symptoms (rhinitis, airway dysfunction, environment/allergens), supporting non-diagnostic framing and non-infectious differential context.',
    },
];

export const CARDIORESPIRATORY_EARLY_WARNING_POLICY_DESCRIPTOR = {
    policyVersion: 'health-anomaly-thresholds/visible-early-warning-v1',
    moderateDeviation: 1.5,
    strongDeviation: 2.5,
    minimumCoreSignalsForMultiSignal: 2,
    persistenceDaysForEscalation: 2,
    emergingHistoryCount: 7,
    minimumHistoryCount: 14,
    minimumRecentDayCoverage: 4 / 7,
    maxBaselineAgeDays: 3,
    baselineWindowDays: 28,
    activityShrinkagePriorDays: 5,
    outcomeCalibrationMinEpisodes: 3,
    allowFirstNightMultiDomainEscalation: true,
    downgradeResolvingRespiration: true,
} as const;

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
    {
        id: READINESS_CARDIORESPIRATORY_CLAIM_IDS.cardiorespiratoryIllnessEscalation,
        statement: 'Multi-domain nocturnal cardiorespiratory monitoring (resting heart rate, HRV, and respiratory rate against clean 28-day personal baselines with emerging 7-13 night caution and 14-night full calibration, activity-matched shrinkage prior K=5, moderate >=1.5 SD and strong >=2.5 SD deviations, multi-night persistence >=2 or strong respiration-anchored Night-1 multi-domain corroboration) supports advisory non-clinical early warnings alongside confounder attribution, while reported symptoms govern Level 3 IOC red-flag screening and 3-stage return-to-sport precautions without diagnostic claims or autonomous training restriction.',
        claimType: 'safety',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['illness_anomaly_detection', 'wearable_health_context', 'recovery'],
            sports: ['all_supported_sports'],
            populations: ['athletes_and_active_adults_with_repeated_overnight_wearable_telemetry'],
            outcomes: ['early_physiological_warning', 'non_diagnostic_recovery_guidance'],
            horizon: 'acute',
        },
        evidence: [
            { sourceId: MISHRA_SMARTWATCH_COVID_SOURCE, directness: 'partially_direct', note: 'Established individualized resting HR/step longitudinal baselines preceding symptom onset.' },
            { sourceId: ALAVI_NIGHTSIGNAL_ALERT_SOURCE, directness: 'partially_direct', note: 'Prospective overnight NightSignal monitoring showed 1-3d lead time alongside frequent exercise/alcohol/travel/sleep confounders.' },
            { sourceId: GRZESIAK_VIRAL_CHALLENGE_SOURCE, directness: 'partially_direct', note: 'Controlled viral challenge confirmed pre-symptomatic cardiorespiratory shift for influenza and common cold viruses.' },
            { sourceId: GAUR_GARMIN_ACTIVITY_MATCHED_SOURCE, directness: 'direct', note: 'Garmin Fenix prospective free-living cohort motivating activity-matched baseline conditioning.' },
            { sourceId: ZWIERS_COVID_RED_TRIAL_SOURCE, directness: 'partially_direct', note: 'Large RCT demonstrated high false-positive burden and no automatic severity benefit from alerting alone.' },
            { sourceId: SCHWELLNUS_IOC_RESPIRATORY_PART1_SOURCE, directness: 'direct', note: 'IOC clinical consensus rejecting the neck check, establishing systemic red-flag warnings, and defining staged RTS.' },
            { sourceId: SCHWELLNUS_IOC_RESPIRATORY_PART2_SOURCE, directness: 'direct', note: 'Companion IOC consensus differentiating non-infective respiratory symptoms and allergic triggers.' },
            { sourceId: ESMAEILPOUR_INFECTION_SOURCE, directness: 'partially_direct', note: 'Prospective multi-signal ARI validation showing low PPV and frequent non-infectious confounders.' },
            { sourceId: NATARAJAN_RESPIRATION_SOURCE, directness: 'partially_direct', note: 'Supporting nocturnal respiratory rate stability and non-specificity.' },
            { sourceId: RENTERIA_ATHLETE_COVID_SOURCE, directness: 'direct', note: 'Direct collegiate athlete longitudinal evidence for early respiration rise.' },
            { sourceId: MITRATZA_WEARABLE_INFECTION_SOURCE, directness: 'partially_direct', note: 'Systematic synthesis supporting multi-sensor presymptomatic detection boundaries.' },
        ],
        limitations: [
            'Positive predictive value in prospective general/worker cohorts remains low (4-10% in Esmaeilpour; 0.8-4.2% period specificity in COVID-RED), prohibiting medical diagnosis framing or autonomous training vetoes.',
            'Numeric cutoffs (1.5 SD moderate, 2.5 SD strong, 7-night emerging minimum with +0.5 SD offset, 14-night reliable baseline, K=5 activity-stratum shrinkage prior, >=3 prior episodes for personal outcome calibration, and >=2 nights persistence) are conservative product policy parameters.',
            'Respiration elevation requires target-date sleep provenance and downgrades resolving tails (deltaVs7d <= 0) to prevent stale 28-day median alarms.',
            'Athletes reporting symptoms must receive Level 3 non-diagnostic guidance prioritizing rest, IOC red-flag awareness, and 3-stage return-to-sport regardless of benign wearable values.',
        ],
        reviewedOn: '2026-11-15',
        version: 1,
    },
];
