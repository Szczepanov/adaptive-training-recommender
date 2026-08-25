import { describe, expect, it } from 'vitest';
import { ORDINAL_RUBRIC, rubricTo10Point, tenPointToRubric, validateRubricScore } from '../rubric.mjs';

describe('rubric module', () => {
  it('defines valid descriptions for 0..4 ordinal scores', () => {
    expect(ORDINAL_RUBRIC[4].label).toBe('Exemplary');
    expect(ORDINAL_RUBRIC[3].label).toBe('Sound');
    expect(ORDINAL_RUBRIC[2].label).toBe('Marginal');
    expect(ORDINAL_RUBRIC[1].label).toBe('Flawed');
    expect(ORDINAL_RUBRIC[0].label).toBe('Unsafe');
  });

  it('converts between 0..4 and 0..10 scales deterministically', () => {
    expect(rubricTo10Point(4)).toBe(10);
    expect(rubricTo10Point(3)).toBe(7.5);
    expect(rubricTo10Point(2)).toBe(5);
    expect(rubricTo10Point(1)).toBe(2.5);
    expect(rubricTo10Point(0)).toBe(0);

    expect(tenPointToRubric(10)).toBe(4);
    expect(tenPointToRubric(7.5)).toBe(3);
    expect(tenPointToRubric(5)).toBe(2);
    expect(tenPointToRubric(2.5)).toBe(1);
    expect(tenPointToRubric(0)).toBe(0);
  });

  it('validates scores according to configured scale', () => {
    expect(validateRubricScore(4, '0-4')).toBe(true);
    expect(validateRubricScore(5, '0-4')).toBe(false);
    expect(validateRubricScore(3.5, '0-4')).toBe(false); // Integer only for 0-4

    expect(validateRubricScore(8.5, '0-10')).toBe(true);
    expect(validateRubricScore(11, '0-10')).toBe(false);
  });
});
