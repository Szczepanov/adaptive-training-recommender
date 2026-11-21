import { isValidElement, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrainingSettings as TrainingSettingsModel } from '../engine/models';
import { createDefaultTrainingSettings } from '../services/trainingSettingsService';

const mocks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  getTrainingSettings: vi.fn(),
  updateTrainingSettings: vi.fn(),
}));

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [mocks.slots[index], (value: unknown) => {
      mocks.slots[index] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(mocks.slots[index]) : value;
    }];
  },
  useEffect: () => {},
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

vi.mock('../services/trainingSettingsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/trainingSettingsService')>();
  return {
    ...actual,
    trainingSettingsService: {
      getTrainingSettings: mocks.getTrainingSettings,
      updateTrainingSettings: mocks.updateTrainingSettings,
    },
  };
});

vi.mock('../services/flagCaptureRuntime', () => ({ notifyFlagInputsChanged: vi.fn() }));
vi.mock('./ProgressionReviewPanel', () => ({ ProgressionReviewPanel: () => null }));
vi.mock('./ProgressionBlockEditor', () => ({ ProgressionBlockEditor: () => null }));

import { TrainingSettings } from './TrainingSettings';

type AnyProps = {
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};

function expand(node: ReactNode): ReactElement<AnyProps>[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return [];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!isValidElement<AnyProps>(node)) return [];
  if (typeof node.type === 'function') {
    const fn = node.type as (props: unknown) => ReactNode;
    return expand(fn(node.props));
  }
  return [node, ...expand(node.props.children)];
}

function render(): ReactElement<AnyProps>[] {
  mocks.cursor = 0;
  return expand(<TrainingSettings userId="athlete-1" />);
}

describe('TrainingSettings injury id handling', () => {
  const base: TrainingSettingsModel = {
    ...createDefaultTrainingSettings('athlete-1', '2026-10-01T00:00:00Z'),
    injuries: [
      { id: 'inj-1', region: 'knee', severity: 'limit', note: 'Patellar', createdAt: '2026-10-01' },
      { id: 'inj-2', region: 'ankle', severity: 'monitor', createdAt: '2026-10-02' },
      { region: 'hip', severity: 'monitor' },
    ],
  };

  beforeEach(() => {
    mocks.slots = [base];
    mocks.cursor = 0;
    mocks.getTrainingSettings.mockReset();
    mocks.updateTrainingSettings.mockReset();
  });

  it('keys injury cards by injury.id with index fallback and preserves id across edits', async () => {
    const tree = render();
    const cards = tree.filter(el => el.type === 'div' && el.props.className === 'injury-card-item');
    expect(cards.map(card => card.key)).toEqual(['inj-1', 'inj-2', '2']);

    // Click Edit on the second injury (inj-2).
    const editButtons = tree.filter(el => el.type === 'button' && el.props.className === 'btn-injury-action edit');
    expect(editButtons).toHaveLength(3);
    editButtons[1].props.onClick!();

    // Update severity via draft slot (slot 2) and submit the form while preserving inj-2's id.
    const editedSettings: TrainingSettingsModel = {
      ...base,
      injuries: [
        base.injuries![0],
        { id: 'inj-2', region: 'ankle', severity: 'exclude', createdAt: '2026-10-02' },
        base.injuries![2],
      ],
    };
    mocks.updateTrainingSettings.mockResolvedValue(editedSettings);

    const editingTree = render();
    const form = editingTree.find(el => el.type === 'form' && el.props.className === 'injury-form')!;
    await form.props.onSubmit!({ preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>);

    expect(mocks.updateTrainingSettings).toHaveBeenCalledTimes(1);
    const [, update] = mocks.updateTrainingSettings.mock.calls[0];
    expect(update.injuryEditIndex).toBe(1);
    expect(update.injuries[1].id).toBe('inj-2');
  });

  it('updates editing state only after remove succeeds and resets it on injury undo', async () => {
    const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const tree = render();
      const editButtons = tree.filter(el => el.type === 'button' && el.props.className === 'btn-injury-action edit');
      editButtons[1].props.onClick!();

      // Failing remove keeps the active edit index and draft intact.
      const editingTree = render();
      const removeBeforeFail = editingTree.filter(el => el.type === 'button' && el.props.className === 'btn-injury-action remove');
      mocks.updateTrainingSettings.mockRejectedValueOnce(new Error('network'));
      removeBeforeFail[0].props.onClick!();
      await flush();

      expect(mocks.slots[3]).toBe(1);
      expect((mocks.slots[2] as { id?: string }).id).toBe('inj-2');
      expect(mocks.slots[1]).toBe('Unable to save that setting. Please try again.');

      // Succeeding remove of an earlier entry shifts editingInjuryIndex down and raises Undo.
      const afterFailTree = render();
      const removeAfterFail = afterFailTree.filter(el => el.type === 'button' && el.props.className === 'btn-injury-action remove');
      const afterRemoveFirst: TrainingSettingsModel = {
        ...base,
        injuries: [base.injuries![1], base.injuries![2]],
      };
      mocks.updateTrainingSettings.mockResolvedValueOnce(afterRemoveFirst);
      removeAfterFail[0].props.onClick!();
      await flush();

      expect(mocks.slots[0]).toEqual(afterRemoveFirst);
      expect(mocks.slots[3]).toBe(0);
      expect((mocks.slots[2] as { id?: string }).id).toBe('inj-2');
      expect((mocks.slots[4] as { revert: { injuries?: unknown[] } } | null)?.revert.injuries).toHaveLength(3);

      // Failing Undo leaves the active edit index, draft, and Undo toast untouched.
      const afterRemoveTree = render();
      const undoButton = afterRemoveTree.find(el => el.type === 'button' && el.props.children === 'Undo')!;
      mocks.updateTrainingSettings.mockRejectedValueOnce(new Error('offline'));
      undoButton.props.onClick!();
      await flush();

      expect(mocks.slots[3]).toBe(0);
      expect((mocks.slots[2] as { id?: string }).id).toBe('inj-2');
      expect(mocks.slots[4]).not.toBeNull();
      expect(mocks.slots[5]).toBe(false);

      // Succeeding injury Undo clears editing state so editingIndex cannot target the wrong row.
      const retryUndoTree = render();
      const retryUndoButton = retryUndoTree.find(el => el.type === 'button' && el.props.children === 'Undo')!;
      mocks.updateTrainingSettings.mockResolvedValueOnce(base);
      retryUndoButton.props.onClick!();
      await flush();

      expect(mocks.slots[0]).toEqual(base);
      expect(mocks.slots[3]).toBeNull();
      expect(mocks.slots[2]).toEqual({
        id: undefined,
        region: '',
        severity: 'limit',
        restrictedModalities: [],
        reviewBy: '',
        note: '',
      });
      expect(mocks.slots[4]).toBeNull();
      expect(mocks.slots[5]).toBe(false);

      const restoredTree = render();
      const submitButton = restoredTree.find(el => el.type === 'button' && el.props.className === 'btn-injury-submit')!;
      expect(submitButton.props.children).toBe('+ Add injury constraint');
    } finally {
      consoleError.mockRestore();
    }
  });
});
