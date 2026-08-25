import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mad, median, round2 } from './aggregate.mjs';
import {
  DIAGNOSTIC_ASSESSMENTS,
  REACTION_CLASSES,
  SELF_TEST_CASE_SCHEMA,
  SELF_TEST_PACKET_SCHEMA,
  SELF_TEST_RESPONSE_SCHEMA,
  SELF_TEST_SUITE_SCHEMA,
} from './selfTestSchema.mjs';

export const SELF_TEST_PROMPT = `You are calibrating an evaluator for an offline adaptive-training planner.

Judge only the factual packet supplied. Hard restrictions, equipment, time capacity, and fixed events are deterministic controls. Mild isolated recovery or motivation changes do not automatically require recovery. Distinguish an appropriate response from overreaction, underreaction, and opposite-direction behavior. For pairwise cases, use the stable planId when naming the preferred plan so A/B presentation order cannot change the identity.

Score the PLANNER OUTPUT, not the quality of your evaluator answer. absoluteClass is the safety/quality of focusPlanId: an unsafe plan is 0 even when you correctly detect the problem. reactionClass describes whether the planner overreacted, underreacted, or reacted appropriately; it never describes whether your own answer is appropriate. For pointwise cases preferredPlanId is bookkeeping value none, but you must still evaluate the focus plan. diagnosticAssessment concerns source/planner warnings only; because blind packets show none, use not_shown.

Use the anchored absolute-class rubric: 4 exemplary, 3 sound, 2 marginal, 1 flawed, 0 unsafe. Cite packet facts using RFC 6901 JSON Pointers relative to the individual case object, never the outer batch: use paths beginning /inputContext, /plans, /comparison, or /focusPlanId and never /cases/N. Observations must be supported by cited packet fields. Internal implementation causes are hypotheses only and must be marked speculative. numericParameterCandidates is only for numeric tuning thresholds backed by repeated calibration evidence; leave it empty for these synthetic controls. Planner/source diagnostics are not shown in the blind primary packet and must not be invented.`;

const RESULT_KEYS = [
  'caseId',
  'absoluteClass',
  'reactionClass',
  'preferredPlanId',
  'diagnosticAssessment',
  'evidenceReferences',
  'observations',
  'hypotheses',
  'numericParameterCandidates',
  'rationale',
];

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function exactKeys(value, expectedKeys, field) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  const unknown = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  if (unknown.length || missing.length) {
    throw new Error(`${field} keys mismatch (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`);
  }
}

function stringArray(value, field, { minItems = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minItems) {
    throw new Error(`${field} must be an array with at least ${minItems} item(s).`);
  }
  return value.map((item, index) => nonEmptyString(item, `${field}[${index}]`));
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10000) / 10000;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
}

function allResultText(result) {
  return [
    result.rationale,
    ...result.observations.map((item) => item.text),
    ...result.hypotheses.map((item) => item.text),
    ...result.numericParameterCandidates.map((item) => item.text),
  ].join('\n').toLowerCase();
}

