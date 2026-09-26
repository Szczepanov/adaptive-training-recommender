import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionEntry } from './models';
import { deriveMovementCompositionEvidence } from '../workouts/movementComposition';
import { validateSessionDefinition } from './validation';

const definition: SessionDefinition = {
  schemaVersion: 1,
  id: 'authored-strength',
  revision: 1,
  title: 'Authored strength',
  intent: 'training',
  movementComposition: [{
    id: 'unilateral-work',
    pattern: 'unilateral_lower_body',
    stepIds: ['split-squat'],
    status: 'required',
  }],
  blocks: [{
    id: 'main',
    role: 'main',
    executionMode: 'sequential',
    steps: [{
      id: 'split-squat',
      kind: 'exercise',
      exerciseRef: { kind: 'catalog', exerciseId: 'rear_foot_elevated_split_squat' },
      compositionPatterns: ['unilateral_lower_body'],
    }],
  }],
};

function entry(exerciseId = 'rear_foot_elevated_split_squat'): SessionEntry {
  return {
    id: 'entry-1', executionId: 'execution-1', stepId: 'split-squat',
    exerciseRef: { kind: 'catalog', exerciseId },
    completedAt: '2026-09-26T10:00:00Z', createdAt: '2026-09-26T10:00:00Z', updatedAt: '2026-09-26T10:00:00Z',
    payload: { kind: 'repetition', setIndex: 0, reps: 6 },
  };
}

describe('session movement-composition evidence', () => {
  it('accepts structured evidence and retains the exact performed exercise identity', () => {
    expect(validateSessionDefinition(definition).ok).toBe(true);
    expect(deriveMovementCompositionEvidence(definition, [entry()], true).requirements).toEqual([{
      requirementId: 'unilateral-work',
      pattern: 'unilateral_lower_body',
      status: 'performed',
      exerciseIds: ['rear_foot_elevated_split_squat'],
    }]);
  });

  it('records an omitted component on completed sessions and an unknown component on unfinished sessions', () => {
    expect(deriveMovementCompositionEvidence(definition, [], true).requirements[0].status).toBe('omitted');
    expect(deriveMovementCompositionEvidence(definition, [], false).requirements[0].status).toBe('unknown');
  });

  it('keeps missing movement-family evidence unknown instead of inferring from free text', () => {
    const custom = structuredClone(definition);
    delete custom.movementComposition;
    delete custom.blocks[0].steps[0].compositionPatterns;
    custom.blocks[0].steps[0].title = 'Rear-foot elevated split squat';
    expect(validateSessionDefinition(custom).ok).toBe(true);
    expect(deriveMovementCompositionEvidence(custom, [entry()], true)).toEqual({ performed: [], requirements: [] });
  });

  it('does not credit a changed exercise identity unless performed movement evidence is recorded', () => {
    const changedIdentity = entry('front_squat');
    expect(deriveMovementCompositionEvidence(definition, [changedIdentity], true).requirements[0].status).toBe('unknown');
  });

  it('attributes a mixed swap only to the entry that performed the required pattern', () => {
    const unilateral = { ...entry(), id: 'unilateral-set', completedAt: '2026-09-26T09:58:00Z' };
    const bilateral = {
      ...entry('front_squat'), id: 'bilateral-set', completedAt: '2026-09-26T10:00:00Z',
      degradedComposition: { pattern: 'unilateral_lower_body' as const, reason: 'Pain-free substitute.' },
    };
    expect(deriveMovementCompositionEvidence(definition, [unilateral, bilateral], true).requirements[0]).toMatchObject({
      status: 'performed', exerciseIds: ['rear_foot_elevated_split_squat'],
    });
  });

  it('validates a relaxed saved-template requirement when its step has no structured tag', () => {
    const savedTemplate = structuredClone(definition);
    delete savedTemplate.blocks[0].steps[0].compositionPatterns;
    savedTemplate.movementComposition![0] = {
      ...savedTemplate.movementComposition![0],
      status: 'relaxed',
      reason: 'Saved template no longer has structured evidence for this movement component.',
    };
    expect(validateSessionDefinition(savedTemplate).ok).toBe(true);
  });

  it('reports an explicitly degraded selected alternative without unilateral credit', () => {
    const withAlternative = structuredClone(definition);
    const step = withAlternative.blocks[0].steps[0];
    step.alternatives = [{
      id: 'bilateral-squat', title: 'Front squat',
      exerciseRef: { kind: 'catalog', exerciseId: 'front_squat' },
      degradedComposition: { pattern: 'unilateral_lower_body', reason: 'Pain-free bilateral substitute selected.' },
    }];
    withAlternative.blocks[0].optionSets = [{
      id: 'movement-choice', appliesAtStepId: step.id,
      trigger: { kind: 'athlete_observed', description: 'The unilateral movement is uncomfortable.' },
      options: [{ id: 'use-squat', label: 'Use front squat', actions: [{ kind: 'select_alternative', targetStepId: step.id, alternativeId: 'bilateral-squat' }] }],
    }];
    expect(validateSessionDefinition(withAlternative).ok).toBe(true);
    const choice: SessionEntry = {
      id: 'choice-1', executionId: 'execution-1', completedAt: '2026-09-26T09:59:00Z',
      createdAt: '2026-09-26T09:59:00Z', updatedAt: '2026-09-26T09:59:00Z',
      payload: { kind: 'choice', choiceId: 'movement-choice', optionId: 'use-squat' },
    };
    const performed = {
      ...entry('front_squat'),
      exerciseRef: { kind: 'catalog', exerciseId: 'front_squat' } as const,
      degradedComposition: { pattern: 'unilateral_lower_body' as const, reason: 'Pain-free bilateral substitute selected.' },
    };
    expect(deriveMovementCompositionEvidence(withAlternative, [choice, performed], true).requirements[0]).toMatchObject({
      status: 'degraded', reason: 'Pain-free bilateral substitute selected.', exerciseIds: ['front_squat'],
    });
  });

  it('attributes degraded status only to entries logged after the degraded alternative was selected', () => {
    const withAlternative = structuredClone(definition);
    const step = withAlternative.blocks[0].steps[0];
    step.alternatives = [{ id: 'bilateral-squat', title: 'Front squat', exerciseRef: { kind: 'catalog', exerciseId: 'front_squat' }, degradedComposition: { pattern: 'unilateral_lower_body', reason: 'Substitution.' } }];
    withAlternative.blocks[0].optionSets = [{ id: 'movement-choice', appliesAtStepId: step.id, trigger: { kind: 'athlete_observed', description: 'Observed.' }, options: [{ id: 'use-squat', label: 'Use front squat', actions: [{ kind: 'select_alternative', targetStepId: step.id, alternativeId: 'bilateral-squat' }] }] }];
    const priorUnilateral = { ...entry(), completedAt: '2026-09-26T09:58:00Z' };
    const choice: SessionEntry = { id: 'choice-1', executionId: 'execution-1', completedAt: '2026-09-26T09:59:00Z', createdAt: '2026-09-26T09:59:00Z', updatedAt: '2026-09-26T09:59:00Z', payload: { kind: 'choice', choiceId: 'movement-choice', optionId: 'use-squat' } };
    expect(deriveMovementCompositionEvidence(withAlternative, [priorUnilateral, choice], true).requirements[0].status).toBe('performed');
  });

  it('rejects a requirement whose referenced step lacks matching structured evidence', () => {
    const invalid = structuredClone(definition);
    invalid.blocks[0].steps[0].compositionPatterns = ['knee_dominant_bilateral'];
    expect(validateSessionDefinition(invalid).ok).toBe(false);
  });
});
