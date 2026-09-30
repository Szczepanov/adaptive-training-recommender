/**
 * Format an ISO build timestamp into a human-readable Warsaw-local "YYYY-MM-DD HH:mm" string.
 * Returns an empty string if the input is missing or unparseable.
 */
export function formatBuildTime(isoString: string | null | undefined, timezone: string = 'Europe/Warsaw'): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = get('hour');
    const minute = get('minute');
    if (!year || !month || !day || !hour || !minute) return '';
    return `${year}-${month}-${day} ${hour}:${minute}`;
  } catch {
    try {
      const date = new Date(isoString);
      return date.toISOString().slice(0, 16).replace('T', ' ');
    } catch {
      return '';
    }
  }
}

const gitSha = import.meta.env.VITE_GIT_SHA?.trim() || 'unknown';
const dirty = import.meta.env.VITE_GIT_DIRTY === 'true';
const builtAt = import.meta.env.VITE_BUILD_TIME?.trim() || '';

export const buildInfo = {
  gitSha,
  shortGitSha: gitSha === 'unknown' ? gitSha : gitSha.slice(0, 7),
  dirty,
  label: `${gitSha === 'unknown' ? gitSha : gitSha.slice(0, 7)}${dirty ? '-dirty' : ''}`,
  builtAt,
  builtAtFormatted: formatBuildTime(builtAt),
} as const;