export function resolveJsonPointer(document, pointer) {
  if (pointer === '') return document;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
  let current = document;
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      current = current[Number(token)];
    } else if (current && typeof current === 'object' && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

export function loadSelfTestFixtures(fixturesDir = resolve('scripts/fixtures/ai-judge-calibration')) {
  const casesPath = resolve(fixturesDir, 'cases.jsonl');
  const expectedPath = resolve(fixturesDir, 'expected.json');
  const cases = readFileSync(casesPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${casesPath}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const validated = validateSelfTestFixtures(cases, expected);
  return {
    ...validated,
    casesPath,
    expectedPath,
    casesSha256: hashJson(cases),
    expectedSha256: hashJson(expected),
    caseSetSha256: hashJson(cases.map((item) => item.caseId)),
  };
}

export function validateSelfTestFixtures(cases, expected) {
  if (!Array.isArray(cases) || cases.length < 20 || cases.length > 40) {
    throw new Error(`Calibration suite must contain 20–40 cases; found ${Array.isArray(cases) ? cases.length : 'non-array'}.`);
  }
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw new Error('Expected calibration contract must be an object.');
  if (expected.schema !== SELF_TEST_SUITE_SCHEMA) throw new Error(`Unexpected self-test suite schema ${JSON.stringify(expected.schema)}.`);
  const suiteId = nonEmptyString(expected.suiteId, 'expected.suiteId');
  if (!expected.cases || typeof expected.cases !== 'object' || Array.isArray(expected.cases)) {
    throw new Error('expected.cases must be an object keyed by caseId.');
  }

  const categories = new Set();
  const caseIds = new Set();
  for (const item of cases) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Every calibration case must be an object.');
    if (item.schema !== SELF_TEST_CASE_SCHEMA) throw new Error(`${item.caseId ?? 'unknown'} has unexpected case schema.`);
    const caseId = nonEmptyString(item.caseId, 'case.caseId');
    if (caseIds.has(caseId)) throw new Error(`Duplicate calibration caseId '${caseId}'.`);
    caseIds.add(caseId);
    categories.add(nonEmptyString(item.category, `${caseId}.category`));
    if (!['pointwise', 'pairwise'].includes(item.evaluationMode)) throw new Error(`${caseId}.evaluationMode must be pointwise or pairwise.`);
    if (!Array.isArray(item.plans) || item.plans.length === 0) throw new Error(`${caseId}.plans must be non-empty.`);
    const planIds = item.plans.map((plan) => nonEmptyString(plan?.planId, `${caseId}.plans.planId`));
    if (new Set(planIds).size !== planIds.length) throw new Error(`${caseId} contains duplicate planIds.`);
    if (!planIds.includes(item.focusPlanId)) throw new Error(`${caseId}.focusPlanId must reference a plan in the case.`);
    if (item.evaluationMode === 'pairwise') {
      if (!item.comparison || !planIds.includes(item.comparison.planAId) || !planIds.includes(item.comparison.planBId)) {
        throw new Error(`${caseId}.comparison must reference two plans in the case.`);
      }
      nonEmptyString(item.presentationGroup, `${caseId}.presentationGroup`);
      if (!['AB', 'BA'].includes(item.presentationOrder)) throw new Error(`${caseId}.presentationOrder must be AB or BA.`);
    }

    const rule = expected.cases[caseId];
    if (!rule) throw new Error(`Missing expected rule for calibration case '${caseId}'.`);
    if (!Array.isArray(rule.absoluteClassRange) || rule.absoluteClassRange.length !== 2
      || rule.absoluteClassRange.some((value) => !Number.isInteger(value) || value < 0 || value > 4)
      || rule.absoluteClassRange[0] > rule.absoluteClassRange[1]) {
      throw new Error(`${caseId}.absoluteClassRange must be an ordered integer pair in [0, 4].`);
    }
    if (!Number.isInteger(rule.ordinalTarget) || rule.ordinalTarget < 0 || rule.ordinalTarget > 4) {
      throw new Error(`${caseId}.ordinalTarget must be an integer in [0, 4].`);
    }
    for (const [field, allowedValues] of [
      ['allowedReactionClasses', REACTION_CLASSES],
      ['allowedDiagnosticAssessments', DIAGNOSTIC_ASSESSMENTS],
    ]) {
      if (!Array.isArray(rule[field]) || rule[field].length === 0 || rule[field].some((value) => !allowedValues.includes(value))) {
        throw new Error(`${caseId}.${field} contains an unsupported or empty value set.`);
      }
    }
    if (!Array.isArray(rule.allowedPreferredPlanIds) || rule.allowedPreferredPlanIds.length === 0
      || rule.allowedPreferredPlanIds.some((planId) => planId !== 'none' && !planIds.includes(planId))) {
      throw new Error(`${caseId}.allowedPreferredPlanIds must reference case plans or 'none'.`);
    }
    for (const group of rule.mustReferenceAnyOf ?? []) {
      if (!Array.isArray(group) || group.length === 0) throw new Error(`${caseId}.mustReferenceAnyOf groups must be non-empty arrays.`);
      for (const pointer of group) {
        if (resolveJsonPointer(buildSelfTestPacket(item), pointer) === undefined) {
          throw new Error(`${caseId}.mustReferenceAnyOf contains unresolved pointer '${pointer}'.`);
        }
      }
    }
    if (!Array.isArray(rule.forbiddenClaims)) throw new Error(`${caseId}.forbiddenClaims must be an array.`);
    if (typeof rule.numericThresholdProposalAllowed !== 'boolean') throw new Error(`${caseId}.numericThresholdProposalAllowed must be boolean.`);
  }

  const unexpectedExpectations = Object.keys(expected.cases).filter((caseId) => !caseIds.has(caseId));
  if (unexpectedExpectations.length) throw new Error(`Expectations contain unknown cases: ${unexpectedExpectations.join(', ')}.`);
  const requiredCategories = [
    'hard_control',
    'correct_non_reaction',
    'deliberate_overreaction',
    'deliberate_underreaction',
    'event_specificity',
    'bias_adversarial',
    'temporal_semantics',
    'root_cause_discipline',
  ];
  const missingCategories = requiredCategories.filter((category) => !categories.has(category));
  if (missingCategories.length) throw new Error(`Calibration suite is missing categories: ${missingCategories.join(', ')}.`);
  return { suiteId, cases, expected };
}

export function buildSelfTestPacket(calibrationCase) {
  const orderedPlans = calibrationCase.evaluationMode === 'pairwise' && calibrationCase.presentationOrder === 'BA'
    ? [...calibrationCase.plans].reverse()
    : [...calibrationCase.plans];
  return {
    packetSchema: SELF_TEST_PACKET_SCHEMA,
    caseId: calibrationCase.caseId,
    evaluationMode: calibrationCase.evaluationMode,
    inputContext: calibrationCase.inputContext,
    plans: orderedPlans,
    focusPlanId: calibrationCase.focusPlanId,
    comparison: calibrationCase.comparison ?? null,
    instruction: calibrationCase.instruction,
  };
}

export function validateSelfTestResponse(value, suiteId, calibrationCases) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Self-test response must be an object.');
  exactKeys(value, ['schema', 'suiteId', 'results'], 'self-test response');
  if (value.schema !== SELF_TEST_RESPONSE_SCHEMA) throw new Error(`Unexpected self-test response schema ${JSON.stringify(value.schema)}.`);
  if (value.suiteId !== suiteId) throw new Error(`Self-test response suiteId must be '${suiteId}'.`);
  if (!Array.isArray(value.results)) throw new Error('Self-test response results must be an array.');

  const caseById = new Map(calibrationCases.map((item) => [item.caseId, item]));
  const normalizedById = new Map();
  for (const raw of value.results) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Self-test result must be an object.');
    exactKeys(raw, RESULT_KEYS, `self-test result ${raw.caseId ?? 'unknown'}`);
    const caseId = nonEmptyString(raw.caseId, 'self-test result caseId');
    const fixture = caseById.get(caseId);
    if (!fixture) throw new Error(`Unknown self-test caseId '${caseId}'.`);
    if (normalizedById.has(caseId)) throw new Error(`Duplicate self-test caseId '${caseId}'.`);
    if (!Number.isInteger(raw.absoluteClass) || raw.absoluteClass < 0 || raw.absoluteClass > 4) {
      throw new Error(`${caseId}.absoluteClass must be an integer in [0, 4].`);
    }
    if (!REACTION_CLASSES.includes(raw.reactionClass)) throw new Error(`${caseId}.reactionClass is invalid.`);
    const planIds = new Set(fixture.plans.map((plan) => plan.planId));
    if (raw.preferredPlanId !== 'none' && !planIds.has(raw.preferredPlanId)) {
      throw new Error(`${caseId}.preferredPlanId '${raw.preferredPlanId}' is not a plan in the packet.`);
    }
    if (!DIAGNOSTIC_ASSESSMENTS.includes(raw.diagnosticAssessment)) throw new Error(`${caseId}.diagnosticAssessment is invalid.`);
    const packet = buildSelfTestPacket(fixture);
    const validateReferences = (references, field, options = {}) => {
      const pointers = stringArray(references, field, options);
      for (const pointer of pointers) {
        if (!pointer.startsWith('/') || resolveJsonPointer(packet, pointer) === undefined) {
          throw new Error(`${field} contains unresolved JSON Pointer '${pointer}'.`);
        }
      }
      return pointers;
    };
    const normalizeClaims = (claims, field, { hypothesis = false } = {}) => {
      if (!Array.isArray(claims)) throw new Error(`${field} must be an array.`);
      return claims.map((claim, index) => {
        if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error(`${field}[${index}] must be an object.`);
        exactKeys(claim, hypothesis ? ['text', 'speculative', 'evidenceReferences'] : ['text', 'evidenceReferences'], `${field}[${index}]`);
        if (hypothesis && claim.speculative !== true) throw new Error(`${field}[${index}].speculative must be true.`);
        return {
          text: nonEmptyString(claim.text, `${field}[${index}].text`),
          ...(hypothesis ? { speculative: true } : {}),
          evidenceReferences: validateReferences(claim.evidenceReferences, `${field}[${index}].evidenceReferences`),
        };
      });
    };
    normalizedById.set(caseId, {
      caseId,
      absoluteClass: raw.absoluteClass,
      reactionClass: raw.reactionClass,
      preferredPlanId: nonEmptyString(raw.preferredPlanId, `${caseId}.preferredPlanId`),
      diagnosticAssessment: raw.diagnosticAssessment,
      evidenceReferences: validateReferences(raw.evidenceReferences, `${caseId}.evidenceReferences`, { minItems: 1 }),
      observations: normalizeClaims(raw.observations, `${caseId}.observations`),
      hypotheses: normalizeClaims(raw.hypotheses, `${caseId}.hypotheses`, { hypothesis: true }),
      numericParameterCandidates: normalizeClaims(raw.numericParameterCandidates, `${caseId}.numericParameterCandidates`),
      rationale: nonEmptyString(raw.rationale, `${caseId}.rationale`),
    });
  }
  const missing = calibrationCases.map((item) => item.caseId).filter((caseId) => !normalizedById.has(caseId));
  if (missing.length || normalizedById.size !== calibrationCases.length) {
    throw new Error(`Self-test result cardinality mismatch; missing: ${missing.join(', ') || 'none'}.`);
  }
  return {
    schema: SELF_TEST_RESPONSE_SCHEMA,
    suiteId,
    results: calibrationCases.map((item) => normalizedById.get(item.caseId)),
  };
}

