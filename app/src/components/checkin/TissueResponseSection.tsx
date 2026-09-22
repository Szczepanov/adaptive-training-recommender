import type { BodyRegion, RegionTissueResponse, TissueResponseLevel } from '../../engine/models';
import { TISSUE_LEVELS } from '../../engine/models';

interface TissueResponseSectionProps {
  tissueSelectId: string;
  pendingTissueRegion: BodyRegion | '';
  onPendingTissueRegionChange: (region: BodyRegion | '') => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableBodyRegions: BodyRegion[];
  tissueResponses: RegionTissueResponse[];
  onAddTissueRegion: (region: BodyRegion, level: TissueResponseLevel) => void;
  onRemoveTissueRegion: (region: BodyRegion) => void;
  onTissueFieldChange: (
    region: BodyRegion,
    field: keyof RegionTissueResponse,
    value: TissueResponseLevel | '',
  ) => void;
}

const REGION_LABELS: Record<BodyRegion, string> = {
  knee: 'Knee',
  achilles: 'Achilles',
  ankle: 'Ankle',
  calf: 'Calf',
  hamstring: 'Hamstring',
  quadriceps: 'Quadriceps',
  adductor_groin: 'Adductor/Groin',
  hip: 'Hip',
  lower_back: 'Lower Back',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
};

const TISSUE_LEVEL_LABELS: Record<TissueResponseLevel, string> = {
  normal: 'Normal',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

const TISSUE_LEVEL_HELP: Record<TissueResponseLevel, string> = {
  normal: 'No meaningful change; normal movement and function.',
  mild: 'Noticeable stiffness/soreness, but normal walking and function.',
  moderate: 'Persistent or function-changing response that should reduce load.',
  severe: 'Marked pain/swelling/instability or meaningful loss of function.',
};

export function TissueResponseSection({
  tissueSelectId,
  pendingTissueRegion,
  onPendingTissueRegionChange,
  open,
  onOpenChange,
  availableBodyRegions,
  tissueResponses,
  onAddTissueRegion,
  onRemoveTissueRegion,
  onTissueFieldChange,
}: TissueResponseSectionProps) {
  return (
    <details
      className="tissue-response-expanded tissue-response-disclosure"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary className="tissue-response-summary">
        <span className="tissue-response-summary-title">Local tissue response</span>
        <span className="tissue-response-summary-status">
          {tissueResponses.length > 0 ? `${tissueResponses.length} area${tissueResponses.length === 1 ? '' : 's'} reported` : 'Optional'}
        </span>
      </summary>
      <div className="tissue-response-content">
        <div className="tissue-response-intro">
          <p>
            Report local stiffness, swelling/fullness, unusual tendon or calf soreness, or altered walking/stairs/squat even when you would not call it an injury. Local tissue response can tighten today&apos;s plan independently of Garmin readiness.
          </p>
        </div>

        <div className="form-group add-region-group">
          <label htmlFor={tissueSelectId}>Add body area to monitor</label>
          <select
            id={tissueSelectId}
            className="select-input"
            value={pendingTissueRegion}
            onChange={(e) => onPendingTissueRegionChange(e.target.value as BodyRegion | '')}
          >
            <option value="">Select a region…</option>
            {availableBodyRegions.map(region => (
              <option key={region} value={region}>{REGION_LABELS[region]}</option>
            ))}
          </select>
        </div>

        {pendingTissueRegion && (
          <div className="followup-tissue-prompt" aria-label={`Morning state for ${REGION_LABELS[pendingTissueRegion]}`}>
            <p>How does your <strong>{REGION_LABELS[pendingTissueRegion]}</strong> feel this morning?</p>
            <div className="followup-actions">
              {TISSUE_LEVELS.map(level => (
                <button
                  key={level}
                  type="button"
                  className="btn-followup-pill"
                  title={TISSUE_LEVEL_HELP[level]}
                  onClick={() => onAddTissueRegion(pendingTissueRegion, level)}
                >
                  {TISSUE_LEVEL_LABELS[level]}
                </button>
              ))}
            </div>
            <small>Normal = no meaningful change · Mild = noticeable but normal function · Moderate = changes function/load · Severe = marked pain/swelling/instability or significant function loss</small>
          </div>
        )}

        {tissueResponses.length === 0 && !pendingTissueRegion && (
          <p className="checkin-helper-text">No local tissue issue reported today.</p>
        )}

        {tissueResponses.map(response => {
          const region = response.region;
          return (
            <article className="tissue-region-card" key={region}>
              <div className="tissue-region-header">
                <strong>{REGION_LABELS[region]}</strong>
                <button
                  type="button"
                  className="tissue-region-remove"
                  onClick={() => onRemoveTissueRegion(region)}
                  aria-label={`Remove ${REGION_LABELS[region]}`}
                >
                  ✕ Remove
                </button>
              </div>

              <div className="tissue-region-fields">
                <div className="form-group">
                  <label htmlFor={`${region}-morningState`}>This morning (resting/waking)</label>
                  <select
                    id={`${region}-morningState`}
                    className="select-input"
                    value={response.morningState}
                    onChange={(e) => onTissueFieldChange(region, 'morningState', e.target.value as TissueResponseLevel)}
                  >
                    {TISSUE_LEVELS.map(level => (
                      <option key={level} value={level}>{TISSUE_LEVEL_LABELS[level]}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor={`${region}-painDuringTraining`}>Pain during training (if any)</label>
                  <select
                    id={`${region}-painDuringTraining`}
                    className="select-input"
                    value={response.painDuringTraining ?? ''}
                    onChange={(e) => onTissueFieldChange(region, 'painDuringTraining', e.target.value as TissueResponseLevel | '')}
                  >
                    <option value="">Did not train / not applicable</option>
                    {TISSUE_LEVELS.map(level => (
                      <option key={level} value={level}>{TISSUE_LEVEL_LABELS[level]}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor={`${region}-afterTrainingState`}>Right after training</label>
                  <select
                    id={`${region}-afterTrainingState`}
                    className="select-input"
                    value={response.afterTrainingState ?? ''}
                    onChange={(e) => onTissueFieldChange(region, 'afterTrainingState', e.target.value as TissueResponseLevel | '')}
                  >
                    <option value="">Did not train / not applicable</option>
                    {TISSUE_LEVELS.map(level => (
                      <option key={level} value={level}>{TISSUE_LEVEL_LABELS[level]}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor={`${region}-nextMorningReaction`}>Reaction to yesterday&apos;s session</label>
                  <select
                    id={`${region}-nextMorningReaction`}
                    className="select-input"
                    value={response.nextMorningReaction ?? ''}
                    onChange={(e) => onTissueFieldChange(region, 'nextMorningReaction', e.target.value as TissueResponseLevel | '')}
                  >
                    <option value="">No session yesterday / not applicable</option>
                    {TISSUE_LEVELS.map(level => (
                      <option key={level} value={level}>{TISSUE_LEVEL_LABELS[level]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}
