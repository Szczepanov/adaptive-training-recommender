/**
 * Resolves the judge provider recorded by a baseline artifact and its run
 * manifest. Manual external runs are a supported canonical source when the
 * normal baseline review and provenance checks pass.
 */
export function resolveJudgeProvider({ provenanceProvider = null, manifestProvider = null } = {}) {
  if (provenanceProvider && manifestProvider && provenanceProvider !== manifestProvider) {
    throw new Error(
      'Judge provider mismatch between summary provenance (' +
        provenanceProvider +
        ') and run manifest (' +
        manifestProvider +
        ').',
    );
  }

  const provider = provenanceProvider || manifestProvider;
  if (!provider) throw new Error('Judge provider is missing from summary provenance and run manifest.');

  return provider;
}
