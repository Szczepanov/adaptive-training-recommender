import React, { useState, useEffect, useCallback } from 'react';
import { goalService } from '../services/goalService';
import type { UserGoal, GoalCategory, GoalDomain, GoalStatus, UserEvent } from '../engine/models';
import { deriveGoalCategory, deriveEventPriority, getDaysToEvent, goalToUserEvent, evaluatePeriodizationPhase } from '../engine/periodization';
import { EVENT_PRESETS } from '../engine/eventPresets';
import { getLocalDateString } from '../utils/localDate';
import { getErrorMessage } from '../utils/errors';

const EVENT_CATEGORY_LABELS: Record<UserEvent['category'], string> = {
  cycling_event: 'Cycling event',
  running_race: 'Running race',
  triathlon: 'Triathlon',
  strength_meet: 'Strength meet',
  general_target: 'General target',
};

const EVENT_LIFECYCLE_LABELS: Record<NonNullable<UserGoal['eventLifecycle']>, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  DNS: 'Did not start (DNS)',
  DNF: 'Did not finish (DNF)',
  cancelled: 'Cancelled',
};

type UserGoalWithId = UserGoal & { id: string };
/** Fields the add/edit goal form collects; matches goalService.createGoal's input. */
type GoalInput = Omit<UserGoal, 'userId' | 'createdAt' | 'updatedAt' | 'schemaVersion'>;
import type { Screen } from '../types/navigation';
import './Goals.css';

interface GoalsProps {
  userId: string;
  onNavigate?: (screen: Screen) => void;
}

