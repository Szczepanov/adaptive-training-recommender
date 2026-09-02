# Knowledge citation provenance audit — 2026-09-02

## Scope

This audit reviewed every `app/src/knowledge` module that currently defines scientific `KnowledgeSource` records:

- `sportsKnowledge.ts`
- `readinessCardiorespiratoryKnowledge.ts`
- `periodizationEventDemandKnowledge.ts`
- `strengthConcurrentKnowledge.ts`
- `strengthWarmupKnowledge.ts`
- `subjectiveReadinessKnowledge.ts`
- `taperFuelingKnowledge.ts`
- `injuryPainKnowledge.ts`

The review checked publication identity, title/authors/journal/year where represented, stable identifiers (PMID/PMCID/DOI/PROSPERO where available), publication/study design, synthesis method, and whether each source is used with a claim/directness that the publication actually supports. Product-policy sources were checked for language that could falsely imply external validation of exact internal thresholds.

This is a provenance audit, not a new evidence synthesis. No engine policy scalar or recommendation threshold was changed merely because a citation was reviewed.

## Corrections made

### Publication-design taxonomy

The registry now distinguishes `scoping_review` and `narrative_review` from `systematic_review`. The normalized `narrative_review` bucket is a publication-design/provenance category, not an evidence-certainty tier.

Verified corrections:

| Source | Previous | Corrected | Verification |
| --- | --- | --- | --- |
| Neves et al. 2026, resistance-training warm-up | `systematic_review` | `scoping_review` | Publisher title explicitly says “A Scoping Review”: https://doi.org/10.1007/s42978-025-00361-9 |
| Burke et al. 2011, carbohydrate | `expert_practice` | `narrative_review` | PubMed publication type is Review, PMID 21660838: https://pubmed.ncbi.nlm.nih.gov/21660838/ |
| Morton et al. 2026, carbohydrate | `expert_practice` | `narrative_review` | PubMed publication type is Review, PMID 41759826: https://pubmed.ncbi.nlm.nih.gov/41759826/ |
| Plews et al. 2026, ultra-high carbohydrate | `expert_practice` | `narrative_review` | Publisher labels the article Current Opinion and describes narrative synthesis: https://doi.org/10.1007/s40279-026-02462-z |
| Issurin 2010, periodization | `expert_practice` | `narrative_review` | PubMed indexes the publication as Review, PMID 20199119: https://pubmed.ncbi.nlm.nih.gov/20199119/ |
| Joyner & Coyle 2008, endurance physiology | `expert_practice` | `narrative_review` | PubMed indexes the publication as Review, PMID 17901124: https://pubmed.ncbi.nlm.nih.gov/17901124/ |
| Sanders & van Erp 2021, cycling power profile | `expert_practice` | `narrative_review` | PubMed indexes the publication as Review, PMID 33271501: https://pubmed.ncbi.nlm.nih.gov/33271501/ |

### Stable identifier enrichment

Fradkin et al. 2010 was already correctly represented as a systematic review with meta-analysis, but the registry retained only its PMID. PubMed also provides DOI `10.1519/JSC.0b013e3181c643a0`; the DOI is now recorded and regression-tested alongside PMID 19996770: https://pubmed.ncbi.nlm.nih.gov/19996770/.

### Product-policy / scientific-evidence boundary

`PRODUCT-TISSUE-RESPONSE-SEVERITY-POLICY-V2` previously described transient moderate discomfort as “tolerable loading, Escriche-Escuder 2020”. That wording could be read as external validation of the product's exact 24-hour latency and monitor/limit/exclude translation.

The cited systematic review supports a narrower statement: pain/symptom response is commonly used to progress lower-limb tendinopathy exercise, but the review did not find strong comparative evidence validating one progression criterion. The product-source note now states explicitly that the 24-hour timing and severity mapping are product calibration, while retaining Escriche-Escuder only as background for condition-specific symptom-monitoring practice. Source: PMID 33444210, DOI `10.1136/bmjopen-2020-041433`: https://pubmed.ncbi.nlm.nih.gov/33444210/.

## Errata / publication-record checks

### Thomas et al. 2016 sports-nutrition position statement

