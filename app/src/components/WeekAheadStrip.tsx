import { useState } from 'react';
import type { WeekAheadDay, WeekAheadPlan } from '../engine/planner';
import type { NextDayPotentialPlan } from '../engine/models';
import './WeekAheadStrip.css';

interface WeekAheadStripProps {
  plan: WeekAheadPlan | null;
  nextDayPlan?: NextDayPotentialPlan | null;
  selectedTier?: 'green' | 'yellow' | 'red';
  onSelectTier?: (tier: 'green' | 'yellow' | 'red') => void;
}

const MODALITY_ICON: Record<string, string> = {
  Running: '🏃',
  Cycling: '🚴',
  Strength: '🏋️',
  Field: '⚽',
  Mobility: '🧘',
  'Cross Training': '🔀',
  None: '💤',
};

const SHORT_MODALITY_LABEL: Record<string, string> = {
  Running: 'Run',
  Cycling: 'Bike',
  Strength: 'Lift',
  Field: 'Field',
  Mobility: 'Mobility',
  'Cross Training': 'Cross',
  None: 'Rest',
};

const CONFIDENCE_LABEL: Record<WeekAheadDay['confidence'], string> = {
  provisional: 'Provisional',
  projected: 'Projected',
};

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

function weekdayLabel(dateStr: string): string {
  return WEEKDAY_FORMATTER.format(new Date(dateStr + 'T00:00:00Z'));
}

export function WeekAheadStrip({ plan, nextDayPlan, selectedTier = 'green', onSelectTier }: WeekAheadStripProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!plan || plan.days.length === 0) return null;

  const safeIndex = Math.min(selectedIndex, plan.days.length - 1);
  const selected = plan.days[safeIndex];

  return (
    <div className="dashboard-card week-ahead-card">
      <div className="card-header">
        <div className="header-title-group">
          <h3>Next 7 Days</h3>
          <span className="provisional-tag">Recalculates daily as your data changes</span>
        </div>
        {nextDayPlan && !nextDayPlan.isSinglePlan && onSelectTier && (
          <div className="tier-selector" aria-label="Tomorrow's expected readiness tier">
            <span className="tier-selector-label">Tomorrow:</span>
            <button
              type="button"
              className={`tier-btn tier-green ${selectedTier === 'green' ? 'active' : ''}`}
              onClick={() => onSelectTier('green')}
              title="Green: High readiness forecast"
            >
              🟢 Optimal
            </button>
            <button
              type="button"
              className={`tier-btn tier-yellow ${selectedTier === 'yellow' ? 'active' : ''}`}
              onClick={() => onSelectTier('yellow')}
              title="Yellow: Moderate readiness forecast"
            >
              🟡 Moderate
            </button>
            <button
              type="button"
              className={`tier-btn tier-red ${selectedTier === 'red' ? 'active' : ''}`}
              onClick={() => onSelectTier('red')}
              title="Red: Low readiness / mandatory recovery forecast"
            >
              🔴 Low
            </button>
          </div>
        )}
      </div>

      <div className="week-ahead-strip">
        {plan.days.map((day, index) => (
          <button
            key={day.date}
            type="button"
            className={`week-ahead-tile confidence-${day.confidence} ${index === safeIndex ? 'selected' : ''}`}
            onClick={() => setSelectedIndex(index)}
          >
            <span className="tile-weekday">{index === 0 ? 'Tomorrow' : weekdayLabel(day.date)}</span>
            <span className="tile-icon">{MODALITY_ICON[day.template.modality] ?? '❔'}</span>
            <span className="tile-category">{SHORT_MODALITY_LABEL[day.template.modality] ?? day.template.modality}</span>
            <span className="tile-duration">{day.template.durationMin}-{day.template.durationMax} m</span>
            <span className={`tile-mode-dot mode-${day.mode}`} title={day.mode === 'recover' ? 'Recovery' : 'Train'} />
          </button>
        ))}
      </div>

      <div className={`week-ahead-detail confidence-${selected.confidence}`}>
        <div className="detail-header">
          <div className="detail-title-group">
            <h4>{selected.template.title}</h4>
            <span className="detail-date">{selected.date}</span>
          </div>
          <span className="status-badge info">
            {CONFIDENCE_LABEL[selected.confidence]}
          </span>
        </div>
        <p className="detail-meta">
          {selected.template.category} · {selected.template.durationMin}-{selected.template.durationMax} min · {selected.phaseName} phase
        </p>
        <p className="detail-rationale">{selected.rationale}</p>
        {selected.addressesObjectives && selected.addressesObjectives.length > 0 && (
          <p className="detail-objectives">
            🎯 Works toward: {selected.addressesObjectives.join(', ')}
          </p>
        )}
        {selected.confidence === 'projected' && (
          <p className="detail-caveat">
            ⚠️ This far out there&apos;s no real recovery data yet -- treat this as the likely
            session <em>type</em>, not a locked prescription. It will adjust automatically
            as each day&apos;s actual readiness comes in.
          </p>
        )}
      </div>
    </div>
  );
}
