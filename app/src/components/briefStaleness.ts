import type { BriefWindowPreset } from '../engine/contextBrief';

export interface BriefStalenessInput {
  readonly brief: { readonly asOfDate: string; readonly preset: BriefWindowPreset } | null;
  readonly briefDate: string | undefined;
  readonly briefPreset: BriefWindowPreset;
  readonly builtVariant: { readonly fullContext: boolean; readonly chat: string };
  readonly fullContext: boolean;
  readonly chat: string;
  readonly checkpointPending: boolean;
}

/** True while the on-screen brief no longer matches what the controls ask for: a different
 * date, preset, chat label or full-context toggle, or a checkpoint still loading. A stale brief
 * must not be copied or confirmed -- the rebuild replaces it. */
export function isBriefStale(input: BriefStalenessInput): boolean {
  const { brief } = input;
  if (brief === null) return false;
  return brief.asOfDate !== input.briefDate
    || brief.preset !== input.briefPreset
    || input.builtVariant.fullContext !== input.fullContext
    || input.builtVariant.chat !== input.chat
    || input.checkpointPending;
}
