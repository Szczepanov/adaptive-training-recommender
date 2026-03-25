import React, { useState, useEffect } from 'react';
import { goalService } from '../services/goalService';
import type { UserGoal, GoalCategory, GoalStatus } from '../engine/models';

type UserGoalWithId = UserGoal & { id: string };
import './Goals.css';

interface GoalsProps {
  userId: string;
  onNavigate?: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
}

export function Goals({ userId, onNavigate }: GoalsProps) {
  const [goals, setGoals] = useState<UserGoalWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<UserGoalWithId | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');

  useEffect(() => {
    loadGoals();
  }, [userId]);

  const loadGoals = async () => {
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
  };

  const handlePauseGoal = async (goalId: string) => {
    try {
      setError(null);
      await goalService.pauseGoal(userId, goalId);
      await loadGoals();
    } catch (err: any) {
      setError(err.message || 'Failed to pause goal');
    }
  };

  const handleReactivateGoal = async (goalId: string) => {
    try {
      setError(null);
      await goalService.reactivateGoal(userId, goalId);
      await loadGoals();
    } catch (err: any) {
      setError(err.message || 'Failed to reactivate goal');
    }
  };

  const handleAddGoal = async (goalData: Omit<UserGoal, 'userId' | 'createdAt' | 'updatedAt'>) => {
    try {
      setError(null);
      await goalService.createGoal(userId, goalData);
      await loadGoals();
      setShowAddModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create goal');
    }
  };

  const handleUpdateGoal = async (goalId: string, updates: Partial<UserGoal>) => {
    try {
      setError(null);
      await goalService.updateGoal(userId, goalId, updates);
      await loadGoals();
      setEditingGoal(null);
    } catch (err: any) {
      setError(err.message || 'Failed to update goal');
    }
  };

  const handleArchiveGoal = async (goalId: string) => {
    try {
      setError(null);
      await goalService.archiveGoal(userId, goalId);
      await loadGoals();
    } catch (err: any) {
      setError(err.message || 'Failed to archive goal');
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    if (!confirm('Are you sure you want to delete this goal?')) return;
    
    try {
      setError(null);
      await goalService.deleteGoal(userId, goalId);
      await loadGoals();
    } catch (err: any) {
      setError(err.message || 'Failed to delete goal');
    }
  };

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
      <button className="goals-back-btn" onClick={() => onNavigate?.('home')}>
        ← Back
      </button>

      <div className="goals-header">
        <h1>Goals</h1>
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
                    <h3>{goal.title}</h3>
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
                    </div>
                    <div className="goal-domain">
                      {goal.domain}
                    </div>
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
  onSave: (data: any) => void;
  onClose: () => void;
}

function GoalModal({ goal, onSave, onClose }: GoalModalProps) {
  const [formData, setFormData] = useState({
    title: goal?.title || '',
    description: goal?.description || '',
    category: goal?.category || 'short-term' as GoalCategory,
    domain: goal?.domain || 'general_fitness' as any,
    priority: goal?.priority || 3,
    status: goal?.status || 'active' as GoalStatus,
    targetMetric: goal?.targetMetric || '',
    targetValue: goal?.targetValue || '',
    targetUnit: goal?.targetUnit || '',
    targetDate: goal?.targetDate || ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const data = {
      title: formData.title,
      description: formData.description || null,
      category: formData.category,
      domain: formData.domain,
      priority: formData.priority,
      status: formData.status,
      targetMetric: formData.targetMetric || null,
      targetValue: formData.targetValue ? Number(formData.targetValue) : null,
      targetUnit: formData.targetUnit || null,
      targetDate: formData.targetDate || null
    };
    
    onSave(data);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>{goal ? 'Edit Goal' : 'Add New Goal'}</h2>
          <button onClick={onClose} className="close-btn">×</button>
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
          
          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value as GoalCategory})}
              >
                <option value="short-term">Short-term</option>
                <option value="mid-term">Mid-term</option>
                <option value="long-term">Long-term</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Domain</label>
              <select
                value={formData.domain}
                onChange={(e) => setFormData({...formData, domain: e.target.value})}
              >
                <option value="endurance">Endurance</option>
                <option value="strength">Strength</option>
                <option value="mobility">Mobility</option>
                <option value="weight_loss">Weight Loss</option>
                <option value="general_fitness">General Fitness</option>
                <option value="other">Other</option>
              </select>
            </div>
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
            
            <div className="form-group">
              <label>Target Date</label>
              <input
                type="date"
                value={formData.targetDate}
                onChange={(e) => setFormData({...formData, targetDate: e.target.value})}
              />
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
