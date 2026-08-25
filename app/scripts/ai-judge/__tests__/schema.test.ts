import { describe, expect, it } from 'vitest';
import { generateFamilyResponseSchema, hashJson, REQUIRED_SCORES, RESPONSE_SCHEMA_V1 } from '../schema.mjs';

describe('AI Judge Schema Generation', () => {
  const familyId = 'test_family';
  const caseIds = ['case_1', 'case_2', 'case_3'];

  it('generates a strict schema with required constants and case limits', () => {
    const schema = generateFamilyResponseSchema(familyId, caseIds);

    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['schema', 'familyId', 'caseScores', 'familyAssessment']);

    expect(schema.properties.schema.const).toBe(RESPONSE_SCHEMA_V1);
    expect(schema.properties.familyId.const).toBe(familyId);

    expect(schema.properties.caseScores.minItems).toBe(3);
    expect(schema.properties.caseScores.maxItems).toBe(3);

    const itemProps = schema.properties.caseScores.items.properties;
    expect(itemProps.caseId.enum).toEqual(caseIds);

    for (const key of REQUIRED_SCORES) {
      expect(itemProps.scores.properties[key]).toEqual({
        type: 'number',
        minimum: 0,
        maximum: 10,
      });
    }

    expect(itemProps.confidence).toEqual({
      type: 'number',
      minimum: 0,
      maximum: 1,
    });
  });

  it('enforces enum on familyAssessment case lists', () => {
    const schema = generateFamilyResponseSchema(familyId, caseIds);
    const faProps = schema.properties.familyAssessment.properties;

    expect(faProps.overreactionCases.items.enum).toEqual(caseIds);
    expect(faProps.underreactionCases.items.enum).toEqual(caseIds);
    expect(faProps.goodSensitivityCases.items.enum).toEqual(caseIds);
    expect(faProps.sensitivity_quality).toEqual({
      type: 'number',
      minimum: 0,
      maximum: 10,
    });
  });

  it('produces deterministic hashes for schema objects', () => {
    const schemaA = generateFamilyResponseSchema(familyId, caseIds);
    const schemaB = generateFamilyResponseSchema(familyId, caseIds);
    expect(hashJson(schemaA)).toBe(hashJson(schemaB));
  });

  it('fails on invalid inputs', () => {
    expect(() => generateFamilyResponseSchema('', caseIds)).toThrow();
    expect(() => generateFamilyResponseSchema(familyId, [])).toThrow();
  });
});
