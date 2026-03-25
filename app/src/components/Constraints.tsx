import React, { useState, useEffect } from 'react';
import { constraintService, PREDEFINED_CONSTRAINTS } from '../services/constraintService';
import type { UserConstraint, ConstraintCategory } from '../engine/models';
import './Constraints.css';

interface ConstraintsProps {
  userId: string;
  onNavigate?: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
}

export function Constraints({ userId, onNavigate }: ConstraintsProps) {
  const [constraints, setConstraints] = useState<UserConstraint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCustomModal, setShowCustomModal] = useState(false);

  useEffect(() => {
    loadConstraints();
  }, [userId]);

  const loadConstraints = async () => {
    try {
      setLoading(true);
      const allConstraints = await constraintService.listConstraints(userId);
      
      // Ensure all predefined constraints exist
      const existingKeys = allConstraints.map(c => c.key);
      const missingKeys = Object.keys(PREDEFINED_CONSTRAINTS).filter(
        key => !existingKeys.includes(key)
      );
      
      if (missingKeys.length > 0) {
        await constraintService.initializePredefinedConstraints(userId);
        const updated = await constraintService.listConstraints(userId);
        setConstraints(updated);
      } else {
        setConstraints(allConstraints);
      }
    } catch (err) {
      console.error('Error loading constraints:', err);
      setError('Failed to load constraints');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleConstraint = async (key: string, isActive: boolean) => {
    try {
      setError(null);
      await constraintService.toggleConstraint(userId, key, isActive);
      await loadConstraints();
    } catch (err: any) {
      setError(err.message || 'Failed to update constraint');
    }
  };

  const handleAddCustom = async (constraintData: Omit<UserConstraint, 'userId' | 'key' | 'createdAt' | 'updatedAt'>) => {
    try {
      setError(null);
      await constraintService.createCustomConstraint(userId, constraintData);
      await loadConstraints();
      setShowCustomModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create constraint');
    }
  };

  const handleDeleteCustom = async (key: string) => {
    if (!confirm('Are you sure you want to delete this custom constraint?')) return;
    
    try {
      setError(null);
      await constraintService.deleteConstraint(userId, key);
      await loadConstraints();
    } catch (err: any) {
      setError(err.message || 'Failed to delete constraint');
    }
  };

  const constraintsByCategory = constraints.reduce((acc, constraint) => {
    if (!acc[constraint.category]) acc[constraint.category] = [];
    acc[constraint.category].push(constraint);
    return acc;
  }, {} as Record<ConstraintCategory, UserConstraint[]>);

  const customConstraints = constraints.filter(c => 
    c.category === 'custom'
  );

  if (loading) {
    return (
      <div className="constraints-container">
        <div className="loading-state">
          <p>Loading constraints...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="constraints-container">
      <button className="constraints-back-btn" onClick={() => onNavigate?.('home')}>
        ← Back
      </button>

      <div className="constraints-header">
        <h1>Constraints</h1>
        <button 
          className="add-btn"
          onClick={() => setShowCustomModal(true)}
        >
          + Custom
        </button>
      </div>

      <div className="constraints-summary">
        <div className="summary-item">
          <span className="summary-label">Active</span>
          <span className="summary-value">
            {constraints.filter(c => c.isActive).length}
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Hard</span>
          <span className="summary-value hard">
            {constraints.filter(c => c.isActive && c.severity === 'hard').length}
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Soft</span>
          <span className="summary-value soft">
            {constraints.filter(c => c.isActive && c.severity === 'soft').length}
          </span>
        </div>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="constraints-content">
        {/* Equipment Constraints */}
        <ConstraintSection
          title="Equipment"
          constraints={constraintsByCategory.equipment || []}
          onToggle={handleToggleConstraint}
        />

        {/* Physical Cautions */}
        <ConstraintSection
          title="Physical Cautions"
          constraints={constraintsByCategory.physical_caution || []}
          onToggle={handleToggleConstraint}
        />

        {/* Schedule */}
        <ConstraintSection
          title="Schedule"
          constraints={constraintsByCategory.schedule || []}
          onToggle={handleToggleConstraint}
        />

        {/* Environment */}
        <ConstraintSection
          title="Environment"
          constraints={constraintsByCategory.environment || []}
          onToggle={handleToggleConstraint}
        />

        {/* Custom Constraints */}
        {customConstraints.length > 0 && (
          <div className="constraint-section">
            <h2 className="section-title">Custom</h2>
            <div className="constraints-list">
              {customConstraints.map(constraint => (
                <ConstraintItem
                  key={constraint.key}
                  constraint={constraint}
                  onToggle={handleToggleConstraint}
                  onDelete={() => handleDeleteCustom(constraint.key)}
                  canDelete
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Custom Constraint Modal */}
      {showCustomModal && (
        <CustomConstraintModal
          onSave={handleAddCustom}
          onClose={() => setShowCustomModal(false)}
        />
      )}
    </div>
  );
}

interface ConstraintSectionProps {
  title: string;
  constraints: UserConstraint[];
  onToggle: (key: string, isActive: boolean) => void;
}

function ConstraintSection({ title, constraints, onToggle }: ConstraintSectionProps) {
  if (constraints.length === 0) return null;

  return (
    <div className="constraint-section">
      <h2 className="section-title">{title}</h2>
      <div className="constraints-list">
        {constraints.map(constraint => (
          <ConstraintItem
            key={constraint.key}
            constraint={constraint}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

interface ConstraintItemProps {
  constraint: UserConstraint;
  onToggle: (key: string, isActive: boolean) => void;
  onDelete?: () => void;
  canDelete?: boolean;
}

function ConstraintItem({ constraint, onToggle, onDelete, canDelete }: ConstraintItemProps) {
  const [isOn, setIsOn] = useState(constraint.isActive);

  const handleToggle = () => {
    const newState = !isOn;
    setIsOn(newState);
    onToggle(constraint.key, newState);
  };

  const renderValue = () => {
    switch (constraint.type) {
      case 'boolean':
        return null; // Toggle handles it
      case 'number':
        return <span className="constraint-value">{constraint.value}</span>;
      case 'string':
        return <span className="constraint-value">{constraint.value}</span>;
      case 'string_array':
        return (
          <span className="constraint-value">
            {(constraint.value as string[]).join(', ')}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`constraint-item ${isOn ? 'active' : ''}`}>
      <div className="constraint-main">
        <button 
          className={`constraint-toggle ${isOn ? 'on' : ''}`}
          onClick={handleToggle}
        >
          <div className="toggle-slider"></div>
        </button>
        
        <div className="constraint-info">
          <h3>{constraint.displayName}</h3>
          {constraint.description && (
            <p>{constraint.description}</p>
          )}
          {renderValue()}
        </div>
      </div>
      
      <div className="constraint-meta">
        <span className={`severity-badge ${constraint.severity}`}>
          {constraint.severity}
        </span>
        {canDelete && (
          <button 
            className="delete-btn"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

interface CustomConstraintModalProps {
  onSave: (data: any) => void;
  onClose: () => void;
}

function CustomConstraintModal({ onSave, onClose }: CustomConstraintModalProps) {
  const [formData, setFormData] = useState({
    displayName: '',
    description: '',
    type: 'boolean' as 'boolean' | 'number' | 'string' | 'string_array',
    value: false as boolean | number | string | string[],
    severity: 'hard' as const,
    category: 'custom' as const
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const renderValueInput = () => {
    switch (formData.type) {
      case 'boolean':
        return (
          <label className="boolean-input">
            <input
              type="checkbox"
              checked={formData.value as boolean}
              onChange={(e) => setFormData({...formData, value: e.target.checked})}
            />
            <span>Enabled</span>
          </label>
        );
      case 'number':
        return (
          <input
            type="number"
            value={formData.value as number || ''}
            onChange={(e) => setFormData({...formData, value: Number(e.target.value)})}
            placeholder="Enter number"
          />
        );
      case 'string':
        return (
          <input
            type="text"
            value={formData.value as string}
            onChange={(e) => setFormData({...formData, value: e.target.value})}
            placeholder="Enter text"
          />
        );
      case 'string_array':
        return (
          <input
            type="text"
            value={(formData.value as string[]).join(', ')}
            onChange={(e) => setFormData({
              ...formData, 
              value: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
            })}
            placeholder="Enter comma-separated values"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Add Custom Constraint</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="constraint-form">
          <div className="form-group">
            <label>Name *</label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({...formData, displayName: e.target.value})}
              required
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              rows={3}
              placeholder="Optional description"
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({
                  ...formData, 
                  type: e.target.value as any,
                  value: e.target.value === 'boolean' ? false : e.target.value === 'number' ? 0 : ''
                })}
              >
                <option value="boolean">Yes/No</option>
                <option value="number">Number</option>
                <option value="string">Text</option>
                <option value="string_array">Multiple Options</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Severity</label>
              <select
                value={formData.severity}
                onChange={(e) => setFormData({...formData, severity: e.target.value as any})}
              >
                <option value="hard">Hard (Must not violate)</option>
                <option value="soft">Soft (Try to avoid)</option>
              </select>
            </div>
          </div>
          
          <div className="form-group">
            <label>Value</label>
            {renderValueInput()}
          </div>
          
          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-btn">
              Cancel
            </button>
            <button type="submit" className="save-btn">
              Add Constraint
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
