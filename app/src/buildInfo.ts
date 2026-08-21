const gitSha = import.meta.env.VITE_GIT_SHA?.trim() || 'unknown';
const dirty = import.meta.env.VITE_GIT_DIRTY === 'true';

export const buildInfo = {
  gitSha,
  shortGitSha: gitSha === 'unknown' ? gitSha : gitSha.slice(0, 7),
  dirty,
  label: `${gitSha === 'unknown' ? gitSha : gitSha.slice(0, 7)}${dirty ? '-dirty' : ''}`,
} as const;
