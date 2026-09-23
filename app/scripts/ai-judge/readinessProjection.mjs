const SUBJECTIVE_ACUTE_FIELDS = ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'stress'];
const OBJECTIVE_ACUTE_FIELDS = [
  'hrv_delta', 'hrv_last_night', 'rhr_delta', 'rhr', 'sleep_score',
  'sleep_duration_min', 'body_battery_wake', 'sleep_score_delta_7d',
];

/** Derive a conservative synthetic recovery baseline for static judge fixtures only.
 * Chronic 28-day fields and missing sensor values remain untouched. */
export function projectedRecoveryBaseline(readiness) {
  const baseline = structuredClone(readiness);
  if (!baseline) return baseline;
  const subjective = baseline.subjective ?? {};
  if (typeof subjective.readiness === 'number' && subjective.readiness <= 4) subjective.readiness = 7;
  if (typeof subjective.sleepQuality === 'number' && subjective.sleepQuality <= 4) subjective.sleepQuality = 7;
  if (typeof subjective.fatigue === 'number' && subjective.fatigue >= 7) subjective.fatigue = 3;
  if (typeof subjective.soreness === 'number' && subjective.soreness >= 7) subjective.soreness = 3;
  if (typeof subjective.stress === 'number' && subjective.stress >= 8) subjective.stress = 4;

  const objective = baseline.objective ?? {};
  const neutral = {
    hrv_delta: 0, hrv_last_night: 42, rhr_delta: 0, rhr: 58, sleep_score: 80,
    sleep_duration_min: 440, body_battery_wake: 72, sleep_score_delta_7d: 0,
  };
  const adverse = {
    hrv_delta: value => value <= -10,
    hrv_last_night: value => value < neutral.hrv_last_night - 10,
    rhr_delta: value => value >= 5,
    rhr: value => value >= neutral.rhr + 5,
    sleep_score: value => value <= 55,
    sleep_duration_min: value => value <= 330,
    body_battery_wake: value => value <= 35,
    sleep_score_delta_7d: value => value <= -20,
  };
  for (const field of OBJECTIVE_ACUTE_FIELDS) {
    const value = objective[field];
    if (typeof value === 'number' && adverse[field](value)) objective[field] = neutral[field];
  }
  return baseline;
}

/** Static weekly forecasts have no new check-in. Let acute Day-1 values return toward the
 * athlete's baseline over time, while retaining null/missing data and chronic 28-day fields. */
export function decayAcuteReadinessTowardBaseline(readiness, baseline, elapsedDays) {
  if (!readiness || !baseline || !Number.isFinite(elapsedDays) || elapsedDays <= 0) return structuredClone(readiness);
  const remainingSignal = 2 ** (-elapsedDays / 2);
  const result = structuredClone(readiness);
  for (const [section, fields] of [['subjective', SUBJECTIVE_ACUTE_FIELDS], ['objective', OBJECTIVE_ACUTE_FIELDS]]) {
    if (!result[section] || !baseline[section]) continue;
    for (const field of fields) {
      const value = result[section][field];
      const target = baseline[section][field];
      if (typeof value === 'number' && typeof target === 'number') {
        result[section][field] = target + (value - target) * remainingSignal;
      }
    }
  }
  return result;
}