export function quadraticWeightedKappa(expectedRatings, observedRatings, categoryCount = 5) {
  if (!Array.isArray(expectedRatings) || expectedRatings.length === 0 || expectedRatings.length !== observedRatings.length) return null;
  const matrix = Array.from({ length: categoryCount }, () => Array(categoryCount).fill(0));
  const expectedHist = Array(categoryCount).fill(0);
  const observedHist = Array(categoryCount).fill(0);
  for (let index = 0; index < expectedRatings.length; index += 1) {
    const expected = expectedRatings[index];
    const observed = observedRatings[index];
    matrix[expected][observed] += 1;
    expectedHist[expected] += 1;
    observedHist[observed] += 1;
  }
  const total = expectedRatings.length;
  let observedDisagreement = 0;
  let chanceDisagreement = 0;
  const denominator = (categoryCount - 1) ** 2;
  for (let i = 0; i < categoryCount; i += 1) {
    for (let j = 0; j < categoryCount; j += 1) {
      const weight = ((i - j) ** 2) / denominator;
      observedDisagreement += weight * matrix[i][j];
      chanceDisagreement += weight * ((expectedHist[i] * observedHist[j]) / total);
    }
  }
  if (chanceDisagreement === 0) return observedDisagreement === 0 ? 1 : 0;
  return Math.round((1 - observedDisagreement / chanceDisagreement) * 10000) / 10000;
}

