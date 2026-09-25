import { briefWindowDaysFor, type BriefWindowPreset } from '../engine/contextBrief';
import { contextBriefService, type ContextBriefResult } from '../services/contextBriefService';

export const BRIEF_PRESET_STORAGE_KEY = 'adaptive-training:context-brief:preset';

/** Defaults new/incognito athletes to `daily` -- the everyday paste-into-chat loop this
 * preset exists for -- while a returning athlete's explicit choice of `full` or
 * `diagnostic` persists across sessions. Storage can be disabled; failure to read must
 * never block the tab. */
export function loadStoredBriefPreset(): BriefWindowPreset {
  if (typeof window === 'undefined') return 'daily';
  try {
    const stored = window.localStorage.getItem(BRIEF_PRESET_STORAGE_KEY);
    return stored === 'full' || stored === 'diagnostic' ? stored : 'daily';
  } catch {
    return 'daily';
  }
}

export function persistBriefPreset(preset: BriefWindowPreset): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BRIEF_PRESET_STORAGE_KEY, preset);
  } catch {
    // Preference remains usable for the current page instance even if it can't persist.
  }
}

type BriefBuilder = Pick<typeof contextBriefService, 'build'>;

/** The one place a preset becomes a service call, so the window and the purpose-bearing
 * preset cannot drift apart between callers. */
export function buildBriefForPreset(
  userId: string,
  asOfDate: string,
  preset: BriefWindowPreset,
  service: BriefBuilder = contextBriefService,
): Promise<ContextBriefResult> {
  return service.build(userId, asOfDate, briefWindowDaysFor(preset), preset);
}
