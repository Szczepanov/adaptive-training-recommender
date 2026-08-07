import { useState } from 'react';
import type { WeekAheadDay, WeekAheadPlan } from '../engine/planner';
import './WeekAheadStrip.css';

interface WeekAheadStripProps {
  plan: WeekAheadPlan | null;
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
  confirmed: 'Confirmed',
  provisional: 'Provisional',
  projected: 'Projected',
};

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

function weekdayLabel(dateStr: string): string {
  // dateStr is an already-local YYYY-MM-DD calendar date; parsing as UTC midnight and
  // formatting in UTC avoids the date shifting a day in either direction depending on
  // the browser's own timezone offset.
  return WEEKDAY_FORMATTER.format(new Date(dateStr + 'T00:00:00Z'));
}

/**
 * Rolling 7-day horizontal strip built on top of planner.ts's generateWeekAheadPlan.
 * Deliberately re-renders from whatever `plan` the parent recomputed on this load --
 * nothing here is cached or persisted, so a goal/constraint/check-in edit that changes
 * the underlying plan is reflected immediately on the next render.
 */
export function WeekAheadStrip({ plan }: WeekAheadStripProps) {
  const [selectedIndex, setSelectedIndex] = useState(1);

  if (!plan || plan.days.length === 0) return null;

  // Clamp during render rather than syncing via an effect (e.g. if options.days ever
  // shrinks the plan out from under an out-of-range selection) -- avoids the extra
  // render-then-correct cascade an effect-based reset would cause.
  const safeIndex = Math.min(selectedIndex, plan.days.length - 1);
  const selected = plan.days[safeIndex];

  return (
    <div className="dashboard-card week-ahead-card">
      <div className="card-header">
        <div className="header-title-group">
          <h3>Next 7 Days</h3>
          <span className="provisional-tag">Recalculates daily as your data changes</span>
        </div>
      </div>

      <div className="week-ahead-strip">
        {plan.days.map((day, index) => (
          <button
            key={day.date}
            type="button"
            className={`week-ahead-tile confidence-${day.confidence} ${index === safeIndex ? 'selected' : ''}`}
            onClick={() => setSelectedIndex(index)}
          >
            <span className="tile-weekday">{index === 0 ? 'Today' : weekdayLabel(day.date)}</span>
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
          <span className={`status-badge ${selected.confidence === 'confirmed' ? 'success' : 'info'}`}>
            {CONFIDENCE_LABEL[selected.confidence]}
          </span>
        </div>
        <p className="detail-meta">
          {selected.template.category} · {selected.template.durationMin}-{selected.template.durationMax} min · {selected.phaseName} phase
        </p>
        <p className="detail-rationale">{selected.rationale}</p>
        {selected.addressesObjectives.length > 0 && (
          <p className="detail-objectives">
            Works toward: {selected.addressesObjectives.join(', ')}
          </p>
        )}
        {selected.confidence === 'projected' && (
          <p className="detail-caveat">
            ⚠️ This far out there's no real recovery data yet -- treat this as the likely
            session <em>type</em>, not a locked prescription. It will adjust automatically
            as each day's actual readiness comes in.
          </p>
        )}
      </div>
    </div>
  );
}