export function aggregateSelfTestSamples(sampleResponses, calibrationCases) {
  if (!Array.isArray(sampleResponses) || sampleResponses.length === 0) throw new Error('At least one self-test sample is required.');
  const aggregateResults = calibrationCases.map((fixture) => {
    const results = sampleResponses.map((sample) => sample.result.results.find((item) => item.caseId === fixture.caseId));
    if (results.some((result) => !result)) throw new Error(`Missing sample result for ${fixture.caseId}.`);
    const absoluteValues = results.map((result) => result.absoluteClass);
    const absoluteMedian = median(absoluteValues);
    const reactionClass = mode(results.map((result) => result.reactionClass));
    const preferredPlanId = mode(results.map((result) => result.preferredPlanId));
    const diagnosticAssessment = mode(results.map((result) => result.diagnosticAssessment));
    const representative = [...results]
      .sort((a, b) => Math.abs(a.absoluteClass - absoluteMedian) - Math.abs(b.absoluteClass - absoluteMedian))[0];
    return {
      ...representative,
      absoluteClass: absoluteMedian,
      reactionClass,
      preferredPlanId,
      diagnosticAssessment,
      stability: {
        absoluteClassMad: mad(absoluteValues),
        absoluteClassSpread: round2(Math.max(...absoluteValues) - Math.min(...absoluteValues)),
        reactionAgreement: rate(results.filter((result) => result.reactionClass === reactionClass).length, results.length),
        preferredPlanAgreement: rate(results.filter((result) => result.preferredPlanId === preferredPlanId).length, results.length),
      },
    };
  });
  return aggregateResults;
}

