
import type { UserPreferences } from '../../engine/models';
import { CANONICAL_MODALITIES } from '../../utils/modalities';

interface ModalitySectionsProps {
  preferences: UserPreferences;
  addPreferredModality: (modality: string) => void;
  removePreferredModality: (modality: string) => void;
  addAvoidedModality: (modality: string) => void;
  removeAvoidedModality: (modality: string) => void;
  addUnavailableModality: (modality: NonNullable<UserPreferences['unavailableModalities']>[number]) => void;
  removeUnavailableModality: (modality: NonNullable<UserPreferences['unavailableModalities']>[number]) => void;
}

export function ModalitySections({
  preferences,
  addPreferredModality,
  removePreferredModality,
  addAvoidedModality,
  removeAvoidedModality,
  addUnavailableModality,
  removeUnavailableModality
}: ModalitySectionsProps) {
  return (
    <>
      {/* Preferred Training Types */}
      <div className="preference-section">
        <h2>Training I Enjoy</h2>
        <p className="preference-desc">
          Modalities you enjoy. When multiple training types achieve today's objective equally well, preferred types receive a soft boost.
        </p>

        <div className="modality-select-group">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                addPreferredModality(e.target.value);
                e.target.value = '';
              }
            }}
          >
            <option value="">+ Add canonical training type...</option>
            {CANONICAL_MODALITIES.map((item) => {
              const isSelected = preferences.preferredModalities.includes(item.value);
              const isAvoided = preferences.avoidedModalities.includes(item.value);
              return (
                <option key={item.value} value={item.value} disabled={isSelected}>
                  {item.label} {isAvoided ? '(In Avoided — selecting will move it)' : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div className="modality-list">
          {preferences.preferredModalities.map(modality => (
            <div key={modality} className="modality-chip">
              <span>{modality}</span>
              <button
                type="button"
                aria-label={`Remove ${modality} from preferred`}
                onClick={() => removePreferredModality(modality)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="add-modality-custom">
          <input
            type="text"
            placeholder="Or add custom activity tag (e.g. Padel)..."
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                addPreferredModality((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
              addPreferredModality(input.value);
              input.value = '';
            }}
          >
            Add Custom
          </button>
        </div>
      </div>

      <div className="preference-section">
        <h2>Unavailable Training Types</h2>
        <p className="preference-desc">
          Hard exclusions: these activities will not be offered, even when they would otherwise fit the plan.
        </p>
        <div className="modality-select-group">
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) {
                addUnavailableModality(event.target.value as NonNullable<UserPreferences['unavailableModalities']>[number]);
                event.target.value = '';
              }
            }}
          >
            <option value="">+ Add unavailable training type...</option>
            {CANONICAL_MODALITIES.map(item => (
              <option key={item.value} value={item.value} disabled={(preferences.unavailableModalities ?? []).includes(item.value as NonNullable<UserPreferences['unavailableModalities']>[number])}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="modality-list">
          {(preferences.unavailableModalities ?? []).map(modality => (
            <div key={modality} className="modality-chip unavailable">
              <span>{modality}</span>
              <button type="button" aria-label={`Remove ${modality} from unavailable`} onClick={() => removeUnavailableModality(modality)}>×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Avoided Training Types */}
      <div className="preference-section">
        <h2>Training I'd Rather Avoid</h2>
        <p className="preference-desc">
          Modalities you dislike. The engine will apply a strong soft penalty to avoid prescribing these when viable alternatives exist.
        </p>
        <p className="preference-warning-note">
          💡 <strong>Note:</strong> Safety & injury restrictions (e.g. Achilles pain) belong in <em>Constraints</em>, not Preferences.
        </p>

        <div className="modality-select-group">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                addAvoidedModality(e.target.value);
                e.target.value = '';
              }
            }}
          >
            <option value="">+ Add canonical training type to avoid...</option>
            {CANONICAL_MODALITIES.map((item) => {
              const isSelected = preferences.avoidedModalities.includes(item.value);
              const isPreferred = preferences.preferredModalities.includes(item.value);
              return (
                <option key={item.value} value={item.value} disabled={isSelected}>
                  {item.label} {isPreferred ? '(In Preferred — selecting will move it)' : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div className="modality-list">
          {preferences.avoidedModalities.map(modality => (
            <div key={modality} className="modality-chip avoided">
              <span>{modality}</span>
              <button
                type="button"
                aria-label={`Remove ${modality} from avoided`}
                onClick={() => removeAvoidedModality(modality)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="add-modality-custom">
          <input
            type="text"
            placeholder="Or add custom activity tag to avoid..."
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                addAvoidedModality((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
              addAvoidedModality(input.value);
              input.value = '';
            }}
          >
            Add Custom
          </button>
        </div>
      </div>
    </>
  );
}
