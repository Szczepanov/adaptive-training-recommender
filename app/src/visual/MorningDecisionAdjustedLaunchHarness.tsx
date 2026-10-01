import { useState } from 'react';
import { MorningDecisionCard } from '../components/MorningDecisionCard';
import type { MorningDecisionEvidence } from '../engine/decisionEvidence';
import type { Recommendation } from '../engine/models';

const evidence = {
  confidence: { badgeClass: 'confidence-high', label: 'High confidence' },
  boundaries: { harderAdjustmentAllowed: true, hardGates: [] },
} as unknown as MorningDecisionEvidence;

const authoredRecommendation = {
  mode: 'train',
  template: {
    id: 'authored:my-tempo:2',
    title: 'My Tempo Run',
    modality: 'Running',
    category: 'Endurance',
    durationMin: 30,
    durationMax: 35,
  },
  rationale: 'Authored session accepted. (Time-crunch adjusted to 30 min).',
  envelopes: { safety: { clinicalEscalationRequired: false } },
  executionDose: { volume: 0.5, intensity: 1 },
  primarySession: {
    sessionSource: {
      kind: 'manual',
      definitionId: 'my-tempo',
      revision: 2,
      contentHash: 'sha256:visual-authored',
    },
    prescriptionHash: 'sha256:visual-authored-prescription',
    occurrenceId: 'visual-occurrence-1',
  },
} as unknown as Recommendation;

/**
 * Visual/E2E harness for morning-decision-ux §4.
 *
 * It starts in the exact failure state from #973: the displayed time-crunch is adjusted,
 * no catalog prescription exists for the authored template, and the original immutable
 * manual binding is still present. Reset must be the only executable recovery path.
 */
export function MorningDecisionAdjustedLaunchHarness() {
  const [adjustmentDirection, setAdjustmentDirection] = useState<'easier' | 'harder' | null>(null);
  const [activeAlternativeId, setActiveAlternativeId] = useState<string | null>('time-30');

  return (
    <MorningDecisionCard
      userId="visual-athlete"
      date="2026-09-12"
      recommendation={authoredRecommendation}
      evidence={evidence}
      prescription={undefined}
      adjustmentDirection={adjustmentDirection}
      activeAlternativeId={activeAlternativeId}
      todayExecution={null}
      onStartSession={() => undefined}
      onAdjustLoad={setAdjustmentDirection}
      onSelectTimeCrunch={(minutes) => {
        const id = `time-${minutes}`;
        setActiveAlternativeId(current => current === id ? null : id);
      }}
      onSelectHomeAlternative={() => setActiveAlternativeId('home-bodyweight')}
      onSelectMobilityAlternative={() => setActiveAlternativeId('mobility')}
      onSelectActiveRecoveryWalk={() => setActiveAlternativeId('recovery-walk')}
      onResetAlternative={() => {
        setActiveAlternativeId(null);
        setAdjustmentDirection(null);
      }}
    />
  );
}