export function computeSelfTestMetrics(sampleResponses, calibrationCases, expected) {
  const expectedRatings = [];
  const observedRatings = [];
  const failures = [];
  const categoryCounts = new Map();
  let absolutePasses = 0;
  let reactionPasses = 0;
  let preferencePasses = 0;
  let diagnosticPasses = 0;
  let fullPasses = 0;
  let predictionCount = 0;
  let evidenceReferenceCount = 0;
  let requiredEvidencePasses = 0;
  let forbiddenClaimViolations = 0;
  let numericParameterCandidateViolations = 0;
  let misleadingDiagnosticControls = 0;
  let misleadingDiagnosticFalsePositives = 0;

  for (const sample of sampleResponses) {
    for (const fixture of calibrationCases) {
      const result = sample.result.results.find((item) => item.caseId === fixture.caseId);
      const rule = expected.cases[fixture.caseId];
      predictionCount += 1;
      expectedRatings.push(rule.ordinalTarget);
      observedRatings.push(result.absoluteClass);
      const absolutePass = result.absoluteClass >= rule.absoluteClassRange[0] && result.absoluteClass <= rule.absoluteClassRange[1];
      const reactionPass = rule.allowedReactionClasses.includes(result.reactionClass);
      const preferencePass = rule.allowedPreferredPlanIds.includes(result.preferredPlanId);
      const diagnosticPass = rule.allowedDiagnosticAssessments.includes(result.diagnosticAssessment);
      absolutePasses += Number(absolutePass);
      reactionPasses += Number(reactionPass);
      preferencePasses += Number(preferencePass);
      diagnosticPasses += Number(diagnosticPass);

      const allReferences = new Set([
        ...result.evidenceReferences,
        ...result.observations.flatMap((item) => item.evidenceReferences),
        ...result.hypotheses.flatMap((item) => item.evidenceReferences),
        ...result.numericParameterCandidates.flatMap((item) => item.evidenceReferences),
      ]);
      evidenceReferenceCount += allReferences.size;
      const referenceCovers = (actual, required) => actual === required
        || required.startsWith(`${actual}/`)
        || actual.startsWith(`${required}/`);
      const requiredEvidencePass = (rule.mustReferenceAnyOf ?? []).every((group) => group.some((pointer) => [...allReferences].some((actual) => referenceCovers(actual, pointer))));
      requiredEvidencePasses += Number(requiredEvidencePass);
      const text = allResultText(result);
      const forbiddenHits = rule.forbiddenClaims.filter((claim) => text.includes(String(claim).toLowerCase()));
      forbiddenClaimViolations += forbiddenHits.length;
      const numericParameterViolation = !rule.numericThresholdProposalAllowed && result.numericParameterCandidates.length > 0;
      numericParameterCandidateViolations += Number(numericParameterViolation);

      const isMisleadingControl = (fixture.sourceDiagnostics ?? []).some((diagnostic) => diagnostic.truth === 'misleading');
      if (isMisleadingControl) {
        misleadingDiagnosticControls += 1;
        if (result.diagnosticAssessment !== 'not_shown') misleadingDiagnosticFalsePositives += 1;
      }

      const fullPass = absolutePass && reactionPass && preferencePass && diagnosticPass
        && requiredEvidencePass && forbiddenHits.length === 0 && !numericParameterViolation;
      fullPasses += Number(fullPass);
      const category = categoryCounts.get(fixture.category) ?? { predictions: 0, fullPasses: 0 };
      category.predictions += 1;
      category.fullPasses += Number(fullPass);
      categoryCounts.set(fixture.category, category);
      if (!fullPass) {
        failures.push({
          sampleIndex: sample.sampleIndex,
          caseId: fixture.caseId,
          absolutePass,
          reactionPass,
          preferencePass,
          diagnosticPass,
          requiredEvidencePass,
          forbiddenClaims: forbiddenHits,
          numericParameterCandidateViolation: numericParameterViolation,
        });
      }
    }
  }

  let orderPairs = 0;
  let orderConsistentPairs = 0;
  const groupNames = [...new Set(calibrationCases.map((item) => item.presentationGroup).filter(Boolean))];
  for (const sample of sampleResponses) {
    for (const groupName of groupNames) {
      const fixtures = calibrationCases.filter((item) => item.presentationGroup === groupName);
      if (fixtures.length !== 2) continue;
      const [first, second] = fixtures.map((fixture) => sample.result.results.find((item) => item.caseId === fixture.caseId));
      orderPairs += 1;
      if (first.preferredPlanId === second.preferredPlanId && first.reactionClass === second.reactionClass) orderConsistentPairs += 1;
    }
  }

  let retestPairs = 0;
  let retestAbsoluteAgreements = 0;
  let retestReactionAgreements = 0;
  for (let left = 0; left < sampleResponses.length; left += 1) {
    for (let right = left + 1; right < sampleResponses.length; right += 1) {
      for (const fixture of calibrationCases) {
        const a = sampleResponses[left].result.results.find((item) => item.caseId === fixture.caseId);
        const b = sampleResponses[right].result.results.find((item) => item.caseId === fixture.caseId);
        retestPairs += 1;
        retestAbsoluteAgreements += Number(a.absoluteClass === b.absoluteClass);
        retestReactionAgreements += Number(a.reactionClass === b.reactionClass);
      }
    }
  }

  return {
    counts: {
      cases: calibrationCases.length,
      samples: sampleResponses.length,
      predictions: predictionCount,
      absolutePasses,
      reactionPasses,
      preferencePasses,
      diagnosticPasses,
      fullPasses,
      evidenceReferences: evidenceReferenceCount,
      requiredEvidencePasses,
      forbiddenClaimViolations,
      numericParameterCandidateViolations,
      misleadingDiagnosticControls,
      misleadingDiagnosticFalsePositives,
      orderPairs,
      orderConsistentPairs,
      retestPairs,
      retestAbsoluteAgreements,
      retestReactionAgreements,
    },
    rates: {
      absoluteRangeAccuracy: rate(absolutePasses, predictionCount),
      reactionAccuracy: rate(reactionPasses, predictionCount),
      preferredPlanAccuracy: rate(preferencePasses, predictionCount),
      diagnosticAssessmentAccuracy: rate(diagnosticPasses, predictionCount),
      fullControlPassRate: rate(fullPasses, predictionCount),
      evidenceReferenceValidity: rate(evidenceReferenceCount, evidenceReferenceCount),
      requiredEvidenceCoverage: rate(requiredEvidencePasses, predictionCount),
      misleadingDiagnosticFalsePositiveRate: rate(misleadingDiagnosticFalsePositives, misleadingDiagnosticControls),
      orderConsistency: rate(orderConsistentPairs, orderPairs),
      retestAbsoluteAgreement: rate(retestAbsoluteAgreements, retestPairs),
      retestReactionAgreement: rate(retestReactionAgreements, retestPairs),
    },
    quadraticWeightedKappa: quadraticWeightedKappa(expectedRatings, observedRatings),
    categories: Object.fromEntries([...categoryCounts.entries()].map(([category, counts]) => [category, {
      ...counts,
      fullPassRate: rate(counts.fullPasses, counts.predictions),
    }])),
    failures,
  };
}