export function Goals({ userId }: GoalsProps) {
  const [goals, setGoals] = useState<UserGoalWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<UserGoalWithId | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');

  const loadGoals = useCallback(async () => {
    try {
      setLoading(true);
      const allGoals = await goalService.listGoals(userId);
      setGoals(allGoals);
    } catch (err) {
      console.error('Error loading goals:', err);
      setError('Failed to load goals');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  const handlePauseGoal = async (goalId: string) => {
    try {
      setError(null);
      await goalService.pauseGoal(userId, goalId);
      await loadGoals();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to pause goal');
    }
  };

  const handleReactivateGoal = async (goalId: string) => {
    try {
      setError(null);
      await goalService.reactivateGoal(userId, goalId);
      await loadGoals();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to reactivate goal');
    }
  };

  const handleAddGoal = async (goalData: GoalInput) => {
    try {
      setError(null);
      await goalService.createGoal(userId, goalData);
      await loadGoals();
      setShowAddModal(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to create goal');
    }
  };

  const handleUpdateGoal = async (goalId: string, updates: Partial<UserGoal>) => {
    try {
      setError(null);
      await goalService.updateGoal(userId, goalId, updates);
      await loadGoals();
      setEditingGoal(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to update goal');
    }
  };

  const handleArchiveGoal = async (goalId: string) => {
    try {
      setError(null);
      await goalService.archiveGoal(userId, goalId);
      await loadGoals();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to archive goal');
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    if (!confirm('Are you sure you want to delete this goal?')) return;

    try {
      setError(null);
      await goalService.deleteGoal(userId, goalId);
      await loadGoals();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to delete goal');
    }
  };

  // Derive Periodization State directly from canonical engine output
  const activeUserEvents = goals
    .filter(g => g.status === 'active')
    .map(goalToUserEvent)
    .filter((e): e is UserEvent => e !== null);

  const periodizationResult = evaluatePeriodizationPhase(activeUserEvents, getLocalDateString());
  const focusEvent = periodizationResult.focusEvent;
  const daysToFocusEvent = periodizationResult.daysToEvent;
  const currentPhaseName = periodizationResult.phase.phaseName;

  const filteredGoals = goals.filter(goal => {
    if (filter === 'all') return true;
    if (filter === 'active') return goal.status === 'active';
    if (filter === 'archived') return goal.status === 'archived';
    return true;
  });

  const goalsByCategory = filteredGoals.reduce((acc, goal) => {
    if (!acc[goal.category]) acc[goal.category] = [];
    acc[goal.category].push(goal);
    return acc;
  }, {} as Record<GoalCategory, UserGoalWithId[]>);

  const renderStars = (priority: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={`star ${i < priority ? 'filled' : ''}`}>
        ★
      </span>
    ));
  };

  if (loading) {
    return (
      <div className="goals-container">
        <div className="loading-state">
          <p>Loading goals...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="goals-container">
      <div className="goals-header">
        <div>
          <h1>Goals</h1>
          <p className="header-subtitle">Manage short-term targets, race milestones, and long-term athletic goals.</p>
        </div>
        <button
          className="add-btn"
          onClick={() => setShowAddModal(true)}
        >
          + Add Goal
        </button>
      </div>

      <div className="filter-tabs">
        <button
          className={`filter-tab ${filter === 'active' ? 'active' : ''}`}
          onClick={() => setFilter('active')}
        >
          Active
        </button>
        <button
          className={`filter-tab ${filter === 'archived' ? 'active' : ''}`}
          onClick={() => setFilter('archived')}
        >
          Archived
        </button>
        <button
          className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className={`goals-layout-grid ${focusEvent ? 'has-event-panel' : ''}`}>
        <div className="goals-content">
        {Object.entries(goalsByCategory).map(([category, categoryGoals]) => (
          <div key={category} className="category-section">
            <h2 className="category-title">
              {category.replace('-', ' ')}
              <span className="goal-count">({categoryGoals.length})</span>
            </h2>

            <div className="goals-list">
              {categoryGoals.map(goal => (
                <div key={goal.id} className={`goal-card ${goal.status}`}>
                  <div className="goal-header">
                    <h3>
                      {goal.title}
                      {goal.eventCategory && goal.targetDate && (
                        <span className="event-badge">
                          🏁 {EVENT_CATEGORY_LABELS[goal.eventCategory]} · {(() => {
                            const days = getDaysToEvent(goal.targetDate, getLocalDateString());
                            return days >= 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
                          })()}
                        </span>
                      )}
                    </h3>
                    <div className="goal-actions">
                      <button
                        onClick={() => setEditingGoal(goal)}
                        className="action-btn edit"
                      >
                        Edit
                      </button>
                      {goal.status === 'active' ? (
                        <>
                          <button
                            onClick={() => handlePauseGoal(goal.id)}
                            className="action-btn edit"
                          >
                            Pause
                          </button>
                          <button
                            onClick={() => handleArchiveGoal(goal.id)}
                            className="action-btn archive"
                          >
                            Archive
                          </button>
                        </>
                      ) : goal.status === 'paused' ? (
                        <>
                          <button
                            onClick={() => handleReactivateGoal(goal.id)}
                            className="action-btn edit"
                          >
                            Reactivate
                          </button>
                          <button
                            onClick={() => handleArchiveGoal(goal.id)}
                            className="action-btn archive"
                          >
                            Archive
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleDeleteGoal(goal.id)}
                          className="action-btn delete"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {goal.description && (
                    <p className="goal-description">{goal.description}</p>
                  )}

                  <div className="goal-meta">
                    <div className="goal-priority">
                      Priority: {renderStars(goal.priority)}
                      {goal.eventCategory && (
                        <span className="taper-class-badge" title="Taper aggressiveness, derived from priority">
                          Taper class {deriveEventPriority(goal.priority)}
                        </span>
                      )}
                    </div>
                    <div className="goal-domain">
                      {goal.domain}
                    </div>
                    {goal.eventCategory && goal.eventLifecycle && goal.eventLifecycle !== 'scheduled' && (
                      <div className="goal-event-status">
                        {EVENT_LIFECYCLE_LABELS[goal.eventLifecycle]}
                      </div>
                    )}
                  </div>

                  {goal.targetMetric && (
                    <div className="goal-target">
                      Target: {goal.targetValue} {goal.targetUnit}
                    </div>
                  )}

                  {goal.targetDate && (
                    <div className="goal-date">
                      Target date: {new Date(goal.targetDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
              ))}

              {categoryGoals.length === 0 && (
                <p className="empty-category">No {filter} goals in this category</p>
              )}
            </div>
          </div>
        ))}

        {filteredGoals.length === 0 && (
          <div className="empty-state">
            <p>No goals yet</p>
            <button
              className="add-btn"
              onClick={() => setShowAddModal(true)}
            >
              Create your first goal
            </button>
          </div>
        )}
      </div>

      {focusEvent && (
        <aside className="event-prep-sidebar">
          <div className="event-prep-card">
            <div className="event-prep-header">
              <h3>EVENT PREPARATION</h3>
              <span className="event-prep-badge">
                {currentPhaseName}
              </span>
            </div>

            <h4 className="event-prep-title">{focusEvent.title}</h4>
            <div className="event-prep-countdown">
              🏁 {daysToFocusEvent !== null && daysToFocusEvent >= 0 ? `In ${daysToFocusEvent} days` : 'Today'} · {focusEvent.date}
            </div>

            <div className="event-prep-item">
              <span className="prep-label">Governing Phase:</span>
              <span className="prep-value">{currentPhaseName}</span>
            </div>

            <div className="event-prep-item">
              <span className="prep-label">Event Importance:</span>
              <span className="prep-value">
                Priority {focusEvent.priority} {focusEvent.priority === 'A' ? '(Top Priority)' : focusEvent.priority === 'B' ? '(Mid Priority)' : '(Train Through)'}
              </span>
            </div>

            <div className="event-prep-item">
              <span className="prep-label">Event Category:</span>
              <span className="prep-value">{EVENT_CATEGORY_LABELS[focusEvent.category]}</span>
            </div>
          </div>
        </aside>
      )}
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingGoal) && (
        <GoalModal
          goal={editingGoal}
          onSave={editingGoal
            ? (updates) => handleUpdateGoal(editingGoal.id, updates)
            : handleAddGoal
          }
          onClose={() => {
            setShowAddModal(false);
            setEditingGoal(null);
          }}
        />
      )}
    </div>
  );
}

interface GoalModalProps {
  goal: UserGoalWithId | null;
  onSave: (data: GoalInput) => void;
  onClose: () => void;
}

function GoalModal({ goal, onSave, onClose }: GoalModalProps) {
  const today = getLocalDateString();
  const modalRef = React.useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    title: goal?.title || '',
    description: goal?.description || '',
    isOpenEnded: !goal?.targetDate,
    category: goal?.category || 'short-term' as GoalCategory,
    targetDate: goal?.targetDate || '',
    domain: goal?.domain || 'general_fitness' as GoalDomain,
    priority: goal?.priority || 3,
    status: goal?.status || 'active' as GoalStatus,
    isEvent: !!goal?.eventCategory,
    eventCategory: goal?.eventCategory || '' as UserEvent['category'] | '',
    eventPreset: goal?.eventPreset || '',
    eventLifecycle: goal?.eventLifecycle || 'scheduled' as NonNullable<UserGoal['eventLifecycle']>,
    taperStartDate: goal?.taper?.startDate || '',
    targetOutcome: goal?.targetOutcome || '',
    targetMetric: goal?.targetMetric || '',
    targetValue: goal?.targetValue || '',
    targetUnit: goal?.targetUnit || ''
  });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const titleInput = modalRef.current?.querySelector<HTMLInputElement>('input[type="text"]');
    titleInput?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const derivedCategory = !formData.isOpenEnded && formData.targetDate
    ? deriveGoalCategory(formData.targetDate, today)
    : null;

  const presetsForCategory = formData.eventCategory ? EVENT_PRESETS[formData.eventCategory] : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const isDatedEvent = !formData.isOpenEnded && formData.isEvent && formData.eventCategory;

    const data = {
      title: formData.title,
      description: formData.description || null,
      category: formData.isOpenEnded
        ? formData.category
        : deriveGoalCategory(formData.targetDate, today),
      domain: formData.domain,
      priority: formData.priority,
      status: formData.status,
      targetMetric: formData.targetMetric || null,
      targetValue: formData.targetValue ? Number(formData.targetValue) : null,
      targetUnit: formData.targetUnit || null,
      targetDate: formData.isOpenEnded ? null : (formData.targetDate || null),
      targetOutcome: formData.targetOutcome || null,
      eventCategory: isDatedEvent ? (formData.eventCategory as UserEvent['category']) : null,
      eventPreset: isDatedEvent ? (formData.eventPreset || null) : null,
      eventLifecycle: isDatedEvent ? formData.eventLifecycle : undefined,
      taper: isDatedEvent && formData.taperStartDate ? { startDate: formData.taperStartDate } : null,
    };

    onSave(data);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="goal-modal-title">{goal ? 'Edit Goal' : 'Add New Goal'}</h2>
          <button onClick={onClose} className="close-btn" aria-label="Close goal dialog">×</button>
        </div>

        <form onSubmit={handleSubmit} className="goal-form">
          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              required
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              rows={3}
            />
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={formData.isOpenEnded}
                onChange={(e) => setFormData({...formData, isOpenEnded: e.target.checked, isEvent: e.target.checked ? false : formData.isEvent})}
              />
              {' '}Open-ended goal (no exact date)
            </label>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Target Date</label>
              <input
                type="date"
                value={formData.targetDate}
                disabled={formData.isOpenEnded}
                onChange={(e) => setFormData({...formData, targetDate: e.target.value})}
                required={!formData.isOpenEnded}
              />
            </div>

            <div className="form-group">
              <label>Category</label>
              {formData.isOpenEnded ? (
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({...formData, category: e.target.value as GoalCategory})}
                >
                  <option value="short-term">Short-term</option>
                  <option value="mid-term">Mid-term</option>
                  <option value="long-term">Long-term</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={derivedCategory ? derivedCategory.replace('-', ' ') : '—'}
                  disabled
                  title="Derived from the target date -- can't be edited directly"
                />
              )}
            </div>
          </div>

          {!formData.isOpenEnded && formData.targetDate && (
            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={formData.isEvent}
                  onChange={(e) => setFormData({...formData, isEvent: e.target.checked})}
                />
                {' '}This is a race / key event
              </label>
            </div>
          )}

          {!formData.isOpenEnded && formData.isEvent && (
            <div className="form-section event-section">
              <div className="form-row">
                <div className="form-group">
                  <label>Event type</label>
                  <select
                    value={formData.eventCategory}
                    required={formData.isEvent}
                    onChange={(e) => {
                      const nextCategory = e.target.value as UserEvent['category'];
                      setFormData({...formData, eventCategory: nextCategory, eventPreset: EVENT_PRESETS[nextCategory][0].id});
                    }}
                  >
                    <option value="" disabled>Select event type…</option>
                    {(Object.keys(EVENT_CATEGORY_LABELS) as UserEvent['category'][]).map(cat => (
                      <option key={cat} value={cat}>{EVENT_CATEGORY_LABELS[cat]}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Event style</label>
                  <select
                    value={formData.eventPreset}
                    disabled={!formData.eventCategory}
                    required={formData.isEvent}
                    onChange={(e) => setFormData({...formData, eventPreset: e.target.value})}
                  >
                    {presetsForCategory.map(preset => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="taper-class-preview">
                Taper class: <strong>{deriveEventPriority(formData.priority)}</strong>
                {' '}(from priority, below — 5★ = A, 3-4★ = B, 1-2★ = C)
              </p>

              <div className="form-group">
                <label>Custom taper start (optional)</label>
                <input
                  type="date"
                  value={formData.taperStartDate}
                  onChange={(e) => setFormData({...formData, taperStartDate: e.target.value})}
                />
                <p className="field-hint">Leave blank to use the event policy. A custom date must be before the planned event.</p>
              </div>

              {goal && (
                <div className="form-group">
                  <label>Event status</label>
                  <select
                    value={formData.eventLifecycle}
                    onChange={(e) => setFormData({...formData, eventLifecycle: e.target.value as NonNullable<UserGoal['eventLifecycle']>})}
                  >
                    {(Object.keys(EVENT_LIFECYCLE_LABELS) as NonNullable<UserGoal['eventLifecycle']>[]).map(lc => (
                      <option key={lc} value={lc}>{EVENT_LIFECYCLE_LABELS[lc]}</option>
                    ))}
                  </select>
                  <p className="field-hint">Rescheduling? Just change the target date above -- it stays "Scheduled".</p>
                </div>
              )}

              <div className="form-group">
                <label>Target outcome (optional)</label>
                <input
                  type="text"
                  value={formData.targetOutcome}
                  onChange={(e) => setFormData({...formData, targetOutcome: e.target.value})}
                  placeholder="e.g., sub-5h finish"
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Domain</label>
            <select
              value={formData.domain}
              onChange={(e) => setFormData({...formData, domain: e.target.value as GoalDomain})}
            >
              <option value="endurance">Endurance</option>
              <option value="strength">Strength</option>
              <option value="mobility">Mobility</option>
              <option value="weight_loss">Weight Loss</option>
              <option value="general_fitness">General Fitness</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="form-group">
            <label>Priority</label>
            <div className="priority-selector">
              {[1, 2, 3, 4, 5].map(value => (
                <button
                  key={value}
                  type="button"
                  className={`priority-btn ${value <= formData.priority ? 'active' : ''}`}
                  onClick={() => setFormData({...formData, priority: value})}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          {goal && (
            <div className="form-group">
              <label>Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({...formData, status: e.target.value as GoalStatus})}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          )}

          <div className="form-section">
            <h3>Optional Target</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Metric</label>
                <input
                  type="text"
                  value={formData.targetMetric}
                  onChange={(e) => setFormData({...formData, targetMetric: e.target.value})}
                  placeholder="e.g., 5k time"
                />
              </div>

              <div className="form-group">
                <label>Value</label>
                <input
                  type="number"
                  value={formData.targetValue}
                  onChange={(e) => setFormData({...formData, targetValue: e.target.value})}
                  placeholder="e.g., 25"
                />
              </div>

              <div className="form-group">
                <label>Unit</label>
                <input
                  type="text"
                  value={formData.targetUnit}
                  onChange={(e) => setFormData({...formData, targetUnit: e.target.value})}
                  placeholder="e.g., minutes"
                />
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-btn">
              Cancel
            </button>
            <button type="submit" className="save-btn">
              {goal ? 'Update' : 'Create'} Goal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