The primary paper is correctly identified as Thomas DT, Erdman KA, Burke LM, *J Acad Nutr Diet.* 2016;116(3):501-528, DOI `10.1016/j.jand.2015.12.006`, PMID 26920240: https://pubmed.ncbi.nlm.nih.gov/26920240/.

PubMed links a published erratum: *J Acad Nutr Diet.* 2017;117(1):146, PMID 28010851, DOI `10.1016/j.jand.2016.11.008`: https://pubmed.ncbi.nlm.nih.gov/28010851/.

The publisher's correction is specific to an undisclosed potential conflict of interest and potential endorsement in a sentence recommending a named postgraduate sports-nutrition course/resource; the replacement text keeps only the generic recommendation to complete recognized postgraduate qualifications. The correction is not to the event-fueling or hydration guidance represented by this repository: https://www.sciencedirect.com/science/article/pii/S2212267216314186.

The source remains usable for the claims currently attached to it; no evidence-certainty or dose-policy change was made on the basis of this erratum.

### Carter et al. 2026 HRV methodological recommendations

During the audit PubMed still displayed the article as online-ahead-of-print, which initially appeared inconsistent with the repository's assigned 2026 volume/page citation. The current American Physiological Society publication record assigns the article to *Am J Physiol Heart Circ Physiol.* 331:H918-H943. The repository citation was therefore retained rather than regressed to the older PubMed display.

## Representative records verified without correction

The audit also rechecked the following higher-impact evidence families against PubMed/publisher records and their claim limitations; no correction was required:

- WHO 2020 adult physical-activity guideline and the core endurance intensity-distribution reviews.
- Recovery/overtraining consensus and muscle-damage/fatigue recovery syntheses.
- HRV-guided training systematic reviews/meta-analyses and autonomic-monitoring synthesis.
- Athlete sleep consensus, sleep-deprivation meta-analysis, sleep-intervention review, and wearable-sleep umbrella/validation reviews.
- Resting-HR and respiratory-rate evidence, including Quer 2020, Natarajan 2021, Mitratza 2022, Rentería 2024, Bloomfield 2024, Esmaeilpour 2024, and Nuuttila 2025. Their repository claims remain explicitly individualized and nonspecific rather than diagnostic.
- Strength/endurance evidence, including Ramos-Campo 2025 umbrella review, Llanos-Lagos running/cycling meta-analyses, Held 2026 concurrent-training umbrella review, Eddens 2018 sequencing meta-analysis, and Bangsbo 2025 elite-athlete consensus.
- Periodization evidence from Mølmen 2019, Galán-Rioja 2023, Almquist 2022, Ebert 2006, plus the corrected narrative reviews above. Exact app phase boundaries and event-demand vectors remain product calibration.
- Subjective-readiness systematic reviews/meta-analysis and psychometric/longitudinal studies. Exact app composite weights and train/modify/recover cut-points remain product policy.
- Taper meta-analyses, endurance carbohydrate evidence, and exercise-associated-hyponatremia consensus. Exact taper windows and internal sharpening vectors remain product policy.
- IOC/team-physician pain and return-to-sport consensus statements and the lower-limb-tendinopathy progression review. Region mappings and automated safety state-machine thresholds remain product policy.

## Deliberate non-changes

- `guideline` was retained for the Thomas et al. 2016 organizational position statement because its abstract explicitly says the participating organizations provide guidelines for type, amount and timing of nutrition/fluid intake. The registry category is therefore defensible even though the journal labels it a Position Paper.
- The Sharma & Périard 2020 triathlon-distance source is explicitly cited as a Springer book chapter. `expert_practice` remains a coarse registry bucket for this publication form; no claim treats it as a systematic synthesis or primary trial.
- No scientific source was upgraded in certainty simply because its identifiers or design label were corrected.
- No product-policy threshold was converted into a scientific constant by citation proximity.

## Validation expectations

The PR should remain subject to the repository's normal CI gates: TypeScript typecheck/lint, sports-knowledge validation, knowledge-coverage validation, full frontend tests, Firestore emulator tests, simulation/judge gates, bundle build, Python lint/typecheck/pytest, dependency audits, and Docker build. CI status should be read from the final PR head rather than inferred from this document.