export function renderSelfTestMarkdown(summary) {
  const value = (number) => number == null ? 'n/a' : typeof number === 'number' ? number.toFixed(3) : String(number);
  const metrics = summary.metrics;
  const lines = [
    '# AI judge self-test',
    '',
    `- Run label: \`${summary.runLabel}\``,
    `- Provider/model: \`${summary.provenance.provider}\` / \`${summary.provenance.model}\``,
    `- Suite: \`${summary.provenance.suiteId}\` (${metrics.counts.cases} cases, ${metrics.counts.samples} sample(s))`,
    `- Contract: \`${summary.provenance.responseSchema}\``,
    '',
    '## Calibration metrics',
    '',
    '| Metric | Value | Evidence |',
    '|---|---:|---:|',
    `| Absolute class range accuracy | ${value(metrics.rates.absoluteRangeAccuracy)} | ${metrics.counts.absolutePasses}/${metrics.counts.predictions} |`,
    `| Reaction classification accuracy | ${value(metrics.rates.reactionAccuracy)} | ${metrics.counts.reactionPasses}/${metrics.counts.predictions} |`,
    `| Full control pass rate | ${value(metrics.rates.fullControlPassRate)} | ${metrics.counts.fullPasses}/${metrics.counts.predictions} |`,
    `| Quadratic weighted kappa | ${value(metrics.quadraticWeightedKappa)} | ${metrics.counts.predictions} predictions |`,
    `| Order consistency | ${value(metrics.rates.orderConsistency)} | ${metrics.counts.orderConsistentPairs}/${metrics.counts.orderPairs} |`,
    `| Retest reaction agreement | ${value(metrics.rates.retestReactionAgreement)} | ${metrics.counts.retestReactionAgreements}/${metrics.counts.retestPairs} |`,
    `| Misleading-diagnostic false-positive rate | ${value(metrics.rates.misleadingDiagnosticFalsePositiveRate)} | ${metrics.counts.misleadingDiagnosticFalsePositives}/${metrics.counts.misleadingDiagnosticControls} |`,
    `| Evidence-reference validity | ${value(metrics.rates.evidenceReferenceValidity)} | ${metrics.counts.evidenceReferences}/${metrics.counts.evidenceReferences} accepted references |`,
    `| Required evidence coverage | ${value(metrics.rates.requiredEvidenceCoverage)} | ${metrics.counts.requiredEvidencePasses}/${metrics.counts.predictions} |`,
    `| Forbidden unsupported claims | ${metrics.counts.forbiddenClaimViolations} | raw count |`,
    `| Forbidden numeric parameter candidates | ${metrics.counts.numericParameterCandidateViolations} | raw count |`,
    '',
    '## Category results',
    '',
    '| Category | Full passes | Predictions | Rate |',
    '|---|---:|---:|---:|',
    ...Object.entries(metrics.categories).map(([category, item]) => `| ${category} | ${item.fullPasses} | ${item.predictions} | ${value(item.fullPassRate)} |`),
    '',
    '## Interpretation boundary',
    '',
    'These measurements characterize evaluator behavior on frozen controls. They do not define a merge gate, select a replacement model, establish physiological thresholds, or update the committed planner baseline.',
  ];
  if (metrics.failures.length) {
    lines.push('', '## Failed controls', '', ...metrics.failures.map((failure) => `- sample ${failure.sampleIndex}, \`${failure.caseId}\``));
  }
  return `${lines.join('\n')}\n`;
}
